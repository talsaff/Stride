// WorkoutGenerator: builds the minute-by-minute schedule for a stage, for the
// tired-day version and for the advanced version. Deterministic.

import { BASE, EASY_DAY, ADVANCED, LEVELS, GLOBAL_LIMITS, MAX_STAGE, stageParams, clampStage, levelOfStage } from './config.js';

const r1 = (x) => Math.round(x * 10) / 10;
const seg = (type, minutes, speed, label, cue) => ({ type, minutes, speed: r1(speed), label, cue });

const CUES = {
  warmup: 'Easy start. Loosen up and find your rhythm.',
  steady: 'Easy walk: relaxed breathing, you can chat.',
  brisk: 'Brisk walk: long steps, arms swinging.',
  recovery: 'Bring it down and let your breathing settle.',
  work: 'Fast walk: quick steps, push the pace!',
  run: 'Run! Relaxed shoulders, short quick steps, breathe.',
  cooldown: 'Slow it down. Great work today.',
};

export function workoutDistance(segments) {
  return segments.reduce((sum, x) => sum + ((x.completedMinutes ?? x.minutes) * x.speed) / 60, 0);
}

export function naturalMinutes(stage, preference = 'mix') {
  return stageParams(stage, preference).minutes;
}

// Workload measure (km of the stage's full workout) for percentage reductions.
export function stageWorkload(stage, preference = 'mix') {
  return workoutDistance(generateWorkout(stage, { preference }).segments);
}

const fastKind = (speed) => (speed >= BASE.runFrom ? 'run' : 'work');
const fastLabel = (speed) => (speed >= 8.5 ? 'Run' : speed >= BASE.runFrom ? 'Jog' : 'Fast walk');

// Split `total` minutes into `n` near-equal integer parts (larger first).
function split(total, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.floor(total / n) + (i < total % n ? 1 : 0));
  return out;
}

// Alternating easy/brisk chunks of up to 3 minutes, ending on brisk so the
// fast part always follows a brisk walk.
function filler(minutes, easySpeed, briskSpeed) {
  const chunks = [];
  let left = minutes, brisk = true;
  while (left > 0) {
    const m = Math.min(3, left);
    chunks.unshift(brisk
      ? seg('brisk', m, briskSpeed, 'Brisk walk', CUES.brisk)
      : seg('steady', m, easySpeed, 'Easy walk', CUES.steady));
    left -= m;
    brisk = !brisk;
  }
  return chunks;
}

// Core builder: warm-up, then n blocks of [easy/brisk filler → fast], a short
// recovery, then cool-down.
function build({ minutes, warm, cool, warmSpeed, coolSpeed, easySpeed, briskSpeed, fastMinutes, fastSpeed }) {
  const total = Math.max(GLOBAL_LIMITS.minTotalMinutes, minutes);
  warm = Math.min(warm, Math.max(1, Math.round(total * 0.2)));
  cool = Math.min(cool, Math.max(1, Math.round(total * 0.15)));
  let main = total - warm - cool;
  let recover = Math.min(BASE.recoverMinutes, Math.max(0, main - 2));
  let fast = Math.max(0, Math.min(fastMinutes, main - recover - 1));
  const blockLen = fast <= 3 ? Math.max(1, fast) : fast <= 8 ? 3 : fast <= 14 ? 4 : 5;
  const n = fast > 0 ? Math.ceil(fast / blockLen) : 0;
  let fill = main - fast - recover;
  const segments = [seg('warmup', warm, warmSpeed, 'Warm-up', CUES.warmup)];
  if (n === 0) {
    segments.push(...filler(fill + recover, easySpeed, briskSpeed));
  } else {
    const fastParts = split(fast, n);
    const gaps = split(Math.max(n, fill), n);
    fastParts.forEach((f, i) => {
      segments.push(...filler(gaps[i], easySpeed, briskSpeed));
      segments.push(seg(fastKind(fastSpeed), f, fastSpeed, `${fastLabel(fastSpeed)} ${i + 1} of ${n}`, CUES[fastKind(fastSpeed)]));
    });
    if (recover > 0) segments.push(seg('recovery', recover, easySpeed, 'Recover', CUES.recovery));
  }
  segments.push(seg('cooldown', cool, coolSpeed, 'Cool-down', CUES.cooldown));
  // Fix rounding so the plan adds up to the requested total.
  const sum = segments.reduce((s, x) => s + x.minutes, 0);
  if (sum !== total) segments[segments.length - 2].minutes = Math.max(1, segments[segments.length - 2].minutes + total - sum);
  return { segments, workIntervals: n };
}

