import React from 'react';
import ReactDOM from 'react-dom/client';
import WidgetWindow from './WidgetWindow';
import './styles/base.css';
import './styles/theme.css';
import './styles/widget-window.css';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WidgetWindow />
  </React.StrictMode>
);
