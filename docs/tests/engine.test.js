import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { decide, commitDecision, recordWorkout } from '../js/engine/engine.js';
import { applyPermanentChange, reducedStage } from '../js/engine/progression.js';
import { generateWorkout, stageWorkload } from '../js/engine/generator.js';
import { classifyWorkout } from '../js/engine/feedback.js';
import { MAX_STAGE, GLOBAL_LIMITS, stageParams, firstStageOfLevel } from '../js/engine/config.js';
import { NOW, workout, easy, ok, hard, missed, input } from './helpers.js';

const fast = (w) => w.segments.filter((s) => s.type === 'work' || s.type === 'run');
const slow = (w) => w.segments.filter((s) => s.type !== 'work' && s.type !== 'run');
const runMinutes = (w) => w.segments.filter((s) => s.type === 'run').reduce((a, s) => a + s.minutes, 0);

describe('the plan', () => {
  test('first workout: 25 min, 3.5-5.5 km/h, at least 2 min at 6 km/h', () => {
    const w = generateWorkout(1);
    assert.equal(w.totalMinutes, 25);
    for (const s of slow(w)) assert.ok(s.speed >= 3.5 && s.speed <= 5.5, `${s.label} ${s.speed}`);
    const fastMin = fast(w).filter((s) => s.speed >= 6).reduce((a, s) => a + s.minutes, 0);
    assert.ok(fastMin >= 2);
  });

  test('every stage is at least 25 minutes and within speed limits', () => {
    for (const pref of ['walk', 'mix', 'run']) {
      for (let s = 1; s <= MAX_STAGE; s++) {
        const w = generateWorkout(s, { preference: pref });
        assert.ok(w.totalMinutes >= 25, `stage ${s}`);
        for (const x of w.segments) {
          assert.ok(x.speed <= (x.type === 'run' ? GLOBAL_LIMITS.maxRunSpeed : GLOBAL_LIMITS.maxWalkSpeed));
        }
        if (pref === 'walk') assert.equal(runMinutes(w), 0, 'walkers never get running in the plan');
      }
    }
  });

  test('each stage changes exactly one thing, by a tiny amount', () => {
    const keys = ['minutes', 'easySpeed', 'fastMinutes', 'fastSpeed'];
    for (let s = 2; s <= MAX_STAGE; s++) {
      const a = stageParams(s - 1), b = stageParams(s);
      const changed = keys.filter((k) => a[k] !== b[k]);
      assert.ok(changed.length <= 1, `stage ${s}: ${changed}`);
      if (b.minutes !== a.minutes) assert.equal(b.minutes - a.minutes, 1);
      if (b.fastMinutes !== a.fastMinutes) assert.equal(b.fastMinutes - a.fastMinutes, 1);
      if (b.fastSpeed !== a.fastSpeed) assert.equal(b.fastSpeed - a.fastSpeed, 0.5);
      if (b.easySpeed !== a.easySpeed) assert.equal(b.easySpeed - a.easySpeed, 0.5);
    }
  });

  test('every speed is a multiple of 0.5 km/h (treadmill steps)', () => {
    for (const pref of ['walk', 'mix', 'run']) {
      for (const mode of ['normal', 'easy', 'advanced']) {
        for (const speedFactor of [1, 1.03, 1.07, 1.12]) {
          for (let s = 1; s <= MAX_STAGE; s++) {
            for (const targetMinutes of [null, 10]) {
              const w = generateWorkout(s, { preference: pref, mode, speedFactor, targetMinutes, extraEasyMinutes: 5 });
              for (const x of w.segments) assert.equal(x.speed * 2, Math.round(x.speed * 2), `${pref} ${mode} stage ${s}: ${x.label} ${x.speed}`);
            }
          }
        }
      }
    }
  });

  test('workload never goes down from one stage to the next', () => {
    for (let s = 2; s <= MAX_STAGE; s++) assert.ok(stageWorkload(s) >= stageWorkload(s - 1) - 1e-9, `stage ${s}`);
  });

  test('tired version: everything 3.5-4.5 km/h, no fast parts', () => {
    for (const stage of [1, 30, 80]) {
      const w = generateWorkout(stage, { mode: 'easy' });
      assert.equal(w.totalMinutes, 25);
      assert.equal(fast(w).length, 0);
      for (const s of w.segments) assert.ok(s.speed >= 3.5 && s.speed <= 4.5, `${s.label} ${s.speed}`);
    }
  });

  test('advanced version: at least 3 min of running, more for advanced plans', () => {
    const first = generateWorkout(1, { mode: 'advanced' });
    assert.ok(runMinutes(first) >= 3);
    assert.ok(fast(first).every((s) => s.type === 'run' && s.speed >= 7));
    const later = generateWorkout(40, { mode: 'advanced' });
    assert.ok(runMinutes(later) > runMinutes(first));
    assert.ok(runMinutes(later) >= generateWorkout(40).fastMinutes);
    assert.ok(later.totalMinutes > generateWorkout(40).totalMinutes);
  });

  test('advanced includes running even for walk-preference users', () => {
    const d = decide(input({ stage: 5, history: [ok(3, 5)], profile: { preference: 'walk' }, request: { temp: 'advanced' } }));
    assert.ok(runMinutes(d.workout) >= 3);
  });

  test('shortening fits 5, 10 and 15 minutes', () => {
    for (const m of [5, 10, 15]) {
      const w = generateWorkout(20, { targetMinutes: m });
      assert.equal(w.totalMinutes, m);
      assert.equal(w.segments[0].type, 'warmup');
      assert.equal(w.segments.at(-1).type, 'cooldown');
    }
  });
});

