// Training configuration.
//
// The plan is a ladder of small steps. Stage 1 is the easiest normal workout:
// 25 minutes at 3.5-5.5 km/h with 2 minutes of fast walking at 6 km/h. Each
// later stage changes exactly ONE thing by a tiny amount, in a repeating
// cycle: +1 minute, +0.1 km/h walking speeds, +1 fast minute, +0.2 km/h fast
// speed. Completing a workout moves you one stage up.

export const ALGORITHM_VERSION = '3.0.0';

export const MAX_STAGE = 80;
export const STAGES_PER_LEVEL = 10;
export const LEVEL_COUNT = 8;

// Absolute limits that no stage, profile or adjustment may exceed.
export const GLOBAL_LIMITS = {
  maxWalkSpeed: 6.5,
  maxRunSpeed: 12.0,
  minSpeed: 2.0,
  maxTotalMinutes: 50,
  minTotalMinutes: 5,
  maxTargetExertion: 8,
};

// Workout building blocks (km/h, minutes).
export const BASE = {
  minutes: 25, maxMinutes: 45,
  warmMinutes: 4, coolMinutes: 3, recoverMinutes: 2,
  warmSpeed: 3.5, coolSpeed: 3.8,
  easySpeed: 4.5, briskSpeed: 5.5,
  fastSpeed: 6.0, fastMinutes: 2, maxFastMinutes: 20,
  walkSpeedStep: 0.1, maxWalkBoost: 1.0,
  fastSpeedStep: 0.2,
  runFrom: 7.0,               // fast segments at or above this are running
};

// How fast the "fast" segments may get, by profile preference.
export const FAST_CAP = { walk: 6.5, mix: 8.5, run: 10.0 };

// Tired / low-energy version: everything between 3.5 and 4.5 km/h.
export const EASY_DAY = { minutes: 25, minSpeed: 3.5, maxSpeed: 4.5, easySpeed: 4.0 };

// Advanced version for high-energy days: replaces today's workout only.
export const ADVANCED = { stageBoost: 4, minRunMinutes: 3, minRunSpeed: 7.0, runSpeedAbovePlan: 0.8, extraMinutes: 2 };

export const LEVELS = {
  1: { name: 'Kickoff', description: '25-27 min, fast walks around 6 km/h.', targetExertion: [4, 6] },
  2: { name: 'Building', description: 'Longer sessions, quicker walking.', targetExertion: [4, 6] },
  3: { name: 'Steady', description: 'More fast minutes, first jog speeds.', targetExertion: [5, 6] },
  4: { name: 'Strong', description: 'Jogging intervals, 30+ min.', targetExertion: [5, 7] },
  5: { name: 'Power', description: 'Longer jogs, brisk walking in between.', targetExertion: [5, 7] },
  6: { name: 'Runner', description: 'Running intervals at a steady pace.', targetExertion: [6, 7] },
  7: { name: 'Fast runner', description: 'Long, quick running blocks.', targetExertion: [6, 8] },
  8: { name: 'Beast mode', description: 'The top of the program.', targetExertion: [6, 8] },
};

// Decision thresholds. All configurable.
export const RULES = {
  stepsPerWorkout: 1,          // completed workout that felt about right
  stepsWhenTooEasy: 2,         // rated "too easy"
  hardStreakToReduce: 2,       // consecutive too-hard workouts → step back
  baselineReduction: 0.12,     // ~12% less workload after two hard ones
  completionForEasy: 0.9,
  completionForHard: 0.6,
  // Return to training (days since last completed workout)
  resumeWithinDays: 14,
  modestReturnWithinDays: 30,
  modestReturnStageDrop: 3,
  longBreakStageDrop: 8,
  longBreakMaxMinutes: 25,
  afterHardStageDrop: 2,
  // Recovery
  fatigueWindow: 3,
  fatigueFlagsForConcern: 2,
  // Slow-down control during a workout
  slowDownStep: 0.3,
};

export function clampStage(stage) {
  return Math.max(1, Math.min(MAX_STAGE, Math.round(stage)));
}

export function levelOfStage(stage) {
  return Math.min(LEVEL_COUNT, 1 + Math.floor((clampStage(stage) - 1) / STAGES_PER_LEVEL));
}

export function firstStageOfLevel(level) {
  return (Math.max(1, Math.min(LEVEL_COUNT, level)) - 1) * STAGES_PER_LEVEL + 1;
}

export function lastStageOfLevel(level) {
  return Math.min(MAX_STAGE, Math.max(1, Math.min(LEVEL_COUNT, level)) * STAGES_PER_LEVEL);
}

const r1 = (x) => Math.round(x * 10) / 10;

// The workload parameters of a stage. Exactly one of them moves per stage
// (unless it has already reached its cap).
export function stageParams(stage, preference = 'mix') {
  const k = clampStage(stage) - 1;
  const steps = (offset) => Math.floor((k + offset) / 4);   // how many times this variable has stepped
  const walkBoost = Math.min(BASE.maxWalkBoost, BASE.walkSpeedStep * steps(2));
  return {
    stage: k + 1,
    minutes: Math.min(BASE.maxMinutes, BASE.minutes + steps(3)),
    warmSpeed: r1(BASE.warmSpeed + walkBoost / 2),
    coolSpeed: BASE.coolSpeed,
    easySpeed: r1(BASE.easySpeed + walkBoost),
    briskSpeed: r1(Math.min(6.0, BASE.briskSpeed + walkBoost / 2)),
    fastMinutes: Math.min(BASE.maxFastMinutes, BASE.fastMinutes + steps(1)),
    fastSpeed: r1(Math.min(FAST_CAP[preference] ?? FAST_CAP.mix, BASE.fastSpeed + BASE.fastSpeedStep * steps(0))),
  };
}

// What changed going into this stage, for explanations.
export function stageChange(stage, preference = 'mix') {
  if (stage <= 1) return 'start';
  const a = stageParams(stage - 1, preference), b = stageParams(stage, preference);
  if (b.minutes !== a.minutes) return `+1 minute (${b.minutes} min)`;
  if (b.easySpeed !== a.easySpeed) return '+0.1 km/h on the walking parts';
  if (b.fastMinutes !== a.fastMinutes) return `+1 fast minute (${b.fastMinutes} min)`;
  if (b.fastSpeed !== a.fastSpeed) return `fast parts at ${b.fastSpeed.toFixed(1)} km/h`;
  return 'a fresh mix';
}
