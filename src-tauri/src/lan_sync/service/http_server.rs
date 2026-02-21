use super::protocol::{
    HealthResponseBody, LatestQuery, LatestResponseBody, PairRequestBody, PairResponseBody,
    PushRequestBody, PushResponseBody,
};
use super::*;
use std::convert::Infallible;
use warp::http::StatusCode;
use warp::Filter;

pub(super) async fn spawn_http_server(
    service: &Arc<LanSyncService>,
    service_port: u16,
    mut stop_rx: watch::Receiver<bool>,
) {
    let service = service.clone();

    let health_route = warp::path!("lan-sync" / "health")
        .and(warp::get())
        .and(with_service(service.clone()))
        .and_then(handle_health_request);

    let pair_route = warp::path!("lan-sync" / "pair" / "request")
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::addr::remote())
        .and(with_service(service.clone()))
        .and_then(handle_pair_request);

    let push_route = warp::path!("lan-sync" / "sync" / "push")
        .and(warp::post())
        .and(warp::body::json())
        .and(warp::addr::remote())
        .and(with_service(service.clone()))
        .and_then(handle_push_request);

    let latest_route = warp::path!("lan-sync" / "latest")
        .and(warp::get())
        .and(warp::query::<LatestQuery>())
        .and(warp::addr::remote())
        .and(with_service(service))
        .and_then(handle_latest_request);

    let routes = health_route.or(pair_route).or(push_route).or(latest_route);
    let bind_address = ([0, 0, 0, 0], service_port);

    tokio::spawn(async move {
        let (_, server) = warp::serve(routes).bind_with_graceful_shutdown(
            bind_address,
            async move {
                let _ = stop_rx.changed().await;
            },
        );
        server.await;
    });
}

fn with_service(
    service: Arc<LanSyncService>,
) -> impl Filter<Extract = (Arc<LanSyncService>,), Error = Infallible> + Clone {
    warp::any().map(move || service.clone())
}

async fn verify_pair_token(
    service: &LanSyncService,
    device_id: &str,
    pair_token: &str,
) -> Result<PairedSyncDevice, String> {
    let device = service
        .manager
        .get_paired_sync_device(device_id)
        .await?
        .ok_or_else(|| "device_not_paired".to_string())?;
    if device.pair_token != pair_token {
        return Err("invalid_pair_token".to_string());
    }
    Ok(device)
}

async fn try_accept_pair(
    service: &LanSyncService,
    request: &PairRequestBody,
    remote: Option<SocketAddr>,
) -> Result<PairResponseBody, StatusCode> {
    if request.requester_device_id.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if request.requester_device_name.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if request.code.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let config = service.get_config().await;
    let identity = service.get_identity().await;
    let now_ms = LanSyncService::now_unix_ms();

    let mut pair_state = service.pair_code.lock().await;
    let Some(active) = pair_state.as_mut() else {
        return Ok(PairResponseBody {
            accepted: false,
            reason: "pair_code_not_active".to_string(),
            device_id: identity.device_id.clone(),
            device_name: identity.device_name.clone(),
            pair_token: None,
            latest_slot: None,
        });
    };

    if active.locked_until_ms > now_ms {
        return Ok(PairResponseBody {
            accepted: false,
            reason: "pair_code_locked".to_string(),
            device_id: identity.device_id.clone(),
            device_name: identity.device_name.clone(),
            pair_token: None,
            latest_slot: None,
        });
    }

    if now_ms > active.expires_at_ms {
        *pair_state = None;
        return Ok(PairResponseBody {
            accepted: false,
            reason: "pair_code_expired".to_string(),
            device_id: identity.device_id.clone(),
            device_name: identity.device_name.clone(),
            pair_token: None,
            latest_slot: None,
        });
    }

    if active.code != request.code.trim() {
        active.failed_attempts = active.failed_attempts.saturating_add(1);
        if active.failed_attempts >= config.pair_max_failures {
            active.locked_until_ms = now_ms.saturating_add((config.pair_lockout_secs * 1000) as i64);
            active.failed_attempts = 0;
        }
        return Ok(PairResponseBody {
            accepted: false,
            reason: "pair_code_mismatch".to_string(),
            device_id: identity.device_id.clone(),
            device_name: identity.device_name.clone(),
            pair_token: None,
            latest_slot: None,
        });
    }

    *pair_state = None;
    drop(pair_state);

    let pair_token = uuid::Uuid::new_v4().to_string();
    let host = remote.map(|addr| addr.ip().to_string());

    let stored = service
        .manager
        .upsert_paired_sync_device(
            &request.requester_device_id,
            &request.requester_device_name,
            &pair_token,
            host.as_deref(),
            Some(request.requester_service_port),
        )
        .await;
    if stored.is_err() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let latest_slot = service.manager.get_sync_latest_slot().await.ok().flatten();

    Ok(PairResponseBody {
        accepted: true,
        reason: "paired".to_string(),
        device_id: identity.device_id,
        device_name: identity.device_name,
        pair_token: Some(pair_token),
        latest_slot,
    })
}