describe('progression: a tiny bit harder every workout', () => {
  test('first-ever workout is stage 1', () => {
    const d = decide(input());
    assert.equal(d.effectiveStage, 1);
    assert.equal(d.workout.totalMinutes, 25);
    assert.ok(d.explanation.length > 0);
  });

  test('one workout that felt about right → one step up', () => {
    const d = decide(input({ stage: 1, history: [ok(2, 1)] }));
    assert.equal(d.baseline.action, 'increase');
    assert.equal(d.baseline.to, 2);
    assert.equal(d.effectiveStage, 2);
    assert.equal(d.workout.totalMinutes, 26);
  });

  test('"too easy" → two steps up', () => {
    assert.equal(decide(input({ stage: 5, history: [easy(2, 5)] })).baseline.to, 7);
  });

  test('a step is only taken once per workout', () => {
    const inp = input({ stage: 1, history: [ok(2, 1)] });
    const d = decide(inp);
    const state = commitDecision(inp.state, d, NOW);
    const again = decide({ ...inp, state });
    assert.equal(again.baseline.changed, false);
    assert.equal(again.effectiveStage, 2);
  });

  test('one hard workout holds the plan and makes today a bit lighter', () => {
    const d = decide(input({ stage: 10, history: [ok(9, 10), hard(2, 10)] }));
    assert.equal(d.baseline.action, 'maintain');
    assert.equal(d.baseline.to, 10);
    assert.equal(d.effectiveStage, 8);
  });

  test('two hard workouts step the plan back ~12%', () => {
    const d = decide(input({ stage: 30, history: [hard(6, 30), hard(2, 30)] }));
    assert.equal(d.baseline.action, 'decrease');
    assert.equal(d.baseline.to, reducedStage(30));
    const drop = 1 - stageWorkload(d.baseline.to) / stageWorkload(30);
    assert.ok(drop >= 0.1 && drop <= 0.25, `drop ${drop}`);
  });

  test('a workout cut short for time does not move the plan', () => {
    const w = workout({ ago: 1, stage: 4, endedEarly: true, reason: 'time', completedWork: 0, rpe: 3 });
    assert.equal(classifyWorkout(w), 'neutral');
    assert.equal(decide(input({ stage: 4, history: [w] })).baseline.action, 'maintain');
  });

  test('high effort counts as hard even if completed', () => {
    assert.equal(classifyWorkout(workout({ ago: 1, stage: 4, rating: 'appropriate', rpe: 9 })), 'hard');
  });

  test('stops at the top of the program', () => {
    assert.equal(decide(input({ stage: MAX_STAGE, history: [ok(2, MAX_STAGE)] })).baseline.to, MAX_STAGE);
  });
});

