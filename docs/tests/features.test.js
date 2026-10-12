import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { decide } from '../js/engine/engine.js';
import { startingStage, speedFactor, maxStage, effectivePreference, isProfileComplete } from '../js/engine/profile.js';
import { generateWorkout } from '../js/engine/generator.js';
import { evaluateMedals, newlyEarned, weeklyStreak } from '../js/engine/medals.js';
import { planSchedule, conflictsOf, pendingMissed, markDone, nextSession, toICS, funnyLine, eventTitle, FUNNY } from '../js/engine/schedule.js';
import { LAST_WALKING_STAGE, MAX_STAGE } from '../js/engine/config.js';
import { NOW, daysAgo, ok, input } from './helpers.js';

const person = (p) => ({ name: 'Sam', age: 25, gender: 'na', heightCm: 170, weightKg: 70, fitness: 'some', preference: 'walk', goal: 'endurance', ...p });

describe('runner profile shapes the plan', () => {
  test('starting level follows fitness and preference', () => {
    assert.equal(startingStage(person({ fitness: 'low' })), 1);
    assert.ok(startingStage(person({ fitness: 'fit', preference: 'run' })) >= 16);
    assert.ok(startingStage(person({ fitness: 'regular' })) > startingStage(person({ fitness: 'some' })));
  });

  test('older age and higher BMI start more gently', () => {
    const base = startingStage(person({ fitness: 'regular' }));
    assert.ok(startingStage(person({ fitness: 'regular', age: 62 })) < base);
    assert.ok(startingStage(person({ fitness: 'regular', weightKg: 105 })) < base);
  });

  test('walkers never get running stages; runners can reach the top', () => {
    assert.equal(maxStage(person({ preference: 'walk' })), LAST_WALKING_STAGE);
    assert.equal(maxStage(person({ preference: 'run' })), MAX_STAGE);
    assert.equal(effectivePreference(person({ preference: 'mix', goal: 'run5k' })), 'run');
    assert.ok(startingStage(person({ fitness: 'fit', preference: 'walk' })) <= LAST_WALKING_STAGE);
  });

  test('speeds scale with height, age and BMI, within limits', () => {
    const tall = speedFactor(person({ heightCm: 190 }));
    const short = speedFactor(person({ heightCm: 150 }));
    assert.ok(tall > 1 && short < 1);
    assert.ok(speedFactor(person({ age: 65 })) < speedFactor(person({ age: 25 })));
    assert.ok(speedFactor(person({ weightKg: 110 })) < speedFactor(person()));
    assert.ok(speedFactor(person({ heightCm: 230, fitness: 'fit' })) <= 1.12);
    assert.ok(speedFactor(person({ heightCm: 120, age: 90, weightKg: 150 })) >= 0.85);
  });

  test('gender does not change speeds', () => {
    assert.equal(speedFactor(person({ gender: 'female' })), speedFactor(person({ gender: 'male' })));
  });

  test('decide() applies the profile speed factor', () => {
    const tall = decide(input({ stage: 6, history: [ok(3, 6)], profile: person({ heightCm: 190 }) }));
    const short = decide(input({ stage: 6, history: [ok(3, 6)], profile: person({ heightCm: 150 }) }));
    const brisk = (d) => d.workout.segments.find((s) => s.type === 'work').speed;
    assert.ok(brisk(tall) > brisk(short));
  });

  test('weight goal adds easy minutes; habit goal keeps sessions short', () => {
    const w = decide(input({ stage: 9, history: [ok(3, 9)], profile: person({ goal: 'weight' }) }));
    const e = decide(input({ stage: 9, history: [ok(3, 9)], profile: person({ goal: 'endurance' }) }));
    assert.equal(w.workout.totalMinutes, e.workout.totalMinutes + 5);
    const h = decide(input({ stage: 22, history: [ok(3, 22)], profile: person({ goal: 'habit', preference: 'run' }) }));
    assert.ok(h.workout.totalMinutes <= 25);
  });

  test('running stages contain jog intervals', () => {
    const w = generateWorkout(16);
    assert.equal(w.isRun, true);
    assert.equal(w.segments.filter((s) => s.type === 'run').length, 5);
  });

  test('profile completeness check', () => {
    assert.equal(isProfileComplete(person()), true);
    assert.equal(isProfileComplete({ ...person(), age: null }), false);
  });
});

