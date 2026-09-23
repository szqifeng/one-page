import { useEffect, useRef, useState } from 'react';
import type { PlanState } from '@/types/planning';
import { ApiError, getPlan, savePlan } from './api';
import { normalizePlanQuarters, syncActiveQuarter } from './quarters';

export function planFingerprint(plan: PlanState) {
  return JSON.stringify({ ...syncActiveQuarter(plan), currentUserId: '' });
}

// One network operation at a time. Edits made during a save remain pending.
export function useCollaboration(plan: PlanState, version: number, enabled: boolean, paused: boolean, apply: (plan: PlanState) => void) {
  const latest = useRef(plan);
  latest.current = plan;
  const pause = useRef(paused);
  pause.current = paused;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const state = useRef({ base: '', version, busy: false, blocked: false });
  const [status, setStatus] = useState('已同步');

  useEffect(() => {
    if (!enabled) return;
    const session = { base: version ? planFingerprint(latest.current) : '', version, busy: false, blocked: false };
    state.current = session;
    let active = true;
    let ticks = 0;
    setStatus('已同步');
    const timer = window.setInterval(async () => {
      if (session.busy || session.blocked) return;
      const snapshot = latest.current;
      const fingerprint = planFingerprint(snapshot);
      const dirty = fingerprint !== session.base;
      if (!dirty && (++ticks % 10 !== 0 || pause.current)) return;
      session.busy = true;
      try {
        if (dirty) {
          setStatus('正在保存');
          const result = await savePlan(snapshot, session.version);
          if (!active) return;
          session.base = fingerprint;
          session.version = result.version;
          setStatus('已同步');
        } else {
          const remote = await getPlan();
          if (!active || pause.current || planFingerprint(latest.current) !== fingerprint) return;
          if (remote.version !== session.version) {
            const next = { ...normalizePlanQuarters(remote.plan), currentUserId: latest.current.currentUserId };
            session.base = planFingerprint(next);
            session.version = remote.version;
            latest.current = next;
            applyRef.current(next);
          }
          setStatus('已同步');
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
          session.blocked = true;
          setStatus(error.status === 409 ? '存在协作冲突，本地修改已保留；请导出草稿后重新加载' : error.message);
        } else {
          setStatus('连接失败，修改保留在本页，正在重试');
        }
      } finally {
        session.busy = false;
      }
    }, 500);
    const unload = (event: BeforeUnloadEvent) => {
      if (session.busy || planFingerprint(latest.current) !== session.base) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('beforeunload', unload); };
  }, [enabled, version]);

  return {
    status,
    canLeave: () => !state.current.busy && !state.current.blocked && planFingerprint(latest.current) === state.current.base,
    version: () => state.current.version,
  };
}
