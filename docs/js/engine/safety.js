// SafetyGuard: decides whether exercise is appropriate today and clamps every
// generated workout to level and global limits. Safety always overrides
// progression and user requests for harder workouts. It never diagnoses.

import { RULES, LEVELS, GLOBAL_LIMITS, lastStageOfLevel, MAX_STAGE } from './config.js';

export const URGENT_MESSAGE =
  'Chest pain, fainting or unusual severe shortness of breath need urgent medical assessment. ' +
  'Please do not exercise today, and contact emergency services or a doctor now if the symptom is happening.';

export const REST_MESSAGE =
  'Please rest today rather than exercising through this. If the symptom is new, severe or keeps coming back, ' +
  'check in with a doctor before your next workout.';

export const FATIGUE_MESSAGE =
  'You have reported unusual tiredness or poor recovery more than once recently. Progression is paused. ' +
  'Fatigue is not always about fitness, and with a history of anemia it is worth mentioning to a doctor.';

export const CLEARANCE_MESSAGE =
  'Levels 4 and 5 unlock once you confirm in Settings that a doctor has cleared you for brisker exercise.';

export function maxStageAllowed(profile) {
  if (profile.medicalClearance) return MAX_STAGE;
  return lastStageOfLevel(RULES.requireClearanceAboveLevel);
}

export function evaluateSafety(assessment, profile) {
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
    notes.push('Severe soreness: keep it gentle today and stop if it turns into pain.');
  }
  if (!profile.medicalClearance) notes.push(CLEARANCE_MESSAGE);
  return { status: 'ok', blockHarder, pauseProgression, notes };
}

const round1 = (x) => Math.round(x * 10) / 10;

// Enforce level and global limits on a generated workout. Returns a new
// workout plus the list of corrections made (normally empty).
export function clampWorkout(workout, level) {
  const lim = LEVELS[level];
  const corrections = [];
  const segments = workout.segments.map((seg) => {
    let speed = seg.speed;
    const max =
      seg.type === 'work'
        ? Math.min(GLOBAL_LIMITS.maxBriskSpeed, lim.briskSpeed ? lim.briskSpeed[1] : lim.comfortSpeed[1])
        : Math.min(GLOBAL_LIMITS.maxComfortSpeed, lim.comfortSpeed[1]);
    if (speed > max) { corrections.push(`${seg.label} speed capped at ${max} km/h`); speed = max; }
    if (speed < GLOBAL_LIMITS.minSpeed) speed = GLOBAL_LIMITS.minSpeed;
    return { ...seg, speed: round1(speed) };
  });
  const target = [
    Math.min(workout.targetExertion[0], GLOBAL_LIMITS.maxTargetExertion),
    Math.min(workout.targetExertion[1], GLOBAL_LIMITS.maxTargetExertion),
  ];
  let total = segments.reduce((s, x) => s + x.minutes, 0);
  if (total > GLOBAL_LIMITS.maxTotalMinutes) corrections.push('Duration above the global limit');
  return { ...workout, segments, targetExertion: target, totalMinutes: total, corrections };
}
