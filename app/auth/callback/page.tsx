'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { appPath } from '@/lib/app-path';
import '@/components/planner.css';

export default function AuthCallback() {
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function finish() {
      try {
        const client = supabase();
        if (!client) throw new Error('Sign-in is not configured.');
        // The singleton client exchanges the PKCE code during initialization.
        // getSession waits for that initialization, including in Strict Mode.
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error('This link has expired or was opened in another browser. Request a new link and open it in the browser where you signed in.');
        if (active) window.location.replace(appPath());
      } catch (error) {
        if (active) {
          window.history.replaceState(null, '', window.location.pathname);
          setError(error instanceof Error ? error.message : 'Sign-in failed. Please request a new link.');
        }
      }
    }
    void finish();
    return () => { active = false; };
  }, []);
  return <main className="planner"><section className="p-panel" style={{maxWidth:520,margin:'64px auto',padding:32}}>
    <h1>{error ? 'Could not sign in' : 'Signing you in…'}</h1>
    {error && <><p role="alert" style={{margin:'20px 0'}}>{error}</p><a href={appPath()}>Back to your planner</a></>}
  </section></main>;
}
