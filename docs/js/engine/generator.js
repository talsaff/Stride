// WorkoutGenerator: builds a valid interval schedule for a stage, optionally
// fitted into a shorter time budget. Deterministic.

import { STAGES, LEVELS, WARMUP_SPEED, COOLDOWN_SPEED, GLOBAL_LIMITS, clampStage } from './config.js';

export function naturalMinutes(stageNo) {
  const s = STAGES[clampStage(stageNo)];
  return s.warm + s.cool + (s.brisk ? s.n * (s.work + s.rec) : s.steady);
}

// Approximate distance in km of the stage's full workout. Used as a simple
// workload measure for percentage-based reductions.
export function stageWorkload(stageNo) {
  const w = generateWorkout(stageNo);
  return w.segments.reduce((sum, seg) => sum + (seg.minutes * seg.speed) / 60, 0);
}

const seg = (type, minutes, speed, label, cue) => ({ type, minutes, speed, label, cue });

const CUES = {
  warmup: 'Easy start. Loosen up, breathe normally.',
  steady: 'Comfortable pace: you can chat in full sentences.',
  recovery: 'Ease back to your comfortable pace and let your breathing settle.',
  work: 'Brisk walk: breathing a bit faster, but you can still talk in sentences.',
  cooldown: 'Slow down gradually. Nice work.',
};

export function generateWorkout(stageNo, { targetMinutes = null, easier = false } = {}) {
  const s = STAGES[clampStage(stageNo)];
  const natural = naturalMinutes(stageNo);
  const T = targetMinutes == null ? natural : Math.max(GLOBAL_LIMITS.minTotalMinutes, Math.min(natural, Math.round(targetMinutes)));

  let warm = s.warm;
  let cool = s.cool;
  if (T < natural) {
    warm = Math.max(1, Math.min(s.warm, Math.round(T * 0.25)));
    cool = Math.max(1, Math.min(s.cool, Math.round(T * 0.2)));
  }
  const main = Math.max(1, T - warm - cool);

  const segments = [seg('warmup', warm, WARMUP_SPEED, 'Warm-up', CUES.warmup)];
  let workIntervals = 0;
  if (s.brisk) {
    const block = s.work + s.rec;
    const n = Math.min(s.n, Math.floor(main / block));
    const lead = main - n * block;
    if (lead > 0) segments.push(seg('steady', lead, s.comfort, 'Comfortable walk', CUES.steady));
    for (let i = 1; i <= n; i++) {
      segments.push(seg('recovery', s.rec, s.comfort, 'Easy walk', CUES.recovery));
      segments.push(seg('work', s.work, s.brisk, `Brisk walk ${i} of ${n}`, CUES.work));
    }
    workIntervals = n;
  } else {
    segments.push(seg('steady', main, s.comfort, 'Comfortable walk', CUES.steady));
  }
  segments.push(seg('cooldown', cool, COOLDOWN_SPEED, 'Cool-down', CUES.cooldown));

  const level = s.level;
  const target = easier ? [2, Math.min(4, LEVELS[level].targetExertion[1])] : LEVELS[level].targetExertion;
  return {
    stage: clampStage(stageNo),
    level,
    segments,
    totalMinutes: segments.reduce((sum, x) => sum + x.minutes, 0),
    naturalMinutes: natural,
    workIntervals,
    targetExertion: [...target],
  };
}