describe('medals', () => {
  test('first workout medal and distance medals', () => {
    const r = evaluateMedals([ok(3, 9)], { workoutsPerWeek: 2 }, NOW);
    const ids = r.medals.filter((m) => m.earned).map((m) => m.id);
    assert.ok(ids.includes('w1'));
    assert.ok(ids.includes('d1'));            // a 23-minute stage-9 walk is ~1.25 km
    assert.ok(!ids.includes('d5'));
    assert.ok(r.totalKm > 1 && r.totalKm < 2);
  });

  test('workout count milestones', () => {
    const history = Array.from({ length: 10 }, (_, i) => ok(30 - i * 2, 3));
    const r = evaluateMedals(history, { workoutsPerWeek: 2 }, NOW);
    const got = (id) => r.medals.find((m) => m.id === id).earned;
    assert.ok(got('w5') && got('w10') && !got('w25'));
  });

  test('weekly streak counts consecutive weeks meeting the goal', () => {
    // NOW is a Monday. Two workouts in each of the previous 3 weeks.
    const history = [ok(20, 3), ok(17, 3), ok(13, 3), ok(10, 3), ok(6, 3), ok(3, 3)];
    const s = weeklyStreak(history, 2, NOW);
    assert.equal(s.best, 3);
    assert.equal(s.current, 3);              // this week is not over yet, so it doesn't break the streak
    const r = evaluateMedals(history, { workoutsPerWeek: 2 }, NOW);
    assert.ok(r.medals.find((m) => m.id === 's2').earned);
    assert.ok(!r.medals.find((m) => m.id === 's4').earned);
  });

  test('a week below the goal breaks the streak', () => {
    // Two full weeks, then only one workout last week.
    const history = [ok(20, 3), ok(17, 3), ok(13, 3), ok(10, 3), ok(6, 3)];
    const s = weeklyStreak(history, 2, NOW);
    assert.equal(s.best, 2);
    assert.equal(s.current, 0);
  });

  test('comeback medal after two weeks off', () => {
    const r = evaluateMedals([ok(40, 3), ok(3, 3)], { workoutsPerWeek: 2 }, NOW);
    assert.ok(r.medals.find((m) => m.id === 'comeback').earned);
  });

  test('newly earned medals are reported once', () => {
    const r = evaluateMedals([ok(3, 9)], { workoutsPerWeek: 2 }, NOW);
    const fresh = newlyEarned(r, []);
    assert.ok(fresh.length >= 2);
    assert.equal(newlyEarned(r, fresh.map((m) => m.id)).length, 0);
  });
});

