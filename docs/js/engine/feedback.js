// FeedbackProcessor: turns post-workout answers into structured data and
// classifies how a workout went as an adaptation signal.
//
// A completed workout is not automatically a success signal. Classification
// looks at exertion, the user's own rating, the talk test, how much of the
// plan was done and why it ended early.

import { RULES, LEVELS, levelOfStage } from './config.js';
import { TALK_TEST, POST_FEELING, RATING, SORENESS, REASONS } from './schema.js';

const DIFFICULTY_REASONS = new Set(['too_difficult', 'low_energy']);

export function normalizeFeedback(form) {
  const rpe = Number(form.perceived_exertion);
  return {
    perceived_exertion: Number.isFinite(rpe) ? Math.max(1, Math.min(10, Math.round(rpe))) : null,
    talk_test_result: TALK_TEST.includes(form.talk_test_result) ? form.talk_test_result : null,
    post_workout_feeling: POST_FEELING.includes(form.post_workout_feeling) ? form.post_workout_feeling : null,
    rating: RATING.includes(form.rating) ? form.rating : null,
    muscle_soreness: SORENESS.includes(form.muscle_soreness) ? form.muscle_soreness : 'none',
    reason_for_shortening_or_skipping: form.reason && REASONS[form.reason] ? form.reason : null,
    user_feedback: String(form.user_feedback ?? '').slice(0, 1000),
  };
}

export function completionRatio(w) {
  if (w.planned_work_intervals > 0) return w.completed_work_intervals / w.planned_work_intervals;
  if (w.planned_duration > 0) return Math.min(1, w.actual_duration / w.planned_duration);
  return 1;
}

// Returns one of:
//   'hard'        harder than intended
//   'easy'        completed comfortably, below the intended effort
//   'appropriate' about right
//   'neutral'     not a fitness signal (e.g. cut short for time)
//   'safety'      stopped because of symptoms (never a failure, never a signal)
export function classifyWorkout(w) {
  if (w.stopped_for_safety) return 'safety';
  const target = w.target_exertion ?? LEVELS[levelOfStage(w.effective_stage ?? 1)].targetExertion;
  const rpe = w.perceived_exertion;
  const ratio = completionRatio(w);
  const reason = w.reason_for_shortening_or_skipping;

  const hard =
    w.rating === 'too_hard' ||
    (rpe != null && rpe > target[1] + 1) ||
    w.talk_test_result === 'no' ||
    (w.ended_early && ratio < RULES.completionForHard && DIFFICULTY_REASONS.has(reason));
  if (hard) return 'hard';

  // Cut short for reasons unrelated to the workload: says nothing about fitness.
  if (w.ended_early && ratio < RULES.completionForEasy && !DIFFICULTY_REASONS.has(reason)) return 'neutral';
  if (w.rating == null && rpe == null) return 'neutral';

  const feltOk = !['exhausted', 'unwell'].includes(w.post_workout_feeling);
  const easy =
    ratio >= RULES.completionForEasy &&
    feltOk &&
    w.talk_test_result !== 'mostly' &&
    (w.rating === 'too_easy' || (rpe != null && rpe < target[0]));
  if (easy) return 'easy';
  return 'appropriate';
}
