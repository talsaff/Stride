// UI layer. Presents workouts, feedback, controls and progress. All workout
// decisions come from the deterministic engine in ./engine/.

import * as store from './storage.js';
import * as gcal from './google.js';
import * as push from './push.js';
import { ICONS, logoMark, wordmark } from './icons.js';
import { decide, commitDecision, recordWorkout } from './engine/engine.js';
import { applyPermanentChange } from './engine/progression.js';
import { assessReadiness } from './engine/readiness.js';
import { evaluateSafety } from './engine/safety.js';
import { normalizeFeedback, classifyWorkout } from './engine/feedback.js';
import { personalInsights } from './engine/personalization.js';
import { LEVELS, LEVEL_COUNT, levelOfStage, RULES, ALGORITHM_VERSION, GLOBAL_LIMITS, MAX_STAGE } from './engine/config.js';
import { REASONS, makeMissedRecord, defaultReadiness } from './engine/schema.js';
import { completedWorkouts, missedSessions, totalMinutes, weeklyCounts } from './engine/history.js';
import { FITNESS, PREFERENCE, GOALS, GENDERS, startingStage, speedFactor, maxStage, profileSummary, isProfileComplete, effectivePreference } from './engine/profile.js';
import { evaluateMedals, newlyEarned, GROUP_TITLES } from './engine/medals.js';
import {
  DAY_SHORT, defaultSchedule, planSchedule, nextSession, pendingMissed, markDone, findSlot, sessionEnd,
  conflictsOf, funnyLine, eventTitle, eventDescription, toICS, hm, fmtHM,
} from './engine/schedule.js';

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
const $sheet = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');

let data = store.load();
let view = 'today';
let wiz = null;              // runner-profile wizard state
let checkin = null;          // post-workout form state
let ticker = null;
let syncing = false;
let pushUrl = null;           // push service URL (from push-config.json)
let pushBusy = false;
let pushTimer = null;
let wakeLock = null;
let audio = null;
let lastSaveAt = 0;

// ---------------------------------------------------------------- helpers

