import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function TimelineChart({ items }) {
  const { t } = useTranslation();

  // Group items by hour
  const hourlyData = useMemo(() => {
    const data = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
      items: [],
    }));

    items.forEach(item => {
      const date = new Date(item.updated_at * 1000);
      const hour = date.getHours();
      data[hour].count += 1;
      data[hour].items.push(item);
    });

    return data;
  }, [items]);

  const maxCount = Math.max(...hourlyData.map(d => d.count), 1);

  const getTimeLabel = (hour) => {
    if (hour >= 6 && hour < 12) return t('collection.morning');
    if (hour >= 12 && hour < 18) return t('collection.afternoon');
    return t('collection.evening');
  };

  return (
    <div className="timeline-chart">
      <div className="timeline-chart-title">Activity Timeline</div>
      <div className="timeline-chart-bars">
        {hourlyData.map(({ hour, count, items: hourItems }) => {
          const height = count > 0 ? (count / maxCount) * 100 : 2;
          const timeLabel = getTimeLabel(hour);

          return (
            <div key={hour} className="timeline-bar-wrapper">
              <div
                className={`timeline-bar ${count > 0 ? 'has-data' : ''}`}
                style={{ height: `${height}%` }}
                title={`${hour}:00 - ${count} items`}
              >
                {count > 0 && (
                  <div className="timeline-bar-count">{count}</div>
                )}
              </div>
              <div className="timeline-bar-label">
                {hour === 0 || hour === 6 || hour === 12 || hour === 18 ? (
                  <span className="timeline-bar-hour">{hour}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="timeline-chart-legend">
        <div className="timeline-legend-item">
          <span className="timeline-legend-label">{t('collection.morning')}</span>
          <span className="timeline-legend-range">6-12</span>
        </div>
        <div className="timeline-legend-item">
          <span className="timeline-legend-label">{t('collection.afternoon')}</span>
          <span className="timeline-legend-range">12-18</span>
        </div>
        <div className="timeline-legend-item">
          <span className="timeline-legend-label">{t('collection.evening')}</span>
          <span className="timeline-legend-range">18-24</span>
        </div>
      </div>
    </div>
  );
}

export default TimelineChart;
