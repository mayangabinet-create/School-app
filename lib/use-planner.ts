'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase/client';
import { blank, State, validateState } from './planner';
const KEY = 'school-planner-v2';
export function usePlanner() {
  const [data, setData] = useState<State>(blank);
  const [user, setUser] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef<number | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const identity = useRef<string | null | undefined>(undefined);
  const client = supabase();
  async function load(uid: string | null) {
    identity.current = uid;
    const request = ++generation.current;
    setReady(false); setError(''); setData(blank()); setUser(uid);
    try {
      let next: State; let rev: number | null = null;
      if (uid && client) {
        const result = await client.from('planner_workspace').select('state,revision').eq('user_id',uid).maybeSingle();
        if (result.error) throw result.error;
        next = result.data ? validateState(result.data.state) : blank(); rev = result.data?.revision ?? null;
      } else { const raw = localStorage.getItem(KEY); next = raw ? validateState(JSON.parse(raw)) : blank(); }
      if (request !== generation.current) return;
      revision.current = rev; setData(next); setReady(true);
    } catch(e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not load your planner. Please reload.'); }
  }
  useEffect(() => {
    if (!client) { void load(null); return; }
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => {
        const uid = session?.user.id ?? null;
        if (active && identity.current !== uid) void load(uid);
      },0);
    });
    return () => { active = false; generation.current++; identity.current = undefined; listener.subscription.unsubscribe(); };
    // The singleton client is stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  async function save(change: (draft: State) => void) {
    if (lock.current || !ready) return false;
    lock.current = true; setBusy(true); setError('');
    const request = generation.current;
    try {
      const next = structuredClone(data); change(next); validateState(next);
      if (user && client) {
        const rev = revision.current;
        const result = rev === null
          ? await client.from('planner_workspace').insert({user_id:user,state:next,revision:1}).select('revision').single()
          : await client.from('planner_workspace').update({state:next,revision:rev+1}).eq('user_id',user).eq('revision',rev).select('revision').maybeSingle();
        if (request !== generation.current) return false;
        if (result.error?.code === '23505' || (!result.error && !result.data)) {
          await load(user);
          if (identity.current === user) setError('Another device changed your planner. Please review the latest version before trying again.');
          return false;
        }
        if (result.error) throw result.error;
        if (!result.data) return false;
        revision.current = result.data.revision;
      } else { localStorage.setItem(KEY, JSON.stringify(next)); }
      if (request === generation.current) setData(next);
      return true;
    } catch(e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not save. Your change has not been applied.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return {data, user, ready, busy, error, setError, save, reload: () => load(user)};
}