const nowIso = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSpeed = (v) => `${Number(v).toFixed(1)}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function clock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function persist() {
  if (!store.save(data)) toast('Could not save on this device. Try exporting a backup in Settings.');
}

function toast(msg, ms = 3600) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
}

function readiness() {
  const r = data.state.readiness;
  if (!r.at || !sameDay(r.at, Date.now())) return defaultReadiness();
  return r;
}

function setReadiness(patch) {
  data.state.readiness = { ...readiness(), ...patch, at: nowIso() };
  persist();
}

function currentDecision(request = {}) {
  return decide({
    profile: data.profile, state: data.state, history: data.history,
    readiness: readiness(), request, now: nowIso(),
  });
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Hi there' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return data.profile.name ? `${part}, ${esc(data.profile.name)}` : part;
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

const segColor = (t) => (t === 'work' || t === 'run' ? 'var(--accent)' : t === 'warmup' ? 'var(--warm)' : t === 'cooldown' ? 'var(--cool)' : 'var(--primary)');

// ---------------------------------------------------------------- render

let lastView = null;
function render() {
  if (view !== lastView) { window.scrollTo(0, 0); lastView = view; }
  const full = view === 'workout' || view === 'checkin' || view === 'wizard';
  $app.classList.toggle('fullscreen', full);
  $tabs.hidden = full;
  if (!full) renderTabs();
  const fn = {
    wizard: renderWizard, today: renderToday, workout: renderWorkout, checkin: renderCheckin,
    plan: renderPlan, medals: renderMedals, progress: renderProgress, settings: renderSettings,
  }[view];
  $app.innerHTML = fn();
  if (view === 'workout') updateWorkout();
}

function renderTabs() {
  const tab = (id, icon, label) =>
    `<button data-act="tab" data-arg="${id}" ${view === id ? 'aria-current="page"' : ''}>${ICONS[icon]}<span>${label}</span></button>`;
  $tabs.innerHTML = tab('today', 'home', 'Today') + tab('plan', 'calendar', 'Plan') + tab('medals', 'medal', 'Medals')
    + tab('progress', 'chart', 'Progress') + tab('settings', 'gear', 'Settings');
}

// ---------- runner profile wizard

const WIZ_STEPS = {
  new: ['welcome', 'about', 'body', 'fitness', 'pref', 'goal', 'schedule', 'summary'],
  complete: ['about', 'body', 'fitness', 'pref', 'goal', 'schedule', 'summary'],
  edit: ['about', 'body', 'fitness', 'pref', 'goal', 'summary'],
};

function openWizard(mode) {
  const p = data.profile;
  wiz = {
    mode, i: 0, error: null,
    draft: {
      name: p.name ?? '', age: p.age, gender: p.gender, heightCm: p.heightCm, weightKg: p.weightKg,
      fitness: p.fitness, preference: p.preference, goal: p.goal, workoutsPerWeek: p.workoutsPerWeek ?? 2,
      scheduleOn: mode === 'new' ? true : data.schedule.enabled,
      days: [...data.schedule.prefs.days], from: data.schedule.prefs.from, to: data.schedule.prefs.to,
    },
  };
  view = 'wizard';
  render();
}

const wizStep = () => WIZ_STEPS[wiz.mode][wiz.i];

function optCard(field, value, title, sub = '', icon = '') {
  const on = wiz.draft[field] === value;
  return `<button class="level-opt" data-act="wz-set" data-arg="${field}:${value}" aria-pressed="${on}">
    ${icon ? `<span class="level-num">${icon}</span>` : ''}<span><b>${esc(title)}</b>${sub ? `<br><span class="small muted">${esc(sub)}</span>` : ''}</span></button>`;
}

function timeOptions(selected) {
  let out = '';
  for (let m = 5 * 60; m <= 23 * 60; m += 30) out += `<option value="${fmtHM(m)}" ${fmtHM(m) === selected ? 'selected' : ''}>${fmtHM(m)}</option>`;
  return out;
}

function renderWizard() {
  const d = wiz.draft;
  const steps = WIZ_STEPS[wiz.mode];
  const step = wizStep();
  const dots = steps.filter((x) => x !== 'welcome').map((x) => `<span class="${steps.indexOf(x) <= wiz.i ? 'on' : ''}"></span>`).join('');
  const head = (eyebrow, title, sub = '') => `
    ${step !== 'welcome' ? `<div class="wiz-top"><button class="icon-btn" data-act="wz-back" aria-label="Back">${wiz.i === 0 && wiz.mode === 'edit' ? ICONS.x : '‹'}</button><div class="wiz-dots">${dots}</div><span style="width:40px"></span></div>` : ''}
    <header class="topbar"><div><div class="eyebrow">${eyebrow}</div><h1 class="title">${title}</h1>${sub ? `<p class="subtitle">${sub}</p>` : ''}</div></header>`;
  const err = wiz.error ? `<p class="small" style="color:var(--danger);margin:-4px 4px 12px">${esc(wiz.error)}</p>` : '';
  const next = (label = 'Next') => `<button class="btn primary lg block" data-act="wz-next">${label}</button>`;
  const chip = (field, val, label) => `<button class="chip" data-act="wz-set" data-arg="${field}:${val}" aria-pressed="${String(d[field]) === String(val)}">${esc(label)}</button>`;

  switch (step) {
    case 'welcome':
      return `<section class="welcome">
        <div class="logo"><svg viewBox="0 0 100 100" aria-hidden="true">${logoMark('#fff', '#1E8A6E')}</svg></div>
        <h1 class="sr-only">Stride</h1>
        <div style="margin-bottom:10px">${wordmark(56)}</div>
        <p class="subtitle">Treadmill workouts that fit your body, your energy and your calendar.</p>
        <div class="features card">
          ${feature('user', 'Built for you', 'Your age, body, fitness and goal shape every plan, and it keeps adapting as you go.')}
          ${feature('calendar', 'Fits your week', 'Workouts get scheduled around your calendar, with reminders that will roast you a little.')}
          ${feature('medal', 'Earn medals', 'Collect medals for workouts, kilometres and weekly streaks.')}
        </div>
        <button class="btn primary lg block" data-act="wz-next">Build my runner profile</button>
        <p class="small muted" style="margin-top:14px">Takes a minute. Your data stays on this phone.</p>
      </section>`;
    case 'about':
      return `${head(wiz.mode === 'complete' ? 'New: runner profile' : 'Runner profile', 'About you')}
        <section class="card">
          <label class="q" style="display:block"><span class="q-label">Name</span>
            <input type="text" id="wz-name" value="${esc(d.name)}" placeholder="What should I call you?" maxlength="30" autocomplete="given-name"></label>
          <label class="q" style="display:block"><span class="q-label">Age</span>
            <input type="number" id="wz-age" inputmode="numeric" value="${esc(d.age ?? '')}" placeholder="e.g. 25" min="10" max="100"></label>
          <div class="q" style="margin-bottom:0"><span class="q-label">Gender</span>
            <div class="chips">${Object.entries(GENDERS).map(([k, v]) => chip('gender', k, v)).join('')}</div></div>
        </section>${err}${next()}`;
    case 'body':
      return `${head('Runner profile', 'Your body', 'Used to set treadmill speeds that suit you.')}
        <section class="card">
          <label class="q" style="display:block"><span class="q-label">Height (cm)</span>
            <input type="number" id="wz-height" inputmode="decimal" value="${esc(d.heightCm ?? '')}" placeholder="e.g. 170"></label>
          <label class="q" style="display:block;margin-bottom:0"><span class="q-label">Weight (kg)</span>
            <input type="number" id="wz-weight" inputmode="decimal" value="${esc(d.weightKg ?? '')}" placeholder="e.g. 70"></label>
        </section>${err}${next()}`;
    case 'fitness':
      return `${head('Runner profile', 'How fit are you right now?', 'Be honest, the plan adapts either way.')}
        ${Object.entries(FITNESS).map(([k, v], i) => optCard('fitness', k, v, ['Short and easy to start', 'A gentle build-up', 'Start with some intervals', 'Start strong'][i], String(i + 1))).join('')}
        ${err}<div style="margin-top:14px">${next()}</div>`;
    case 'pref':
      return `${head('Runner profile', 'Walking or running?')}
        ${optCard('preference', 'walk', 'Walking', 'Brisk walking all the way. No running, ever.', '🚶')}
        ${optCard('preference', 'mix', 'A bit of both', 'Walking that grows into run/walk intervals.', '🔀')}
        ${optCard('preference', 'run', 'Running', 'Builds up from walking to continuous running.', '🏃')}
        ${err}<div style="margin-top:14px">${next()}</div>`;
    case 'goal':
      return `${head('Runner profile', "What's your main goal?")}
        ${optCard('goal', 'habit', GOALS.habit, 'Short, doable sessions that stick.', '📅')}
        ${optCard('goal', 'weight', GOALS.weight, 'Extra easy minutes added to each workout.', '⚖️')}
        ${optCard('goal', 'endurance', GOALS.endurance, 'Steady progress in time and pace.', '🫁')}
        ${optCard('goal', 'run5k', GOALS.run5k, 'Switches on the running track.', '🏁')}
        ${err}<div style="margin-top:14px">${next()}</div>`;
    case 'schedule':
      return `${head('Your week', 'When can you train?', 'Stride will schedule workouts in these slots and move them if something clashes.')}
        <section class="card">
          <div class="q"><span class="q-label">Workouts per week</span>
            <div class="chips">${[1, 2, 3, 4, 5].map((n) => chip('workoutsPerWeek', n, `${n}×`)).join('')}</div></div>
          <div class="q"><span class="q-label">Days that usually work</span>
            <div class="chips">${[1, 2, 3, 4, 5, 6, 0].map((n) => `<button class="chip" data-act="wz-day" data-arg="${n}" aria-pressed="${d.days.includes(n)}">${DAY_SHORT[n]}</button>`).join('')}</div></div>
          <div class="q" style="margin-bottom:0"><span class="q-label">Time window</span>
            <div class="row"><select id="wz-from" class="select">${timeOptions(d.from)}</select><span class="muted">to</span><select id="wz-to" class="select">${timeOptions(d.to)}</select></div></div>
        </section>
        <section class="card"><div class="switch-row"><div><b>Schedule my workouts</b><p class="small muted">You can connect Google Calendar or add workouts to your iPhone calendar in the Plan tab.</p></div>
          <button class="switch" role="switch" aria-checked="${d.scheduleOn}" data-act="wz-sched"></button></div></section>
        ${err}${next()}`;
    case 'summary': {
      const p = { ...data.profile, ...draftProfile() };
      const start = startingStage(p);
      const cur = Math.min(data.state.baselineStage, maxStage(p));
      const keepStage = wiz.mode === 'new' ? start : cur;
      const preview = decide({ profile: p, state: { ...data.state, baselineStage: keepStage, tempAdjustment: 'none', shortenTo: null }, history: data.history, readiness: defaultReadiness(), request: {}, now: nowIso() });
      const w = preview.workout;
      const fast = w?.segments.find((s) => s.type === 'work' || s.type === 'run');
      const steady = w?.segments.find((s) => s.type === 'steady' || s.type === 'recovery');
      return `${head('All set', wiz.mode === 'new' ? `Here's your plan${d.name ? `, ${esc(d.name)}` : ''}` : 'Your updated plan')}
        <section class="card hero">
          <span class="badge">Level ${levelOfStage(keepStage)} · ${esc(LEVELS[levelOfStage(keepStage)].name)}</span>
          <div class="stats">
            <div><div class="stat-num">${w ? w.totalMinutes : '–'}<span style="font-size:18px"> min</span></div><div class="stat-label">First workout</div></div>
            ${steady ? `<div><div class="stat-num">${fmtSpeed(steady.speed)}</div><div class="stat-label">Easy km/h</div></div>` : ''}
            ${fast ? `<div><div class="stat-num">${fmtSpeed(fast.speed)}</div><div class="stat-label">${fast.type === 'run' ? 'Jog' : 'Brisk'} km/h</div></div>` : ''}
          </div>
        </section>
        <section class="card"><h3>Tailored to you</h3><ul class="why">${profileSummary(p).map((x) => `<li>${esc(x)}</li>`).join('')}
          <li>Gets harder only after workouts feel comfortable, and eases off when they don't.</li></ul></section>
        ${wiz.mode === 'new' ? next("Let's go") : `
          <button class="btn primary lg block" data-act="wz-finish" data-arg="keep">Save and keep my level (${levelOfStage(cur)})</button>
          ${start !== cur ? `<button class="btn block" style="margin-top:10px" data-act="wz-finish" data-arg="restart">Save and restart at level ${levelOfStage(start)}</button>` : ''}`}`;
    }
    default: return '';
  }
}

function draftProfile() {
  const d = wiz.draft;
  return { name: d.name, age: d.age, gender: d.gender, heightCm: d.heightCm, weightKg: d.weightKg, fitness: d.fitness, preference: d.preference, goal: d.goal, workoutsPerWeek: d.workoutsPerWeek };
}

// Read inputs on the current step and validate. Returns an error or null.
function readWizardStep() {
  const d = wiz.draft;
  const num = (id) => { const v = document.getElementById(id)?.value; return v === '' || v == null ? null : Number(v); };
  switch (wizStep()) {
    case 'about':
      d.name = (document.getElementById('wz-name')?.value ?? '').trim().slice(0, 30);
      d.age = num('wz-age');
      if (!d.age || d.age < 10 || d.age > 100) return 'Please enter your age (10–100).';
      if (!d.gender) return 'Please pick an option for gender.';
      return null;
    case 'body':
      d.heightCm = num('wz-height');
      d.weightKg = num('wz-weight');
      if (!d.heightCm || d.heightCm < 120 || d.heightCm > 230) return 'Please enter your height in cm (120–230).';
      if (!d.weightKg || d.weightKg < 30 || d.weightKg > 250) return 'Please enter your weight in kg (30–250).';
      return null;
    case 'fitness': return d.fitness ? null : 'Pick the one that fits best.';
    case 'pref': return d.preference ? null : 'Pick walking, running or both.';
    case 'goal': return d.goal ? null : 'Pick a goal.';
    case 'schedule':
      d.from = document.getElementById('wz-from')?.value ?? d.from;
      d.to = document.getElementById('wz-to')?.value ?? d.to;
      if (d.scheduleOn && !d.days.length) return 'Pick at least one day.';
      if (d.scheduleOn && hm(d.to) - hm(d.from) < 30) return 'The time window needs to be at least 30 minutes.';
      return null;
    default: return null;
  }
}

function finishWizard(choice) {
  const d = wiz.draft;
  data.profile = { ...data.profile, ...draftProfile() };
  const now = nowIso();
  const start = startingStage(data.profile);
  let stage = data.state.baselineStage;
  if (wiz.mode === 'new' || choice === 'restart') stage = start;
  stage = Math.min(stage, maxStage(data.profile));
  if (stage !== data.state.baselineStage) {
    data.state = {
      ...data.state, baselineStage: stage, baselineChangedAt: now,
      baselineLog: [...data.state.baselineLog, { at: now, from: data.state.baselineStage, to: stage, source: 'profile', reason: 'Set from runner profile' }],
    };
  }
  if (wiz.mode !== 'edit') {
    data.schedule.enabled = d.scheduleOn;
    data.schedule.prefs = { days: [...d.days].sort(), from: d.from, to: d.to };
  }
  if (wiz.mode === 'new') {
    data.onboarded = true;
    data.state.seenMedals = [];
    store.requestPersistence();
  }
  const mode = wiz.mode;
  wiz = null;
  persist();
  replan({ silent: true });
  view = mode === 'edit' ? 'settings' : 'today';
  render();
  toast(choice ? 'Runner profile saved. Your plan is updated.' : "Profile saved. Let's get moving!");
}

const feature = (icon, title, text) =>
  `<div class="feature"><div class="ico">${ICONS[icon]}</div><div><b>${title}</b><p class="small muted">${text}</p></div></div>`;

// ---------- today

const fmtWhen = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 864e5);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
};

function renderToday() {
  const d = currentDecision();
  const r = readiness();
  const done = completedWorkouts(data.history);
  const monthCount = done.filter((w) => Date.now() - new Date(w.date) < 30 * 864e5).length;
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const initial = (data.profile.name || '?').trim().charAt(0).toUpperCase() || '?';

  let html = `
  <header class="topbar">
    <div><div class="eyebrow">${esc(dateStr)}</div><h1 class="title">${greeting()}</h1>
    <p class="subtitle">${done.length === 0 ? 'Ready for your first workout?' : monthCount ? `${plural(monthCount, 'workout')} in the last 30 days. Keep it up.` : 'Welcome back. Your progress is right where you left it.'}</p></div>
    <button class="avatar" data-act="profile" aria-label="Runner profile">${esc(initial)}</button>
  </header>`;

  if (!isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    html += `<div class="card soft install-tip">${ICONS.share}<span>Install Stride: tap <b>Share</b>, then <b>Add to Home Screen</b>.</span></div>`;
  }

  html += scheduleCards();
  html += readinessCard(r);

  if (d.status !== 'ok') {
    html += `
    <section class="card warn">
      <h2>${esc(d.headline)}</h2>
      <p style="margin-top:8px">${esc(d.explanation[0])}</p>
    </section>`;
    return html + todayLinks();
  }

  const w = d.workout;
  const lvl = LEVELS[d.baselineLevel];
  const fastLabel = w.isRun ? (w.workIntervals === 1 ? 'Jog' : 'Jogs') : (w.workIntervals === 1 ? 'Brisk bit' : 'Brisk bits');
  html += `
  <section class="card hero">
    <div class="row between wrap"><span class="badge">${w.isRun ? ICONS.run : ICONS.walk} Level ${d.baselineLevel} · ${esc(lvl.name)}</span>
    ${d.effectiveStage !== d.baseline.to ? '<span class="badge">Adjusted for today</span>' : ''}</div>
    <h2 style="margin-top:12px">${esc(d.headline)}</h2>
    <div class="stats">
      <div><div class="stat-num">${w.totalMinutes}<span style="font-size:18px"> min</span></div><div class="stat-label">Total time</div></div>
      <div><div class="stat-num">${w.distanceKm}<span style="font-size:18px"> km</span></div><div class="stat-label">About</div></div>
      ${w.workIntervals ? `<div><div class="stat-num">${w.workIntervals}</div><div class="stat-label">${fastLabel}</div></div>` : ''}
    </div>
    <div class="timeline" aria-hidden="true">${w.segments.map((s) => `<span class="tl-${s.type}" style="flex:${s.minutes}"></span>`).join('')}</div>
    <button class="btn white lg block" style="margin-top:16px" data-act="start">${ICONS.play} Start workout</button>
  </section>

  <div class="actions">
    ${actionBtn('easier', 'leaf', 'Low energy today', d.tempApplied === 'easier')}
    ${actionBtn('harder', 'bolt', 'Make it harder', d.tempApplied === 'harder', !d.harderAllowed)}
    ${actionBtn('shorten', 'clock', data.state.shortenTo ? `${data.state.shortenTo} min only` : 'Shorten', !!data.state.shortenTo)}
  </div>

  <section class="card">
    <h3>The plan · effort ${w.targetExertion[0]}–${w.targetExertion[1]} out of 10</h3>
    <ul class="segments">${w.segments.map(segRow).join('')}</ul>
    <p class="small muted" style="margin-top:10px">Speeds are a guide. Go by feel: you should still be able to talk in short sentences. If not, slow down.</p>
  </section>

  <section class="card">
    <h3>Why this workout</h3>
    <ul class="why">${d.explanation.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    ${d.safetyNotes.filter((n) => !d.explanation.includes(n)).length ? `<ul class="why small">${d.safetyNotes.filter((n) => !d.explanation.includes(n)).map((e) => `<li class="muted">${esc(e)}</li>`).join('')}</ul>` : ''}
  </section>`;
  return html + todayLinks();
}

function scheduleCards() {
  const sch = data.schedule;
  if (!sch.enabled) return '';
  let html = '';
  const missedOnes = pendingMissed(sch.sessions, data.history, nowIso(), sch.dismissed);
  if (missedOnes.length) {
    const m = missedOnes[0];
    html += `<section class="card soft">
      <h3>What happened ${esc(fmtWhen(m.start).replace(/^(Today|Yesterday)/, (x) => x.toLowerCase()))}?</h3>
      <p class="small muted" style="margin-bottom:10px">You had a workout planned. No judgement, and no catch-up needed. This just helps the plan.</p>
      <div class="chips">
        <button class="chip" data-act="missed-session" data-arg="${m.id}:done">I did it</button>
        ${Object.entries(REASONS).map(([k, v]) => `<button class="chip" data-act="missed-session" data-arg="${m.id}:${k}">${esc(v)}</button>`).join('')}
      </div></section>`;
  }
  const next = nextSession(sch.sessions, nowIso());
  if (next) {
    const mins = (new Date(next.start) - Date.now()) / 60000;
    const soon = mins < 30;
    html += `<section class="card ${soon ? 'next-now' : ''}">
      <div class="row between"><div><div class="eyebrow">${soon ? (mins <= 0 ? "It's time!" : 'Starting soon') : 'Next workout'}</div>
        <b style="font-size:20px">${esc(fmtWhen(next.start))}</b>${next.moved ? ' <span class="badge">moved</span>' : ''}
        ${soon ? `<p class="small" style="margin-top:4px">${esc(funnyLine(next.id, { name: data.profile.name, minutes: next.minutes }))}</p>` : ''}</div>
        <div class="row" style="gap:6px"><button class="chip" data-act="sheet" data-arg="move:${next.id}">Move</button><button class="chip" data-act="sheet" data-arg="skip:${next.id}">Skip</button></div>
      </div></section>`;
  }
  return html;
}

function segRow(s) {
  return `<li><span class="seg-dot dot-${s.type}"></span><span class="seg-name">${esc(s.label)}</span>
    <span class="seg-meta"><b>${s.minutes} min</b> · ${fmtSpeed(s.speed)} km/h</span></li>`;
}

function actionBtn(act, icon, label, on, disabled = false) {
  return `<button class="action ${on ? 'on' : ''}" data-act="${act}" ${disabled ? 'aria-disabled="true"' : ''} aria-pressed="${on}">${ICONS[icon]}<span>${esc(label)}</span></button>`;
}

function readinessCard(r) {
  const chip = (field, val, label) =>
    `<button class="chip" data-act="ready" data-arg="${field}:${val}" aria-pressed="${r[field] === val}">${label}</button>`;
  return `
  <section class="card">
    <h3>How are you today?</h3>
    <div class="q"><span class="q-label small muted">Energy</span><div class="chips">
      ${chip('energy', 'low', 'Low')}${chip('energy', 'normal', 'Normal')}${chip('energy', 'high', 'High')}</div></div>
    <div class="q" style="margin-bottom:0"><span class="q-label small muted">Recovery from last time</span><div class="chips">
      ${chip('recovery', 'poor', 'Poor')}${chip('recovery', 'normal', 'Normal')}${chip('recovery', 'good', 'Good')}</div></div>
  </section>`;
}

function todayLinks() {
  return `
  <section class="card">
    <button class="list-btn" data-act="sheet" data-arg="level"><span class="row">${ICONS.sliders} Change my program level</span><span class="chev">${ICONS.chev}</span></button>
    <button class="list-btn" data-act="profile"><span class="row">${ICONS.user} Edit runner profile</span><span class="chev">${ICONS.chev}</span></button>
    <button class="list-btn" data-act="sheet" data-arg="missed"><span class="row">${ICONS.calendar} Log a missed session</span><span class="chev">${ICONS.chev}</span></button>
  </section>`;
}

// ---------- active workout

function startWorkout() {
  const now = nowIso();
  const d = currentDecision();
  if (d.status !== 'ok') return render();
  if (d.baseline.changed) toast(d.baseline.reason, 5000);
  data.state = commitDecision(data.state, d, now);
  data.activeSession = {
    id: uid(), startedAt: now, decision: d,
    segments: d.workout.segments.map((s) => ({ ...s, plannedSpeed: s.speed, done: false, skipped: false, completedMinutes: 0 })),
    index: 0, segElapsedMs: 0, totalElapsedMs: 0, running: true, lastTick: Date.now(),
    endedEarly: false, stoppedForSafety: false, endReason: null, slowed: false,
  };
  persist();
  unlockAudio();
  requestWakeLock();
  view = 'workout';
  render();
  announce();
  startTicker();
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
}

function tick() {
  const s = data.activeSession;
  if (!s || view !== 'workout') return;
  const now = Date.now();
  let dt = now - s.lastTick;
  s.lastTick = now;
  if (!s.running) return;
  // If the app was closed for a long time, assume the walk was paused.
  if (dt > 30 * 60 * 1000) { s.running = false; persist(); render(); return; }
  let changed = false;
  while (dt > 0 && s.index < s.segments.length) {
    const seg = s.segments[s.index];
    const left = seg.minutes * 60000 - s.segElapsedMs;
    const use = Math.min(dt, left);
    s.segElapsedMs += use;
    s.totalElapsedMs += use;
    dt -= use;
    if (s.segElapsedMs >= seg.minutes * 60000 - 5) {
      seg.done = true;
      seg.completedMinutes = seg.minutes;
      s.index++;
      s.segElapsedMs = 0;
      changed = true;
    }
  }
  if (s.index >= s.segments.length) return finishWorkout(false);
  if (changed) { render(); announce(); persist(); return; }
  if (now - lastSaveAt > 5000) { lastSaveAt = now; persist(); }
  updateWorkout();
}

function renderWorkout() {
  const s = data.activeSession;
  const seg = s.segments[s.index];
  const next = s.segments[s.index + 1];
  const col = segColor(seg.type);
  return `
  <section class="active">
    <div class="active-top">
      <span class="badge" style="background:color-mix(in srgb, ${col} 18%, transparent);color:${col}">Step ${s.index + 1} of ${s.segments.length}</span>
      ${s.running ? '' : '<span class="paused-label">PAUSED</span>'}
      <span class="muted small" id="w-total"></span>
    </div>
    <div class="ring-wrap">
      <svg viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="54" fill="none" stroke-width="9"/>
      <circle id="w-ring" class="ring-fg" cx="60" cy="60" r="54" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="339.3" stroke-dashoffset="0"/></svg>
      <div class="ring-center">
        <div class="seg-title">${esc(seg.label)}</div>
        <div class="clock" id="w-clock">0:00</div>
        <div class="speed-pill" style="background:color-mix(in srgb, ${col} 16%, transparent);color:${col}">${fmtSpeed(seg.speed)} km/h</div>
      </div>
    </div>
    <p class="cue">${esc(seg.cue)}${seg.speed < seg.plannedSpeed ? ' <b>(slowed down, good call)</b>' : ''}</p>
    ${next ? `<div class="next"><span><span class="muted small">Next</span><br><b>${esc(next.label)}</b></span><span class="seg-meta"><b>${fmtSpeed(next.speed)} km/h</b><br><span class="small">${next.minutes} min</span></span></div>`
      : '<div class="next"><span><b>Last step.</b> Almost there.</span></div>'}
    <div class="progress"><span id="w-progress" style="width:0%"></span></div>
    <div class="controls">
      <button class="btn ${s.running ? '' : 'primary'} main" data-act="pause">${s.running ? `${ICONS.pause} Pause` : `${ICONS.play} Resume`}</button>
      <button class="btn" data-act="slow">${ICONS.slow}Slow down</button>
      <button class="btn" data-act="skip">${ICONS.skip}Skip step</button>
      <button class="btn" data-act="sheet" data-arg="stop">${ICONS.stop}Stop</button>
    </div>
    <button class="unwell" data-act="sheet" data-arg="unwell">I don't feel well</button>
  </section>`;
}

function updateWorkout() {
  const s = data.activeSession;
  if (!s) return;
  const seg = s.segments[s.index];
  const segMs = seg.minutes * 60000;
  const planned = s.segments.reduce((a, x) => a + x.minutes, 0) * 60000;
  const doneMs = s.segments.slice(0, s.index).reduce((a, x) => a + x.minutes * 60000, 0) + s.segElapsedMs;
  const el = (id) => document.getElementById(id);
  if (el('w-clock')) el('w-clock').textContent = clock(segMs - s.segElapsedMs);
  if (el('w-ring')) el('w-ring').style.strokeDashoffset = String(339.3 * (s.segElapsedMs / segMs));
  if (el('w-progress')) el('w-progress').style.width = `${Math.min(100, (doneMs / planned) * 100)}%`;
  if (el('w-total')) el('w-total').textContent = `${clock(planned - doneMs)} left`;
}

function announce() {
  const s = data.activeSession;
  if (!s) return;
  const seg = s.segments[s.index];
  beep();
  if (navigator.vibrate) navigator.vibrate(200);
  speak(`${seg.label}. Set the treadmill to ${fmtSpeed(seg.speed)} kilometres per hour, for ${plural(seg.minutes, 'minute')}.`);
}

function togglePause() {
  const s = data.activeSession;
  s.running = !s.running;
  s.lastTick = Date.now();
  persist();
  render();
}

function slowDown() {
  const s = data.activeSession;
  const seg = s.segments[s.index];
  const isWork = seg.type === 'work' || seg.type === 'run';
  const step = RULES.slowDownStep;
  for (let i = s.index; i < s.segments.length; i++) {
    const x = s.segments[i];
    const same = isWork ? x.type === seg.type : (x.type === 'steady' || x.type === 'recovery' || i === s.index);
    if (same) x.speed = Math.max(GLOBAL_LIMITS.minSpeed, Math.round((x.speed - step) * 10) / 10);
  }
  s.slowed = true;
  persist();
  render();
  speak(`Slowing to ${fmtSpeed(seg.speed)}.`);
  toast(`Slowed to ${fmtSpeed(seg.speed)} km/h${isWork ? ` for the ${seg.type === 'run' ? 'jogs' : 'brisk bits'}` : ''}. Smart move.`);
}

function skipStep() {
  const s = data.activeSession;
  const seg = s.segments[s.index];
  seg.skipped = true;
  seg.completedMinutes = s.segElapsedMs / 60000;
  s.index++;
  s.segElapsedMs = 0;
  if (s.index >= s.segments.length) return finishWorkout(true, null);
  persist();
  render();
  announce();
}

function finishWorkout(early, reason = null, safety = false) {
  const s = data.activeSession;
  clearInterval(ticker);
  releaseWakeLock();
  if (s.index < s.segments.length) {
    const seg = s.segments[s.index];
    seg.completedMinutes = s.segElapsedMs / 60000;
  }
  s.running = false;
  s.endedEarly = early || s.segments.some((x) => x.skipped);
  s.stoppedForSafety = safety;
  s.endReason = reason;
  checkin = {
    perceived_exertion: null, talk_test_result: null, post_workout_feeling: null, rating: null,
    muscle_soreness: 'none', reason: reason, user_feedback: '',
  };
  persist();
  view = 'checkin';
  closeSheet();
  render();
  if (!early) { speak('Workout complete. Well done.'); beep(); }
}

// ---------- post-workout check-in

function renderCheckin() {
  const s = data.activeSession;
  const mins = Math.round(s.totalElapsedMs / 6000) / 10;
  const c = checkin;
  const chip = (field, val, label) => `<button class="chip" data-act="ci" data-arg="${field}:${val}" aria-pressed="${c[field] === val}">${label}</button>`;
  const rpe = Array.from({ length: 10 }, (_, i) =>
    `<button data-act="ci" data-arg="perceived_exertion:${i + 1}" aria-pressed="${c.perceived_exertion === i + 1}">${i + 1}</button>`).join('');
  return `
  <header class="topbar"><div>
    <div class="eyebrow">${s.stoppedForSafety ? 'Stopped for your wellbeing' : s.endedEarly ? 'Every minute counts' : 'Workout complete'}</div>
    <h1 class="title">${s.stoppedForSafety ? 'Good call stopping.' : 'Nice work!'}</h1>
    <p class="subtitle">You did <b>${mins} min</b>${s.endedEarly ? ` of ${s.decision.workout.totalMinutes} planned. That still counts and is saved.` : '. All of it.'}</p>
  </div></header>
  ${s.stoppedForSafety ? `<section class="card warn"><b>Rest up.</b><p class="small" style="margin-top:6px">Take it easy for the rest of the day. Your plan will be lighter next time.</p></section>` : ''}
  <section class="card">
    <div class="q"><span class="q-label">How hard was it overall?</span>
      <div class="rpe">${rpe}</div>
      <div class="rpe-legend"><span>Very easy</span><span>Comfortable</span><span>Moderate</span><span>Hard</span><span>Max</span></div>
      <p class="small muted" style="margin-top:6px">Your target today was ${s.decision.workout.targetExertion[0]}–${s.decision.workout.targetExertion[1]}.</p></div>
    <div class="q"><span class="q-label">${s.decision.workout.workIntervals ? `Could you talk in full sentences during the ${s.decision.workout.isRun ? 'jogs' : 'brisk bits'}?` : 'Could you talk in full sentences?'}</span>
      <div class="chips">${chip('talk_test_result', 'yes', 'Yes, easily')}${chip('talk_test_result', 'mostly', 'Mostly')}${chip('talk_test_result', 'no', 'No, too puffed')}</div></div>
    <div class="q"><span class="q-label">How do you feel now?</span>
      <div class="chips">${chip('post_workout_feeling', 'great', 'Great')}${chip('post_workout_feeling', 'good', 'Good')}${chip('post_workout_feeling', 'tired', 'Tired')}${chip('post_workout_feeling', 'exhausted', 'Exhausted')}${chip('post_workout_feeling', 'unwell', 'Unwell')}</div></div>
    <div class="q"><span class="q-label">The workout was…</span>
      <div class="chips">${chip('rating', 'too_easy', 'Too easy')}${chip('rating', 'appropriate', 'About right')}${chip('rating', 'too_hard', 'Too hard')}</div></div>
    <div class="q"><span class="q-label">Any muscle soreness?</span>
      <div class="chips">${chip('muscle_soreness', 'none', 'None')}${chip('muscle_soreness', 'mild', 'Mild')}${chip('muscle_soreness', 'moderate', 'Moderate')}${chip('muscle_soreness', 'severe', 'Severe')}</div></div>
    ${s.endedEarly || s.stoppedForSafety ? `<div class="q"><span class="q-label">What made you stop early? <span class="muted small">(optional)</span></span>
      <div class="chips">${Object.entries(REASONS).map(([k, v]) => chip('reason', k, v)).join('')}</div></div>` : ''}
    <div class="q" style="margin-bottom:0"><span class="q-label">Notes <span class="muted small">(optional)</span></span>
      <textarea id="ci-notes" rows="3" placeholder="Anything worth remembering?">${esc(c.user_feedback)}</textarea></div>
  </section>
  <button class="btn primary lg block" data-act="save-checkin">${ICONS.check} Save</button>
  ${s.totalElapsedMs < 60000 ? '<button class="btn ghost block" style="margin-top:6px" data-act="discard">Don\'t save this workout</button>' : ''}`;
}

function saveCheckin() {
  const s = data.activeSession;
  const notes = document.getElementById('ci-notes');
  if (notes) checkin.user_feedback = notes.value;
  const feedback = normalizeFeedback(checkin);
  const now = nowIso();
  const { record, state, classification } = recordWorkout({
    state: data.state, decision: s.decision,
    session: { startedAt: s.startedAt, elapsedMinutes: s.totalElapsedMs / 60000, endedEarly: s.endedEarly, stoppedForSafety: s.stoppedForSafety, segments: s.segments },
    feedback, readiness: readiness(), now, id: s.id,
  });
  data.history.push(record);
  data.state = state;
  data.activeSession = null;
  if (data.schedule.enabled) data.schedule.sessions = markDone(data.schedule.sessions, record.date);
  const fresh = newlyEarned(evaluateMedals(data.history, data.profile, now), data.state.seenMedals);
  data.state.seenMedals = [...(data.state.seenMedals ?? []), ...fresh.map((m) => m.id)];
  persist();
  view = 'today';
  render();
  if (fresh.length) setTimeout(() => openSheet(sheets.medal(fresh)), 600);
  if (data.schedule.enabled) replan({ silent: true });
  else pushSync();
  window.scrollTo(0, 0);
  const msgs = {
    easy: 'Saved. That felt comfortable. A couple more like it and things step up a little.',
    appropriate: 'Saved. Right in the sweet spot. Nicely done.',
    hard: 'Saved. Thanks for being honest. Next time will be a bit lighter.',
    neutral: 'Saved. Short walks still count toward your habit.',
    safety: 'Saved. Stopping was the right call. Rest up.',
  };
  toast(msgs[classification] ?? 'Saved.', 4500);
}

// ---------- progress

function renderProgress() {
  const done = completedWorkouts(data.history);
  const missed = missedSessions(data.history);
  const weeks = weeklyCounts(data.history, new Date(), 8);
  const recent4 = weeks.slice(-4).reduce((a, b) => a + b, 0);
  const mins = Math.round(totalMinutes(data.history));
  const { insights } = personalInsights(data.history);
  const level = levelOfStage(data.state.baselineStage);

  const comfortable = done.filter((w) => ['easy', 'appropriate'].includes(classifyWorkout(w)));
  const best = comfortable.reduce((b, w) => (!b || w.actual_duration > b.actual_duration ||
    (w.actual_duration === b.actual_duration && topSpeed(w) > topSpeed(b)) ? w : b), null);

  const maxW = Math.max(2, ...weeks);
  const weekBars = weeks.map((n) => `<div class="bar"><b>${n || ''}</b><i class="${n ? '' : 'zero'}" style="height:${(n / maxW) * 100}%"></i></div>`).join('');
  const weekAxis = weeks.map((_, i) => `<span>${i === 7 ? 'This' : `−${7 - i}w`}</span>`).join('');

  const last = done.slice(-10);
  const maxM = Math.max(10, ...last.map((w) => w.actual_duration));
  const durBars = last.map((w) => `<div class="bar"><b>${Math.round(w.actual_duration)}</b><i style="height:${(w.actual_duration / maxM) * 100}%"></i></div>`).join('');
  const durAxis = last.map((w) => `<span>${new Date(w.date).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}</span>`).join('');

  const recov = done.slice(-8).map((w) => `<span class="rec-dot ${w.recovery_status}">${w.recovery_status}</span>`).join('');

  const items = [...data.history].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);

  return `
  <header class="topbar"><div><div class="eyebrow">Your journey</div><h1 class="title">Progress</h1></div></header>
  <div class="tiles">
    ${tile(done.length, done.length === 1 ? 'Workout' : 'Workouts')}
    ${tile(mins, 'Minutes moved')}
    ${tile(evaluateMedals(data.history, data.profile, nowIso()).totalKm, 'Kilometres')}
    ${tile(`L${level}`, LEVELS[level].name)}
  </div>
  ${done.length === 0 ? `<section class="card soft"><p>Your progress will show up here after your first workout. Whenever you're ready.</p></section>` : `
  <section class="card">
    <h3>Consistency · workouts per week</h3>
    <div class="bars" role="img" aria-label="Workouts per week for the last 8 weeks: ${weeks.join(', ')}">${weekBars}</div>
    <div class="bar-axis">${weekAxis}</div>
    <p class="small muted" style="margin-top:10px">Your aim: ${data.profile.workoutsPerWeek} per week. ${recent4} in the last 4 weeks.</p>
  </section>
  <section class="card">
    <h3>Minutes per workout · last ${last.length}</h3>
    <div class="bars" role="img" aria-label="Minutes per workout">${durBars}</div>
    <div class="bar-axis">${durAxis}</div>
  </section>
  ${best ? `<section class="card"><h3>Personal best comfortable workout</h3>
    <div class="row between"><div><b style="font-size:22px">${Math.round(best.actual_duration)} min</b><p class="small muted">${new Date(best.date).toLocaleDateString()} · felt ${best.rating === 'too_easy' ? 'easy' : 'about right'}</p></div>
    <span class="badge accent">${fmtSpeed(topSpeed(best))} km/h top speed</span></div></section>` : ''}
  <section class="card"><h3>Recovery before recent workouts</h3><div class="rec-dots">${recov}</div></section>`}
  ${insights.length ? `<section class="card soft"><h3>What I'm learning about you</h3><ul class="why">${insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>` : ''}
  ${items.length ? `<section class="card"><h3>History</h3>${items.map(histItem).join('')}</section>` : ''}
  ${missed.length ? `<p class="small muted" style="text-align:center">${plural(missed.length, 'missed session')} logged. Missing sessions never erases progress.</p>` : ''}`;
}

const tile = (num, label) => `<div class="tile"><div class="tile-num">${esc(num)}</div><div class="tile-label">${esc(label)}</div></div>`;
const topSpeed = (w) => Math.max(0, ...(w.actual_speed_by_interval ?? []).map((x) => x.speed));

function histItem(r) {
  const date = new Date(r.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (r.kind === 'missed') {
    return `<div class="hist-item"><div class="row between"><span class="muted">${date} · missed</span><span class="small muted">${esc(REASONS[r.reason] ?? '')}</span></div></div>`;
  }
  const c = classifyWorkout(r);
  const label = { easy: 'Felt easy', appropriate: 'About right', hard: 'Tough one', neutral: 'Short one', safety: 'Stopped early' }[c];
  return `<details class="hist-item"><summary><span><b>${date}</b> · ${Math.round(r.actual_duration)} min${r.distance_km ? ` · ${r.distance_km.toFixed(1)} km` : ''}</span><span class="badge ${c === 'hard' ? 'accent' : ''}">${label}</span></summary>
    <div class="hist-detail">
      <p>Level ${r.baseline_program_level} · effort ${r.perceived_exertion ?? '–'}/10 · talk test: ${esc(r.talk_test_result ?? '–')} · felt ${esc(r.post_workout_feeling ?? '–')}</p>
      ${r.reason_for_shortening_or_skipping ? `<p>Ended early: ${esc(REASONS[r.reason_for_shortening_or_skipping])}</p>` : ''}
      ${r.user_feedback ? `<p>“${esc(r.user_feedback)}”</p>` : ''}
      <p class="muted" style="margin-top:4px">Why it was planned: ${esc(r.algorithm_decision_explanation)}</p>
    </div></details>`;
}

// ---------- settings

function renderSettings() {
  const p = data.profile;
  const sw = (key, label, sub) => `<div class="switch-row"><div><b>${label}</b>${sub ? `<p class="small muted">${sub}</p>` : ''}</div>
    <button class="switch" role="switch" aria-label="${esc(label)}" aria-checked="${!!p[key]}" data-act="toggle" data-arg="${key}"></button></div>`;
  const durChip = (v) => `<button class="chip" data-act="pref" data-arg="defaultMinutes:${v}" aria-pressed="${(p.defaultMinutes ?? 0) === v}">${v === 0 ? 'Full length' : `${v} min`}</button>`;
  const row = (k, v) => `<div class="kv"><span class="muted">${k}</span><b>${esc(v ?? '–')}</b></div>`;
  return `
  <header class="topbar"><div><div class="eyebrow">Make it yours</div><h1 class="title">Settings</h1></div></header>
  <section class="card" id="runner-profile">
    <div class="row between"><h3 style="margin:0">Runner profile</h3><span class="avatar sm">${esc((p.name || '?').charAt(0).toUpperCase())}</span></div>
    <div class="kv-grid">
      ${row('Name', p.name || '–')}${row('Age', p.age)}${row('Gender', GENDERS[p.gender])}
      ${row('Height', p.heightCm ? `${p.heightCm} cm` : null)}${row('Weight', p.weightKg ? `${p.weightKg} kg` : null)}
      ${row('Fitness', FITNESS[p.fitness])}${row('Prefers', PREFERENCE[effectivePreference(p)])}${row('Goal', GOALS[p.goal])}
    </div>
    <ul class="why small" style="margin-top:10px">${profileSummary(p).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <button class="btn primary block" style="margin-top:12px" data-act="edit-profile">${ICONS.user} Edit runner profile</button>
  </section>
  <section class="card"><h3>Program level</h3>${levelOptions()}</section>
  <section class="card">
    <h3>Workout length cap</h3><div class="chips">${[0, 10, 15, 20, 25, 30].map(durChip).join('')}</div>
    <p class="small muted" style="margin-top:8px">Workouts longer than this get shortened to fit.</p>
  </section>
  <section class="card">
    <h3>Preferences</h3>
    ${sw('autoEasierOnLowEnergy', 'Lighter workout when energy is low', 'Applies automatically when you pick “Low” energy.')}
    ${sw('voiceCues', 'Voice and sound cues', 'Announces each step and treadmill speed.')}
  </section>
  <section class="card">
    <h3>Your data</h3>
    <button class="list-btn" data-act="export"><span>Export backup</span><span class="chev">${ICONS.share}</span></button>
    <label class="list-btn" style="cursor:pointer"><span>Import backup</span><span class="chev">${ICONS.chev}</span><input type="file" id="import-file" accept="application/json,.json" class="sr-only"></label>
    <button class="list-btn" data-act="sheet" data-arg="delete" style="color:var(--danger)"><span>Delete all data</span></button>
  </section>
  <div style="text-align:center;margin:18px 0 6px;opacity:.85">${wordmark(28)}</div>
  <p class="small muted" style="text-align:center;margin:0 20px 10px">Version ${ALGORITHM_VERSION}</p>`;
}

function levelOptions() {
  const cur = levelOfStage(data.state.baselineStage);
  const top = levelOfStage(maxStage(data.profile));
  return Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1).map((l) => `
    <button class="level-opt" data-act="level" data-arg="${l}" aria-pressed="${l === cur}" ${l > top ? 'aria-disabled="true"' : ''}>
      <span class="level-num">${l}</span>
      <span><b>${esc(LEVELS[l].name)}</b><br><span class="small muted">${esc(LEVELS[l].description)} ~${LEVELS[l].totalMinutes[0]}–${LEVELS[l].totalMinutes[1]} min${l > top ? ' · needs running in your profile' : ''}</span></span>
    </button>`).join('');
}

// ---------- plan (schedule + calendars)

function plannedMinutes() {
  const d = decide({ profile: data.profile, state: { ...data.state, tempAdjustment: 'none', shortenTo: null }, history: data.history, readiness: defaultReadiness(), request: {}, now: nowIso() });
  return d.workout?.totalMinutes ?? 20;
}

function scheduleCtx() {
  const s = data.schedule;
  return { prefs: s.prefs, busy: s.busy, external: s.google.connected ? (s.externalBusy ?? []) : [], sessions: s.sessions };
}

function describeChanges(changes) {
  const moved = changes.filter((c) => c.type === 'moved');
  const unresolved = changes.filter((c) => c.type === 'unresolved');
  if (moved.length) return `Moved ${plural(moved.length, 'workout')} to dodge a clash: ${moved.map((c) => fmtWhen(c.session.start)).join(', ')}.`;
  if (unresolved.length) return `Couldn't find a free slot for ${fmtWhen(unresolved[0].session.start)}. Move or skip it in the Plan tab.`;
  return null;
}

// Re-plan locally, then push to Google if connected. Never schedules catch-ups.
function replan({ silent = false } = {}) {
  if (!data.schedule.enabled) return;
  const { sessions, changes } = planSchedule({ ...scheduleCtx(), now: nowIso(), minutes: plannedMinutes(), perWeek: data.profile.workoutsPerWeek });
  data.schedule.sessions = sessions;
  persist();
  const msg = describeChanges(changes);
  if (msg && !silent) toast(msg, 5000);
  if (data.schedule.google.connected && gcal.hasValidToken()) syncGoogle(false);
  pushSync();
}

// ---------- push reminders

function pushSessions() {
  if (!data.schedule.enabled) return [];
  const now = new Date();
  return data.schedule.sessions.filter((s) => s.status === 'planned' && new Date(s.start) > now)
    .map(({ id, start, minutes }) => ({ id, start, minutes }));
}

// Tell the push service about the current plan (debounced; skips if unchanged).
function pushSync() {
  if (!data.push?.enabled || !pushUrl) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const sessions = pushSessions();
    const payload = JSON.stringify(sessions);
    if (payload === data.push.lastPayload) return;
    try {
      const r = await push.update(pushUrl, sessions);
      if (r === null) { data.push.enabled = false; persist(); if (view === 'plan') render(); return; }
      data.push.lastPayload = payload;
      persist();
    } catch { /* offline: try again on the next change or launch */ }
  }, 1200);
}

