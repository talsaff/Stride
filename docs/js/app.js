// UI layer. Presents workouts, feedback, controls and progress. All workout
// decisions come from the deterministic engine in ./engine/.

import * as store from './storage.js';
import { ICONS } from './icons.js';
import { decide, commitDecision, recordWorkout } from './engine/engine.js';
import { applyPermanentChange } from './engine/progression.js';
import { assessReadiness } from './engine/readiness.js';
import { evaluateSafety } from './engine/safety.js';
import { normalizeFeedback, classifyWorkout } from './engine/feedback.js';
import { personalInsights } from './engine/personalization.js';
import { LEVELS, levelOfStage, RULES, ALGORITHM_VERSION, GLOBAL_LIMITS } from './engine/config.js';
import { REASONS, RED_FLAG_SYMPTOMS, REST_SYMPTOMS, makeMissedRecord, defaultReadiness } from './engine/schema.js';
import { completedWorkouts, missedSessions, totalMinutes, weeklyCounts } from './engine/history.js';

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
const $sheet = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');

let data = store.load();
let view = data.activeSession ? 'workout' : data.onboarded ? 'today' : 'welcome';
let checkin = null;          // post-workout form state
let ticker = null;
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

const segColor = (t) => (t === 'work' ? 'var(--accent)' : t === 'warmup' ? 'var(--warm)' : t === 'cooldown' ? 'var(--cool)' : 'var(--primary)');

// ---------------------------------------------------------------- render

let lastView = null;
function render() {
  if (view !== lastView) { window.scrollTo(0, 0); lastView = view; }
  const full = view === 'workout' || view === 'checkin' || view === 'welcome';
  $app.classList.toggle('fullscreen', full);
  $tabs.hidden = full;
  if (!full) renderTabs();
  const fn = { welcome: renderWelcome, today: renderToday, workout: renderWorkout, checkin: renderCheckin, progress: renderProgress, settings: renderSettings }[view];
  $app.innerHTML = fn();
  if (view === 'workout') updateWorkout();
}

function renderTabs() {
  const tab = (id, icon, label) =>
    `<button data-act="tab" data-arg="${id}" ${view === id ? 'aria-current="page"' : ''}>${ICONS[icon]}<span>${label}</span></button>`;
  $tabs.innerHTML = tab('today', 'home', 'Today') + tab('progress', 'chart', 'Progress') + tab('settings', 'gear', 'Settings');
}

// ---------- welcome

function renderWelcome() {
  return `
  <section class="welcome">
    <div class="logo">${ICONS.walk}</div>
    <h1 class="title">Stride</h1>
    <p class="subtitle">Treadmill walks that fit your energy, your week and your pace.</p>
    <div class="features card">
      ${feature('leaf', 'Built around you', 'Each walk adapts to how the last ones felt, your energy today and how long it has been.')}
      ${feature('heart', 'Missed a week? No problem', 'Your progress never resets. After a break you ease back in gently.')}
      ${feature('walk', 'Walking is enough', 'Running is never required. Success is showing up, at any pace.')}
    </div>
    <div class="card warn" style="text-align:left">
      <div class="row" style="align-items:flex-start">${ICONS.shield}<div>
        <b>A quick health note</b>
        <p class="small" style="margin-top:4px">Because of your history of significant anemia and fatigue, please check with a doctor before doing brisker exercise or running. Tiredness is not always about fitness. Stride starts very gently and never asks you to push through pain, dizziness or unusual fatigue.</p>
      </div></div>
    </div>
    <label class="card" style="display:block;text-align:left">
      <span class="q-label">What should I call you? <span class="muted small">(optional)</span></span>
      <input type="text" id="name-input" placeholder="Your name" maxlength="30" autocomplete="given-name">
    </label>
    <button class="btn primary lg block" data-act="onboard">Let's take the first step</button>
    <p class="small muted" style="margin-top:14px">Your data stays on this phone.</p>
  </section>`;
}

const feature = (icon, title, text) =>
  `<div class="feature"><div class="ico">${ICONS[icon]}</div><div><b>${title}</b><p class="small muted">${text}</p></div></div>`;

// ---------- today

