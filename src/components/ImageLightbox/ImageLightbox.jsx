import { useEffect, useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './ImageLightbox.css';

function ImageLightbox({ src, onClose }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(10, Math.max(0.1, prev + delta * prev));
    });
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [translate]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    setTranslate({
      x: translateStart.current.x + e.clientX - dragStart.current.x,
      y: translateStart.current.y + e.clientY - dragStart.current.y,
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="image-lightbox-overlay" onClick={handleOverlayClick} onWheel={handleWheel}>
      <button className="image-lightbox-close" onClick={onClose}>
        <X size={20} />
      </button>
      <img
        className="image-lightbox-img"
        src={src}
        alt=""
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          cursor: scale > 1 ? 'grab' : 'default',
        }}
        draggable={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}

export default ImageLightbox;
