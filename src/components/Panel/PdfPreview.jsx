import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

function PdfPreview({ src }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let pdfDoc = null;

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString();

        const loadingTask = pdfjsLib.getDocument(src);
        pdfDoc = await loadingTask.promise;
        if (cancelled) { pdfDoc.destroy(); return; }

        const page = await pdfDoc.getPage(1);
        if (cancelled) { pdfDoc.destroy(); return; }

        const canvas = canvasRef.current;
        if (!canvas) { pdfDoc.destroy(); return; }

        // Scale to fit ~400px width
        const desiredWidth = 400;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = desiredWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
        }).promise;

        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfDoc) pdfDoc.destroy();
    };
  }, [src]);

  if (error) {
    return <div className="file-preview-error">{t('filePreview.pdfLoadFailed')}</div>;
  }

  return (
    <div className="file-preview-pdf">
      <canvas ref={canvasRef} style={{ display: loading ? 'none' : 'block' }} />
      {loading && <div className="file-preview-loading">{t('filePreview.loading')}</div>}
      {!loading && <div className="file-preview-pdf-hint">{t('filePreview.pdfFirstPage')}</div>}
    </div>
  );
}

export default PdfPreview;
