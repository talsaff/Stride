// Runner profile → plan personalization. Pure functions.
//
// The profile changes three things:
//   1. where the program starts (startingStage)
//   2. how fast every segment is (speedFactor: height, age, BMI, fitness)
//   3. how far the program can go (maxStage: walking only, mix, or running)
// plus a small goal-based tweak in the workout generator (goalOptions).

import { clampStage, MAX_STAGE, LAST_WALKING_STAGE, lastStageOfLevel } from './config.js';

export const FITNESS = {
  low: 'I get out of breath quickly',
  some: 'I move a bit, nothing regular',
  regular: 'I work out now and then',
  fit: 'I am pretty fit',
};
export const PREFERENCE = { walk: 'Walking', mix: 'A bit of both', run: 'Running' };
export const GOALS = {
  habit: 'Build a habit',
  weight: 'Lose weight',
  endurance: 'More stamina',
  run5k: 'Run 5 km',
};
export const GENDERS = { female: 'Female', male: 'Male', other: 'Other', na: 'Prefer not to say' };

export function bmi(profile) {
  const h = Number(profile.heightCm), w = Number(profile.weightKg);
  if (!h || !w) return null;
  return w / ((h / 100) ** 2);
}

// Running-goal users get the running track even if they picked "mix".
export function effectivePreference(profile) {
  if (profile.goal === 'run5k' && profile.preference !== 'run') return 'run';
  return profile.preference ?? 'walk';
}

export function maxStage(profile) {
  const pref = effectivePreference(profile);
  if (pref === 'walk') return LAST_WALKING_STAGE;
  if (pref === 'mix') return lastStageOfLevel(7);
  return MAX_STAGE;
}

const START = {
  walk: { low: 1, some: 4, regular: 7, fit: 10 },
  mix: { low: 1, some: 4, regular: 10, fit: 16 },
  run: { low: 2, some: 5, regular: 13, fit: 16 },
};

export function startingStage(profile) {
  const pref = effectivePreference(profile);
  let s = START[pref][profile.fitness ?? 'low'] ?? 1;
  const age = Number(profile.age) || 0;
  if (age >= 45) s -= 1;
  if (age >= 60) s -= 2;
  const b = bmi(profile);
  if (b && b >= 30) s -= 1;
  if (b && b >= 35) s -= 1;
  return Math.min(clampStage(s), maxStage(profile));
}

// Multiplier applied to every speed. Taller people walk faster at the same
// effort; speeds ease off gradually with age and with a higher BMI; fitter
// people get a small boost. Gender is not used: height, weight and age
// already describe what matters for treadmill speed.
export function speedFactor(profile) {
  let f = 1;
  const h = Number(profile.heightCm);
  if (h) f += Math.max(-0.08, Math.min(0.08, (h - 165) * 0.0035));
  const age = Number(profile.age);
  if (age > 35) f -= Math.min(0.15, (age - 35) * 0.004);
  const b = bmi(profile);
  if (b && b >= 35) f -= 0.07;
  else if (b && b >= 30) f -= 0.04;
  if (profile.fitness === 'regular') f += 0.02;
  if (profile.fitness === 'fit') f += 0.04;
  return Math.round(Math.max(0.85, Math.min(1.12, f)) * 100) / 100;
}

export function goalOptions(profile) {
  switch (profile.goal) {
    case 'weight': return { extraEasyMinutes: 5 };   // more time moving at an easy, sustainable effort
    case 'habit': return { capMinutes: 25 };         // keep sessions short enough to stick
    default: return {};
  }
}

export function profileSummary(profile) {
  const pref = effectivePreference(profile);
  const parts = [];
  if (pref === 'walk') parts.push('Walking-only program');
  else if (pref === 'mix') parts.push('Walking that grows into run/walk intervals');
  else parts.push('Walking that builds up to running');
  const f = speedFactor(profile);
  if (f !== 1) parts.push(`Speeds ${f > 1 ? 'up' : 'down'} ${Math.round(Math.abs(f - 1) * 100)}% for your body and age`);
  const g = goalOptions(profile);
  if (g.extraEasyMinutes) parts.push(`+${g.extraEasyMinutes} easy minutes per workout for your weight goal`);
  if (g.capMinutes) parts.push(`Sessions kept under ${g.capMinutes} min to make the habit stick`);
  return parts;
}

export function isProfileComplete(profile) {
  return !!(profile.age && profile.heightCm && profile.weightKg && profile.fitness && profile.preference && profile.goal && profile.gender);
}