// opts: mode ('normal' | 'easy' | 'advanced'), targetMinutes (fit into this),
//       speedFactor (profile, only ever speeds up), preference, extraEasyMinutes, capMinutes
export function generateWorkout(stageNo, opts = {}) {
  const { mode = 'normal', speedFactor = 1, preference = 'mix', extraEasyMinutes = 0, capMinutes = null } = opts;
  const stage = clampStage(stageNo);
  const f = Math.max(1, speedFactor);
  let p = stageParams(stage, preference);
  let level = levelOfStage(stage);
  let target = [...LEVELS[level].targetExertion];
  let spec;

  if (mode === 'easy') {
    spec = {
      minutes: EASY_DAY.minutes, warm: BASE.warmMinutes, cool: BASE.coolMinutes,
      warmSpeed: EASY_DAY.minSpeed, coolSpeed: EASY_DAY.minSpeed,
      easySpeed: EASY_DAY.easySpeed, briskSpeed: EASY_DAY.maxSpeed, fastMinutes: 0, fastSpeed: 0,
    };
    target = [3, 4];
  } else {
    if (mode === 'advanced') {
      const q = stageParams(Math.min(MAX_STAGE, stage + ADVANCED.stageBoost), 'run');
      p = {
        ...q,
        minutes: Math.min(BASE.maxMinutes + ADVANCED.extraMinutes, q.minutes + ADVANCED.extraMinutes),
        fastMinutes: Math.max(ADVANCED.minRunMinutes, q.fastMinutes),
        fastSpeed: r1(Math.max(ADVANCED.minRunSpeed, q.fastSpeed + ADVANCED.runSpeedAbovePlan)),
      };
      level = levelOfStage(Math.min(MAX_STAGE, stage + ADVANCED.stageBoost));
      target = [6, 8];
    }
    spec = {
      minutes: p.minutes, warm: BASE.warmMinutes, cool: BASE.coolMinutes,
      warmSpeed: p.warmSpeed, coolSpeed: p.coolSpeed,
      easySpeed: Math.min(GLOBAL_LIMITS.maxWalkSpeed, p.easySpeed * f),
      briskSpeed: Math.min(GLOBAL_LIMITS.maxWalkSpeed, p.briskSpeed * f),
      fastMinutes: p.fastMinutes,
      fastSpeed: Math.min(p.fastSpeed >= BASE.runFrom ? GLOBAL_LIMITS.maxRunSpeed : GLOBAL_LIMITS.maxWalkSpeed, p.fastSpeed * f),
    };
  }

  const natural = spec.minutes;
  let total = natural;
  if (capMinutes && mode === 'normal') total = Math.min(total, Math.max(BASE.minutes, capMinutes));
  if (opts.targetMinutes != null) total = Math.max(GLOBAL_LIMITS.minTotalMinutes, Math.min(total, Math.round(opts.targetMinutes)));
  if (total < natural) {
    spec = { ...spec, minutes: total, fastMinutes: spec.fastMinutes ? Math.max(1, Math.round(spec.fastMinutes * total / natural)) : 0 };
  }
  const { segments, workIntervals } = build(spec);

  // Goal tweak: extra easy minutes, only on full-length normal workouts.
  if (extraEasyMinutes > 0 && mode === 'normal' && total >= natural) {
    segments.splice(segments.length - 1, 0, seg('steady', extraEasyMinutes, Math.min(spec.easySpeed, 4.5), 'Bonus easy walk', 'Easy extra minutes: they add up for your goal.'));
  }

  const fastSegs = segments.filter((s) => s.type === 'work' || s.type === 'run');
  return {
    stage,
    level,
    mode,
    isRun: fastSegs.some((s) => s.type === 'run'),
    segments,
    totalMinutes: segments.reduce((sum, x) => sum + x.minutes, 0),
    naturalMinutes: natural,
    workIntervals,
    fastMinutes: fastSegs.reduce((s, x) => s + x.minutes, 0),
    runMinutes: fastSegs.filter((s) => s.type === 'run').reduce((s, x) => s + x.minutes, 0),
    topSpeed: Math.max(0, ...segments.map((s) => s.speed)),
    targetExertion: target,
    speedFactor: f,
    distanceKm: r1(workoutDistance(segments)),
  };
}
