// Example user histories and the workout the engine should recommend next.
// These double as documentation: the same table appears in docs/DESIGN.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../js/engine/engine.js';
import { ok, easy, hard, missed, input, workout } from './helpers.js';

const examples = [
  {
    name: 'A. Brand-new user',
    inp: input(),
    expect: { stage: 1, minutes: 13, action: 'maintain', headline: /workout for today/ },
  },
  {
    name: 'B. Two comfortable weeks at level 2 (1x/week)',
    inp: input({ stage: 4, history: [easy(14, 4), easy(7, 4)] }),
    expect: { stage: 5, minutes: 19, action: 'increase' },
  },
  {
    name: 'C. One tough day after steady progress',
    inp: input({ stage: 7, history: [ok(12, 7), ok(6, 7), hard(2, 7)] }),
    expect: { stage: 6, minutes: 19, action: 'maintain', baselineTo: 7 },
  },
  {
    name: 'D. Two tough workouts in a row',
    inp: input({ stage: 9, history: [hard(8, 9), hard(4, 9)] }),
    expect: { stage: 8, minutes: 19, action: 'decrease', baselineTo: 8 },
  },
  {
    name: 'E. Busy month: three sessions missed for time, last walk 20 days ago',
    inp: input({ stage: 6, history: [ok(20, 6), missed(13, 'time'), missed(9, 'time'), missed(2, 'motivation')] }),
    expect: { stage: 5, minutes: 19, action: 'maintain', baselineTo: 6 },
  },
  {
    name: 'F. Six weeks off',
    inp: input({ stage: 8, history: [ok(45, 8)] }),
    expect: { stage: 5, minutes: 15, action: 'maintain', baselineTo: 8 },
  },
  {
    name: 'G. Low energy today',
    inp: input({ stage: 6, history: [ok(4, 6)], readiness: { energy: 'low' } }),
    expect: { stage: 4, minutes: 15, action: 'maintain', baselineTo: 6 },
  },
  {
    name: 'H. Feels great, asks for harder, but slept badly (poor recovery)',
    inp: input({ stage: 6, history: [ok(4, 6)], readiness: { recovery: 'poor', energy: 'high' }, request: { temp: 'harder' } }),
    expect: { stage: 5, action: 'maintain', baselineTo: 6 },
  },
  {
    name: 'I. Chest pain reported',
    inp: input({ stage: 6, history: [ok(4, 6)], readiness: { symptoms: ['chest_pain'] } }),
    expect: { status: 'urgent' },
  },
  {
    name: 'J. Shortened twice for time (neutral), otherwise fine',
    inp: input({ stage: 5, history: [workout({ ago: 9, stage: 5, endedEarly: true, reason: 'time', completedWork: 1 }), workout({ ago: 2, stage: 5, endedEarly: true, reason: 'time', completedWork: 1 })] }),
    expect: { stage: 5, minutes: 19, action: 'maintain' },
  },
];

for (const ex of examples) {
  test(ex.name, () => {
    const d = decide(ex.inp);
    if (ex.expect.status) { assert.equal(d.status, ex.expect.status); return; }
    assert.equal(d.status, 'ok');
    assert.equal(d.effectiveStage, ex.expect.stage, 'stage');
    if (ex.expect.minutes) assert.equal(d.workout.totalMinutes, ex.expect.minutes, 'minutes');
    assert.equal(d.baseline.action, ex.expect.action, 'action');
    if (ex.expect.baselineTo) assert.equal(d.baseline.to, ex.expect.baselineTo, 'baseline');
    if (ex.expect.headline) assert.match(d.headline, ex.expect.headline);
  });
}
