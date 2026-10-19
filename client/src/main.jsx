import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import './styles.css';
import App from './App.jsx';
import { AppProvider } from './store.jsx';
import { STATIC } from './api.js';

if (STATIC) document.documentElement.classList.add('static');

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AppProvider>
      <App />
    </AppProvider>
  </BrowserRouter>
);
