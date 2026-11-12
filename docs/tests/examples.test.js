// Example user histories and the workout the engine should recommend next.
// These double as documentation: the same table appears in docs/DESIGN.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../js/engine/engine.js';
import { ok, easy, hard, missed, input, workout } from './helpers.js';

const runMin = (w) => w.segments.filter((s) => s.type === 'run').reduce((a, s) => a + s.minutes, 0);

const examples = [
  { name: 'A. Brand-new user', inp: input(), expect: { stage: 1, minutes: 25, mode: 'normal', action: 'maintain' } },
  { name: 'B. Did the first workout, felt about right', inp: input({ stage: 1, history: [ok(3, 1)] }), expect: { stage: 2, minutes: 26, action: 'increase' } },
  { name: 'C. Rated the last one "too easy"', inp: input({ stage: 10, history: [easy(3, 10)] }), expect: { stage: 12, action: 'increase' } },
  { name: 'D. One tough day', inp: input({ stage: 20, history: [ok(9, 20), hard(2, 20)] }), expect: { stage: 18, action: 'maintain', baselineTo: 20 } },
  { name: 'E. Two tough days in a row', inp: input({ stage: 30, history: [hard(6, 30), hard(2, 30)] }), expect: { action: 'decrease' } },
  { name: 'F. Tired today', inp: input({ stage: 20, history: [ok(4, 20)], readiness: { energy: 'low' } }), expect: { mode: 'easy', minutes: 25, maxSpeed: 4.5 } },
  { name: 'G. Full of energy: advanced', inp: input({ stage: 20, history: [ok(4, 20)], request: { temp: 'advanced' } }), expect: { mode: 'advanced', minRun: 3 } },
  { name: 'H. Three weeks off', inp: input({ stage: 20, history: [ok(21, 20), missed(10, 'time')] }), expect: { stage: 17, baselineTo: 21 } },  // the workout before the break still counts as a step
  { name: 'I. Two months off', inp: input({ stage: 40, history: [ok(60, 40)] }), expect: { stage: 32, minutes: 25, baselineTo: 42 } },  // ...and it felt easy for that level
  { name: 'J. Cut short for time twice', inp: input({ stage: 15, history: [workout({ ago: 9, stage: 15, endedEarly: true, reason: 'time', completedWork: 0 }), workout({ ago: 2, stage: 15, endedEarly: true, reason: 'time', completedWork: 0 })] }), expect: { stage: 15, action: 'maintain' } },
];

for (const ex of examples) {
  test(ex.name, () => {
    const d = decide(ex.inp);
    const e = ex.expect;
    assert.equal(d.status, 'ok');
    if (e.stage) assert.equal(d.effectiveStage, e.stage, 'stage');
    if (e.minutes) assert.equal(d.workout.totalMinutes, e.minutes, 'minutes');
    if (e.mode) assert.equal(d.mode, e.mode, 'mode');
    if (e.action) assert.equal(d.baseline.action, e.action, 'action');
    if (e.baselineTo) assert.equal(d.baseline.to, e.baselineTo, 'baseline');
    if (e.maxSpeed) assert.ok(d.workout.segments.every((s) => s.speed <= e.maxSpeed));
    if (e.minRun) assert.ok(runMin(d.workout) >= e.minRun);
  });
}
