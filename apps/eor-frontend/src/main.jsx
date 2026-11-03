import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Estilos Modulares (Sin dependencias de Tailwind)
import './styles/theme.css';
import './styles/layout.css';
import './styles/cards.css';
import './styles/filters.css';
import './styles/modules.css';
import './styles/individual.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
