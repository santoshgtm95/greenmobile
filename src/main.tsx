import React from 'react';
import '@fontsource-variable/inter';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyFontScale, readFontScale } from './lib/fontScale';

applyFontScale(readFontScale());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
