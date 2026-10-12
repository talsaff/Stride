// WorkoutHistory: pure helpers over the stored list of planned/performed
// workouts and missed sessions. Nothing here mutates its input.

const DAY_MS = 24 * 60 * 60 * 1000;

export function byDate(a, b) {
  return new Date(a.date) - new Date(b.date);
}

export function completedWorkouts(history) {
  return history.filter((r) => r.kind === 'workout' && r.actual_duration > 0).sort(byDate);
}

export function missedSessions(history) {
  return history.filter((r) => r.kind === 'missed').sort(byDate);
}

export function lastCompleted(history) {
  const done = completedWorkouts(history);
  return done.length ? done[done.length - 1] : null;
}

// Whole days between two timestamps (calendar-agnostic, floor).
export function daysBetween(fromIso, toIso) {
  return Math.floor((new Date(toIso) - new Date(fromIso)) / DAY_MS);
}

export function after(records, iso) {
  if (!iso) return records;
  const t = new Date(iso).getTime();
  return records.filter((r) => new Date(r.date).getTime() > t);
}

export function totalMinutes(history) {
  return completedWorkouts(history).reduce((sum, w) => sum + w.actual_duration, 0);
}

// Start of the ISO week (Monday 00:00 local) for a date.
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

// Number of workouts in each of the last `weeks` weeks, oldest first.
export function weeklyCounts(history, now, weeks = 8) {
  const current = weekStart(now).getTime();
  const counts = new Array(weeks).fill(0);
  for (const w of completedWorkouts(history)) {
    const diff = Math.round((current - weekStart(w.date).getTime()) / (7 * DAY_MS));
    if (diff >= 0 && diff < weeks) counts[weeks - 1 - diff]++;
  }
  return counts;
}
