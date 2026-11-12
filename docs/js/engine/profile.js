// Runner profile → plan personalization. Pure functions.
//
// The profile changes three things:
//   1. where the program starts (startingStage)
//   2. how fast every segment is (speedFactor: height, age, BMI, fitness)
//   3. how far the program can go (maxStage: walking only, mix, or running)
// plus a small goal-based tweak in the workout generator (goalOptions).

import { clampStage, MAX_STAGE, FAST_CAP } from './config.js';

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

export function maxStage() {
  return MAX_STAGE;
}

// Where a new user starts. Stage 1 is already 25 min with fast walking.
const START = { low: 1, some: 6, regular: 14, fit: 24 };

export function startingStage(profile) {
  let s = START[profile.fitness ?? 'low'] ?? 1;
  const age = Number(profile.age) || 0;
  if (age >= 45) s -= 3;
  if (age >= 60) s -= 5;
  const b = bmi(profile);
  if (b && b >= 30) s -= 3;
  if (b && b >= 35) s -= 3;
  return clampStage(s);
}

// Multiplier on walking and fast speeds. It only ever speeds things up (never
// below the plan's minimums): taller and fitter people move faster at the same
// effort; age and a higher BMI reduce the boost. Gender is not used: height,
// weight and age already describe what matters for treadmill speed.
export function speedFactor(profile) {
  let f = 1;
  const h = Number(profile.heightCm);
  if (h) f += Math.max(-0.08, Math.min(0.08, (h - 170) * 0.0035));
  const age = Number(profile.age);
  if (age > 35) f -= Math.min(0.15, (age - 35) * 0.004);
  const b = bmi(profile);
  if (b && b >= 35) f -= 0.07;
  else if (b && b >= 30) f -= 0.04;
  if (profile.fitness === 'regular') f += 0.02;
  if (profile.fitness === 'fit') f += 0.04;
  return Math.round(Math.max(1, Math.min(1.12, f)) * 100) / 100;
}

export function goalOptions(profile) {
  switch (profile.goal) {
    case 'weight': return { extraEasyMinutes: 5 };   // more time moving at an easy, sustainable effort
    case 'habit': return { capMinutes: 30 };         // keep sessions short enough to stick
    default: return {};
  }
}

export function profileSummary(profile) {
  const pref = effectivePreference(profile);
  const parts = [];
  if (pref === 'walk') parts.push(`Walking program: fast walks up to ${FAST_CAP.walk} km/h, no running in the plan`);
  else if (pref === 'mix') parts.push(`Fast walks that grow into jogs, up to ${FAST_CAP.mix} km/h`);
  else parts.push(`Builds up to real running, up to ${FAST_CAP.run.toFixed(0)} km/h`);
  const f = speedFactor(profile);
  if (f > 1) parts.push(`Speeds up ${Math.round((f - 1) * 100)}% for your height and fitness`);
  const g = goalOptions(profile);
  if (g.extraEasyMinutes) parts.push(`+${g.extraEasyMinutes} easy minutes per workout for your weight goal`);
  if (g.capMinutes) parts.push(`Sessions capped at ${g.capMinutes} min to make the habit stick`);
  parts.push('Gets a tiny bit harder after every workout');
  return parts;
}

export function isProfileComplete(profile) {
  return !!(profile.age && profile.heightCm && profile.weightKg && profile.fitness && profile.preference && profile.goal && profile.gender);
}
