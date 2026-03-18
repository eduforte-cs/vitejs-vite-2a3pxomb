import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './supabase.js';
import Landing from './Landing.jsx';
import MMARDashboard from './App.jsx';

function Shell() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#9B9A97' }}>Loading...</div>;
  if (!session) return <Landing />;
  return <MMARDashboard session={session} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
);
