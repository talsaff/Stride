// ProgressionEngine: decides whether the permanent baseline should increase,
// stay the same or decrease, based only on performance at the current
// baseline. It never progresses because time passed or a session was missed.

import { RULES, MAX_STAGE, clampStage, levelOfStage, firstStageOfLevel, lastStageOfLevel, STAGES } from './config.js';
import { completedWorkouts, after } from './history.js';
import { classifyWorkout } from './feedback.js';
import { stageWorkload } from './generator.js';
import { maxStageAllowed } from './safety.js';

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
  const tail = (n) => signals.slice(-n);

  const hardTail = tail(RULES.hardStreakToReduce);
  if (hardTail.length === RULES.hardStreakToReduce && hardTail.every((x) => x.c === 'hard')) {
    const to = reducedStage(base);
    return {
      action: 'decrease', from: base, to, afterHard: false,
      reason: `The last ${RULES.hardStreakToReduce} workouts felt harder than intended, so your program is lowered by about ` +
        `${Math.round(RULES.baselineReduction * 100)}% to rebuild a comfortable base. Your history and achievements stay.`,
    };
  }

  const last = signals[signals.length - 1];
  if (last && (last.c === 'hard' || last.c === 'safety')) {
    return {
      action: 'maintain', from: base, to: base, afterHard: true,
      reason: last.c === 'safety'
        ? 'Your last workout was stopped for your wellbeing. Today is a bit lighter; your program level is unchanged.'
        : 'Your last workout felt harder than intended. One tough day is not a lost fitness, so only today is a bit lighter.',
    };
  }

  // Only workouts actually performed at the current baseline count as
  // evidence that the baseline is too easy.
  const atBase = signals.filter((x) => x.w.effective_stage === base && x.w.temporary_adjustment !== 'easier');
  const easyTail = atBase.slice(-RULES.easyStreakToProgress);
  const lastIsEasy = last && last.c === 'easy';
  const readyToProgress =
    lastIsEasy &&
    atBase[atBase.length - 1] === last &&
    easyTail.length === RULES.easyStreakToProgress &&
    easyTail.every((x) => x.c === 'easy' && x.w.recovery_status !== 'poor');

  if (readyToProgress) {
    if (safety.pauseProgression) {
      return { action: 'maintain', from: base, to: base, afterHard: false, reason: 'You are ready for a small step up, but it is on hold until recovery is back to normal.' };
    }
    const cap = maxStageAllowed(profile);
    if (base >= MAX_STAGE) {
      return { action: 'maintain', from: base, to: base, afterHard: false, reason: 'You are at the top of the program. Keep enjoying it!' };
    }
    if (base + 1 > cap) {
      return { action: 'maintain', from: base, to: base, afterHard: false, reason: 'You are ready for more, but the next level needs medical clearance first (see Settings).' };
    }
    const to = base + 1;
    return {
      action: 'increase', from: base, to, afterHard: false,
      reason: `Your last ${RULES.easyStreakToProgress} workouts at this level felt comfortable, so one thing goes up a little: ${STAGES[to].changed}.`,
    };
  }

  return {
    action: 'maintain', from: base, to: base, afterHard: false,
    reason: signals.length
      ? 'Recent workouts felt about right, so your program stays where it is.'
      : 'Your program stays at its current level until there is feedback to learn from.',
  };
}

// User-requested permanent change. Lowering is always allowed. Raising is
// conservative (one level at a time, to that level's first stage) and is
// refused when safety, recovery, a return after a break or recent hard
// sessions say otherwise.
export function applyPermanentChange({ state, profile, targetLevel, assessment, safety, decisionContext = {}, now }) {
  const base = state.baselineStage;
  const curLevel = levelOfStage(base);
  if (targetLevel === curLevel) return { accepted: false, state, message: 'That is already your level.' };

  let to;
  if (targetLevel < curLevel) {
    const offset = base - firstStageOfLevel(curLevel);
    to = clampStage(Math.min(firstStageOfLevel(targetLevel) + offset, lastStageOfLevel(targetLevel)));
  } else {
    if (targetLevel > curLevel + 1) {
      return { accepted: false, state, message: 'To keep things sustainable, the program can be raised one level at a time.' };
    }
    if (safety.status !== 'ok' || safety.pauseProgression) {
      return { accepted: false, state, message: 'Not today: recovery or symptoms come first. You can raise the level once you are feeling back to normal.' };
    }
    if (decisionContext.returnRamp) {
      return { accepted: false, state, message: 'You are easing back in after a break. Once you are back at your usual level you can raise it.' };
    }
    if (decisionContext.afterHard) {
      return { accepted: false, state, message: 'Your last workout felt harder than intended. Let us see how the next one goes first.' };
    }
    if (targetLevel > levelOfStage(maxStageAllowed(profile))) {
      return { accepted: false, state, message: 'Levels 4 and 5 need you to confirm medical clearance in Settings first.' };
    }
    to = firstStageOfLevel(targetLevel);
  }

  const entry = { at: now, from: base, to, source: 'user', reason: targetLevel < curLevel ? 'User lowered the program' : 'User raised the program' };
  return {
    accepted: true,
    message: targetLevel < curLevel
      ? `Program lowered to level ${targetLevel}. All your history is kept.`
      : `Program raised to level ${targetLevel}. Future workouts start at the gentle end of it.`,
    state: { ...state, baselineStage: to, baselineChangedAt: now, baselineLog: [...state.baselineLog, entry] },
  };
}