function pushCard() {
  const p = data.push ?? {};
  let body;
  if (!pushUrl) {
    body = `<p class="small muted">Not set up yet. It needs a free one-time setup (about 15 minutes): see <b>push/README.md</b> in the Stride repo on GitHub. Until then you get calendar alerts, and funny pop-ups while Stride is open.</p>`;
  } else if (!push.supported() || (/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone())) {
    body = `<p class="small muted">Install Stride on your home screen first (Share → Add to Home Screen), then open it from there to turn these on. Needs iOS 16.4 or newer.</p>`;
  } else if (p.enabled) {
    body = `<p class="small">${ICONS.check} On. A funny reminder arrives 10 minutes before and at the start of every planned workout, even when Stride is closed.</p>
      <p class="small muted" style="margin:6px 0 12px">If you change your plan in Google Calendar, open Stride once so the reminders follow.</p>
      <div class="row"><button class="btn primary" style="flex:1" data-act="push-test">${ICONS.bell} Send a test</button><button class="btn" data-act="push-off" ${pushBusy ? 'disabled' : ''}>Turn off</button></div>`;
  } else {
    body = `<p class="small muted" style="margin-bottom:12px">Get a funny nudge 10 minutes before and at the start of each workout, even when Stride is closed.</p>
      <button class="btn primary block" data-act="push-on" ${pushBusy ? 'disabled' : ''}>${ICONS.bell} ${pushBusy ? 'Turning on…' : 'Turn on push reminders'}</button>`;
  }
  return `<section class="card"><h3>Funny push reminders</h3>${body}</section>`;
}

