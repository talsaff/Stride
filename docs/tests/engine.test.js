import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { decide, commitDecision, recordWorkout } from '../js/engine/engine.js';
import { applyPermanentChange, reducedStage } from '../js/engine/progression.js';
import { generateWorkout, stageWorkload, naturalMinutes } from '../js/engine/generator.js';
import { classifyWorkout } from '../js/engine/feedback.js';
import { assessReadiness } from '../js/engine/readiness.js';
import { evaluateSafety } from '../js/engine/safety.js';
import { STAGES, MAX_STAGE, LEVELS, GLOBAL_LIMITS } from '../js/engine/config.js';
import { NOW, daysAgo, workout, easy, ok, hard, missed, input } from './helpers.js';

describe('configuration', () => {
  test('adjacent stages change exactly one primary workload variable', () => {
    const keys = ['comfort', 'brisk', 'run', 'n', 'work', 'rec', 'steady'];
    for (let s = 2; s <= MAX_STAGE; s++) {
      const a = STAGES[s - 1], b = STAGES[s];
      const diff = keys.filter((k) => a[k] !== b[k]);
      if (!a.brisk && b.brisk) continue; // introducing pace changes is its own single step
      if (!a.run && b.run) continue;     // switching to the first jogs is its own single step
      // Fewer-but-longer intervals is one change of interval structure.
      const primary = new Set(diff.map((k) => (k === 'work' || k === 'rec' || k === 'n' ? 'structure' : k)));
      assert.equal(primary.size, 1, `stage ${s - 1} → ${s} changes ${diff.join(', ')}`);
    }
  });

  test('every stage fits inside its level limits', () => {
    for (let s = 1; s <= MAX_STAGE; s++) {
      const w = generateWorkout(s);
      const lim = LEVELS[w.level];
      assert.ok(w.totalMinutes >= lim.totalMinutes[0] && w.totalMinutes <= lim.totalMinutes[1], `stage ${s} duration`);
      for (const seg of w.segments) {
        if (seg.type === 'run') assert.ok(lim.run && seg.speed <= GLOBAL_LIMITS.maxRunSpeed, 'jogs only on running levels');
        else assert.ok(seg.speed <= GLOBAL_LIMITS.maxWalkSpeed, 'walking speeds');
        if (seg.type === 'work' || seg.type === 'run') assert.ok(seg.speed >= lim.briskSpeed[0] && seg.speed <= lim.briskSpeed[1], `stage ${s} speed`);
      }
      assert.ok(w.targetExertion[1] <= 7, 'never prescribes all-out effort');
    }
  });

  test('workload grows monotonically up the ladder', () => {
    for (let s = 2; s <= MAX_STAGE; s++) {
      if (s === 16) continue; // first jogs: a new kind of workload, not more of the same
      assert.ok(stageWorkload(s) >= stageWorkload(s - 1) - 1e-9, `stage ${s}`);
    }
  });
});

describe('workout generation', () => {
  test('first-ever workout is a short comfortable walk with warm-up and cool-down', () => {
    const d = decide(input());
    assert.equal(d.status, 'ok');
    assert.equal(d.effectiveStage, 1);
    const types = d.workout.segments.map((s) => s.type);
    assert.deepEqual(types, ['warmup', 'steady', 'cooldown']);
    assert.equal(d.workout.totalMinutes, 13);
    assert.ok(d.explanation.length > 0);
  });

  test('shortening recalculates intervals to fit 5, 10 and 15 minutes', () => {
    for (const m of [5, 10, 15]) {
      const w = generateWorkout(9, { targetMinutes: m });
      assert.equal(w.totalMinutes, m);
      assert.equal(w.segments[0].type, 'warmup');
      assert.equal(w.segments.at(-1).type, 'cooldown');
    }
    assert.equal(generateWorkout(9, { targetMinutes: 10 }).workIntervals, 1);
  });

  test('shortening never makes a workout longer than its natural length', () => {
    assert.equal(generateWorkout(1, { targetMinutes: 30 }).totalMinutes, naturalMinutes(1));
  });

  test('shorten request through decide()', () => {
    const d = decide(input({ stage: 6, history: [ok(3, 6)], request: { shortenTo: 10 } }));
    assert.equal(d.workout.totalMinutes, 10);
    assert.equal(d.baseline.changed, false);
  });
});

describe('determinism', () => {
  test('same inputs and history give the same decision', () => {
    const history = [ok(20, 4), easy(10, 5), hard(3, 5), missed(1, 'time')];
    const a = decide(input({ stage: 5, history, readiness: { energy: 'high' }, request: { temp: 'harder' } }));
    const b = decide(input({ stage: 5, history, readiness: { energy: 'high' }, request: { temp: 'harder' } }));
    assert.deepEqual(a, b);
  });
});

