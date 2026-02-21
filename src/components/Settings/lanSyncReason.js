const DIRECT_REASON_KEY_MAP = {
  stale_version: 'settings.lanSync.reason.staleVersion',
  duplicate_or_same_version: 'settings.lanSync.reason.duplicateOrSameVersion',
  remote_slot_empty: 'settings.lanSync.reason.remoteSlotEmpty',
  local_sync_slot_is_empty: 'settings.lanSync.reason.localSlotEmpty',
  invalid_payload_json: 'settings.lanSync.reason.invalidPayloadJson',
  invalid_payload_type: 'settings.lanSync.reason.invalidPayloadType',
  invalid_source_device_id: 'settings.lanSync.reason.invalidSourceDeviceId',
  invalid_source_seq: 'settings.lanSync.reason.invalidSourceSeq',
  invalid_logical_ts_ms: 'settings.lanSync.reason.invalidLogicalTs',
  invalid_content_hash: 'settings.lanSync.reason.invalidContentHash',
  unauthorized: 'settings.lanSync.reason.unauthorized',
  device_not_paired: 'settings.lanSync.reason.deviceNotPaired',
  invalid_pair_token: 'settings.lanSync.reason.invalidPairToken',
  pair_code_not_active: 'settings.lanSync.reason.pairCodeNotActive',
  pair_code_locked: 'settings.lanSync.reason.pairCodeLocked',
  pair_code_expired: 'settings.lanSync.reason.pairCodeExpired',
  pair_code_mismatch: 'settings.lanSync.reason.pairCodeMismatch',
  pair_internal_error: 'settings.lanSync.reason.pairInternalError',
  pair_rejected: 'settings.lanSync.reason.pairRejected',
  missing_pair_token: 'settings.lanSync.reason.missingPairToken',
};

const asTrimmedString = (value) => String(value ?? '').trim();

export function humanizeLanReason(t, rawReason) {
  const reason = asTrimmedString(rawReason);
  if (!reason) return t('settings.lanSync.reason.unknown');

  const directKey = DIRECT_REASON_KEY_MAP[reason];
  if (directKey) return t(directKey);

  if (reason.startsWith('sync_push_http_')) {
    return t('settings.lanSync.reason.httpStatus', {
      status: reason.slice('sync_push_http_'.length),
    });
  }
  if (reason.startsWith('sync_pull_http_')) {
    return t('settings.lanSync.reason.httpStatus', {
      status: reason.slice('sync_pull_http_'.length),
    });
  }
  if (reason.startsWith('apply_error:')) {
    return t('settings.lanSync.reason.applyError', {
      error: asTrimmedString(reason.slice('apply_error:'.length)) || reason,
    });
  }

  const lower = reason.toLowerCase();
  if (lower.includes('target_host is required')) return t('settings.lanSync.reason.targetHostRequired');
  if (lower.includes('pair code is required')) return t('settings.lanSync.reason.pairCodeRequired');
  if (lower.startsWith('paired device not found:')) return t('settings.lanSync.reason.deviceNotPaired');
  if (lower.startsWith('no host available for paired device:')) return t('settings.lanSync.reason.noKnownHost');
  if (lower.startsWith('no port available for paired device:')) return t('settings.lanSync.reason.noKnownPort');
  if (lower.includes('timed out') || lower.includes('timeout')) return t('settings.lanSync.reason.requestTimeout');
  if (lower.startsWith('pair request failed:')) return t('settings.lanSync.reason.pairRequestFailed');
  if (lower.startsWith('sync push failed:')) return t('settings.lanSync.reason.syncPushFailed');
  if (lower.startsWith('sync pull failed:')) return t('settings.lanSync.reason.syncPullFailed');
  if (lower.startsWith('failed to build http client:')) return t('settings.lanSync.reason.httpClientBuildFailed');
  if (lower.startsWith('invalid pair response:')) return t('settings.lanSync.reason.invalidPairResponse');
  if (lower.startsWith('invalid sync push response:')) return t('settings.lanSync.reason.invalidPushResponse');
  if (lower.startsWith('invalid sync pull response:')) return t('settings.lanSync.reason.invalidPullResponse');
  if (lower.startsWith('invalid target url:')) return t('settings.lanSync.reason.invalidTargetUrl');

  return reason;
}
