// Adaptive decision engine. Pure and deterministic: the same profile, state,
// history, readiness, request and `now` always produce the same decision.
//
// Priority order (spec section 6):
//   1. Safety and contraindications        (SafetyGuard)
//   2. Current symptoms and recovery       (SafetyGuard / ReadinessAssessment)
//   3. Return-to-training after inactivity (ReadinessAssessment)
//   4. Temporary preference for today
//   5. Recent workout performance          (ProgressionEngine)
//   6. Long-term progression               (ProgressionEngine)
//   7. Fitting the workout into the time available (WorkoutGenerator)
// Reductions from different reasons do not stack: the most conservative wins.

import { ALGORITHM_VERSION, RULES, MAX_STAGE, clampStage, levelOfStage } from './config.js';
import { assessReadiness } from './readiness.js';
import { evaluateSafety, clampWorkout, maxStageAllowed } from './safety.js';
import { evaluateProgression } from './progression.js';
import { generateWorkout } from './generator.js';
import { classifyWorkout } from './feedback.js';
import { lastCompleted, completedWorkouts } from './history.js';
import { makeWorkoutRecord } from './schema.js';

function lastComfortableStage(history, fallback) {
  const done = completedWorkouts(history);
  for (let i = done.length - 1; i >= 0; i--) {
    const c = classifyWorkout(done[i]);
    if (c === 'easy' || c === 'appropriate') return done[i].effective_stage;
  }
  return fallback;
}

function returnPlan(assessment, history, baseline) {
  const last = lastCompleted(history);
  const ref = Math.min(baseline, lastComfortableStage(history, baseline));
  const d = assessment.daysSinceLast;
  switch (assessment.returnCategory) {
    case 'modest':
      return {
        stage: Math.max(1, ref - RULES.modestReturnStageDrop), maxMinutes: null,
        why: `It has been ${d} days since your last walk. Welcome back! Today repeats a comfortable workout at a slightly lighter load, then builds back up.`,
      };
    case 'long':
      return {
        stage: Math.max(1, ref - RULES.longBreakStageDrop), maxMinutes: RULES.longBreakMaxMinutes,
        why: `It has been ${d} days since your last walk. Welcome back! Today is short and easy so we can see how it feels. Your history and progress are all still here.`,
      };
    case 'resume': {
      if (!last.return_ramp || last.effective_stage >= baseline) return null;
      const c = classifyWorkout(last);
      const stage = c === 'easy' || c === 'appropriate' ? last.effective_stage + 1 : last.effective_stage;
      if (stage >= baseline) return null;
      return { stage, maxMinutes: null, why: 'Still easing back in after your break: one small step closer to your usual level.' };
    }
    default:
      return null;
  }
}