async function syncGoogle(interactive) {
  const g = data.schedule.google;
  if (syncing) return;
  syncing = true;
  if (view === 'plan') render();
  try {
    const token = await gcal.connect(g.clientId);
    const now = new Date();
    const from = new Date(now.getTime() - 864e5).toISOString();
    const to = new Date(now.getTime() + 15 * 864e5).toISOString();
    g.calendarId = await gcal.ensureCalendar(token, g.calendarId);
    const calId = g.calendarId;
    const { busy, strideEvents } = await gcal.readCalendar(token, calId, from, to);

    // Respect changes made in Google Calendar: moved events move the session,
    // deleted events count as skipped (no catch-up).
    let sessions = data.schedule.sessions.map((s) => {
      if (s.status !== 'planned' || new Date(s.start) < now) return s;
      const ev = strideEvents.get(s.id);
      if (!ev) return s.googleEventId ? { ...s, status: 'skipped', note: 'Deleted in Google Calendar' } : s;
      const evStart = new Date(ev.start.dateTime).toISOString();
      return evStart !== new Date(s.start).toISOString() ? { ...s, start: evStart, googleEventId: ev.id, moved: true } : { ...s, googleEventId: ev.id };
    });
    data.schedule.externalBusy = busy;
    const plan = planSchedule({ prefs: data.schedule.prefs, busy: data.schedule.busy, external: data.schedule.externalBusy, sessions, now: now.toISOString(), minutes: plannedMinutes(), perWeek: data.profile.workoutsPerWeek });
    sessions = plan.sessions;

    const keep = new Set();
    for (const s of sessions) {
      if (s.status !== 'planned' || new Date(s.start) < now) continue;
      const body = gcal.eventBody(s, { title: eventTitle(s), description: eventDescription(s, data.profile) });
      const ev = strideEvents.get(s.id);
      if (ev) {
        const same = new Date(ev.start.dateTime).getTime() === new Date(s.start).getTime() && new Date(ev.end.dateTime).getTime() === sessionEnd(s).getTime()
          && ev.summary === body.summary && (ev.description ?? '') === body.description;
        if (!same) await gcal.patchEvent(token, calId, ev.id, body);
        s.googleEventId = ev.id;
      } else {
        const created = await gcal.insertEvent(token, calId, body);
        s.googleEventId = created.id;
      }
      keep.add(s.id);
    }
    for (const [sid, ev] of strideEvents) {
      if (!keep.has(sid) && new Date(ev.start.dateTime) > now && !sessions.some((x) => x.id === sid && x.status !== 'planned')) await gcal.deleteEvent(token, calId, ev.id);
    }
    data.schedule.sessions = sessions;
    Object.assign(g, { connected: true, lastSync: nowIso(), error: null });
    persist();
    pushSync();
    const msg = describeChanges(plan.changes);
    toast(msg ?? (interactive ? `Synced with Google Calendar. ${plural(sessions.filter((x) => x.status === 'planned' && new Date(x.start) >= now).length, 'workout')} scheduled.` : ''), msg ? 5000 : 2500);
  } catch (e) {
    g.error = e.message;
    persist();
    if (interactive) toast(e.message, 5000);
  } finally {
    syncing = false;
    if (view === 'plan' || view === 'today') render();
  }
}

