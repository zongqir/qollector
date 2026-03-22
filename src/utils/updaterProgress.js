export function createUpdaterProgressHandler({
  onDownloadStart,
  onDownloadProgress,
  onInstalling,
}) {
  let totalBytes = null;
  let downloadedBytes = 0;

  return (event) => {
    if (event?.event === 'Started') {
      downloadedBytes = 0;
      const contentLength = Number(event.data?.contentLength);
      totalBytes = Number.isFinite(contentLength) && contentLength > 0
        ? contentLength
        : null;

      onDownloadStart?.({ totalBytes });
      return;
    }

    if (event?.event === 'Progress') {
      downloadedBytes += Number(event.data?.chunkLength || 0);
      if (!totalBytes) return;

      const percent = Math.min((downloadedBytes / totalBytes) * 100, 100);
      onDownloadProgress?.({ percent, downloadedBytes, totalBytes });
      return;
    }

    if (event?.event === 'Finished') {
      if (totalBytes) {
        onDownloadProgress?.({ percent: 100, downloadedBytes: totalBytes, totalBytes });
      }
      onInstalling?.();
    }
  };
}
