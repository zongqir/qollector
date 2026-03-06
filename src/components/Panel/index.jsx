import useAppStore from '../../store/useAppStore';
import WorkbenchPanel from './WorkbenchPanel';
import ComparePanel from './ComparePanel';
import PreviewPanel from './PreviewPanel';
import TimelinePanel from './TimelinePanel';

function PolymorphicPanel() {
  const panelMode = useAppStore(s => s.panelMode);

  return (
    <div className="polymorphic-panel">
      <div className={`panel-view ${panelMode === 'workbench' ? 'active' : ''}`}>
        <WorkbenchPanel />
      </div>
      <div className={`panel-view ${panelMode === 'preview' ? 'active' : ''}`}>
        {panelMode === 'preview' ? <PreviewPanel /> : null}
      </div>
      {panelMode === 'compare' && (
        <div className="panel-view active">
          <ComparePanel />
        </div>
      )}
      <div className={`panel-view ${panelMode === 'timeline' ? 'active' : ''}`}>
        <TimelinePanel />
      </div>
    </div>
  );
}

export default PolymorphicPanel;
