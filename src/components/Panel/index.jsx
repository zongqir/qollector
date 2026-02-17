import useAppStore from '../../store/useAppStore';
import CollectionPanel from './CollectionPanel';
import PreviewPanel from './PreviewPanel';
import TimelinePanel from './TimelinePanel';

function PolymorphicPanel() {
  const panelMode = useAppStore(s => s.panelMode);

  return (
    <div className="polymorphic-panel">
      <div className={`panel-view ${panelMode === 'collection' ? 'active' : ''}`}>
        <CollectionPanel />
      </div>
      <div className={`panel-view ${panelMode === 'preview' ? 'active' : ''}`}>
        {panelMode === 'preview' && <PreviewPanel />}
      </div>
      <div className={`panel-view ${panelMode === 'timeline' ? 'active' : ''}`}>
        {panelMode === 'timeline' && <TimelinePanel />}
      </div>
    </div>
  );
}

export default PolymorphicPanel;
