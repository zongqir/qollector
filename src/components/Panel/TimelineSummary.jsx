import { useTranslation } from 'react-i18next';
import { Sparkles, AlertCircle } from 'lucide-react';

function TimelineSummary({ summary, aiEnabled }) {
  const { t } = useTranslation();

  if (!aiEnabled) {
    return (
      <div className="timeline-summary timeline-summary-disabled">
        <div className="timeline-summary-icon">
          <AlertCircle size={20} />
        </div>
        <div className="timeline-summary-text">
          {t('collection.aiNotEnabled')}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="timeline-summary timeline-summary-loading">
        <div className="timeline-summary-icon">
          <Sparkles size={20} className="sparkle-icon" />
        </div>
        <div className="timeline-summary-text">
          {t('collection.aiSummaryLoading')}
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-summary">
      <div className="timeline-summary-header">
        <Sparkles size={18} />
        <span>AI Summary</span>
      </div>
      <div className="timeline-summary-content">
        {summary.split('\n').map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </div>
  );
}

export default TimelineSummary;