function renderToday() {
  const d = currentDecision();
  const r = readiness();
  const done = completedWorkouts(data.history);
  const monthCount = done.filter((w) => Date.now() - new Date(w.date) < 30 * 864e5).length;
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  let html = `
  <header class="topbar">
    <div><div class="eyebrow">${esc(dateStr)}</div><h1 class="title">${greeting()}</h1>
    <p class="subtitle">${done.length === 0 ? 'Ready for your first walk?' : monthCount ? `${plural(monthCount, 'walk')} in the last 30 days. Lovely.` : 'Welcome back. Your progress is right where you left it.'}</p></div>
  </header>`;

  if (!isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    html += `<div class="card soft install-tip">${ICONS.share}<span>Install Stride: tap <b>Share</b>, then <b>Add to Home Screen</b>.</span></div>`;
  }

  html += readinessCard(r);

  if (d.status !== 'ok') {
    html += `
    <section class="card ${d.status === 'urgent' ? 'danger' : 'warn'}">
      <h2>${esc(d.headline)}</h2>
      <p style="margin-top:8px">${esc(d.explanation[0])}</p>
      <p class="small" style="margin-top:8px">${esc(d.explanation[1])}</p>
      ${d.status === 'urgent' ? '<p style="margin-top:12px"><b>If symptoms are happening now, call your local emergency number.</b></p>' : ''}
      <button class="btn block" style="margin-top:14px" data-act="sheet" data-arg="symptoms">Update how I feel</button>
    </section>`;
    html += todayLinks();
    return html;
  }

  const w = d.workout;
  const lvl = LEVELS[d.baselineLevel];
  html += `
  <section class="card hero">
    <div class="row between wrap"><span class="badge">${ICONS.walk} Level ${d.baselineLevel} · ${esc(lvl.name)}</span>
    ${d.effectiveStage !== d.baseline.to ? '<span class="badge">Adjusted for today</span>' : ''}</div>
    <h2 style="margin-top:12px">${esc(d.headline)}</h2>
    <div class="stats">
      <div><div class="stat-num">${w.totalMinutes}<span style="font-size:18px"> min</span></div><div class="stat-label">Total time</div></div>
      <div><div class="stat-num">${w.targetExertion[0]}–${w.targetExertion[1]}</div><div class="stat-label">Effort out of 10</div></div>
      ${w.workIntervals ? `<div><div class="stat-num">${w.workIntervals}</div><div class="stat-label">Brisk ${w.workIntervals === 1 ? 'bit' : 'bits'}</div></div>` : ''}
    </div>
    <div class="timeline" aria-hidden="true">${w.segments.map((s) => `<span class="tl-${s.type}" style="flex:${s.minutes}"></span>`).join('')}</div>
    <button class="btn white lg block" style="margin-top:16px" data-act="start">${ICONS.play} Start walk</button>
  </section>

  <div class="actions">
    ${actionBtn('easier', 'leaf', 'Low energy today', d.tempApplied === 'easier')}
    ${actionBtn('harder', 'bolt', 'Make it harder', d.tempApplied === 'harder', !d.harderAllowed)}
    ${actionBtn('shorten', 'clock', data.state.shortenTo ? `${data.state.shortenTo} min only` : 'Shorten', !!data.state.shortenTo)}
  </div>

  <section class="card">
    <h3>The plan</h3>
    <ul class="segments">${w.segments.map(segRow).join('')}</ul>
    <p class="small muted" style="margin-top:10px">Speeds are a guide. Go by feel: during brisk bits you should still be able to talk in full sentences. If not, slow down.</p>
  </section>

  <section class="card">
    <h3>Why this workout</h3>
    <ul class="why">${d.explanation.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    ${d.safetyNotes.length ? `<ul class="why small">${d.safetyNotes.filter((n) => !d.explanation.includes(n)).map((e) => `<li class="muted">${esc(e)}</li>`).join('')}</ul>` : ''}
  </section>`;
  html += todayLinks();
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
  const symptomCount = r.symptoms.length;
  return `
  <section class="card">
    <h3>How are you today?</h3>
    <div class="q"><span class="q-label small muted">Energy</span><div class="chips">
      ${chip('energy', 'low', 'Low')}${chip('energy', 'normal', 'Normal')}${chip('energy', 'high', 'High')}</div></div>
    <div class="q" style="margin-bottom:12px"><span class="q-label small muted">Recovery from last time</span><div class="chips">
      ${chip('recovery', 'poor', 'Poor')}${chip('recovery', 'normal', 'Normal')}${chip('recovery', 'good', 'Good')}</div></div>
    <button class="link" data-act="sheet" data-arg="symptoms">${symptomCount ? `${plural(symptomCount, 'symptom')} reported · edit` : 'Any symptoms or pain? Tell me'}</button>
  </section>`;
}

