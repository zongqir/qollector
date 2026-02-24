import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useAppStore from '../../store/useAppStore';
import './GuidedTour.css';

const TOUR_STEPS = [
  { selector: '.polymorphic-panel', placement: 'left', titleKey: 'tour.step1Title', descKey: 'tour.step1Desc' },
  { selector: '.titlebar-btn.mini-btn', placement: 'bottom', titleKey: 'tour.step2Title', descKey: 'tour.step2Desc' },
  { selector: '.quick-note-panel-close-btn', placement: 'left', titleKey: 'tour.step3Title', descKey: 'tour.step3Desc' },
  { selector: '.titlebar', placement: 'bottom', titleKey: 'tour.step4Title', descKey: 'tour.step4Desc' },
  { selector: '.titlebar-btn.pin-btn', placement: 'bottom', titleKey: 'tour.step5Title', descKey: 'tour.step5Desc' },
  { selector: '.titlebar-btn.quick-add-btn', placement: 'bottom', titleKey: 'tour.step6Title', descKey: 'tour.step6Desc' },
  { selector: null, placement: 'center', titleKey: 'tour.step7Title', descKey: 'tour.step7Desc' },
  { selector: null, placement: 'center', titleKey: 'tour.step8Title', descKey: 'tour.step8Desc' },
];

const SPOTLIGHT_PAD = 8;
const TOOLTIP_GAP = 14;

function getTargetRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getBoundingClientRect();
}

function calcTooltipPos(rect, placement, tooltipEl) {
  if (!rect || !tooltipEl) return { top: 0, left: 0 };
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;

  switch (placement) {
    case 'left':
      return {
        top: rect.top + rect.height / 2 - th / 2,
        left: rect.left - SPOTLIGHT_PAD - TOOLTIP_GAP - tw,
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2 - th / 2,
        left: rect.right + SPOTLIGHT_PAD + TOOLTIP_GAP,
      };
    case 'bottom':
      return {
        top: rect.bottom + SPOTLIGHT_PAD + TOOLTIP_GAP,
        left: rect.left + rect.width / 2 - tw / 2,
      };
    case 'top':
      return {
        top: rect.top - SPOTLIGHT_PAD - TOOLTIP_GAP - th,
        left: rect.left + rect.width / 2 - tw / 2,
      };
    default:
      return { top: 0, left: 0 };
  }
}

function clampPos(pos) {
  const margin = 8;
  return {
    top: Math.max(margin, Math.min(pos.top, window.innerHeight - margin)),
    left: Math.max(margin, Math.min(pos.left, window.innerWidth - margin)),
  };
}

function GuidedTour() {
  const { t } = useTranslation();
  const tourStep = useAppStore((s) => s.tourStep);
  const nextTourStep = useAppStore((s) => s.nextTourStep);
  const prevTourStep = useAppStore((s) => s.prevTourStep);
  const completeTour = useAppStore((s) => s.completeTour);
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  const [spotlightStyle, setSpotlightStyle] = useState({});
  const tooltipRef = useRef(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [tooltipReady, setTooltipReady] = useState(false);

  const step = TOUR_STEPS[tourStep];
  const isLastStep = tourStep === TOUR_STEPS.length - 1;
  const isCenterStep = step?.placement === 'center';

  const updatePositions = useCallback(() => {
    if (!step) return;
    if (isCenterStep) {
      setSpotlightStyle({ display: 'none' });
      setTooltipReady(true);
      return;
    }
    const rect = getTargetRect(step.selector);
    if (!rect) {
      setSpotlightStyle({ display: 'none' });
      setTooltipReady(true);
      return;
    }
    setSpotlightStyle({
      top: rect.top - SPOTLIGHT_PAD,
      left: rect.left - SPOTLIGHT_PAD,
      width: rect.width + SPOTLIGHT_PAD * 2,
      height: rect.height + SPOTLIGHT_PAD * 2,
      display: 'block',
    });
    if (tooltipRef.current) {
      const pos = calcTooltipPos(rect, step.placement, tooltipRef.current);
      setTooltipPos(clampPos(pos));
    }
    setTooltipReady(true);
  }, [step, isCenterStep]);

  // Recalculate on step change and resize
  useEffect(() => {
    setTooltipReady(false);
    // Small delay to let DOM settle (e.g. panel might be opening)
    const timer = setTimeout(updatePositions, 80);
    window.addEventListener('resize', updatePositions);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePositions);
    };
  }, [tourStep, updatePositions]);

  // Re-measure after tooltip mounts so position accounts for actual size
  useEffect(() => {
    if (tooltipRef.current && !isCenterStep) {
      const raf = requestAnimationFrame(updatePositions);
      return () => cancelAnimationFrame(raf);
    }
  }, [tourStep, isCenterStep, updatePositions]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        completeTour();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (isLastStep) completeTour();
        else nextTourStep();
      } else if (e.key === 'ArrowLeft') {
        prevTourStep();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isLastStep, completeTour, nextTourStep, prevTourStep]);

  const handleGoSettings = () => {
    completeTour();
    setTimeout(() => setShowSettings(true, 'ai'), 300);
  };

  if (!step) return null;

  const progressDots = (
    <div className="tour-progress">
      {TOUR_STEPS.map((_, i) => (
        <span key={i} className={`tour-progress-dot${i === tourStep ? ' active' : ''}`} />
      ))}
    </div>
  );

  const navButtons = (
    <div className="tour-nav">
      <button className="tour-nav-skip" onClick={completeTour}>{t('tour.skip')}</button>
      {progressDots}
      <div style={{ display: 'flex', gap: 6 }}>
        {tourStep > 0 && (
          <button className="tour-nav-btn" onClick={prevTourStep}>{t('tour.prev')}</button>
        )}
        <button
          className="tour-nav-btn primary"
          onClick={isLastStep ? completeTour : nextTourStep}
        >
          {isLastStep ? t('tour.done') : t('tour.next')}
        </button>
      </div>
    </div>
  );

  // Center card for the last step
  if (isCenterStep) {
    return (
      <div className="tour-overlay" onClick={completeTour}>
        <div className="tour-spotlight" style={{ display: 'none' }} />
        <div className="tour-tooltip-center" onClick={(e) => e.stopPropagation()}>
          <div className="tour-tooltip-title">{t(step.titleKey)}</div>
          <div className="tour-tooltip-desc">{t(step.descKey)}</div>
          <button className="tour-go-settings-btn" onClick={handleGoSettings}>
            {t('tour.step4GoSettings')}
          </button>
          {navButtons}
        </div>
      </div>
    );
  }

  // Normal spotlight + tooltip step
  return (
    <div className="tour-overlay" onClick={completeTour}>
      <div className="tour-spotlight" style={spotlightStyle} />
      <div
        ref={tooltipRef}
        className="tour-tooltip"
        data-placement={step.placement}
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          visibility: tooltipReady ? 'visible' : 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tour-tooltip-arrow" />
        <div className="tour-tooltip-title">{t(step.titleKey)}</div>
        <div className="tour-tooltip-desc">{t(step.descKey)}</div>
        {navButtons}
      </div>
    </div>
  );
}

export default GuidedTour;