export function decide({ profile, state, history, readiness, request = {}, now }) {
  const temp = request.temp ?? state.tempAdjustment ?? 'none';
  const shortenTo = request.shortenTo ?? state.shortenTo ?? null;
  const assessment = assessReadiness({ readiness, history, now });
  const safety = evaluateSafety(assessment, profile);
  const explanation = [];
  const modifiers = [];

  const base = {
    algorithmVersion: ALGORITHM_VERSION,
    assessment,
    safetyNotes: safety.notes,
    request: { temp, shortenTo },
  };

  // 1. Safety and contraindications
  if (safety.status !== 'ok') {
    return {
      ...base,
      status: safety.status,
      code: safety.status === 'urgent' ? 'stop_urgent' : 'rest',
      headline: safety.status === 'urgent' ? 'Please do not exercise today' : 'Rest day recommended',
      explanation: [safety.notes[0], 'Resting for your health is never a failure, and it does not erase your progress.'],
      baseline: { from: state.baselineStage, to: state.baselineStage, changed: false, action: 'maintain' },
      workout: null, harderAllowed: false, progressionAllowed: false,
    };
  }

  // 5-6. Performance-based baseline evaluation (applied below in priority order)
  const prog = evaluateProgression({ state, history, safety, profile });
  const baseline = prog.to;
  if (prog.action !== 'maintain') modifiers.push(prog.action);

  const reductions = []; // {stage, why, source}
  // 2. Current symptoms and recovery
  if (safety.pauseProgression) {
    reductions.push({ stage: baseline - RULES.poorRecoveryStageDrop, why: safety.notes[0], source: 'recovery' });
  }
  // 3. Return to training
  const ret = assessment.returnCategory === 'first' ? null : returnPlan(assessment, history, baseline);
  if (ret) reductions.push({ ...ret, source: 'return' });
  const priorityReduced = reductions.length > 0;

  // 4. Temporary preference
  const autoEasier = temp === 'none' && assessment.energy === 'low' && profile.autoEasierOnLowEnergy;
  if (temp === 'easier' || autoEasier) {
    reductions.push({
      stage: baseline - RULES.easierStageDrop, source: 'easier',
      why: autoEasier
        ? 'You said your energy is low, so today is lighter. This is a one-off: your program level does not change.'
        : 'You asked for an easier day. This is a one-off: your program level does not change.',
    });
  }
  // 5. Recent performance (one hard session, or a session missed because it was too hard)
  const missedHard = assessment.missedSinceLast.some((m) => m.reason === 'too_difficult');
  if ((prog.afterHard || missedHard) && temp !== 'harder') {
    reductions.push({
      stage: baseline - RULES.afterHardStageDrop, source: 'after_hard',
      why: prog.afterHard ? prog.reason : 'You skipped a session because it felt too hard, so today is a little lighter. Your level is unchanged.',
    });
  }

  let effective = baseline;
  let maxMinutes = null;
  for (const r of reductions) {
    if (r.stage < effective) effective = r.stage;
    if (r.maxMinutes != null) maxMinutes = r.maxMinutes;
    explanation.push(r.why);
    modifiers.push(r.source);
  }
  effective = clampStage(effective);

  // 4b. Harder request: modest, and never over safety, recovery or a return
  let harderAllowed = !(safety.blockHarder || priorityReduced || assessment.energy === 'low');
  let harderBlockedReason = null;
  if (!harderAllowed) {
    harderBlockedReason = safety.blockHarder
      ? 'Recovery comes first today, so a harder workout is not available.'
      : priorityReduced
        ? 'You are easing back in after a break, so today stays gentle.'
        : 'You said your energy is low today, so a harder workout is not offered.';
  }
  const cap = maxStageAllowed(profile);
  if (effective + RULES.harderStageRise > Math.min(cap, MAX_STAGE)) {
    if (harderAllowed) harderBlockedReason = effective >= MAX_STAGE
      ? 'This is already the hardest workout in the program.'
      : 'A harder workout needs medical clearance first (see Settings).';
    harderAllowed = false;
  }
  if (temp === 'harder') {
    if (harderAllowed) {
      effective = clampStage(effective + RULES.harderStageRise);
      explanation.push('You are feeling good, so today has a small extra challenge. This is a one-off: your program level does not change.');
      modifiers.push('harder');
    } else {
      explanation.push(`You asked for a harder workout, but: ${harderBlockedReason}`);
      modifiers.push('harder_refused');
    }
  }
  effective = Math.min(effective, cap);

  // 6. Long-term progression explanation
  if (prog.action !== 'maintain' || explanation.length === 0) explanation.unshift(prog.reason);

  // 7. Fit into the time available
  let targetMinutes = null;
  if (profile.defaultMinutes) targetMinutes = profile.defaultMinutes;
  if (maxMinutes != null) targetMinutes = Math.min(targetMinutes ?? maxMinutes, maxMinutes);
  if (shortenTo) {
    targetMinutes = Math.min(targetMinutes ?? shortenTo, shortenTo);
    explanation.push(`Shortened to about ${shortenTo} minutes for today. Every minute counts.`);
    modifiers.push('shortened');
  }
  const easier = reductions.some((r) => r.source === 'easier' || r.source === 'recovery');
  const raw = generateWorkout(effective, { targetMinutes, easier });
  const workout = clampWorkout(raw, raw.level);
  if (!shortenTo && targetMinutes && workout.totalMinutes < workout.naturalMinutes) {
    explanation.push(`Fitted to your preferred ${targetMinutes}-minute session.`);
  }

  const appliedTemp = modifiers.includes('harder') ? 'harder' : (modifiers.includes('easier') ? 'easier' : 'none');
  return {
    ...base,
    status: 'ok',
    code: prog.action,
    modifiers,
    headline: headlineFor(prog.action, modifiers),
    explanation,
    baseline: { from: state.baselineStage, to: baseline, changed: baseline !== state.baselineStage, action: prog.action, reason: prog.reason },
    effectiveStage: effective,
    level: workout.level,
    baselineLevel: levelOfStage(baseline),
    tempApplied: appliedTemp,
    returnRamp: !!ret,
    afterHard: prog.afterHard,
    progressionAllowed: !safety.pauseProgression,
    harderAllowed,
    harderBlockedReason,
    workout,
  };
}