function todayLinks() {
  return `
  <section class="card">
    <button class="list-btn" data-act="sheet" data-arg="level"><span class="row">${ICONS.sliders} Change my program level</span><span class="chev">${ICONS.chev}</span></button>
    <button class="list-btn" data-act="sheet" data-arg="missed"><span class="row">${ICONS.calendar} Log a missed session</span><span class="chev">${ICONS.chev}</span></button>
    <button class="list-btn" data-act="sheet" data-arg="safety"><span class="row">${ICONS.shield} Safety guide</span><span class="chev">${ICONS.chev}</span></button>
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
  const isWork = seg.type === 'work';
  const step = RULES.slowDownStep;
  for (let i = s.index; i < s.segments.length; i++) {
    const x = s.segments[i];
    const same = isWork ? x.type === 'work' : (x.type === 'steady' || x.type === 'recovery' || i === s.index);
    if (same) x.speed = Math.max(GLOBAL_LIMITS.minSpeed, Math.round((x.speed - step) * 10) / 10);
  }
  s.slowed = true;
  persist();
  render();
  speak(`Slowing to ${fmtSpeed(seg.speed)}.`);
  toast(`Slowed to ${fmtSpeed(seg.speed)} km/h${isWork ? ' for the brisk bits' : ''}. Listening to your body is the plan working.`);
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
    <p class="subtitle">You walked <b>${mins} min</b>${s.endedEarly ? ` of ${s.decision.workout.totalMinutes} planned. That still counts and is saved.` : '. All of it.'}</p>
  </div></header>
  ${s.stoppedForSafety ? `<section class="card danger"><b>Please rest now.</b><p class="small" style="margin-top:6px">If you had chest pain, fainted, or felt unusually and severely short of breath, get urgent medical help. For other symptoms that are new or keep coming back, talk to a doctor before your next walk.</p></section>` : ''}
  <section class="card">
    <div class="q"><span class="q-label">How hard was it overall?</span>
      <div class="rpe">${rpe}</div>
      <div class="rpe-legend"><span>Very easy</span><span>Comfortable</span><span>Moderate</span><span>Hard</span><span>Max</span></div>
      <p class="small muted" style="margin-top:6px">Your target today was ${s.decision.workout.targetExertion[0]}–${s.decision.workout.targetExertion[1]}.</p></div>
    <div class="q"><span class="q-label">${s.decision.workout.workIntervals ? 'Could you talk in full sentences during the brisk bits?' : 'Could you talk in full sentences while walking?'}</span>
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
  ${s.totalElapsedMs < 60000 ? '<button class="btn ghost block" style="margin-top:6px" data-act="discard">Don\'t save this walk</button>' : ''}`;
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
  persist();
  view = 'today';
  render();
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
    ${tile(done.length, done.length === 1 ? 'Walk completed' : 'Walks completed')}
    ${tile(mins, 'Minutes walked')}
    ${tile(recent4, 'Walks in last 4 weeks')}
    ${tile(`L${level}`, LEVELS[level].name)}
  </div>
  ${done.length === 0 ? `<section class="card soft"><p>Your progress will show up here after your first walk. No pressure. Whenever you're ready.</p></section>` : `
  <section class="card">
    <h3>Consistency · walks per week</h3>
    <div class="bars" role="img" aria-label="Walks per week for the last 8 weeks: ${weeks.join(', ')}">${weekBars}</div>
    <div class="bar-axis">${weekAxis}</div>
    <p class="small muted" style="margin-top:10px">Your aim: ${data.profile.workoutsPerWeek} per week. Any week with a walk is a win.</p>
  </section>
  <section class="card">
    <h3>Minutes per walk · last ${last.length}</h3>
    <div class="bars" role="img" aria-label="Minutes walked per session">${durBars}</div>
    <div class="bar-axis">${durAxis}</div>
  </section>
  ${best ? `<section class="card"><h3>Personal best comfortable walk</h3>
    <div class="row between"><div><b style="font-size:22px">${Math.round(best.actual_duration)} min</b><p class="small muted">${new Date(best.date).toLocaleDateString()} · felt ${best.rating === 'too_easy' ? 'easy' : 'about right'}</p></div>
    <span class="badge accent">${fmtSpeed(topSpeed(best))} km/h top speed</span></div></section>` : ''}
  <section class="card"><h3>Recovery before recent walks</h3><div class="rec-dots">${recov}</div></section>`}
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
  const label = { easy: 'Felt easy', appropriate: 'About right', hard: 'Tough one', neutral: 'Short walk', safety: 'Stopped safely' }[c];
  return `<details class="hist-item"><summary><span><b>${date}</b> · ${Math.round(r.actual_duration)} min</span><span class="badge ${c === 'hard' ? 'accent' : ''}">${label}</span></summary>
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
  const freqChip = (v) => `<button class="chip" data-act="pref" data-arg="workoutsPerWeek:${v}" aria-pressed="${p.workoutsPerWeek === v}">${v}× a week</button>`;
  return `
  <header class="topbar"><div><div class="eyebrow">Make it yours</div><h1 class="title">Settings</h1></div></header>
  <section class="card"><h3>Program level</h3>${levelOptions()}</section>
  <section class="card">
    <h3>Workout length</h3><div class="chips">${[0, 10, 15, 20, 25].map(durChip).join('')}</div>
    <p class="small muted" style="margin-top:8px">A cap for everyday walks. Shorter is always fine.</p>
    <h3 style="margin-top:18px">How often</h3><div class="chips">${[1, 2, 3].map(freqChip).join('')}</div>
    <p class="small muted" style="margin-top:8px">Only used to frame your progress. There's no catching up to do.</p>
  </section>
  <section class="card">
    <h3>Preferences</h3>
    ${sw('autoEasierOnLowEnergy', 'Lighter walk when energy is low', 'Applies automatically when you pick “Low” energy.')}
    ${sw('voiceCues', 'Voice and sound cues', 'Announces each step and treadmill speed.')}
    ${sw('medicalClearance', 'A doctor has cleared me for brisker exercise', 'Unlocks levels 4 and 5. Running is never required.')}
  </section>
  <section class="card">
    <h3>About you</h3>
    ${field('name', 'Name', 'text')}${field('age', 'Age', 'number')}${field('heightCm', 'Height (cm)', 'number')}${field('weightKg', 'Weight (kg)', 'number')}
    <p class="small muted">Weight is never used to measure progress.</p>
  </section>
  <section class="card">
    <h3>Your data</h3>
    <button class="list-btn" data-act="export"><span>Export backup</span><span class="chev">${ICONS.share}</span></button>
    <label class="list-btn" style="cursor:pointer"><span>Import backup</span><span class="chev">${ICONS.chev}</span><input type="file" id="import-file" accept="application/json,.json" class="sr-only"></label>
    <button class="list-btn" data-act="sheet" data-arg="delete" style="color:var(--danger)"><span>Delete all data</span></button>
  </section>
  <p class="small muted" style="text-align:center;margin:10px 20px">Stride ${ALGORITHM_VERSION} · rules-based and transparent. Starting thresholds are conservative estimates, not medical advice.</p>`;
}

const field = (key, label, type) =>
  `<label class="field"><span>${label}</span><input type="${type}" ${type === 'number' ? 'inputmode="decimal"' : ''} data-field="${key}" value="${esc(data.profile[key] ?? '')}"></label>`;

function levelOptions() {
  const cur = levelOfStage(data.state.baselineStage);
  return [1, 2, 3, 4, 5].map((l) => `
    <button class="level-opt" data-act="level" data-arg="${l}" aria-pressed="${l === cur}">
      <span class="level-num">${l}</span>
      <span><b>${esc(LEVELS[l].name)}</b><br><span class="small muted">${esc(LEVELS[l].description)} ~${LEVELS[l].totalMinutes[0]}–${LEVELS[l].totalMinutes[1]} min${l > 3 && !data.profile.medicalClearance ? ' · needs clearance' : ''}</span></span>
    </button>`).join('');
}

// ---------------------------------------------------------------- sheets

function openSheet(html) {
  $sheet.innerHTML = `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
}
function closeSheet() { $sheet.innerHTML = ''; }

