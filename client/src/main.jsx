import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import App from './App.jsx';
import { AppProvider } from './store.jsx';
import { STATIC } from './api.js';

if (STATIC) document.documentElement.classList.add('static');
// The cloud site can be installed as an app and keeps visited pages for offline use.
if (STATIC && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AppProvider>
      <App />
    </AppProvider>
  </BrowserRouter>
);