function headlineFor(action, modifiers) {
  if (modifiers.includes('return')) return 'Welcome back: an easy return';
  if (modifiers.includes('recovery')) return 'A gentle day for recovery';
  if (modifiers.includes('easier')) return 'A lighter one today';
  if (modifiers.includes('harder')) return 'A little extra today';
  if (action === 'increase') return 'Small step up today';
  if (action === 'decrease') return 'Resetting to a comfortable base';
  if (modifiers.includes('after_hard')) return 'Taking it a bit easier today';
  return 'Your walk for today';
}

// Persist the baseline change a decision implies. Called when the user starts
// the workout, so browsing the app never changes anything.
export function commitDecision(state, decision, now) {
  let next = { ...state, algorithmVersion: decision.algorithmVersion, lastDecision: summarizeDecision(decision, now) };
  if (decision.baseline.changed) {
    next = {
      ...next,
      baselineStage: decision.baseline.to,
      baselineChangedAt: now,
      baselineLog: [...state.baselineLog, {
        at: now, from: decision.baseline.from, to: decision.baseline.to, source: 'engine', reason: decision.baseline.reason,
      }],
    };
  }
  return next;
}

export function summarizeDecision(decision, now) {
  return {
    at: now, version: decision.algorithmVersion, code: decision.code, modifiers: decision.modifiers ?? [],
    effectiveStage: decision.effectiveStage ?? null, explanation: decision.explanation,
  };
}

// Build the stored record for a finished session and expire the one-time
// adjustments. `session` comes from the active-workout screen.
export function recordWorkout({ state, decision, session, feedback, readiness, now, id }) {
  const plan = decision.workout;
  const done = session.segments.filter((s) => s.completedMinutes > 0 || s.done);
  const record = makeWorkoutRecord({
    workout_id: id,
    date: session.startedAt,
    planned_duration: plan.totalMinutes,
    actual_duration: Math.round(session.elapsedMinutes * 10) / 10,
    planned_intervals: plan.segments.map(({ type, minutes, speed }) => ({ type, minutes, speed })),
    completed_intervals: session.segments.filter((s) => s.done).length,
    planned_work_intervals: plan.workIntervals,
    completed_work_intervals: session.segments.filter((s) => s.type === 'work' && s.done && !s.skipped).length,
    actual_speed_by_interval: done.map((s) => ({ type: s.type, minutes: Math.round(s.completedMinutes * 10) / 10, speed: s.speed, skipped: !!s.skipped })),
    baseline_program_level: levelOfStage(state.baselineStage),
    baseline_stage: state.baselineStage,
    effective_stage: decision.effectiveStage,
    temporary_adjustment: decision.tempApplied,
    pre_workout_energy: readiness.energy,
    recovery_status: readiness.recovery,
    muscle_soreness: feedback.muscle_soreness ?? readiness.soreness ?? 'none',
    perceived_exertion: feedback.perceived_exertion,
    talk_test_result: feedback.talk_test_result,
    post_workout_feeling: feedback.post_workout_feeling,
    rating: feedback.rating,
    ended_early: session.endedEarly,
    stopped_for_safety: session.stoppedForSafety,
    reason_for_shortening_or_skipping: feedback.reason_for_shortening_or_skipping,
    user_feedback: feedback.user_feedback,
    target_exertion: plan.targetExertion,
    algorithm_version: decision.algorithmVersion,
    algorithm_decision: [decision.code, ...(decision.modifiers ?? [])].join('+'),
    algorithm_decision_explanation: decision.explanation.join(' '),
    return_ramp: decision.returnRamp,
  });
  const c = classifyWorkout(record);
  const nextState = {
    ...state,
    tempAdjustment: 'none',
    shortenTo: null,
    lastCompletedAt: record.actual_duration > 0 ? record.date : state.lastCompletedAt,
    lastSuccessfulWorkoutId: c === 'easy' || c === 'appropriate' ? record.workout_id : state.lastSuccessfulWorkoutId,
    readiness: { ...state.readiness, symptoms: [] },
  };
  return { record, state: nextState, classification: c };
}