describe('scheduling', () => {
  // NOW = Monday 12 Oct 2026, 19:00 London time (18:00 UTC).
  const prefs = { days: [1, 3, 6], from: '18:00', to: '21:00' };

  test('fills each week with the requested number of sessions on preferred days', () => {
    const { sessions } = planSchedule({ prefs, now: NOW, minutes: 20, perWeek: 2 });
    assert.ok(sessions.length >= 3 && sessions.length <= 4);
    for (const s of sessions) {
      assert.ok(prefs.days.includes(new Date(s.start).getDay()));
      const h = new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes();
      assert.ok(h >= 18 * 60 && h + 20 <= 21 * 60);
      assert.ok(new Date(s.start) >= new Date(NOW));
    }
  });

  test('avoids weekly busy blocks', () => {
    const busy = [{ id: 'b', days: [1, 3, 6], from: '17:00', to: '19:30', label: 'Class' }];
    const { sessions } = planSchedule({ prefs, busy, now: NOW, minutes: 20, perWeek: 2 });
    for (const s of sessions) assert.equal(conflictsOf(s, busy, []), 0);
    for (const s of sessions) assert.ok(new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes() >= 19 * 60 + 40);
  });

  test('moves a session when a calendar event clashes', () => {
    const first = planSchedule({ prefs, now: NOW, minutes: 20, perWeek: 2 });
    const target = first.sessions[0];
    const external = [{ start: target.start, end: new Date(new Date(target.start).getTime() + 90 * 60000).toISOString() }];
    const second = planSchedule({ prefs, external, sessions: first.sessions, now: NOW, minutes: 20, perWeek: 2 });
    const moved = second.changes.find((c) => c.type === 'moved');
    assert.ok(moved, 'a session was moved');
    assert.equal(moved.from, target.start);
    for (const s of second.sessions) assert.equal(conflictsOf(s, [], external), 0);
  });

  test('keeps valid sessions where they are (no churn)', () => {
    const first = planSchedule({ prefs, now: NOW, minutes: 20, perWeek: 2 });
    const again = planSchedule({ prefs, sessions: first.sessions, now: NOW, minutes: 20, perWeek: 2 });
    assert.deepEqual(again.sessions.map((s) => s.start), first.sessions.map((s) => s.start));
    assert.equal(again.changes.length, 0);
  });

  test('is deterministic', () => {
    const a = planSchedule({ prefs, now: NOW, minutes: 25, perWeek: 2 });
    const b = planSchedule({ prefs, now: NOW, minutes: 25, perWeek: 2 });
    assert.deepEqual(a, b);
  });

  test('past planned sessions without a workout are flagged as possibly missed', () => {
    const s = { id: 'x', start: daysAgo(2), minutes: 20, status: 'planned' };
    assert.equal(pendingMissed([s], [], NOW).length, 1);
    assert.equal(pendingMissed([s], [ok(2, 3)], NOW).length, 0);
    assert.equal(pendingMissed([s], [], NOW, ['x']).length, 0);
  });

  test('finishing a workout marks that day\'s session done', () => {
    const s = { id: 'x', start: NOW, minutes: 20, status: 'planned' };
    assert.equal(markDone([s], NOW)[0].status, 'done');
    assert.equal(nextSession(markDone([s], NOW), NOW), null);
  });

  test('calendar export has a plain title, the joke in the notes, and two alerts per session', () => {
    const { sessions } = planSchedule({ prefs, now: NOW, minutes: 20, perWeek: 2 });
    const ics = toICS(sessions, { name: 'Sam' }, NOW);
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, sessions.length);
    assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, sessions.length * 2);
    assert.match(ics, /SUMMARY:🏃 Stride workout · 20 min/);
    for (const line of FUNNY) assert.ok(!ics.includes(`SUMMARY:${line.slice(0, 15)}`));
    assert.ok(ics.includes('\r\n'));
  });

  test('funny lines fill in the name and minutes and read cleanly without a name', () => {
    for (let i = 0; i < 200; i++) {
      const withName = funnyLine(`seed${i}`, { name: 'Sam', minutes: 20 });
      const noName = funnyLine(`seed${i}`, { name: '', minutes: 20 });
      assert.ok(!/\{|\}/.test(withName) && !/\{|\}/.test(noName));
      assert.ok(!/ ,|,\s*[.!]|^Hey,? ?$/.test(noName), noName);
    }
    assert.ok(FUNNY.length >= 20);
    assert.equal(eventTitle({ id: 'a', minutes: 20 }), '🏃 Stride workout · 20 min');
  });
});

test('skipping a session never schedules a catch-up', () => {
  const prefs = { days: [1, 3, 6], from: '18:00', to: '21:00' };
  const first = planSchedule({ prefs, now: NOW, minutes: 20, perWeek: 2 });
  const skipped = first.sessions.map((s, i) => (i === 0 ? { ...s, status: 'skipped' } : s));
  const again = planSchedule({ prefs, sessions: skipped, now: NOW, minutes: 20, perWeek: 2 });
  assert.equal(again.changes.filter((c) => c.type === 'added').length, 0);
});