function renderPlan() {
  const sch = data.schedule;
  const p = sch.prefs;
  const g = sch.google;
  const now = new Date();
  if (!sch.enabled) {
    return `<header class="topbar"><div><div class="eyebrow">Your week</div><h1 class="title">Plan</h1></div></header>
      <section class="card"><h2>Schedule your workouts</h2><p class="muted" style="margin:8px 0 14px">Pick your days and times. Stride books workouts into free slots, moves them when something clashes, and reminds you when it's time.</p>
      <button class="btn primary block" data-act="sched-on">Turn on scheduling</button></section>`;
  }
  const upcoming = sch.sessions.filter((s) => sessionEnd(s) > now && s.status === 'planned');
  const ctx = scheduleCtx();
  const list = upcoming.length ? upcoming.map((s) => {
    const clash = conflictsOf(s, ctx.busy, ctx.external, ctx.sessions);
    return `<div class="sess"><div><b>${esc(fmtWhen(s.start))}</b><div class="small muted">${s.minutes} min${s.moved ? ' · moved' : ''}${s.googleEventId ? ' · in Google Calendar' : ''}</div>
      ${clash ? '<span class="badge accent">Clashes with something</span>' : ''}</div>
      <div class="row" style="gap:6px"><button class="chip" data-act="sheet" data-arg="move:${s.id}">Move</button><button class="chip" data-act="sheet" data-arg="skip:${s.id}">Skip</button></div></div>`;
  }).join('') : '<p class="muted">Nothing planned in the next two weeks. Check your days and time window below.</p>';

  const day = (n) => `<button class="chip" data-act="plan-day" data-arg="${n}" aria-pressed="${p.days.includes(n)}">${DAY_SHORT[n]}</button>`;
  const per = (n) => `<button class="chip" data-act="pref" data-arg="workoutsPerWeek:${n}" aria-pressed="${data.profile.workoutsPerWeek === n}">${n}×</button>`;
  const busyList = sch.busy.length ? sch.busy.map((b) => `<div class="sess"><div><b>${esc(b.label || 'Busy')}</b><div class="small muted">${b.days.map((d) => DAY_SHORT[d]).join(', ')} · ${b.from}–${b.to}</div></div>
      <button class="icon-btn" data-act="busy-del" data-arg="${b.id}" aria-label="Remove">${ICONS.x}</button></div>`).join('') : '<p class="small muted">Add regular commitments (work, classes) so workouts never land on them.</p>';

  return `
  <header class="topbar"><div><div class="eyebrow">Your week</div><h1 class="title">Plan</h1></div></header>
  <section class="card"><h3>Coming up</h3>${list}</section>

  <section class="card">
    <h3>Google Calendar</h3>
    ${g.connected ? `<p class="small">${ICONS.check} Connected${g.lastSync ? ` · last sync ${esc(fmtWhen(g.lastSync))}` : ''}</p>
      <p class="small muted" style="margin:6px 0 12px">Workouts go into a separate <b>Stride workouts</b> calendar with reminders. Stride only sees when you're busy, never what your events are. If you move a workout in Google, Stride follows.</p>
      ${g.error ? `<p class="small" style="color:var(--danger)">${esc(g.error)}</p>` : ''}
      <div class="row"><button class="btn primary" style="flex:1" data-act="gsync" ${syncing ? 'disabled' : ''}>${ICONS.refresh} ${syncing ? 'Syncing…' : 'Sync now'}</button><button class="btn" data-act="gdisconnect">Disconnect</button></div>`
    : `<p class="small muted" style="margin-bottom:10px">Full auto mode: Stride checks when you're busy (times only, never event details), books workouts into free slots, moves them when plans change, and puts them in its own <b>Stride workouts</b> calendar with reminders. It can't read or change your other events.</p>
      <label class="q" style="display:block;margin-bottom:10px"><span class="q-label small">Your Google OAuth Client ID</span>
        <input type="text" id="g-client" value="${esc(g.clientId)}" placeholder="xxxx.apps.googleusercontent.com" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      ${g.error ? `<p class="small" style="color:var(--danger);margin-bottom:8px">${esc(g.error)}</p>` : ''}
      <div class="row"><button class="btn primary" style="flex:1" data-act="gconnect" ${syncing ? 'disabled' : ''}>${syncing ? 'Connecting…' : 'Connect Google Calendar'}</button>
      <button class="btn" data-act="sheet" data-arg="ghelp">How?</button></div>`}
  </section>

  <section class="card">
    <h3>iPhone Calendar</h3>
    <p class="small muted" style="margin-bottom:12px">Adds your upcoming workouts to the iPhone Calendar with alerts 10 minutes before and at start time. After you change the plan, add them again; open the new events and remove old ones if you see doubles.</p>
    <button class="btn block" data-act="ics">${ICONS.calendar} Add to iPhone Calendar</button>
  </section>

  <section class="card">
    <h3>When you can train</h3>
    <div class="q"><span class="q-label small muted">Workouts per week</span><div class="chips">${[1, 2, 3, 4, 5].map(per).join('')}</div></div>
    <div class="q"><span class="q-label small muted">Days</span><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(day).join('')}</div></div>
    <div class="q" style="margin-bottom:0"><span class="q-label small muted">Time window</span>
      <div class="row"><select class="select" data-plan="from">${timeOptions(p.from)}</select><span class="muted">to</span><select class="select" data-plan="to">${timeOptions(p.to)}</select></div></div>
  </section>

  <section class="card">
    <div class="row between"><h3 style="margin:0">Busy times</h3><button class="chip" data-act="sheet" data-arg="busy">${ICONS.plus} Add</button></div>
    <div style="margin-top:8px">${busyList}</div>
  </section>

  ${pushCard()}
  <section class="card soft">
    <button class="link" data-act="sched-off">Turn off scheduling</button>
  </section>`;
}

