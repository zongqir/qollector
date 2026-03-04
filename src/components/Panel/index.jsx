import useAppStore from '../../store/useAppStore';
import WorkbenchPanel from './WorkbenchPanel';
import ComparePanel from './ComparePanel';
import PreviewPanel from './PreviewPanel';
import TimelinePanel from './TimelinePanel';

function PolymorphicPanel() {
  const panelMode = useAppStore(s => s.panelMode);

  return (
    <div className="polymorphic-panel">
      {panelMode === 'workbench' && (
        <div className="panel-view active">
          <WorkbenchPanel />
        </div>
      )}
      {panelMode === 'preview' && (
        <div className="panel-view active">
          <PreviewPanel />
        </div>
      )}
      {panelMode === 'compare' && (
        <div className="panel-view active">
          <ComparePanel />
        </div>
      )}
      {panelMode === 'timeline' && (
        <div className="panel-view active">
          <TimelinePanel />
        </div>
      )}
    </div>
  );
}

export default PolymorphicPanel;
