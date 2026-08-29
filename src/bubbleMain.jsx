import React from 'react';
import ReactDOM from 'react-dom/client';
import BubbleWindow from './BubbleWindow';
import './styles/base.css';
import './styles/theme.css';
import './styles/bubble-window.css';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BubbleWindow />
  </React.StrictMode>
);
