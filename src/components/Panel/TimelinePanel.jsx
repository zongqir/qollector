import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ChevronLeft, Calendar } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import TimelineChart from './TimelineChart';
import TimelineSummary from './TimelineSummary';

function TimelinePanel() {
  const { t } = useTranslation();

  const timelineDate = useAppStore(s => s.timelineDate);
  const timelineItems = useAppStore(s => s.timelineItems);
  const timelineSummary = useAppStore(s => s.timelineSummary);
  const timelineLoading = useAppStore(s => s.timelineLoading);
  const timelineError = useAppStore(s => s.timelineError);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const switchTimelineDate = useAppStore(s => s.switchTimelineDate);
  const setPanelMode = useAppStore(s => s.setPanelMode);

  const handleBackToCollection = () => {
    setPanelMode('workbench');
  };

  const handleDateSwitch = (date) => {
    switchTimelineDate(date);
  };

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <button
          className="timeline-back-btn"
          onClick={handleBackToCollection}
          title={t('workbench.backToCollectionFromTimeline')}
        >
          <ChevronLeft size={16} />
          <span>{t('workbench.backToCollection')}</span>
        </button>
        <div className="timeline-title">
          <Clock size={18} />
          <span>{t('workbench.timelineTitle')}</span>
        </div>
      </div>

      <div className="timeline-date-switcher">
        <button
          className={`timeline-date-btn ${timelineDate === 'today' ? 'active' : ''}`}
          onClick={() => handleDateSwitch('today')}
        >
          <Calendar size={14} />
          <span>{t('workbench.today')}</span>
        </button>
        <button
          className={`timeline-date-btn ${timelineDate === 'yesterday' ? 'active' : ''}`}
          onClick={() => handleDateSwitch('yesterday')}
        >
          <Calendar size={14} />
          <span>{t('workbench.yesterday')}</span>
        </button>
      </div>

      {timelineLoading && (
        <div className="timeline-loading">
          <div className="timeline-loading-spinner" />
          <span>{t('app.loading')}</span>
        </div>
      )}

      {!timelineLoading && timelineError && (
        <div className="timeline-error">
          <span>{timelineError}</span>
        </div>
      )}

      {!timelineLoading && !timelineError && timelineItems.length === 0 && (
        <div className="timeline-empty">
          <Clock size={48} strokeWidth={1} />
          <div className="timeline-empty-text">{t('workbench.noDataForDate')}</div>
        </div>
      )}

      {!timelineLoading && !timelineError && timelineItems.length > 0 && (
        <div className="timeline-content">
          <TimelineSummary
            summary={timelineSummary}
            aiEnabled={aiEnabled}
          />
          <TimelineChart items={timelineItems} />
        </div>
      )}
    </div>
  );
}

export default TimelinePanel;
