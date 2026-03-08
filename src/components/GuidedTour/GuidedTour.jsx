import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import useAppStore from '../../store/useAppStore';
import { WINDOW_MODE_STORAGE_KEY } from '../../constants/storageKeys';
import './GuidedTour.css';

const NORMAL_SIZE = { width: 800, height: 600 };

const TOUR_STEPS = [
  { selector: '.titlebar-btn.mini-btn', placement: 'bottom', titleKey: 'tour.step2Title', descKey: 'tour.step2Desc', action: 'exitMini' },
  { selector: null, placement: 'center', titleKey: 'tour.stepShowPanelTitle', descKey: 'tour.stepShowPanelDesc', action: 'showPanel' },
  { selector: '.polymorphic-panel', placement: 'left', titleKey: 'tour.step1Title', descKey: 'tour.step1Desc' },
  { selector: '.titlebar-btn.panel-btn', placement: 'bottom', titleKey: 'tour.step3Title', descKey: 'tour.step3Desc' },
  { selector: '.titlebar', placement: 'bottom', titleKey: 'tour.step4Title', descKey: 'tour.step4Desc' },
  { selector: '.titlebar-btn.pin-btn', placement: 'bottom', titleKey: 'tour.step5Title', descKey: 'tour.step5Desc' },
  { selector: '.titlebar-btn.quick-add-btn', placement: 'bottom', titleKey: 'tour.step6Title', descKey: 'tour.step6Desc' },
  { selector: null, placement: 'center', titleKey: 'tour.step7Title', descKey: 'tour.step7Desc' },
  { selector: null, placement: 'center', titleKey: 'tour.step8Title', descKey: 'tour.step8Desc' },
  { selector: null, placement: 'center', titleKey: 'tour.step9Title', descKey: 'tour.step9Desc' },
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

  const isMiniMode = useAppStore((s) => s.isMiniMode);

  const executeStepAction = useCallback(async (stepDef) => {
    if (stepDef?.action === 'exitMini') {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(NORMAL_SIZE.width, NORMAL_SIZE.height));
        localStorage.setItem(WINDOW_MODE_STORAGE_KEY, 'normal');
        useAppStore.setState({ isMiniMode: false, workbenchPanelEnabled: true });
      } catch (error) {
        console.error('failed to exit mini mode during tour:', error);
      }
    } else if (stepDef?.action === 'showPanel') {
      useAppStore.setState({ workbenchPanelEnabled: true });
    }
  }, []);

  const handleNext = useCallback(() => {
    const currentStep = TOUR_STEPS[useAppStore.getState().tourStep];
    if (currentStep?.action) {
      executeStepAction(currentStep);
    }
    if (tourStep === TOUR_STEPS.length - 1) {
      completeTour();
    } else {
      nextTourStep();
    }
  }, [tourStep, executeStepAction, completeTour, nextTourStep]);

  const [spotlightRect, setSpotlightRect] = useState(null);
  const tooltipRef = useRef(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [tooltipReady, setTooltipReady] = useState(false);
  const prevStepRef = useRef(tourStep);

  const step = TOUR_STEPS[tourStep];
  const isLastStep = tourStep === TOUR_STEPS.length - 1;
  const isCenterStep = step?.placement === 'center';

  const updatePositions = useCallback(() => {
    if (!step) return;
    if (isCenterStep) {
      setSpotlightRect(null);
      setTooltipReady(true);
      return;
    }
    const rect = getTargetRect(step.selector);
    if (!rect) {
      setSpotlightRect(null);
      setTooltipReady(true);
      return;
    }
    const sr = {
      top: rect.top - SPOTLIGHT_PAD,
      left: rect.left - SPOTLIGHT_PAD,
      width: rect.width + SPOTLIGHT_PAD * 2,
      height: rect.height + SPOTLIGHT_PAD * 2,
    };
    setSpotlightRect(sr);
    if (tooltipRef.current) {
      const pos = calcTooltipPos(rect, step.placement, tooltipRef.current);
      setTooltipPos(clampPos(pos));
    }
    setTooltipReady(true);
  }, [step, isCenterStep]);

  // Recalculate on step change and resize
  useEffect(() => {
    const prevStep = prevStepRef.current;
    const movedBackward = tourStep < prevStep;
    prevStepRef.current = tourStep;

    // Only auto-skip action steps when moving forward.
    // If user clicks "prev", keep the step visible instead of forcing jump.
    if (!movedBackward) {
      // Skip exitMini step if already in normal mode
      if (step?.action === 'exitMini' && !useAppStore.getState().isMiniMode) {
        nextTourStep();
        return;
      }
      // Skip showPanel step if panel is already open
      if (step?.action === 'showPanel' && useAppStore.getState().workbenchPanelEnabled) {
        nextTourStep();
        return;
      }
    }
    setTooltipReady(false);
    // Small delay to let DOM settle (e.g. panel might be opening)
    const timer = setTimeout(updatePositions, 80);
    window.addEventListener('resize', updatePositions);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePositions);
    };
  }, [tourStep, step, nextTourStep, updatePositions]);

  // Re-measure after tooltip mounts so position accounts for actual size
  useEffect(() => {
    if (tooltipRef.current && !isCenterStep) {
      const raf = requestAnimationFrame(updatePositions);
      return () => cancelAnimationFrame(raf);
    }
  }, [tourStep, isCenterStep, updatePositions]);

  // Auto-advance when user clicks mini button to exit mini mode during the exitMini step
  const prevMiniModeRef = useRef(isMiniMode);
  useEffect(() => {
    const wasMini = prevMiniModeRef.current;
    prevMiniModeRef.current = isMiniMode;
    // Only advance if user actually toggled from mini to normal during this step
    if (step?.action === 'exitMini' && wasMini && !isMiniMode) {
      nextTourStep();
    }
  }, [isMiniMode, step, nextTourStep]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        completeTour();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNext();
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
          onClick={handleNext}
        >
          {isLastStep ? t('tour.done') : t('tour.next')}
        </button>
      </div>
    </div>
  );

  // Build four mask panels around the spotlight hole
  const maskPanels = spotlightRect ? (
    <>
      {/* Top */}
      <div className="tour-mask-panel" style={{ top: 0, left: 0, right: 0, height: Math.max(0, spotlightRect.top) }} />
      {/* Bottom */}
      <div className="tour-mask-panel" style={{ top: spotlightRect.top + spotlightRect.height, left: 0, right: 0, bottom: 0 }} />
      {/* Left */}
      <div className="tour-mask-panel" style={{ top: spotlightRect.top, left: 0, width: Math.max(0, spotlightRect.left), height: spotlightRect.height }} />
      {/* Right */}
      <div className="tour-mask-panel" style={{ top: spotlightRect.top, left: spotlightRect.left + spotlightRect.width, right: 0, height: spotlightRect.height }} />
    </>
  ) : (
    <div className="tour-mask-panel" style={{ inset: 0 }} />
  );

  // Center card for the last step
  if (isCenterStep) {
    return (
      <div className="tour-overlay">
        <div className="tour-mask-panel" style={{ inset: 0 }} />
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
    <div className="tour-overlay">
      {maskPanels}
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
