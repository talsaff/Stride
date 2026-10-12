// Heuristic configuration.
//
// These are sensible STARTING heuristics, not validated thresholds. They are
// kept in one place so they can be tuned later from real feedback.

export const ALGORITHM_VERSION = '2.0.0';

// Warm-up / cool-down speeds (km/h) before the profile speed factor.
export const WARMUP_SPEED = 2.7;
export const COOLDOWN_SPEED = 2.6;
export const RUN_WARMUP_SPEED = 3.6;
export const RUN_COOLDOWN_SPEED = 3.2;

// Absolute limits that no level, profile, request or adjustment may exceed.
export const GLOBAL_LIMITS = {
  maxWalkSpeed: 5.5,
  maxRunSpeed: 10.0,
  minSpeed: 2.0,
  maxTotalMinutes: 45,
  minTotalMinutes: 5,
  maxTargetExertion: 7,      // never prescribe all-out effort
};

// Eight program levels. 1-5 are walking, 6-8 add jogging/running. Each level
// has explicit workload limits (before the profile speed factor).
export const LEVELS = {
  1: { name: 'Gentle start', description: 'Comfortable walking to build the habit.',
    totalMinutes: [12, 16], comfortSpeed: [2.8, 3.2], briskSpeed: null, intervals: [0, 0], targetExertion: [3, 4] },
  2: { name: 'Easy walking', description: 'Easy walking with a few faster bits.',
    totalMinutes: [14, 20], comfortSpeed: [3.0, 3.4], briskSpeed: [3.3, 3.7], intervals: [2, 3], targetExertion: [3, 4] },
  3: { name: 'Walking intervals', description: 'Moderate walking intervals.',
    totalMinutes: [18, 24], comfortSpeed: [3.0, 3.5], briskSpeed: [3.5, 3.9], intervals: [3, 4], targetExertion: [3, 5] },
  4: { name: 'Longer brisk walks', description: 'Longer, brisker walking intervals.',
    totalMinutes: [24, 28], comfortSpeed: [3.0, 3.6], briskSpeed: [3.7, 4.1], intervals: [3, 4], targetExertion: [4, 5] },
  5: { name: 'Strong walker', description: 'Challenging but controlled power walking.',
    totalMinutes: [24, 34], comfortSpeed: [3.0, 3.6], briskSpeed: [4.0, 4.5], intervals: [4, 4], targetExertion: [4, 6] },
  6: { name: 'First jogs', description: 'Short easy jogs between walks.',
    totalMinutes: [26, 36], comfortSpeed: [3.6, 4.4], briskSpeed: [6.0, 7.2], intervals: [5, 6], targetExertion: [5, 6], run: true },
  7: { name: 'Run/walk', description: 'Longer jogs with short walking breaks.',
    totalMinutes: [30, 38], comfortSpeed: [3.6, 4.4], briskSpeed: [6.5, 8.0], intervals: [5, 6], targetExertion: [5, 7], run: true },
  8: { name: 'Runner', description: 'Long runs, building to continuous running.',
    totalMinutes: [34, 42], comfortSpeed: [3.6, 4.4], briskSpeed: [7.0, 8.5], intervals: [2, 4], targetExertion: [6, 7], run: true },
};
export const LEVEL_COUNT = 8;

// The progression ladder. Adjacent stages differ in ONE thing: duration,
// interval structure, or one speed. (Switching from walking to the first
// jogs is its own single step.)
//   steady: minutes of continuous comfortable walking (level 1)
//   n / work / rec: number of faster intervals, their minutes, easy minutes
//   brisk: fast-walk speed;  run: jog speed (makes the intervals jogs)
export const STAGES = [
  null, // 1-indexed
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
  { level: 6, warm: 5, cool: 4, comfort: 4.0, run: 6.5, n: 5, work: 1, rec: 3, changed: 'first jogs' },
  { level: 6, warm: 5, cool: 4, comfort: 4.0, run: 6.5, n: 6, work: 1, rec: 3, changed: 'number of jogs' },
  { level: 6, warm: 5, cool: 4, comfort: 4.0, run: 7.0, n: 6, work: 1, rec: 3, changed: 'jog speed' },
  { level: 7, warm: 5, cool: 4, comfort: 4.0, run: 7.0, n: 6, work: 2, rec: 2, changed: 'jog length' },
  { level: 7, warm: 5, cool: 4, comfort: 4.0, run: 7.0, n: 5, work: 3, rec: 2, changed: 'jog length' },
  { level: 7, warm: 5, cool: 4, comfort: 4.0, run: 7.5, n: 5, work: 3, rec: 2, changed: 'jog speed' },
  { level: 8, warm: 5, cool: 4, comfort: 4.0, run: 7.5, n: 4, work: 5, rec: 2, changed: 'run length' },
  { level: 8, warm: 5, cool: 4, comfort: 4.0, run: 7.5, n: 3, work: 8, rec: 2, changed: 'run length' },
  { level: 8, warm: 5, cool: 4, comfort: 4.0, run: 7.5, n: 2, work: 13, rec: 2, changed: 'run length' },
];
export const MAX_STAGE = STAGES.length - 1;
export const LAST_WALKING_STAGE = 15;

// Decision thresholds. All configurable.
export const RULES = {
  // Progression
  easyStreakToProgress: 2,         // consecutive comfortable workouts needed
  hardStreakToReduce: 2,           // consecutive too-hard workouts → reduce baseline
  baselineReduction: 0.12,         // ~10-15% workload reduction
  completionForEasy: 0.9,
  completionForHard: 0.6,
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
  // Recovery
  fatigueWindow: 3,
  fatigueFlagsForConcern: 2,
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