async fn handle_health_request(service: Arc<LanSyncService>) -> Result<impl warp::Reply, Infallible> {
    let identity = service.get_identity().await;
    let config = service.get_config().await;
    let body = HealthResponseBody {
        device_id: identity.device_id,
        device_name: identity.device_name,
        service_port: config.service_port,
        server_time_ms: LanSyncService::now_unix_ms(),
    };
    Ok(warp::reply::with_status(
        warp::reply::json(&body),
        StatusCode::OK,
    ))
}

async fn handle_pair_request(
    request: PairRequestBody,
    remote: Option<SocketAddr>,
    service: Arc<LanSyncService>,
) -> Result<impl warp::Reply, Infallible> {
    let response = try_accept_pair(service.as_ref(), &request, remote).await;
    match response {
        Ok(body) => Ok(warp::reply::with_status(
            warp::reply::json(&body),
            if body.accepted {
                StatusCode::OK
            } else {
                StatusCode::UNAUTHORIZED
            },
        )),
        Err(code) => {
            let identity = service.get_identity().await;
            Ok(warp::reply::with_status(
                warp::reply::json(&PairResponseBody {
                    accepted: false,
                    reason: "pair_internal_error".to_string(),
                    device_id: identity.device_id,
                    device_name: identity.device_name,
                    pair_token: None,
                    latest_slot: None,
                }),
                code,
            ))
        }
    }
}

async fn handle_push_request(
    request: PushRequestBody,
    remote: Option<SocketAddr>,
    service: Arc<LanSyncService>,
) -> Result<impl warp::Reply, Infallible> {
    let verified = verify_pair_token(service.as_ref(), &request.from_device_id, &request.pair_token).await;
    if verified.is_err() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&PushResponseBody {
                result: SyncApplyResult {
                    applied: false,
                    reason: "unauthorized".to_string(),
                    slot: None,
                },
            }),
            StatusCode::UNAUTHORIZED,
        ));
    }

    if let Some(addr) = remote {
        let host = addr.ip().to_string();
        let _ = service
            .manager
            .touch_paired_sync_device(
                &request.from_device_id,
                Some(&host),
                Some(request.from_service_port),
            )
            .await;
    }

    let apply_result = service.manager.apply_remote_sync_slot(request.slot).await;
    match apply_result {
        Ok(result) => Ok(warp::reply::with_status(
            warp::reply::json(&PushResponseBody { result }),
            StatusCode::OK,
        )),
        Err(error) => Ok(warp::reply::with_status(
            warp::reply::json(&PushResponseBody {
                result: SyncApplyResult {
                    applied: false,
                    reason: format!("apply_error:{}", error),
                    slot: None,
                },
            }),
            StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

async fn handle_latest_request(
    query: LatestQuery,
    remote: Option<SocketAddr>,
    service: Arc<LanSyncService>,
) -> Result<impl warp::Reply, Infallible> {
    let verified = verify_pair_token(service.as_ref(), &query.device_id, &query.pair_token).await;
    if verified.is_err() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&LatestResponseBody { slot: None }),
            StatusCode::UNAUTHORIZED,
        ));
    }

    if let Some(addr) = remote {
        let host = addr.ip().to_string();
        let _ = service
            .manager
            .touch_paired_sync_device(&query.device_id, Some(&host), None)
            .await;
    }

    let slot = service
        .manager
        .get_sync_latest_slot()
        .await
        .ok()
        .flatten();
    Ok(warp::reply::with_status(
        warp::reply::json(&LatestResponseBody { slot }),
        StatusCode::OK,
    ))
}
