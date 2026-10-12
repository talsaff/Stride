// Initial heuristic configuration.
//
// Everything in this file is a conservative STARTING heuristic chosen for a
// beginner. None of these numbers are medically validated thresholds. They are
// kept in one place so they can be tuned later from real user feedback.

export const ALGORITHM_VERSION = '1.0.0';

// Fixed segment speeds (km/h) that are not part of the progression ladder.
export const WARMUP_SPEED = 2.7;
export const COOLDOWN_SPEED = 2.6;

// Absolute limits that no level, user request or adjustment may exceed.
export const GLOBAL_LIMITS = {
  maxBriskSpeed: 4.5,        // walking only, never running
  maxComfortSpeed: 3.8,
  minSpeed: 2.0,
  maxTotalMinutes: 40,
  minTotalMinutes: 5,
  maxTargetExertion: 6,      // never prescribe hard or maximal effort
};

// The five baseline program levels. Each level defines explicit workload
// limits rather than a speed multiplier. SafetyGuard clamps every generated
// workout to the limits of the level it belongs to.
export const LEVELS = {
  1: {
    name: 'Gentle start',
    description: 'Very easy adaptation and comfortable walking.',
    totalMinutes: [12, 16], comfortSpeed: [2.8, 3.2], briskSpeed: null,
    intervalMinutes: null, intervals: [0, 0], targetExertion: [3, 4],
  },
  2: {
    name: 'Easy walking',
    description: 'Easy walking with occasional pace changes.',
    totalMinutes: [14, 20], comfortSpeed: [3.0, 3.4], briskSpeed: [3.3, 3.7],
    intervalMinutes: [1, 1], intervals: [2, 3], targetExertion: [3, 4],
  },
  3: {
    name: 'Walking intervals',
    description: 'Moderate walking intervals.',
    totalMinutes: [18, 24], comfortSpeed: [3.0, 3.5], briskSpeed: [3.5, 3.9],
    intervalMinutes: [2, 2], intervals: [3, 4], targetExertion: [3, 5],
  },
  4: {
    name: 'Longer brisk walks',
    description: 'Longer or brisker walking intervals.',
    totalMinutes: [24, 28], comfortSpeed: [3.0, 3.6], briskSpeed: [3.7, 4.1],
    intervalMinutes: [3, 3], intervals: [3, 4], targetExertion: [4, 5],
  },
  5: {
    name: 'Strong walker',
    description: 'More challenging but controlled walking intervals.',
    totalMinutes: [24, 34], comfortSpeed: [3.0, 3.6], briskSpeed: [4.0, 4.5],
    intervalMinutes: [3, 4], intervals: [4, 4], targetExertion: [4, 6],
  },
};

// The progression ladder. Adjacent stages differ in exactly ONE primary
// workload variable (duration, number of intervals, interval length or
// speed), so every progression step changes one thing at a time.
//   steady: minutes of continuous comfortable walking (level 1 only)
//   n / work / rec: number of brisk intervals, brisk minutes, easy minutes
export const STAGES = [
  null, // stages are 1-indexed
  { level: 1, warm: 4, cool: 3, comfort: 3.0, steady: 6, changed: 'start' },
  { level: 1, warm: 4, cool: 3, comfort: 3.0, steady: 8, changed: 'duration' },
  { level: 1, warm: 4, cool: 3, comfort: 3.2, steady: 8, changed: 'speed' },
  { level: 2, warm: 4, cool: 3, comfort: 3.2, brisk: 3.5, n: 2, work: 1, rec: 3, changed: 'pace changes' },
  { level: 2, warm: 4, cool: 3, comfort: 3.2, brisk: 3.5, n: 3, work: 1, rec: 3, changed: 'number of intervals' },
  { level: 2, warm: 4, cool: 3, comfort: 3.2, brisk: 3.6, n: 3, work: 1, rec: 3, changed: 'brisk speed' },
  { level: 3, warm: 4, cool: 3, comfort: 3.2, brisk: 3.6, n: 3, work: 2, rec: 2, changed: 'interval length' },
  { level: 3, warm: 4, cool: 3, comfort: 3.2, brisk: 3.8, n: 3, work: 2, rec: 2, changed: 'brisk speed' },
  { level: 3, warm: 4, cool: 3, comfort: 3.2, brisk: 3.8, n: 4, work: 2, rec: 2, changed: 'number of intervals' },
  { level: 4, warm: 4, cool: 3, comfort: 3.2, brisk: 3.8, n: 4, work: 3, rec: 2, changed: 'interval length' },
  { level: 4, warm: 4, cool: 3, comfort: 3.2, brisk: 3.9, n: 4, work: 3, rec: 2, changed: 'brisk speed' },
  { level: 4, warm: 4, cool: 3, comfort: 3.2, brisk: 4.0, n: 4, work: 3, rec: 2, changed: 'brisk speed' },
  { level: 5, warm: 4, cool: 3, comfort: 3.2, brisk: 4.2, n: 4, work: 3, rec: 2, changed: 'brisk speed' },
  { level: 5, warm: 4, cool: 3, comfort: 3.2, brisk: 4.2, n: 4, work: 4, rec: 2, changed: 'interval length' },
  { level: 5, warm: 4, cool: 3, comfort: 3.2, brisk: 4.4, n: 4, work: 4, rec: 2, changed: 'brisk speed' },
];
export const MAX_STAGE = STAGES.length - 1;

// Decision thresholds. All configurable.
export const RULES = {
  // Progression
  easyStreakToProgress: 2,         // consecutive comfortable workouts needed (spec: 2-3)
  hardStreakToReduce: 2,           // consecutive too-hard workouts → reduce baseline
  baselineReduction: 0.12,         // ~10-15% workload reduction
  completionForEasy: 0.9,          // fraction of planned intervals to count as "comfortable"
  completionForHard: 0.6,          // below this (shortened because of difficulty) → hard
  // Return to training (days since last completed workout)
  resumeWithinDays: 14,
  modestReturnWithinDays: 30,
  modestReturnStageDrop: 1,
  longBreakStageDrop: 3,
  longBreakMaxMinutes: 15,
  // Temporary adjustments
  easierStageDrop: 2,
  harderStageRise: 1,
  afterHardStageDrop: 1,
  poorRecoveryStageDrop: 1,
  // Safety
  requireClearanceAboveLevel: 3,   // levels 4-5 need confirmed medical clearance
  fatigueWindow: 3,                // look at the last N check-ins
  fatigueFlagsForConcern: 2,       // poor recovery / exhausted this many times → pause
  // Slow-down control during a workout
  slowDownStep: 0.3,
};

export function levelOfStage(stage) {
  return STAGES[clampStage(stage)].level;
}

export function firstStageOfLevel(level) {
  for (let s = 1; s <= MAX_STAGE; s++) if (STAGES[s].level === level) return s;
  return 1;
}

export function lastStageOfLevel(level) {
  let last = 1;
  for (let s = 1; s <= MAX_STAGE; s++) if (STAGES[s].level === level) last = s;
  return last;
}

export function clampStage(stage) {
  return Math.max(1, Math.min(MAX_STAGE, Math.round(stage)));
}
