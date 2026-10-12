// SafetyGuard: recovery-based limits and hard caps on every generated workout.
// Recovery always overrides progression and requests for harder workouts.

import { LEVELS, GLOBAL_LIMITS } from './config.js';
import { maxStage } from './profile.js';

export const URGENT_MESSAGE =
  'Chest pain, fainting or severe shortness of breath: stop and get medical help right away.';

export const REST_MESSAGE =
  'Take a rest day rather than training through this. Your plan will be right here tomorrow.';

export const FATIGUE_MESSAGE =
  'You have felt wiped out a few times recently, so progression is paused until you are recovered.';

export function maxStageAllowed(profile) {
  return maxStage(profile);
}

export function evaluateSafety(assessment) {
  const notes = [];
  if (assessment.redFlags.length) {
    return { status: 'urgent', blockHarder: true, pauseProgression: true, notes: [URGENT_MESSAGE] };
  }
  if (assessment.restFlags.length) {
    return { status: 'rest', blockHarder: true, pauseProgression: true, notes: [REST_MESSAGE] };
  }
  let blockHarder = false;
  let pauseProgression = false;
  if (assessment.persistentFatigue) {
    blockHarder = true;
    pauseProgression = true;
    notes.push(FATIGUE_MESSAGE);
  } else if (assessment.recovery === 'poor') {
    blockHarder = true;
    pauseProgression = true;
    notes.push('Recovery feels poor today, so the workout is lighter and nothing will be increased.');
  }
  if (assessment.soreness === 'severe') {
    blockHarder = true;
    pauseProgression = true;
    notes.push('Severe soreness: keep it easy today.');
  }
  return { status: 'ok', blockHarder, pauseProgression, notes };
}

const round1 = (x) => Math.round(x * 10) / 10;

// Enforce level limits (scaled by the profile speed factor) and global
// limits. Returns a new workout plus the corrections made (normally none).
export function clampWorkout(workout, level) {
  const lim = LEVELS[level];
  const f = workout.speedFactor ?? 1;
  const corrections = [];
  const segments = workout.segments.map((seg) => {
    let speed = seg.speed;
    const fast = seg.type === 'work' || seg.type === 'run';
    const max = fast
      ? Math.min(seg.type === 'run' ? GLOBAL_LIMITS.maxRunSpeed : GLOBAL_LIMITS.maxWalkSpeed, round1((lim.briskSpeed ?? lim.comfortSpeed)[1] * f))
      : Math.min(GLOBAL_LIMITS.maxWalkSpeed, round1(lim.comfortSpeed[1] * f));
    if (speed > max) { corrections.push(`${seg.label} speed capped at ${max} km/h`); speed = max; }
    if (speed < GLOBAL_LIMITS.minSpeed) speed = GLOBAL_LIMITS.minSpeed;
    return { ...seg, speed: round1(speed) };
  });
  const target = [
    Math.min(workout.targetExertion[0], GLOBAL_LIMITS.maxTargetExertion),
    Math.min(workout.targetExertion[1], GLOBAL_LIMITS.maxTargetExertion),
  ];
  const total = segments.reduce((s, x) => s + x.minutes, 0);
  if (total > GLOBAL_LIMITS.maxTotalMinutes) corrections.push('Duration above the global limit');
  return { ...workout, segments, targetExertion: target, totalMinutes: total, corrections };
}
