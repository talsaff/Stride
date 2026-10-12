// Medals: achievements computed purely from history. Nothing is stored except
// which medals the user has already been shown (for the "new medal" pop-up).

import { completedWorkouts, weekStart, byDate } from './history.js';
import { workoutDistance } from './generator.js';

export const MEDALS = [
  // Number of workouts
  { id: 'w1', group: 'workouts', n: 1, emoji: '👟', title: 'First steps', desc: 'Finish your first workout' },
  { id: 'w5', group: 'workouts', n: 5, emoji: '🖐️', title: 'High five', desc: '5 workouts done' },
  { id: 'w10', group: 'workouts', n: 10, emoji: '🔟', title: 'Double digits', desc: '10 workouts done' },
  { id: 'w25', group: 'workouts', n: 25, emoji: '🥉', title: 'Regular', desc: '25 workouts done' },
  { id: 'w50', group: 'workouts', n: 50, emoji: '🥈', title: 'Half century', desc: '50 workouts done' },
  { id: 'w100', group: 'workouts', n: 100, emoji: '🥇', title: 'Centurion', desc: '100 workouts done' },
  // Total distance (km)
  { id: 'd1', group: 'distance', n: 1, emoji: '📍', title: 'First kilometre', desc: '1 km in total' },
  { id: 'd5', group: 'distance', n: 5, emoji: '🗺️', title: 'Five K', desc: '5 km in total' },
  { id: 'd10', group: 'distance', n: 10, emoji: '🔥', title: '10K club', desc: '10 km in total' },
  { id: 'd21', group: 'distance', n: 21.1, emoji: '🌗', title: 'Half marathon', desc: '21.1 km in total' },
  { id: 'd42', group: 'distance', n: 42.2, emoji: '🏅', title: 'Marathoner', desc: '42.2 km in total' },
  { id: 'd100', group: 'distance', n: 100, emoji: '💯', title: 'Triple digits', desc: '100 km in total' },
  { id: 'd250', group: 'distance', n: 250, emoji: '🚀', title: 'Long hauler', desc: '250 km in total' },
  // Weeks in a row hitting the weekly goal
  { id: 's2', group: 'streak', n: 2, emoji: '📅', title: 'Two in a row', desc: '2 weeks in a row without missing a workout' },
  { id: 's4', group: 'streak', n: 4, emoji: '🗓️', title: 'Month strong', desc: '4 weeks in a row' },
  { id: 's8', group: 'streak', n: 8, emoji: '💪', title: 'Unstoppable', desc: '8 weeks in a row' },
  { id: 's12', group: 'streak', n: 12, emoji: '🌟', title: 'Quarter year', desc: '12 weeks in a row' },
  { id: 's26', group: 'streak', n: 26, emoji: '👑', title: 'Half a year', desc: '26 weeks in a row' },
  { id: 's52', group: 'streak', n: 52, emoji: '🦄', title: 'Legend', desc: '52 weeks in a row' },
  // Fun one-offs
  { id: 'jog', group: 'special', emoji: '🏃', title: 'Jog on', desc: 'Finish your first jog interval' },
  { id: 'early', group: 'special', emoji: '🌅', title: 'Early bird', desc: 'Work out before 8 am' },
  { id: 'night', group: 'special', emoji: '🌙', title: 'Night owl', desc: 'Work out after 9 pm' },
  { id: 'comeback', group: 'special', emoji: '🔄', title: 'Comeback kid', desc: 'Get back on after 2+ weeks off' },
  { id: 'half', group: 'special', emoji: '⏱️', title: 'Half-hour hero', desc: 'One workout of 30+ minutes' },
];

export const GROUP_TITLES = {
  workouts: 'Workouts', distance: 'Distance', streak: 'Weekly streaks', special: 'Specials',
};

export function recordDistance(w) {
  if (w.distance_km != null) return w.distance_km;
  return workoutDistance((w.actual_speed_by_interval ?? []).map((x) => ({ ...x, completedMinutes: x.minutes })));
}

const WEEK = 7 * 864e5;

// Weekly streak: a week counts when completed workouts ≥ weekly goal.
// Returns { current, best, reachedAt: {n: iso} }. The current week only
// adds to the streak once its goal is met; it never breaks it early.
export function weeklyStreak(history, perWeek, now) {
  const done = completedWorkouts(history);
  const goal = Math.max(1, perWeek || 1);
  if (!done.length) return { current: 0, best: 0, reachedAt: {} };
  const counts = new Map();
  for (const w of done) {
    const k = weekStart(w.date).getTime();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const thisWeek = weekStart(now).getTime();
  let run = 0, best = 0;
  const reachedAt = {};
  // Step week by week; +12h keeps DST shifts from landing on the wrong week.
  for (let key = weekStart(done[0].date).getTime(); key <= thisWeek; key = weekStart(new Date(key + WEEK + 12 * 3600e3)).getTime()) {
    const ok = (counts.get(key) ?? 0) >= goal;
    if (ok) {
      run++;
      if (run > best) { best = run; reachedAt[best] = new Date(Math.min(key + WEEK - 1, new Date(now).getTime())).toISOString(); }
    } else if (key !== thisWeek) {
      run = 0;
    }
  }
  return { current: run, best, reachedAt };
}

export function evaluateMedals(history, profile, now) {
  const done = completedWorkouts(history).sort(byDate);
  const earned = {};
  // Workouts and distance thresholds, with the date each was crossed.
  let km = 0;
  done.forEach((w, i) => {
    km += recordDistance(w);
    for (const m of MEDALS) {
      if (earned[m.id]) continue;
      if (m.group === 'workouts' && i + 1 >= m.n) earned[m.id] = w.date;
      if (m.group === 'distance' && km >= m.n - 1e-9) earned[m.id] = w.date;
    }
    const hour = new Date(w.date).getHours();
    if (!earned.early && hour < 8) earned.early = w.date;
    if (!earned.night && hour >= 21) earned.night = w.date;
    if (!earned.half && w.actual_duration >= 30) earned.half = w.date;
    if (!earned.jog && (w.actual_speed_by_interval ?? []).some((x) => x.type === 'run' && !x.skipped && x.minutes > 0)) earned.jog = w.date;
    if (!earned.comeback && i > 0 && new Date(w.date) - new Date(done[i - 1].date) >= 14 * 864e5) earned.comeback = w.date;
  });
  const streak = weeklyStreak(history, profile.workoutsPerWeek, now);
  for (const m of MEDALS) if (m.group === 'streak' && streak.best >= m.n) earned[m.id] = streak.reachedAt[m.n];

  const progressOf = (m) => {
    if (m.group === 'workouts') return Math.min(1, done.length / m.n);
    if (m.group === 'distance') return Math.min(1, km / m.n);
    if (m.group === 'streak') return Math.min(1, streak.current / m.n);
    return earned[m.id] ? 1 : 0;
  };
  const medals = MEDALS.map((m) => ({ ...m, earned: !!earned[m.id], earnedAt: earned[m.id] ?? null, progress: progressOf(m) }));
  return {
    medals,
    earnedCount: medals.filter((m) => m.earned).length,
    totalKm: Math.round(km * 10) / 10,
    workouts: done.length,
    streak,
  };
}

export function newlyEarned(result, seenIds) {
  const seen = new Set(seenIds ?? []);
  return result.medals.filter((m) => m.earned && !seen.has(m.id));
}
