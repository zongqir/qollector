use super::*;

pub(super) async fn spawn_discovery_listener(
    service: &Arc<LanSyncService>,
    config: LanSyncConfig,
    mut stop_rx: watch::Receiver<bool>,
) -> Result<(), String> {
    let listen_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), config.discovery_port);
    let socket = UdpSocket::bind(listen_addr)
        .await
        .map_err(|e| format!("Failed to bind discovery listener: {}", e))?;

    let service = service.clone();
    tokio::spawn(async move {
        let mut buffer = vec![0_u8; 8192];
        loop {
            tokio::select! {
                changed = stop_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                recv = socket.recv_from(&mut buffer) => {
                    let Ok((len, sender)) = recv else { continue; };
                    let payload = &buffer[..len];
                    let packet = serde_json::from_slice::<DiscoveryPacket>(payload);
                    let Ok(packet) = packet else { continue; };
                    if packet.kind != DISCOVERY_KIND {
                        continue;
                    }
                    let identity = service.get_identity().await;
                    if packet.device_id == identity.device_id {
                        continue;
                    }

                    let host = sender.ip().to_string();
                    let now_ms = LanSyncService::now_unix_ms();
                    {
                        let mut map = service.discovered.lock().await;
                        map.insert(packet.device_id.clone(), DiscoveredSyncDevice {
                            device_id: packet.device_id.clone(),
                            device_name: packet.device_name.clone(),
                            host: host.clone(),
                            service_port: packet.service_port,
                            last_seen_ms: now_ms,
                        });
                        let ttl_ms = config.discovery_ttl_ms as i64;
                        map.retain(|_, device| now_ms.saturating_sub(device.last_seen_ms) <= ttl_ms);
                    }

                    let _ = service.manager.touch_paired_sync_device(
                        &packet.device_id,
                        Some(&host),
                        Some(packet.service_port),
                    ).await;
                }
            }
        }
    });

    Ok(())
}

pub(super) async fn spawn_discovery_broadcast(
    service: &Arc<LanSyncService>,
    config: LanSyncConfig,
    mut stop_rx: watch::Receiver<bool>,
) -> Result<(), String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|e| format!("Failed to bind discovery broadcaster: {}", e))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Failed to enable broadcast: {}", e))?;

    let target = SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), config.discovery_port);
    let service = service.clone();
    tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_millis(config.discovery_interval_ms));
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                changed = stop_rx.changed() => {
                    if changed.is_ok() {
                        break;
                    }
                }
                _ = ticker.tick() => {
                    let identity = service.get_identity().await;
                    let payload = DiscoveryPacket {
                        kind: DISCOVERY_KIND.to_string(),
                        device_id: identity.device_id,
                        device_name: identity.device_name,
                        service_port: config.service_port,
                        ts_ms: LanSyncService::now_unix_ms(),
                    };
                    if let Ok(raw) = serde_json::to_vec(&payload) {
                        let _ = socket.send_to(&raw, target).await;
                    }

                    let now_ms = LanSyncService::now_unix_ms();
                    let ttl_ms = config.discovery_ttl_ms as i64;
                    service
                        .discovered
                        .lock()
                        .await
                        .retain(|_, device| now_ms.saturating_sub(device.last_seen_ms) <= ttl_ms);
                }
            }
        }
    });

    Ok(())
}