describe('temporary adjustments', () => {
  test('easier day lowers today only, not the baseline', () => {
    const inp = input({ stage: 6, history: [ok(4, 6)], request: { temp: 'easier' } });
    const d = decide(inp);
    assert.equal(d.effectiveStage, 4);
    assert.equal(d.baseline.to, 6);
    assert.equal(d.tempApplied, 'easier');
    const committed = commitDecision({ ...inp.state, tempAdjustment: 'easier' }, d, NOW);
    assert.equal(committed.baselineStage, 6);
  });

  test('temporary adjustment expires after the workout', () => {
    const inp = input({ stage: 6, history: [ok(4, 6)], state: { tempAdjustment: 'easier', shortenTo: 10 } });
    const d = decide(inp);
    const session = { startedAt: NOW, elapsedMinutes: 10, endedEarly: false, stoppedForSafety: false,
      segments: d.workout.segments.map((s) => ({ ...s, done: true, completedMinutes: s.minutes })) };
    const { state } = recordWorkout({ state: inp.state, decision: d, session, feedback: { rating: 'appropriate', perceived_exertion: 3 }, readiness: inp.readiness, now: NOW, id: 'x' });
    assert.equal(state.tempAdjustment, 'none');
    assert.equal(state.shortenTo, null);
    assert.equal(state.baselineStage, 6);
  });

  test('low energy automatically gives a lighter one-off day', () => {
    const d = decide(input({ stage: 6, history: [ok(4, 6)], readiness: { energy: 'low' } }));
    assert.equal(d.effectiveStage, 4);
    assert.equal(d.baseline.changed, false);
    assert.equal(d.harderAllowed, false);
  });

  test('harder day is a modest one-stage bump and does not change the baseline', () => {
    const d = decide(input({ stage: 5, history: [ok(4, 5)], readiness: { energy: 'high' }, request: { temp: 'harder' } }));
    assert.equal(d.effectiveStage, 6);
    assert.equal(d.baseline.to, 5);
    assert.equal(d.tempApplied, 'harder');
  });

  test('harder request is refused when recovery is poor', () => {
    const d = decide(input({ stage: 5, history: [ok(4, 5)], readiness: { recovery: 'poor' }, request: { temp: 'harder' } }));
    assert.ok(d.effectiveStage < 5);
    assert.equal(d.harderAllowed, false);
    assert.ok(d.modifiers.includes('harder_refused'));
  });

  test('harder request cannot go past the top of a walking-only program', () => {
    const d = decide(input({ stage: 15, history: [ok(4, 15)], request: { temp: 'harder' } }));
    assert.equal(d.effectiveStage, 15);
    assert.equal(d.harderAllowed, false);
    const runner = decide(input({ stage: 15, history: [ok(4, 15)], profile: { preference: 'run' }, request: { temp: 'harder' } }));
    assert.equal(runner.effectiveStage, 16);
  });
});

describe('permanent adjustments', () => {
  const ctx = (inp) => {
    const assessment = assessReadiness(inp);
    return { assessment, safety: evaluateSafety(assessment, inp.profile) };
  };

  test('lowering the program affects future workouts and keeps history', () => {
    const history = [ok(10, 8), ok(3, 8)];
    const inp = input({ stage: 8, history });
    const res = applyPermanentChange({ ...inp, ...ctx(inp), targetLevel: 2 });
    assert.equal(res.accepted, true);
    assert.equal(res.state.baselineStage, 5); // same position within level 2
    assert.equal(res.state.baselineLog.length, 1);
    const next = decide({ ...inp, state: res.state });
    assert.equal(next.effectiveStage, 5);
    assert.equal(history.length, 2);
  });

  test('raising goes one level up to its gentlest stage', () => {
    const inp = input({ stage: 5, history: [ok(3, 5)] });
    const res = applyPermanentChange({ ...inp, ...ctx(inp), targetLevel: 3 });
    assert.equal(res.accepted, true);
    assert.equal(res.state.baselineStage, 7);
    assert.equal(decide({ ...inp, state: res.state }).effectiveStage, 7);
  });

  test('raising two levels at once is refused', () => {
    const inp = input({ stage: 2, history: [ok(3, 2)] });
    assert.equal(applyPermanentChange({ ...inp, ...ctx(inp), targetLevel: 3 }).accepted, false);
  });

  test('raising is refused when recovery is poor (safety overrides request)', () => {
    const inp = input({ stage: 5, history: [ok(3, 5)], readiness: { recovery: 'poor' } });
    const res = applyPermanentChange({ ...inp, ...ctx(inp), targetLevel: 3 });
    assert.equal(res.accepted, false);
    assert.equal(res.state.baselineStage, 5);
  });

  test('levels with running need a running preference', () => {
    const inp = input({ stage: 15, history: [ok(3, 15)] });
    assert.equal(applyPermanentChange({ ...inp, ...ctx(inp), targetLevel: 6 }).accepted, false);
    const runner = input({ stage: 15, history: [ok(3, 15)], profile: { preference: 'run' } });
    assert.equal(applyPermanentChange({ ...runner, ...ctx(runner), targetLevel: 6 }).accepted, true);
  });

  test('levels 4 and 5 need no extra permission', () => {
    const inp = input({ stage: 8, history: [ok(3, 8)] });
    assert.equal(applyPermanentChange({ ...inp, ...ctx(inp), targetLevel: 4 }).accepted, true);
  });
});

