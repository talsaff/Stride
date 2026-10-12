// WorkoutGenerator: builds a valid interval schedule for a stage, personalized
// by the runner profile and optionally fitted into a shorter time budget.
// Deterministic.

import { STAGES, LEVELS, WARMUP_SPEED, COOLDOWN_SPEED, RUN_WARMUP_SPEED, RUN_COOLDOWN_SPEED, GLOBAL_LIMITS, clampStage } from './config.js';

export function naturalMinutes(stageNo) {
  const s = STAGES[clampStage(stageNo)];
  return s.warm + s.cool + (s.n ? s.n * (s.work + s.rec) : s.steady);
}

// Approximate distance in km of the stage's full workout (unpersonalized).
// Used as a simple workload measure for percentage-based reductions.
export function stageWorkload(stageNo) {
  return workoutDistance(generateWorkout(stageNo).segments);
}

export function workoutDistance(segments) {
  return segments.reduce((sum, x) => sum + ((x.completedMinutes ?? x.minutes) * x.speed) / 60, 0);
}

const seg = (type, minutes, speed, label, cue) => ({ type, minutes, speed, label, cue });
const r1 = (x) => Math.round(x * 10) / 10;

const CUES = {
  warmup: 'Easy start. Loosen up, breathe normally.',
  steady: 'Comfortable pace: you can chat in full sentences.',
  recovery: 'Ease back and let your breathing settle.',
  work: 'Brisk walk: breathing faster, but you can still talk in sentences.',
  run: 'Easy jog: relaxed shoulders, short steps. You should still be able to talk.',
  cooldown: 'Slow down gradually. Nice work.',
};

// opts: targetMinutes (fit into this), easier (lower effort target),
//       speedFactor (profile), extraEasyMinutes (goal), capMinutes (goal)
export function generateWorkout(stageNo, opts = {}) {
  const { easier = false, speedFactor = 1, extraEasyMinutes = 0, capMinutes = null } = opts;
  const s = STAGES[clampStage(stageNo)];
  const isRun = !!s.run;
  const natural = naturalMinutes(stageNo);
  let targetMinutes = opts.targetMinutes ?? null;
  if (capMinutes && natural > capMinutes) targetMinutes = Math.min(targetMinutes ?? capMinutes, capMinutes);
  const T = targetMinutes == null ? natural : Math.max(GLOBAL_LIMITS.minTotalMinutes, Math.min(natural, Math.round(targetMinutes)));
  const sp = (v) => r1(v * speedFactor);

  let warm = s.warm;
  let cool = s.cool;
  if (T < natural) {
    warm = Math.max(1, Math.min(s.warm, Math.round(T * 0.25)));
    cool = Math.max(1, Math.min(s.cool, Math.round(T * 0.2)));
  }
  const main = Math.max(1, T - warm - cool);

  const segments = [seg('warmup', warm, sp(isRun ? RUN_WARMUP_SPEED : WARMUP_SPEED), 'Warm-up', CUES.warmup)];
  let workIntervals = 0;
  if (s.n) {
    const block = s.work + s.rec;
    const n = Math.min(s.n, Math.floor(main / block));
    const lead = main - n * block;
    if (lead > 0) segments.push(seg('steady', lead, sp(s.comfort), isRun ? 'Brisk walk' : 'Comfortable walk', CUES.steady));
    for (let i = 1; i <= n; i++) {
      segments.push(seg('recovery', s.rec, sp(s.comfort), isRun ? 'Walk break' : 'Easy walk', CUES.recovery));
      segments.push(isRun
        ? seg('run', s.work, sp(s.run), `${s.work >= 5 ? 'Run' : 'Jog'} ${i} of ${n}`, CUES.run)
        : seg('work', s.work, sp(s.brisk), `Brisk walk ${i} of ${n}`, CUES.work));
    }
    workIntervals = n;
  } else {
    segments.push(seg('steady', main, sp(s.comfort), 'Comfortable walk', CUES.steady));
  }
  // Goal tweak: extra easy minutes, only on full-length sessions.
  if (extraEasyMinutes > 0 && T >= natural && natural + extraEasyMinutes <= GLOBAL_LIMITS.maxTotalMinutes) {
    segments.push(seg('steady', extraEasyMinutes, sp(isRun ? s.comfort : Math.min(s.comfort, 3.2)), 'Bonus easy walk', 'Easy extra minutes: these add up for your goal.'));
  }
  segments.push(seg('cooldown', cool, sp(isRun ? RUN_COOLDOWN_SPEED : COOLDOWN_SPEED), 'Cool-down', CUES.cooldown));

  const level = s.level;
  const target = easier ? [2, Math.min(4, LEVELS[level].targetExertion[1])] : LEVELS[level].targetExertion;
  return {
    stage: clampStage(stageNo),
    level,
    isRun,
    segments,
    totalMinutes: segments.reduce((sum, x) => sum + x.minutes, 0),
    naturalMinutes: natural,
    workIntervals,
    targetExertion: [...target],
    speedFactor,
    distanceKm: r1(workoutDistance(segments)),
  };
}
