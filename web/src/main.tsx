import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Theme is applied pre-paint by an inline script in index.html.

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
