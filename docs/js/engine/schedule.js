// Scheduler: plans workout sessions into free time, moves sessions that clash
// with busy time, and exports them as calendar events. Pure and
// deterministic (works in the device's local time zone).

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const STEP = 15;      // minutes between candidate start times
const BUFFER = 10;    // minutes kept free around other events

export function defaultSchedule() {
  return {
    enabled: false,
    prefs: { days: [1, 3, 6], from: '18:00', to: '21:00' },
    busy: [],          // [{id, days:[0-6], from:'09:00', to:'17:00', label}]
    sessions: [],      // [{id, start, minutes, status, moved?, googleEventId?}]
    google: { clientId: '', connected: false, lastSync: null, error: null },
    dismissed: [],     // session ids whose "did you miss it?" prompt was answered
  };
}

export const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const pad = (n) => String(n).padStart(2, '0');
export const fmtHM = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function at(day, minutes) { const x = dayStart(day); x.setMinutes(minutes); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function sessionId(start) {
  const d = new Date(start);
  return `ses-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}
export const sessionEnd = (s) => new Date(new Date(s.start).getTime() + s.minutes * MIN);
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// All busy intervals touching a given day: weekly busy blocks + calendar events.
function busyOnDay(day, busyBlocks, external) {
  const out = [];
  const dow = new Date(day).getDay();
  for (const b of busyBlocks) {
    if (!b.days.includes(dow)) continue;
    let end = hm(b.to);
    if (end <= hm(b.from)) end += 24 * 60; // overnight block
    out.push([at(day, hm(b.from)).getTime(), at(day, end).getTime()]);
  }
  const d0 = dayStart(day).getTime();
  for (const e of external) {
    const s = new Date(e.start).getTime(), f = new Date(e.end).getTime();
    if (overlaps(s, f, d0 - DAY, d0 + 2 * DAY)) out.push([s, f]);
  }
  return out;
}

export function conflictsOf(session, busyBlocks, external, others = []) {
  const s = new Date(session.start).getTime() - BUFFER * MIN;
  const f = sessionEnd(session).getTime() + BUFFER * MIN;
  const hits = busyOnDay(session.start, busyBlocks, external).filter(([a, b]) => overlaps(s, f, a, b));
  const clash = others.some((o) => o.id !== session.id && o.status !== 'skipped' &&
    overlaps(s, f, new Date(o.start).getTime(), sessionEnd(o).getTime()));
  return hits.length + (clash ? 1 : 0);
}

// First free start time on `day` inside the preferred window (or the whole
// waking day when `anyTime`), not before `notBefore`.
export function findSlot(day, minutes, ctx, notBefore, anyTime = false) {
  const { prefs, busy, external, sessions } = ctx;
  const from = anyTime ? 7 * 60 : hm(prefs.from);
  const to = anyTime ? 22 * 60 : hm(prefs.to);
  for (let m = from; m + minutes <= to; m += STEP) {
    const start = at(day, m);
    if (notBefore && start < notBefore) continue;
    const cand = { id: '__cand', start: start.toISOString(), minutes };
    if (!conflictsOf(cand, busy, external, sessions)) return start;
  }
  return null;
}

const hasSessionOn = (sessions, day, exceptId) =>
  sessions.some((s) => s.id !== exceptId && s.status !== 'skipped' && dayStart(s.start).getTime() === dayStart(day).getTime());

// Plan the next `horizonDays`. Keeps past sessions, keeps valid future
// sessions where they are, moves clashing ones, and fills each week up to
// `perWeek` sessions on the preferred days, spread out as evenly as possible.
export function planSchedule({ prefs, busy = [], external = [], sessions = [], now, minutes, perWeek, horizonDays = 14 }) {
  const nowD = new Date(now);
  const changes = [];
  const past = sessions.filter((s) => new Date(s.start) < nowD || s.status !== 'planned');
  let future = sessions.filter((s) => new Date(s.start) >= nowD && s.status === 'planned')
    .map((s) => ({ ...s, minutes }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const ctx = () => ({ prefs, busy, external, sessions: [...past, ...future] });

  // 1. Move sessions that now clash with something.
  for (const s of [...future]) {
    const others = [...past, ...future];
    if (!conflictsOf(s, busy, external, others)) continue;
    let slot = null;
    const day0 = dayStart(s.start);
    // Same day later, then the next preferred days, then any day in 3 days.
    slot = findSlot(day0, minutes, { ...ctx(), sessions: others.filter((o) => o.id !== s.id) }, nowD);
    for (let i = 1; !slot && i <= 7; i++) {
      const d = addDays(day0, i);
      if (prefs.days.includes(d.getDay()) && !hasSessionOn(others, d, s.id)) slot = findSlot(d, minutes, ctx(), nowD);
    }
    for (let i = 0; !slot && i <= 3; i++) {
      const d = addDays(day0, i);
      if (!hasSessionOn(others, d, s.id)) slot = findSlot(d, minutes, ctx(), nowD, true);
    }
    if (slot) {
      const moved = { ...s, start: slot.toISOString(), moved: true };
      changes.push({ type: 'moved', session: moved, from: s.start });
      future = future.map((x) => (x.id === s.id ? moved : x));
    } else {
      changes.push({ type: 'unresolved', session: s });
    }
  }

  // 2. Fill weeks up to perWeek (and trim extras beyond it).
  const horizonEnd = addDays(dayStart(nowD), horizonDays);
  const weekKey = (d) => { const x = dayStart(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); };
  for (let w = weekKey(nowD); w < horizonEnd.getTime(); w = weekKey(addDays(new Date(w), 7))) {
    // Skipped/missed sessions still count toward the week: no catch-up sessions.
    const inWeek = () => [...past, ...future].filter((s) => weekKey(s.start) === w);
    // Trim: drop the latest future planned sessions over the weekly goal.
    while (inWeek().length > perWeek) {
      const extra = future.filter((s) => weekKey(s.start) === w).sort((a, b) => new Date(b.start) - new Date(a.start))[0];
      if (!extra) break;
      future = future.filter((s) => s.id !== extra.id);
      changes.push({ type: 'removed', session: extra });
    }
    // Fill: candidate preferred days that are still ahead and free.
    for (let guard = 0; inWeek().length < perWeek && guard < 7; guard++) {
      const taken = inWeek().map((s) => dayStart(s.start).getTime());
      const candidates = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(new Date(w), i);
        if (d >= horizonEnd || dayStart(d) < dayStart(nowD)) continue;
        if (!prefs.days.includes(d.getDay()) || taken.includes(dayStart(d).getTime())) continue;
        // Spread sessions out: prefer the day furthest from existing ones.
        const gap = taken.length ? Math.min(...taken.map((t) => Math.abs(dayStart(d).getTime() - t))) : 0;
        candidates.push({ d, gap });
      }
      candidates.sort((a, b) => b.gap - a.gap || a.d - b.d);
      let added = false;
      for (const { d } of candidates) {
        const slot = findSlot(d, minutes, ctx(), nowD);
        if (!slot) continue;
        const s = { id: sessionId(slot), start: slot.toISOString(), minutes, status: 'planned' };
        future.push(s);
        changes.push({ type: 'added', session: s });
        added = true;
        break;
      }
      if (!added) break;
    }
  }
  future.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { sessions: [...past, ...future].sort((a, b) => new Date(a.start) - new Date(b.start)), changes };
}

export function nextSession(sessions, now) {
  return sessions
    .filter((s) => s.status === 'planned' && sessionEnd(s) > new Date(now))
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0] ?? null;
}

// Planned sessions that ended (with an hour of slack) and have no workout
// on the same day: ask the user what happened.
export function pendingMissed(sessions, history, now, dismissed = []) {
  const cutoff = new Date(now).getTime() - 60 * MIN;
  const doneDays = new Set(history.filter((r) => r.kind === 'workout' && r.actual_duration > 0)
    .map((r) => dayStart(r.date).getTime()));
  return sessions.filter((s) => s.status === 'planned' && sessionEnd(s).getTime() < cutoff &&
    !doneDays.has(dayStart(s.start).getTime()) && !dismissed.includes(s.id));
}

// After a workout, mark the session it belongs to (same day) as done.
export function markDone(sessions, workoutDate) {
  const day = dayStart(workoutDate).getTime();
  const t = new Date(workoutDate).getTime();
  const same = sessions.filter((s) => s.status === 'planned' && dayStart(s.start).getTime() === day)
    .sort((a, b) => Math.abs(new Date(a.start) - t) - Math.abs(new Date(b.start) - t))[0];
  return sessions.map((s) => (same && s.id === same.id ? { ...s, status: 'done' } : s));
}

// ---------------------------------------------------------------- humour

export const FUNNY = [
  'Hey {name}, the couch called. It says you two need some space. 🛋️',
  'Get your lazy ass on the treadmill, {name}. Lovingly. 🍑',
  'Your treadmill misses you. It is crying little belt tears.',
  '{min} minutes. You have scrolled longer than that on TikTok.',
  'Plot twist: you actually work out today.',
  'Your treadmill is not a clothes rack. Prove it.',
  'This is your sign. Literally. Get moving.',
  'Fun fact: workouts do not do themselves. Sadly.',
  'Your future self says thanks in advance. Do not let them down.',
  'Treadmill o\'clock. No excuses, only shoelaces. 👟',
  'The only bad workout is the one your lazy butt skips.',
  'Rise and grind. Or, you know, walk briskly.',
  'Somewhere a sloth is judging you. Go on, prove it wrong. 🦥',
  'Get moving before your playlist gets bored of waiting. 🎧',
  '{name}, your medals are not going to collect themselves. 🏅',
  'Warning: excessive sitting detected. Deploy legs immediately.',
  'Be the reason your step counter smiles today.',
  'Go now and you get to be smug for the rest of the day. 😎',
];

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function funnyLine(seed, { name = '', minutes = 20 } = {}) {
  const line = FUNNY[hash(seed) % FUNNY.length];
  return line
    .replace(/\{min\}/g, String(minutes))
    .replace(/,? ?\{name\}/g, (m) => (name ? m.replace('{name}', name) : ''))
    .replace(/^Hey , /, 'Hey, ')
    .replace(/\s+([.!?])/g, '$1');
}

export function eventTitle(session) {
  return 'Stride time';
}

export function eventDescription(session, profile = {}) {
  return `${funnyLine(session.id, { name: profile.name, minutes: session.minutes })}\n\nOpen Stride when you are on the treadmill. Your plan for today is waiting.`;
}

// ---------------------------------------------------------------- iCalendar

const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Each event gets two alerts with a funny message (10 min before and at the
// start). These alerts are what notify you on the phone.
export function toICS(sessions, profile, now) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stride//Treadmill Coach//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const s of sessions) {
    if (s.status !== 'planned') continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@stride.app`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(s.start)}`,
      `DTEND:${icsDate(sessionEnd(s))}`,
      `SUMMARY:${icsEsc(eventTitle(s, profile))}`,
      `DESCRIPTION:${icsEsc(eventDescription(s, profile))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', `DESCRIPTION:${icsEsc(eventTitle(s))}`, 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${icsEsc(eventTitle(s))}`, 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
