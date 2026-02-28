import React from 'react';
import ReactDOM from 'react-dom/client';
import HistoryEditorWindow from './HistoryEditorWindow';
import './styles/base.css';
import './styles/theme.css';
import './styles/history-editor-window.css';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HistoryEditorWindow />
  </React.StrictMode>
);