// ---------- medals

function renderMedals() {
  const r = evaluateMedals(data.history, data.profile, nowIso());
  const groups = ['workouts', 'distance', 'streak', 'special'];
  const tileFor = (m) => `
    <div class="medal ${m.earned ? 'earned' : ''}">
      <div class="medal-emoji" aria-hidden="true">${m.emoji}</div>
      <b>${esc(m.title)}</b>
      <span class="small muted">${esc(m.desc)}</span>
      ${m.earned ? `<span class="small medal-date">${new Date(m.earnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>`
        : m.group !== 'special' ? `<div class="progress sm"><span style="width:${Math.round(m.progress * 100)}%"></span></div>` : ''}
    </div>`;
  return `
  <header class="topbar"><div><div class="eyebrow">Trophy case</div><h1 class="title">Medals</h1>
    <p class="subtitle">${r.earnedCount} of ${r.medals.length} collected</p></div></header>
  <div class="tiles">
    ${tile(r.workouts, r.workouts === 1 ? 'Workout' : 'Workouts')}
    ${tile(r.totalKm, 'Kilometres')}
    ${tile(r.streak.current, `Week streak (goal ${data.profile.workoutsPerWeek}/wk)`)}
    ${tile(r.streak.best, 'Best streak')}
  </div>
  ${groups.map((g) => `<section class="card"><h3>${GROUP_TITLES[g]}</h3><div class="medal-grid">${r.medals.filter((m) => m.group === g).map(tileFor).join('')}</div></section>`).join('')}`;
}

// ---------------------------------------------------------------- sheets

function openSheet(html) {
  $sheet.innerHTML = `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
}
function closeSheet() { $sheet.innerHTML = ''; }

const findSession = (id) => data.schedule.sessions.find((s) => s.id === id);

// Up to six alternative free slots over the next week.
function alternativeSlots(session) {
  const out = [];
  const others = data.schedule.sessions.filter((s) => s.id !== session.id);
  const ctx = { ...scheduleCtx(), sessions: others };
  const now = new Date();
  for (let i = 0; i < 8 && out.length < 6; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    if (others.some((o) => o.status !== 'skipped' && new Date(o.start).toDateString() === d.toDateString())) continue;
    const slot = findSlot(d, session.minutes, ctx, now) ?? findSlot(d, session.minutes, ctx, now, true);
    if (slot && slot.getTime() !== new Date(session.start).getTime()) out.push(slot);
  }
  return out;
}

const sheets = {
  shorten() {
    const d = currentDecision({ shortenTo: null, temp: data.state.tempAdjustment });
    const full = d.workout ? d.workout.naturalMinutes : 15;
    const opts = [5, 10, 15, 20, 25].filter((m) => m < full);
    return `<h2>How much time do you have?</h2><p class="muted small">The intervals are recalculated to fit. Short workouts still count.</p>
      <div class="sheet-actions">${opts.map((m) => `<button class="btn block" data-act="shorten-to" data-arg="${m}">${m} minutes</button>`).join('')}
      <button class="btn primary block" data-act="shorten-to" data-arg="0">Full workout</button></div>`;
  },
  level() {
    return `<h2>Program level</h2><p class="muted small">This is a lasting change. Your history is always kept. For just today, use “Low energy” or “Make it harder” instead.</p>
      <div style="margin-top:14px">${levelOptions()}</div>`;
  },
  missed() {
    return `<h2>Log a missed session</h2><p class="muted small">Life happens. This helps the plan understand your week. It does not count against you.</p>
      <div class="chips" style="margin-top:14px">${Object.entries(REASONS).map(([k, v]) => `<button class="chip" data-act="missed" data-arg="${k}">${esc(v)}</button>`).join('')}</div>
      <div class="sheet-actions"><button class="btn ghost block" data-act="close">Cancel</button></div>`;
  },
  stop() {
    const opts = [['time', 'Short on time'], ['low_energy', 'Low energy'], ['too_difficult', 'Too difficult'], ['motivation', 'Not feeling it today'], ['other', 'Other reason']];
    return `<h2>End your workout?</h2><p class="muted small">Stopping is always allowed. Everything you've done so far is saved.</p>
      <div class="sheet-actions">${opts.map(([k, v]) => `<button class="btn block" data-act="end" data-arg="${k}">${v}</button>`).join('')}
      <button class="btn block" data-act="sheet" data-arg="unwell">Pain or feeling unwell</button>
      <button class="btn primary block" data-act="close">Keep going</button></div>`;
  },
  unwell() {
    return `<h2>Stop and take a break</h2>
      <p>Slow the belt down, step off and sit for a bit. Drink some water.</p>
      <p class="small muted" style="margin-top:8px">Chest pain, fainting or severe breathlessness: get medical help right away.</p>
      <div class="sheet-actions"><button class="btn danger block" data-act="end-safety">End workout</button>
      <button class="btn ghost block" data-act="close">I'm OK, continue</button></div>`;
  },
  delete() {
    return `<h2>Delete all data?</h2><p class="muted">This permanently removes your profile, history, medals and schedule from this phone. Events already in your calendar stay there. Consider exporting a backup first.</p>
      <div class="sheet-actions"><button class="btn danger block" data-act="wipe">Delete everything</button>
      <button class="btn block" data-act="close">Cancel</button></div>`;
  },
  medal(list) {
    return `<div class="celebrate">${list.map((m) => `<div class="medal-big">${m.emoji}</div>`).join('')}</div>
      <h2 style="text-align:center">${list.length === 1 ? 'New medal!' : `${list.length} new medals!`}</h2>
      ${list.map((m) => `<p style="text-align:center"><b>${esc(m.title)}</b><br><span class="muted small">${esc(m.desc)}</span></p>`).join('')}
      <div class="sheet-actions"><button class="btn primary block" data-act="close">Nice!</button>
      <button class="btn ghost block" data-act="tab" data-arg="medals">See all medals</button></div>`;
  },
  move(id) {
    const s = findSession(id);
    if (!s) return '<p>That workout is gone.</p>';
    const slots = alternativeSlots(s);
    return `<h2>Move workout</h2><p class="muted small">Currently ${esc(fmtWhen(s.start))}. Pick a free slot:</p>
      <div class="sheet-actions">${slots.map((d) => `<button class="btn block" data-act="move-to" data-arg="${id}|${d.toISOString()}">${esc(fmtWhen(d.toISOString()))}</button>`).join('') || '<p class="muted">No free slots in the next week. Try widening your time window.</p>'}
      <button class="btn ghost block" data-act="close">Cancel</button></div>`;
  },
  skip(id) {
    const s = findSession(id);
    if (!s) return '<p>That workout is gone.</p>';
    return `<h2>Skip ${esc(fmtWhen(s.start))}?</h2><p class="muted small">No catch-up session will be added. What's up?</p>
      <div class="chips" style="margin-top:14px">${Object.entries(REASONS).map(([k, v]) => `<button class="chip" data-act="skip-session" data-arg="${id}:${k}">${esc(v)}</button>`).join('')}</div>
      <div class="sheet-actions"><button class="btn ghost block" data-act="close">Keep it</button></div>`;
  },
  busy() {
    return `<h2>Add a busy time</h2><p class="muted small">Workouts will never be scheduled during this.</p>
      <label class="q" style="display:block;margin-top:12px"><span class="q-label small">Label</span><input type="text" id="busy-label" placeholder="Work, class, gym…" maxlength="30"></label>
      <div class="q"><span class="q-label small">Days</span><div class="chips" id="busy-days">${[1, 2, 3, 4, 5, 6, 0].map((n) => `<button class="chip" data-act="busy-day" data-arg="${n}" aria-pressed="${n >= 1 && n <= 5}">${DAY_SHORT[n]}</button>`).join('')}</div></div>
      <div class="q"><span class="q-label small">Time</span><div class="row"><select class="select" id="busy-from">${timeOptions('09:00')}</select><span class="muted">to</span><select class="select" id="busy-to">${timeOptions('17:00')}</select></div></div>
      <div class="sheet-actions"><button class="btn primary block" data-act="busy-add">Add busy time</button><button class="btn ghost block" data-act="close">Cancel</button></div>`;
  },
  ghelp() {
    const origin = esc(location.origin);
    return `<h2>Connect Google Calendar</h2>
      <p class="small muted">One-time setup, about 10 minutes, free. Easiest on a computer.</p>
      <ol class="why small" style="margin-top:12px">
        <li>Open <b>console.cloud.google.com</b> and create a project (name it “Stride”).</li>
        <li>Go to <b>APIs &amp; Services → Library</b>, search <b>Google Calendar API</b> and click <b>Enable</b>.</li>
        <li>Go to <b>Google Auth Platform</b> (or <b>OAuth consent screen</b>), click <b>Get started</b>: app name Stride, your email, audience <b>External</b>.</li>
        <li>Under <b>Audience → Test users</b>, add your own Google address. Leave the app in <b>Testing</b>, so nobody else can use your Client ID.</li>
        <li>Go to <b>Clients</b> (or <b>Credentials</b>) → <b>Create client</b> → type <b>Web application</b>. Under <b>Authorized JavaScript origins</b> add <b>${origin}</b>. Save.</li>
        <li>Copy the <b>Client ID</b> (ends in .apps.googleusercontent.com), paste it here and tap Connect.</li>
      </ol>
      <p class="small muted">Google may say the app is unverified. That's expected for your own private app (only you, as a test user, can sign in): tap <b>Continue</b>. Stride asks for two permissions: <b>see your free/busy times</b> and <b>manage the calendars it creates</b>. Sign-in lasts about an hour, after which Sync asks again. Revoke access any time at myaccount.google.com/permissions.</p>
      <div class="sheet-actions"><button class="btn primary block" data-act="close">Got it</button></div>`;
  },
};

// ---------------------------------------------------------------- actions

function changeLevel(level) {
  const d = currentDecision();
  const assessment = assessReadiness({ readiness: readiness(), history: data.history, now: nowIso() });
  const safety = evaluateSafety(assessment);
  const res = applyPermanentChange({
    state: data.state, profile: data.profile, targetLevel: level, assessment, safety,
    decisionContext: { returnRamp: d.returnRamp, afterHard: d.afterHard }, now: nowIso(),
  });
  if (res.accepted) { data.state = res.state; persist(); closeSheet(); render(); replan({ silent: true }); }
  toast(res.message, 4500);
}

function logMissed(reason, date = nowIso()) {
  data.history.push(makeMissedRecord({ id: uid(), date, reason }));
}

async function shareOrDownload(file) {
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: file.name }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const actions = {
  tab(arg) { view = arg; closeSheet(); render(); window.scrollTo(0, 0); },
  profile() { view = 'settings'; render(); setTimeout(() => document.getElementById('runner-profile')?.scrollIntoView({ behavior: 'smooth' }), 50); },
  'edit-profile'() { openWizard('edit'); },
  // wizard
  'wz-next'() {
    wiz.error = readWizardStep();
    if (wiz.error) return render();
    if (wizStep() === 'summary') return finishWizard(null);
    wiz.i++;
    render();
  },
  'wz-back'() {
    readWizardStep();
    wiz.error = null;
    if (wiz.i === 0) { if (wiz.mode === 'edit') { wiz = null; view = 'settings'; } return render(); }
    wiz.i--;
    render();
  },
  'wz-set'(arg) {
    const [k, v] = arg.split(':');
    readWizardStep();
    wiz.error = null;
    wiz.draft[k] = k === 'workoutsPerWeek' ? Number(v) : v;
    render();
  },
  'wz-day'(arg) {
    readWizardStep();
    const n = Number(arg);
    const days = wiz.draft.days;
    wiz.draft.days = days.includes(n) ? days.filter((x) => x !== n) : [...days, n];
    render();
  },
  'wz-sched'() { readWizardStep(); wiz.draft.scheduleOn = !wiz.draft.scheduleOn; render(); },
  'wz-finish'(arg) { finishWizard(arg); },
  // today
  ready(arg) {
    const [field, val] = arg.split(':');
    setReadiness({ [field]: val });
    render();
  },
  sheet(arg) {
    const [name, param] = arg.split(':');
    openSheet(sheets[name](param));
  },
  close() { closeSheet(); },
  easier() {
    const d = currentDecision();
    if (d.tempApplied === 'easier' && data.state.tempAdjustment !== 'easier') {
      return toast('Today is lighter because your energy is low. Change your energy above to undo.');
    }
    data.state.tempAdjustment = data.state.tempAdjustment === 'easier' ? 'none' : 'easier';
    persist(); render();
    if (data.state.tempAdjustment === 'easier') toast('Lighter workout for today only. Your program level stays the same.');
  },
  harder() {
    if (data.state.tempAdjustment === 'harder') { data.state.tempAdjustment = 'none'; persist(); return render(); }
    const d = currentDecision({ temp: 'harder' });
    if (!d.harderAllowed) return toast(d.harderBlockedReason ?? 'A harder workout is not available today.', 4500);
    data.state.tempAdjustment = 'harder';
    persist(); render();
    toast('A little extra for today only. Ease off any time.');
  },
  shorten() { openSheet(sheets.shorten()); },
  'shorten-to'(arg) {
    data.state.shortenTo = Number(arg) || null;
    persist(); closeSheet(); render();
  },
  level(arg, el) {
    if (el?.getAttribute('aria-disabled') === 'true') return toast('That level includes running. Edit your runner profile and pick running (or both) first.', 4500);
    changeLevel(Number(arg));
  },
  missed(arg) {
    logMissed(arg);
    persist(); closeSheet(); render();
    toast(arg === 'time' || arg === 'motivation'
      ? 'Logged. Busy weeks happen and your plan stays the same.'
      : 'Logged. Thanks, the plan will take it into account. Your progress is safe.');
  },
  'missed-session'(arg) {
    const [id, reason] = arg.split(':');
    const s = findSession(id);
    data.schedule.dismissed = [...data.schedule.dismissed, id].slice(-200);
    if (s) {
      if (reason === 'done') {
        s.status = 'done';
        toast('Nice. Log it next time by starting it in Stride, so it counts toward medals.');
      } else {
        s.status = 'missed';
        logMissed(reason, s.start);
        toast('Logged. No catch-up needed.');
      }
    }
    persist(); render(); pushSync();
  },
  // workout
  start() { startWorkout(); },
  pause() { togglePause(); },
  slow() { slowDown(); },
  skip() { skipStep(); },
  end(arg) { finishWorkout(true, arg); },
  'end-safety'() { finishWorkout(true, 'pain', true); },
  ci(arg) {
    const i = arg.indexOf(':');
    const field = arg.slice(0, i);
    let val = arg.slice(i + 1);
    if (field === 'perceived_exertion') val = Number(val);
    const notes = document.getElementById('ci-notes');
    if (notes) checkin.user_feedback = notes.value;
    checkin[field] = checkin[field] === val && field === 'reason' ? null : val;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  'save-checkin'() { saveCheckin(); },
  discard() {
    data.activeSession = null;
    data.state.tempAdjustment = 'none';
    data.state.shortenTo = null;
    persist(); view = 'today'; render();
  },
  // settings
  toggle(arg) {
    data.profile[arg] = !data.profile[arg];
    persist(); render();
  },
  pref(arg) {
    const [k, v] = arg.split(':');
    data.profile[k] = k === 'defaultMinutes' ? (Number(v) || null) : Number(v);
    persist(); render();
    if (k === 'workoutsPerWeek' || k === 'defaultMinutes') replan();
  },
  async export() {
    const json = store.exportJson(data);
    await shareOrDownload(new File([json], `stride-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' }));
  },
  wipe() {
    gcal.forgetToken();
    store.wipe();
    data = store.emptyData();
    closeSheet();
    openWizard('new');
  },
  // plan
  'sched-on'() { data.schedule.enabled = true; persist(); replan({ silent: true }); render(); },
  'sched-off'() { data.schedule.enabled = false; persist(); render(); pushSync(); toast('Scheduling is off. Events already in your calendars stay there.'); },
  'plan-day'(arg) {
    const n = Number(arg);
    const days = data.schedule.prefs.days;
    data.schedule.prefs.days = days.includes(n) ? days.filter((x) => x !== n) : [...days, n].sort();
    replan(); render();
  },
  'move-to'(arg) {
    const [id, iso] = arg.split('|');
    const s = findSession(id);
    if (s) { s.start = iso; s.moved = true; }
    persist(); closeSheet(); render();
    toast(`Moved to ${fmtWhen(iso)}.`);
    pushSync();
    if (data.schedule.google.connected && gcal.hasValidToken()) syncGoogle(false);
  },
  'skip-session'(arg) {
    const [id, reason] = arg.split(':');
    const s = findSession(id);
    if (s) { s.status = 'skipped'; logMissed(reason, s.start); }
    data.schedule.dismissed = [...data.schedule.dismissed, id].slice(-200);
    persist(); closeSheet(); render();
    toast('Skipped. No catch-up, no guilt.');
    pushSync();
    if (data.schedule.google.connected && gcal.hasValidToken()) syncGoogle(false);
  },
  'busy-day'(arg, el) { el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); },
  'busy-add'() {
    const days = [...document.querySelectorAll('#busy-days .chip[aria-pressed="true"]')].map((x) => Number(x.dataset.arg));
    const from = document.getElementById('busy-from').value;
    const to = document.getElementById('busy-to').value;
    if (!days.length) return toast('Pick at least one day.');
    data.schedule.busy.push({ id: uid(), label: document.getElementById('busy-label').value.trim().slice(0, 30), days, from, to });
    persist(); closeSheet(); replan(); render();
  },
  'busy-del'(arg) { data.schedule.busy = data.schedule.busy.filter((b) => b.id !== arg); persist(); replan(); render(); },
  gconnect() {
    const id = document.getElementById('g-client')?.value.trim() ?? '';
    data.schedule.google.clientId = id;
    data.schedule.google.error = null;
    persist();
    syncGoogle(true);
  },
  gsync() { syncGoogle(true); },
  gdisconnect() {
    gcal.forgetToken();
    Object.assign(data.schedule.google, { connected: false, error: null, calendarId: null });
    data.schedule.sessions = data.schedule.sessions.map(({ googleEventId, ...s }) => s);
    persist(); render();
    toast('Disconnected. To remove the workouts, delete the "Stride workouts" calendar in Google Calendar.');
  },
  async ics() {
    const upcoming = data.schedule.sessions.filter((s) => s.status === 'planned' && sessionEnd(s) > new Date());
    if (!upcoming.length) return toast('Nothing planned yet.');
    const file = new File([toICS(upcoming, data.profile, nowIso())], 'stride-workouts.ics', { type: 'text/calendar' });
    const url = URL.createObjectURL(file);
    // Opening an .ics in Safari offers "Add All" to the iPhone Calendar.
    const w = window.open(url, '_blank');
    if (!w) await shareOrDownload(file);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  async 'push-on'() {
    if (!pushUrl) return;
    pushBusy = true; render();
    try {
      const r = await push.enable(pushUrl, pushSessions());
      data.push = { ...data.push, enabled: true, lastPayload: JSON.stringify(pushSessions()) };
      persist();
      toast(r.alerts ? `Push reminders on. ${plural(r.alerts / 2, 'workout')} covered.` : 'Push reminders on. Plan some workouts to get reminders.', 4500);
    } catch (e) { toast(e.message, 6000); }
    pushBusy = false; render();
  },
  async 'push-off'() {
    pushBusy = true; render();
    try { await push.disable(pushUrl); } catch { /* ignore */ }
    data.push = { ...data.push, enabled: false, lastPayload: null };
    persist();
    pushBusy = false; render();
    toast('Push reminders off.');
  },
  async 'push-test'() {
    try {
      await push.test(pushUrl);
      toast('Test sent. It should arrive in a few seconds (try locking your phone).', 5000);
    } catch (e) { toast(e.message, 5000); }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset.arg, el); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset?.plan) {
    data.schedule.prefs[t.dataset.plan] = t.value;
    if (hm(data.schedule.prefs.to) - hm(data.schedule.prefs.from) < 30) toast('The time window needs to be at least 30 minutes.');
    persist(); replan(); render();
  }
  if (t.id === 'import-file' && t.files?.[0]) {
    try {
      data = store.importJson(await t.files[0].text());
      data.activeSession = null;
      persist();
      toast(`Backup restored: ${plural(completedWorkouts(data.history).length, 'workout')}.`);
      render();
    } catch (err) {
      toast(`Could not import: ${err.message}`);
    }
  }
});

// ---------------------------------------------------------------- reminders

// While the app is open, nudge the user when a planned workout starts.
async function checkReminder() {
  if (!data.schedule.enabled || data.activeSession) return;
  const next = nextSession(data.schedule.sessions, nowIso());
  if (!next) return;
  const mins = (new Date(next.start) - Date.now()) / 60000;
  const key = `${next.id}@${next.start}`;
  if (mins > 1 || mins < -15 || (data.schedule.notified ?? []).includes(key)) return;
  data.schedule.notified = [...(data.schedule.notified ?? []), key].slice(-50);
  persist();
  const line = funnyLine(`${next.id}-go`, { name: data.profile.name, minutes: next.minutes });
  toast(line, 8000);
  speak(line);
  if (view === 'today') render();
}
setInterval(checkReminder, 20000);

// ---------------------------------------------------------------- device helpers

function unlockAudio() {
  try {
    audio = audio ?? new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

function beep() {
  if (!data.profile.voiceCues || !audio) return;
  try {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.4);
  } catch { /* ignore */ }
}

function speak(text) {
  if (!data.profile.voiceCues || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (view === 'workout' && data.activeSession?.running) { requestWakeLock(); tick(); }
    else if (view === 'today' || view === 'plan') { replan({ silent: false }); render(); checkReminder(); }
  } else if (data.activeSession) {
    persist();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------------------------------------------------------------- startup

if (data.state.seenMedals == null) {
  // Existing users: don't pop up medals for workouts done before medals existed.
  data.state.seenMedals = evaluateMedals(data.history, data.profile, nowIso()).medals.filter((m) => m.earned).map((m) => m.id);
  persist();
}
if (data.activeSession) {
  view = 'workout';
  render();
  startTicker();
} else if (!data.onboarded) {
  openWizard('new');
} else if (!isProfileComplete(data.profile)) {
  openWizard('complete');
} else {
  render();
  replan({ silent: false });
  checkReminder();
}
push.serviceUrl().then((url) => {
  pushUrl = url;
  if (view === 'plan') render();
  pushSync();
});