describe('missed workouts and returning after a break', () => {
  test('missing sessions for scheduling does not lower the fitness estimate', () => {
    const history = [ok(9, 6), missed(6, 'time'), missed(3, 'motivation')];
    const d = decide(input({ stage: 6, history }));
    assert.equal(d.effectiveStage, 6);
    assert.equal(d.baseline.changed, false);
  });

  test('skipping never triggers progression', () => {
    const history = [ok(9, 6), missed(6, 'time'), missed(4, 'time'), missed(2, 'time')];
    assert.equal(decide(input({ stage: 6, history })).baseline.action, 'maintain');
  });

  test('a session missed because it was too hard makes the next one a bit lighter', () => {
    const d = decide(input({ stage: 6, history: [ok(9, 6), missed(3, 'too_difficult')] }));
    assert.equal(d.effectiveStage, 5);
    assert.equal(d.baseline.changed, false);
  });

  test('up to 14 days: resume the usual level', () => {
    assert.equal(decide(input({ stage: 6, history: [ok(14, 6)] })).effectiveStage, 6);
  });

  test('15-30 days: modestly lighter return, baseline kept', () => {
    const d = decide(input({ stage: 6, history: [ok(20, 6)] }));
    assert.equal(d.effectiveStage, 5);
    assert.equal(d.returnRamp, true);
    assert.equal(d.baseline.to, 6);
  });

  test('over 30 days: short easy return workout, not a reset', () => {
    const d = decide(input({ stage: 9, history: [ok(60, 9)] }));
    assert.equal(d.effectiveStage, 6);
    assert.ok(d.workout.totalMinutes <= 15);
    assert.equal(d.baseline.to, 9);
    assert.equal(d.harderAllowed, false);
  });

  test('return ramp steps back up one stage per comfortable session', () => {
    const history = [ok(60, 9), ok(5, 6, { ramp: true, baseline: 9 })];
    const d = decide(input({ stage: 9, history }));
    assert.equal(d.effectiveStage, 7);
    assert.equal(d.returnRamp, true);
    const done = [...history, ok(2, 8, { ramp: true, baseline: 9 })];
    const back = decide(input({ stage: 9, history: done }));
    assert.equal(back.effectiveStage, 9);
    assert.equal(back.returnRamp, false);
  });
});

