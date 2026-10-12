import { defaultProfile, defaultState, defaultReadiness, makeWorkoutRecord, makeMissedRecord } from '../js/engine/schema.js';
import { generateWorkout } from '../js/engine/generator.js';
import { levelOfStage } from '../js/engine/config.js';

export const NOW = '2026-10-12T18:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

export function daysAgo(n, from = NOW) {
  return new Date(new Date(from).getTime() - n * DAY).toISOString();
}

let seq = 0;

// A completed workout at `stage`. Defaults describe an "appropriate" session.
export function workout({ ago, stage = 1, baseline = stage, rating = 'appropriate', rpe = 4, talk = 'yes', feeling = 'good',
  recovery = 'normal', endedEarly = false, reason = null, completedWork, safetyStop = false, temp = 'none', ramp = false, actual } = {}) {
  const plan = generateWorkout(stage);
  return makeWorkoutRecord({
    workout_id: `w${++seq}`,
    date: daysAgo(ago),
    planned_duration: plan.totalMinutes,
    actual_duration: actual ?? (endedEarly ? Math.round(plan.totalMinutes / 2) : plan.totalMinutes),
    planned_intervals: plan.segments,
    completed_intervals: plan.segments.length,
    planned_work_intervals: plan.workIntervals,
    completed_work_intervals: completedWork ?? plan.workIntervals,
    actual_speed_by_interval: plan.segments,
    baseline_program_level: levelOfStage(baseline),
    baseline_stage: baseline,
    effective_stage: stage,
    temporary_adjustment: temp,
    perceived_exertion: rpe,
    talk_test_result: talk,
    post_workout_feeling: feeling,
    recovery_status: recovery,
    rating,
    ended_early: endedEarly,
    stopped_for_safety: safetyStop,
    reason_for_shortening_or_skipping: reason,
    target_exertion: plan.targetExertion,
    algorithm_version: 'test',
    algorithm_decision: 'test',
    algorithm_decision_explanation: '',
    return_ramp: ramp,
  });
}

export const easy = (ago, stage, extra = {}) => workout({ ago, stage, rating: 'too_easy', rpe: 2, ...extra });
export const ok = (ago, stage, extra = {}) => workout({ ago, stage, ...extra });
export const hard = (ago, stage, extra = {}) => workout({ ago, stage, rating: 'too_hard', rpe: 7, talk: 'no', feeling: 'tired', ...extra });

export function missed(ago, reason) {
  return makeMissedRecord({ id: `m${++seq}`, date: daysAgo(ago), reason });
}

export function input({ stage = 1, changedAt = null, history = [], readiness = {}, profile = {}, request = {}, state = {} } = {}) {
  return {
    profile: { ...defaultProfile(), ...profile },
    state: { ...defaultState(), baselineStage: stage, baselineChangedAt: changedAt, ...state },
    history,
    readiness: { ...defaultReadiness(), ...readiness },
    request,
    now: NOW,
  };
}
