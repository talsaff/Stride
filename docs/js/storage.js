// PersistenceService: stores profile, program state and full history in the
// device's local storage. Everything stays on the phone.

import { SCHEMA_VERSION, defaultProfile, defaultState, defaultReadiness } from './engine/schema.js';
import { defaultSchedule } from './engine/schedule.js';

const KEY = 'stride.v1';

export function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: false,
    profile: defaultProfile(),
    state: defaultState(),
    history: [],          // workout and missed records
    schedule: defaultSchedule(),
    push: { enabled: false, lastPayload: null },
    activeSession: null,  // in-progress workout, so a reload can resume it
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function migrate(data) {
  const base = emptyData();
  return {
    ...base,
    ...data,
    profile: { ...base.profile, ...(data.profile ?? {}) },
    state: { ...base.state, ...(data.state ?? {}), readiness: { ...defaultReadiness(), ...(data.state?.readiness ?? {}) } },
    history: Array.isArray(data.history) ? data.history : [],
    schedule: {
      ...base.schedule, ...(data.schedule ?? {}),
      prefs: { ...base.schedule.prefs, ...(data.schedule?.prefs ?? {}) },
      google: { ...base.schedule.google, ...(data.schedule?.google ?? {}) },
    },
    push: { ...base.push, ...(data.push ?? {}) },
    schemaVersion: SCHEMA_VERSION,
  };
}

export function exportJson(data) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Stride', ...data }, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.history)) throw new Error('Not a Stride backup file');
  return migrate(parsed);
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}
