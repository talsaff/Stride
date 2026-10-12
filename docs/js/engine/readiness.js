// ReadinessAssessment: evaluates today's energy, recovery, symptoms and the
// time since the previous completed workout.

import { RULES } from './config.js';
import { RED_FLAG_SYMPTOMS, REST_SYMPTOMS } from './schema.js';
import { completedWorkouts, missedSessions, lastCompleted, daysBetween } from './history.js';

export function returnCategory(daysSinceLast) {
  if (daysSinceLast == null) return 'first';
  if (daysSinceLast <= RULES.resumeWithinDays) return 'resume';
  if (daysSinceLast <= RULES.modestReturnWithinDays) return 'modest';
  return 'long';
}

// Counts recent signs of unusual fatigue: poor recovery today, workouts that
// left the user exhausted/unwell or started with poor recovery, and sessions
// missed for low energy or illness.
function fatigueFlags(readiness, history) {
  const events = [
    ...completedWorkouts(history).map((w) => ({
      date: w.date,
      flag: w.recovery_status === 'poor' || ['exhausted', 'unwell'].includes(w.post_workout_feeling),
    })),
    ...missedSessions(history).map((m) => ({
      date: m.date,
      flag: m.reason === 'low_energy' || m.reason === 'illness',
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent = events.slice(-(RULES.fatigueWindow - 1));
  let count = recent.filter((e) => e.flag).length;
  if (readiness.recovery === 'poor' || readiness.symptoms.includes('severe_fatigue')) count++;
  return count;
}

export function assessReadiness({ readiness, history, now }) {
  const last = lastCompleted(history);
  const daysSinceLast = last ? daysBetween(last.date, now) : null;
  const symptoms = readiness.symptoms ?? [];
  const missedSinceLast = missedSessions(history).filter(
    (m) => !last || new Date(m.date) > new Date(last.date),
  );
  return {
    energy: readiness.energy ?? 'normal',
    recovery: readiness.recovery ?? 'normal',
    soreness: readiness.soreness ?? 'none',
    redFlags: symptoms.filter((s) => s in RED_FLAG_SYMPTOMS),
    restFlags: symptoms.filter((s) => s in REST_SYMPTOMS),
    daysSinceLast,
    returnCategory: returnCategory(daysSinceLast),
    missedSinceLast,
    persistentFatigue: fatigueFlags({ ...readiness, symptoms }, history) >= RULES.fatigueFlagsForConcern,
  };
}
