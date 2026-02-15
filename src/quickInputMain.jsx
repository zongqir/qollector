import React from 'react';
import ReactDOM from 'react-dom/client';
import QuickInputWindow from './QuickInputWindow';
import './styles/base.css';
import './styles/theme.css';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QuickInputWindow />
  </React.StrictMode>
);