const sheets = {
  symptoms() {
    const r = readiness();
    const opt = (k, v) => `<button class="chip warn" data-act="symptom" data-arg="${k}" aria-pressed="${r.symptoms.includes(k)}">${esc(v)}</button>`;
    return `<h2>Any symptoms today?</h2><p class="muted small">Tap anything that applies. This is not a diagnosis. It helps keep today's plan safe.</p>
      <h3 style="margin:16px 0 8px" class="small">Urgent</h3><div class="chips">${Object.entries(RED_FLAG_SYMPTOMS).map(([k, v]) => opt(k, v)).join('')}</div>
      <h3 style="margin:16px 0 8px" class="small">Rest today</h3><div class="chips">${Object.entries(REST_SYMPTOMS).map(([k, v]) => opt(k, v)).join('')}</div>
      <div class="sheet-actions"><button class="btn primary block" data-act="close">Done</button>
      <button class="btn ghost block" data-act="clear-symptoms">None of these</button></div>`;
  },
  shorten() {
    const d = currentDecision({ shortenTo: null, temp: data.state.tempAdjustment });
    const full = d.workout ? d.workout.naturalMinutes : 15;
    const opts = [5, 10, 15, 20].filter((m) => m < full);
    return `<h2>How much time do you have?</h2><p class="muted small">The intervals are recalculated to fit. Short walks still count.</p>
      <div class="sheet-actions">${opts.map((m) => `<button class="btn block" data-act="shorten-to" data-arg="${m}">${m} minutes</button>`).join('')}
      <button class="btn primary block" data-act="shorten-to" data-arg="0">Full walk</button></div>`;
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
    return `<h2>End your walk?</h2><p class="muted small">Stopping is always allowed. Everything you've done so far is saved.</p>
      <div class="sheet-actions">${opts.map(([k, v]) => `<button class="btn block" data-act="end" data-arg="${k}">${v}</button>`).join('')}
      <button class="btn block" data-act="sheet" data-arg="unwell" style="color:var(--danger)">Pain or physical symptoms</button>
      <button class="btn primary block" data-act="close">Keep going</button></div>`;
  },
  unwell() {
    return `<h2 style="color:var(--danger)">Stop walking now</h2>
      <p>Press stop on the treadmill, hold the handrails and step off carefully. Sit down if you feel faint.</p>
      <div class="card danger" style="margin-top:14px"><b>Chest pain, fainting, or unusual severe shortness of breath?</b>
      <p class="small" style="margin-top:6px">Call your local emergency number now.</p></div>
      <p class="small muted">For dizziness, pain or unusual exhaustion: rest, and check in with a doctor if it is new or keeps happening. Stopping for your health is never a failure.</p>
      <div class="sheet-actions"><button class="btn danger block" data-act="end-safety">End workout</button>
      <button class="btn ghost block" data-act="close">I'm OK, continue</button></div>`;
  },
  safety() {
    return `<h2>Safety guide</h2>
      <ul class="why" style="margin-top:12px">
        <li><b>Stop immediately</b> and seek urgent help for chest pain, fainting or unusual severe breathlessness.</li>
        <li>Never push through significant pain, dizziness or unexplained severe fatigue.</li>
        <li>Fatigue is not always about fitness. With a history of significant anemia, ongoing tiredness is worth discussing with a doctor.</li>
        <li>Please get medical clearance before brisker exercise or running.</li>
        <li>Use the treadmill safety clip and keep the handrails within reach.</li>
        <li>The talk test beats any speed: if you can't speak in full sentences, slow down.</li>
      </ul>
      <p class="small muted">Stride gives general activity guidance and does not diagnose anything.</p>
      <div class="sheet-actions"><button class="btn primary block" data-act="close">Got it</button></div>`;
  },
  delete() {
    return `<h2>Delete all data?</h2><p class="muted">This permanently removes your history, settings and progress from this phone. Consider exporting a backup first.</p>
      <div class="sheet-actions"><button class="btn danger block" data-act="wipe">Delete everything</button>
      <button class="btn block" data-act="close">Cancel</button></div>`;
  },
  clearance() {
    return `<h2>Medical clearance</h2><p>Only switch this on if a doctor has told you brisker exercise is fine for you, given your history of anemia and fatigue.</p>
      <p class="small muted" style="margin-top:8px">It unlocks levels 4 and 5. Progress there is still gradual and still walking only.</p>
      <div class="sheet-actions"><button class="btn primary block" data-act="clearance-yes">Yes, I've been cleared</button>
      <button class="btn block" data-act="close">Not yet</button></div>`;
  },
};