describe('performance-based progression', () => {
  test('one difficult workout makes only the next workout easier', () => {
    const d = decide(input({ stage: 6, history: [ok(10, 6), hard(3, 6)] }));
    assert.equal(d.effectiveStage, 5);
    assert.equal(d.baseline.changed, false);
  });

  test('two consecutive difficult workouts reduce the baseline by ~10-15%', () => {
    const d = decide(input({ stage: 9, history: [hard(7, 9), hard(3, 9)] }));
    assert.equal(d.baseline.action, 'decrease');
    const drop = 1 - stageWorkload(d.baseline.to) / stageWorkload(9);
    assert.ok(drop >= 0.1 && drop <= 0.3, `drop ${drop}`);
    assert.equal(d.baseline.to, reducedStage(9));
  });

  test('after a reduction is committed, the same hard sessions are not counted again', () => {
    const inp = input({ stage: 9, history: [hard(7, 9), hard(3, 9)] });
    const d = decide(inp);
    const state = commitDecision(inp.state, d, NOW);
    const again = decide({ ...inp, state });
    assert.equal(again.baseline.changed, false);
    assert.equal(again.effectiveStage, state.baselineStage);
  });

  test('appropriate workouts maintain the level', () => {
    const d = decide(input({ stage: 4, history: [ok(10, 4), ok(5, 4), ok(2, 4)] }));
    assert.equal(d.baseline.action, 'maintain');
    assert.equal(d.effectiveStage, 4);
  });

  test('two comfortable workouts trigger a one-stage progression', () => {
    const d = decide(input({ stage: 4, history: [easy(8, 4), easy(3, 4)] }));
    assert.equal(d.baseline.action, 'increase');
    assert.equal(d.baseline.to, 5);
    assert.equal(d.effectiveStage, 5);
  });

  test('easy sessions done on an easier day do not count toward progression', () => {
    const d = decide(input({ stage: 4, history: [easy(8, 2, { temp: 'easier', baseline: 4 }), easy(3, 2, { temp: 'easier', baseline: 4 })] }));
    assert.equal(d.baseline.action, 'maintain');
  });

  test('a completed workout is not automatically a success: high exertion counts as hard', () => {
    const w = workout({ ago: 1, stage: 4, rating: 'appropriate', rpe: 8 });
    assert.equal(classifyWorkout(w), 'hard');
  });

  test('a workout cut short for time is not a fitness signal', () => {
    const w = workout({ ago: 1, stage: 4, endedEarly: true, reason: 'time', completedWork: 1, rpe: 3 });
    assert.equal(classifyWorkout(w), 'neutral');
    const d = decide(input({ stage: 4, history: [w] }));
    assert.equal(d.effectiveStage, 4);
  });

  test('progression stops at the top of a walking-only program', () => {
    const d = decide(input({ stage: 15, history: [easy(8, 15), easy(3, 15)] }));
    assert.equal(d.baseline.action, 'maintain');
    const runner = decide(input({ stage: 15, history: [easy(8, 15), easy(3, 15)], profile: { preference: 'run' } }));
    assert.equal(runner.baseline.to, 16);
  });
});

describe('safety overrides', () => {
  test('red-flag symptoms stop everything, even a harder request', () => {
    const d = decide(input({ stage: 6, history: [easy(8, 6), easy(3, 6)], readiness: { symptoms: ['chest_pain'] }, request: { temp: 'harder' } }));
    assert.equal(d.status, 'urgent');
    assert.equal(d.workout, null);
    assert.match(d.explanation[0], /medical help/);
  });

  test('dizziness or significant pain means rest today', () => {
    const d = decide(input({ stage: 6, history: [ok(3, 6)], readiness: { symptoms: ['dizziness'] } }));
    assert.equal(d.status, 'rest');
    assert.equal(d.workout, null);
  });

  test('poor recovery pauses progression even after comfortable workouts', () => {
    const d = decide(input({ stage: 4, history: [easy(8, 4), easy(3, 4)], readiness: { recovery: 'poor' } }));
    assert.equal(d.baseline.changed, false);
    assert.equal(d.progressionAllowed, false);
    assert.ok(d.effectiveStage < 4);
  });

  test('feeling wiped out repeatedly pauses progression', () => {
    const history = [ok(10, 4, { feeling: 'exhausted' }), missed(5, 'low_energy')];
    const d = decide(input({ stage: 4, history }));
    assert.equal(d.progressionAllowed, false);
    assert.doesNotMatch(d.safetyNotes.join(' '), /doctor|anemia|clearance/i);
  });

  test('a safety stop is not treated as a failure or a hard signal', () => {
    const w = workout({ ago: 2, stage: 6, endedEarly: true, safetyStop: true, reason: 'pain', completedWork: 0 });
    assert.equal(classifyWorkout(w), 'safety');
    const d = decide(input({ stage: 6, history: [ok(9, 6), w] }));
    assert.equal(d.baseline.changed, false);
  });

  test('every recommendation includes an explanation', () => {
    const cases = [input(), input({ stage: 6, history: [hard(3, 6)] }), input({ stage: 3, history: [ok(40, 3)] }),
      input({ readiness: { symptoms: ['pain'] } }), input({ stage: 4, history: [easy(5, 4), easy(2, 4)] })];
    for (const c of cases) {
      const d = decide(c);
      assert.ok(d.explanation.length > 0 && d.explanation.every((s) => typeof s === 'string' && s.length > 10));
    }
  });
});

test('works at one workout per week', () => {
  const history = [ok(28, 4), easy(21, 4), easy(14, 4)];
  const d = decide(input({ stage: 4, history }));
  assert.equal(d.baseline.action, 'increase');
  assert.equal(d.returnRamp, false);
  assert.equal(daysAgo(0), NOW);
});
