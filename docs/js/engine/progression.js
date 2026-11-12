// ProgressionEngine: decides whether the permanent baseline should go up,
// stay or go down, based only on completed workouts. It never progresses
// because time passed or a session was missed.
//
// Every completed workout that felt about right moves the plan one tiny step
// up (two if it felt too easy). A hard one holds the plan; two hard ones in a
// row step it back by about 12% of workload.

import { RULES, MAX_STAGE, clampStage, levelOfStage, firstStageOfLevel, stageChange } from './config.js';
import { completedWorkouts, after } from './history.js';
import { classifyWorkout } from './feedback.js';
import { stageWorkload } from './generator.js';
import { effectivePreference } from './profile.js';

// Classified workouts since the last permanent change, ignoring 'neutral'
// sessions (cut short for time etc.) which carry no fitness signal.
export function recentSignals(state, history) {
  return after(completedWorkouts(history), state.baselineChangedAt)
    .map((w) => ({ w, c: classifyWorkout(w) }))
    .filter((x) => x.c !== 'neutral');
}

// Highest stage below `stage` whose workload is at least `fraction` lower.
export function reducedStage(stage, fraction = RULES.baselineReduction) {
  const goal = stageWorkload(stage) * (1 - fraction);
  for (let s = stage - 1; s >= 1; s--) if (stageWorkload(s) <= goal) return s;
  return Math.max(1, stage - 1);
}

export function evaluateProgression({ state, history, safety, profile }) {
  const base = state.baselineStage;
  const signals = recentSignals(state, history);
  const keep = (reason, afterHard = false) => ({ action: 'maintain', from: base, to: base, afterHard, reason });

  const hardTail = signals.slice(-RULES.hardStreakToReduce);
  if (hardTail.length === RULES.hardStreakToReduce && hardTail.every((x) => x.c === 'hard')) {
    const to = reducedStage(base);
    return {
      action: 'decrease', from: base, to, afterHard: false,
      reason: `The last ${RULES.hardStreakToReduce} workouts felt too hard, so the plan steps back a bit to rebuild. Your history and medals stay.`,
    };
  }

  const last = signals[signals.length - 1];
  if (!last) {
    return keep(completedWorkouts(history).length
      ? 'Same level as last time: short or skipped sessions do not move the plan.'
      : 'Your first workout: 25 minutes with a fast-walk push. Let\'s go!');
  }
  if (last.c === 'hard' || last.c === 'safety') {
    return keep(last.c === 'safety'
      ? 'Your last workout was stopped early, so today is a bit lighter. Your plan is unchanged.'
      : 'Your last workout felt too hard, so today is a little lighter and the plan holds.', true);
  }

  // Easy days and back-from-a-break days don't push the plan.
  if (last.w.temporary_adjustment === 'easier' || last.w.return_ramp) {
    return keep('Your last workout was a lighter one, so the plan stays where it is.');
  }
  if (safety.pauseProgression) {
    return keep('You are ready for the next step, but it waits until you feel recovered.');
  }
  if (base >= MAX_STAGE) return keep('You are at the top of the program. Beast mode!');

  const steps = last.c === 'easy' ? RULES.stepsWhenTooEasy : RULES.stepsPerWorkout;
  const to = clampStage(base + steps);
  const what = stageChange(to, effectivePreference(profile));
  return {
    action: 'increase', from: base, to, afterHard: false,
    reason: last.c === 'easy'
      ? `Your last workout felt easy, so today jumps two steps: ${what}.`
      : `Nice work last time. Today is a tiny bit harder: ${what}.`,
  };
}

// User-requested permanent change: jump to the start of any level. History
// and medals are always kept.
export function applyPermanentChange({ state, targetLevel, now }) {
  const base = state.baselineStage;
  const curLevel = levelOfStage(base);
  if (targetLevel === curLevel) return { accepted: false, state, message: 'That is already your level.' };
  const to = firstStageOfLevel(targetLevel);
  const entry = { at: now, from: base, to, source: 'user', reason: targetLevel < curLevel ? 'User lowered the program' : 'User raised the program' };
  return {
    accepted: true,
    message: targetLevel < curLevel
      ? `Program lowered to level ${targetLevel}. All your history is kept.`
      : `Program raised to level ${targetLevel}. Let's see what you've got!`,
    state: { ...state, baselineStage: to, baselineChangedAt: now, baselineLog: [...state.baselineLog, entry] },
  };
}