describe('easy and advanced days only change today', () => {
  test('tired: easy version, plan unchanged, expires after the workout', () => {
    const inp = input({ stage: 12, history: [ok(4, 12)], state: { baselineChangedAt: NOW }, request: { temp: 'easier' } });
    const d = decide(inp);
    assert.equal(d.mode, 'easy');
    assert.equal(d.baseline.to, 12);
    const session = { startedAt: NOW, elapsedMinutes: 25, endedEarly: false, stoppedForSafety: false,
      segments: d.workout.segments.map((s) => ({ ...s, done: true, completedMinutes: s.minutes })) };
    const { state, record } = recordWorkout({ state: { ...inp.state, tempAdjustment: 'easier' }, decision: d, session, feedback: { rating: 'appropriate', perceived_exertion: 4 }, readiness: inp.readiness, now: NOW, id: 'x' });
    assert.equal(state.tempAdjustment, 'none');
    assert.equal(state.baselineStage, 12);
    // and an easy day does not push the plan up afterwards
    const next = decide(input({ stage: 12, history: [record], state: { baselineChangedAt: '2026-10-01T00:00:00Z' } }));
    assert.equal(next.baseline.to, 12);
  });

  test('low energy automatically gives the easy version', () => {
    const d = decide(input({ stage: 12, history: [ok(4, 12)], readiness: { energy: 'low' } }));
    assert.equal(d.mode, 'easy');
    for (const s of d.workout.segments) assert.ok(s.speed <= 4.5);
  });

  test('advanced replaces today only; the plan does not jump', () => {
    const inp = input({ stage: 12, history: [ok(4, 12)], state: { baselineChangedAt: NOW }, request: { temp: 'advanced' } });
    const d = decide(inp);
    assert.equal(d.mode, 'advanced');
    assert.equal(d.baseline.changed, false);
    assert.equal(d.tempApplied, 'advanced');
    assert.ok(runMinutes(d.workout) >= 3);
  });

  test('finishing an advanced workout counts like a normal one (one step)', () => {
    const w = ok(2, 12, { temp: 'advanced' });
    assert.equal(decide(input({ stage: 12, history: [w] })).baseline.to, 13);
  });

  test('old saved "harder" requests become advanced', () => {
    assert.equal(decide(input({ stage: 3, request: { temp: 'harder' } })).mode, 'advanced');
  });
});

describe('breaks and missed sessions', () => {
  test('missing sessions for scheduling changes nothing', () => {
    const d = decide(input({ stage: 20, history: [ok(9, 20), missed(6, 'time'), missed(3, 'motivation')], state: { baselineChangedAt: NOW } }));
    assert.equal(d.effectiveStage, 20);
    assert.equal(d.baseline.changed, false);
  });

  test('a session missed because it was too hard makes today lighter', () => {
    const d = decide(input({ stage: 20, history: [ok(9, 20), missed(3, 'too_difficult')], state: { baselineChangedAt: NOW } }));
    assert.equal(d.effectiveStage, 18);
  });

  test('15-30 days off: a few steps back for today, plan kept', () => {
    const d = decide(input({ stage: 20, history: [ok(20, 20)], state: { baselineChangedAt: NOW } }));
    assert.equal(d.effectiveStage, 17);
    assert.equal(d.baseline.to, 20);
    assert.equal(d.returnRamp, true);
  });

  test('over 30 days off: bigger step back, 25 minutes', () => {
    const d = decide(input({ stage: 40, history: [ok(60, 40)], state: { baselineChangedAt: NOW } }));
    assert.equal(d.effectiveStage, 32);
    assert.equal(d.workout.totalMinutes, 25);
    assert.equal(d.baseline.to, 40);
  });
});

describe('recovery and safety', () => {
  test('poor recovery: easy version and no step up', () => {
    const d = decide(input({ stage: 10, history: [ok(3, 10)], readiness: { recovery: 'poor' } }));
    assert.equal(d.mode, 'easy');
    assert.equal(d.baseline.changed, false);
    assert.equal(d.progressionAllowed, false);
  });

  test('red-flag symptoms stop everything', () => {
    const d = decide(input({ stage: 10, readiness: { symptoms: ['chest_pain'] }, request: { temp: 'advanced' } }));
    assert.equal(d.status, 'urgent');
    assert.equal(d.workout, null);
  });

  test('every recommendation explains itself', () => {
    const cases = [input(), input({ stage: 6, history: [hard(3, 6)] }), input({ stage: 3, history: [ok(40, 3)] }),
      input({ request: { temp: 'advanced' } }), input({ stage: 4, history: [easy(5, 4)] })];
    for (const c of cases) assert.ok(decide(c).explanation.every((s) => typeof s === 'string' && s.length > 10));
  });

  test('same inputs always give the same decision', () => {
    const history = [ok(20, 4), easy(10, 5), hard(3, 7), missed(1, 'time')];
    const a = decide(input({ stage: 7, history, request: { temp: 'advanced' } }));
    const b = decide(input({ stage: 7, history, request: { temp: 'advanced' } }));
    assert.deepEqual(a, b);
  });
});

describe('permanent level change', () => {
  test('jumps to the start of the chosen level and keeps history', () => {
    const inp = input({ stage: 25, history: [ok(3, 25)] });
    const res = applyPermanentChange({ state: inp.state, targetLevel: 1, now: NOW });
    assert.equal(res.accepted, true);
    assert.equal(res.state.baselineStage, 1);
    const up = applyPermanentChange({ state: inp.state, targetLevel: 5, now: NOW });
    assert.equal(up.state.baselineStage, firstStageOfLevel(5));
    assert.equal(decide({ ...inp, state: res.state }).effectiveStage, 1);
  });
});
