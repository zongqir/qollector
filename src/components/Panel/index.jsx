import useAppStore from '../../store/useAppStore';
import CollectionPanel from './CollectionPanel';
import PreviewPanel from './PreviewPanel';
import TimelinePanel from './TimelinePanel';

function PolymorphicPanel() {
  const panelMode = useAppStore(s => s.panelMode);

  return (
    <div className="polymorphic-panel">
      {panelMode === 'collection' && (
        <div className="panel-view active">
          <CollectionPanel />
        </div>
      )}
      {panelMode === 'preview' && (
        <div className="panel-view active">
          <PreviewPanel />
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