// ---------------------------------------------------------------- actions

function changeLevel(level) {
  const d = currentDecision();
  const assessment = assessReadiness({ readiness: readiness(), history: data.history, now: nowIso() });
  const safety = evaluateSafety(assessment, data.profile);
  const res = applyPermanentChange({
    state: data.state, profile: data.profile, targetLevel: level, assessment, safety,
    decisionContext: { returnRamp: d.returnRamp, afterHard: d.afterHard }, now: nowIso(),
  });
  if (res.accepted) { data.state = res.state; persist(); closeSheet(); render(); }
  toast(res.message, 4500);
}

const actions = {
  tab(arg) { view = arg; closeSheet(); render(); window.scrollTo(0, 0); },
  onboard() {
    const name = document.getElementById('name-input')?.value.trim();
    data.profile.name = name ?? '';
    data.onboarded = true;
    persist();
    store.requestPersistence();
    view = 'today';
    render();
  },
  ready(arg) {
    const [field, val] = arg.split(':');
    setReadiness({ [field]: val });
    render();
  },
  sheet(arg) { openSheet(sheets[arg]()); },
  close() { closeSheet(); },
  symptom(arg) {
    const r = readiness();
    const symptoms = r.symptoms.includes(arg) ? r.symptoms.filter((s) => s !== arg) : [...r.symptoms, arg];
    setReadiness({ symptoms });
    openSheet(sheets.symptoms());
    render();
  },
  'clear-symptoms'() { setReadiness({ symptoms: [] }); closeSheet(); render(); },
  easier() {
    const d = currentDecision();
    if (d.tempApplied === 'easier' && data.state.tempAdjustment !== 'easier') {
      return toast('Today is lighter because your energy is low. Change your energy above to undo.');
    }
    data.state.tempAdjustment = data.state.tempAdjustment === 'easier' ? 'none' : 'easier';
    persist(); render();
    if (data.state.tempAdjustment === 'easier') toast('Lighter walk for today only. Your program level stays the same.');
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
  level(arg) { changeLevel(Number(arg)); },
  missed(arg) {
    data.history.push(makeMissedRecord({ id: uid(), date: nowIso(), reason: arg }));
    persist(); closeSheet(); render();
    toast(arg === 'time' || arg === 'motivation'
      ? 'Logged. Busy weeks happen and your plan stays the same.'
      : 'Logged. Thanks, the plan will take it into account. Your progress is safe.');
  },
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
  toggle(arg) {
    if (arg === 'medicalClearance' && !data.profile.medicalClearance) return openSheet(sheets.clearance());
    data.profile[arg] = !data.profile[arg];
    persist(); render();
  },
  'clearance-yes'() { data.profile.medicalClearance = true; persist(); closeSheet(); render(); },
  pref(arg) {
    const [k, v] = arg.split(':');
    data.profile[k] = k === 'defaultMinutes' ? (Number(v) || null) : Number(v);
    persist(); render();
  },
  async export() {
    const json = store.exportJson(data);
    const name = `stride-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Stride backup' }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  wipe() {
    store.wipe();
    data = store.emptyData();
    closeSheet();
    view = 'welcome';
    render();
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
  if (t.dataset?.field) {
    const k = t.dataset.field;
    data.profile[k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value.slice(0, 30);
    persist();
  }
  if (t.id === 'import-file' && t.files?.[0]) {
    try {
      data = store.importJson(await t.files[0].text());
      data.activeSession = null;
      persist();
      toast(`Backup restored: ${plural(completedWorkouts(data.history).length, 'walk')}.`);
      render();
    } catch (err) {
      toast(`Could not import: ${err.message}`);
    }
  }
});

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
    else if (view === 'today') render();
  } else if (data.activeSession) {
    persist();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
if (view === 'workout') startTicker();
