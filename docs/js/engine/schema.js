// Data schema: enumerations and record factories.
// See docs/DESIGN.md for the full field-by-field description.

export const SCHEMA_VERSION = 1;

export const ENERGY = ['low', 'normal', 'high'];
export const RECOVERY = ['poor', 'normal', 'good'];
export const TALK_TEST = ['yes', 'mostly', 'no'];
export const POST_FEELING = ['great', 'good', 'tired', 'exhausted', 'unwell'];
export const RATING = ['too_easy', 'appropriate', 'too_hard'];
export const SORENESS = ['none', 'mild', 'moderate', 'severe'];

export const REASONS = {
  time: 'Lack of time',
  low_energy: 'Low energy',
  too_difficult: 'Workout was too difficult',
  pain: 'Pain or physical symptoms',
  motivation: 'Lack of motivation',
  illness: 'Illness',
  other: 'Other',
};

// Symptoms that end a workout and need urgent medical assessment.
export const RED_FLAG_SYMPTOMS = {
  chest_pain: 'Chest pain or pressure',
  fainting: 'Fainting or nearly fainting',
  severe_breathless: 'Unusual, severe shortness of breath',
};

// Symptoms that mean "rest today, do not exercise through this".
export const REST_SYMPTOMS = {
  dizziness: 'Dizziness or light-headedness',
  pain: 'Significant pain',
  severe_fatigue: 'Unexplained severe fatigue',
  palpitations: 'Racing or irregular heartbeat',
};

export const TEMP_ADJUSTMENTS = ['none', 'easier', 'harder'];

export function defaultProfile() {
  return {
    name: '',
    age: null,
    gender: null,                  // female | male | other | na
    heightCm: null,
    weightKg: null,
    fitness: null,                 // low | some | regular | fit
    preference: null,              // walk | mix | run
    goal: null,                    // habit | weight | endurance | run5k
    workoutsPerWeek: 2,
    defaultMinutes: null,          // null = use the program's natural length
    autoEasierOnLowEnergy: true,
    voiceCues: true,
  };
}

export function defaultState() {
  return {
    baselineStage: 1,
    baselineChangedAt: null,       // ISO timestamp of last permanent change
    baselineLog: [],               // [{at, from, to, reason, source}]
    tempAdjustment: 'none',        // expires after the next workout
    shortenTo: null,               // one-time minutes, expires after the next workout
    readiness: defaultReadiness(),
    lastCompletedAt: null,
    lastSuccessfulWorkoutId: null,
    algorithmVersion: null,
    lastDecision: null,
  };
}

export function defaultReadiness() {
  return { energy: 'normal', recovery: 'normal', soreness: 'none', symptoms: [], at: null };
}

// One completed (possibly shortened or stopped) workout.
export function makeWorkoutRecord(fields) {
  return {
    kind: 'workout',
    workout_id: fields.workout_id,
    date: fields.date,                                   // ISO timestamp of start
    planned_duration: fields.planned_duration,           // minutes
    actual_duration: fields.actual_duration,             // minutes (1 decimal)
    distance_km: fields.distance_km ?? null,
    planned_intervals: fields.planned_intervals,         // [{type, minutes, speed}]
    completed_intervals: fields.completed_intervals,     // count of segments finished
    planned_work_intervals: fields.planned_work_intervals ?? 0,
    completed_work_intervals: fields.completed_work_intervals ?? 0,
    actual_speed_by_interval: fields.actual_speed_by_interval, // [{type, minutes, speed, skipped}]
    baseline_program_level: fields.baseline_program_level,
    baseline_stage: fields.baseline_stage,
    effective_stage: fields.effective_stage,
    temporary_adjustment: fields.temporary_adjustment ?? 'none',
    pre_workout_energy: fields.pre_workout_energy ?? 'normal',
    perceived_exertion: fields.perceived_exertion ?? null,     // 1-10
    talk_test_result: fields.talk_test_result ?? null,
    post_workout_feeling: fields.post_workout_feeling ?? null,
    recovery_status: fields.recovery_status ?? 'normal',       // pre-workout recovery
    muscle_soreness: fields.muscle_soreness ?? 'none',
    rating: fields.rating ?? null,                             // too_easy / appropriate / too_hard
    ended_early: !!fields.ended_early,
    stopped_for_safety: !!fields.stopped_for_safety,
    reason_for_shortening_or_skipping: fields.reason_for_shortening_or_skipping ?? null,
    user_feedback: fields.user_feedback ?? '',
    target_exertion: fields.target_exertion ?? null,           // [min, max]
    algorithm_version: fields.algorithm_version,
    algorithm_decision: fields.algorithm_decision,
    algorithm_decision_explanation: fields.algorithm_decision_explanation,
    return_ramp: !!fields.return_ramp,
  };
}

// A missed workout is stored separately and never counts as a fitness signal
// by itself.
export function makeMissedRecord(fields) {
  return {
    kind: 'missed',
    id: fields.id,
    date: fields.date,
    reason: fields.reason,        // key of REASONS
    note: fields.note ?? '',
  };
}
