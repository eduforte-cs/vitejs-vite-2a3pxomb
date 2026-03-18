import React from 'react';
import ReactDOM from 'react-dom/client';
import MMARDashboard from './App.jsx';

// BYPASS — reemplazar main.jsx con este archivo para desarrollo local
// Restaurar main.jsx original antes de deployar
function Shell() {
  return <MMARDashboard session={null} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
);
