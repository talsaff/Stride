// Personalization layer (future learning).
//
// Kept separate from the deterministic rules on purpose. This module only
// OBSERVES history and produces insights and gentle suggestions. It never
// changes speeds or the baseline itself. As real feedback accumulates, the
// strongest of these patterns can be promoted into configurable rules.

import { STAGES } from './config.js';
import { completedWorkouts, missedSessions, totalMinutes } from './history.js';
import { classifyWorkout, completionRatio } from './feedback.js';

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function personalInsights(history) {
  const done = completedWorkouts(history);
  const missed = missedSessions(history);
  const insights = [];
  if (done.length < 3) return { insights, suggestedMinutes: null };

  // Which session length is most likely to be finished?
  const recent = done.slice(-6);
  const shortenedForTime = recent.filter((w) => w.ended_early && w.reason_for_shortening_or_skipping === 'time');
  const typical = median(recent.map((w) => w.actual_duration));
  let suggestedMinutes = null;
  if (shortenedForTime.length >= 2 && typical) {
    suggestedMinutes = Math.max(5, Math.round(typical));
    insights.push(`You often run short on time. Sessions of about ${suggestedMinutes} minutes might fit your days better; you can set this in Settings.`);
  }

  // Do missed sessions come from scheduling or from the workload?
  const scheduleMisses = missed.filter((m) => m.reason === 'time' || m.reason === 'motivation').length;
  const workloadMisses = missed.filter((m) => m.reason === 'too_difficult' || m.reason === 'low_energy').length;
  if (missed.length >= 2) {
    if (scheduleMisses > workloadMisses) insights.push('Most missed sessions were about time or motivation, not the workout itself, so they do not lower your plan.');
    else if (workloadMisses > scheduleMisses) insights.push('Several missed sessions were about energy or difficulty. If that continues, lowering your level a notch could help.');
  }

  // Does the user tolerate speed changes or duration/volume changes better?
  const byChange = { speed: [], volume: [] };
  for (const w of done) {
    const changed = STAGES[w.effective_stage]?.changed ?? '';
    const c = classifyWorkout(w);
    if (c === 'neutral' || c === 'safety') continue;
    const bucket = /speed/.test(changed) ? 'speed' : 'volume';
    byChange[bucket].push(c === 'hard' ? 1 : 0);
  }
  const rate = (xs) => (xs.length >= 2 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const speedHard = rate(byChange.speed);
  const volumeHard = rate(byChange.volume);
  if (speedHard != null && volumeHard != null && Math.abs(speedHard - volumeHard) >= 0.34) {
    insights.push(speedHard > volumeHard
      ? 'Faster speeds tend to feel tougher for you than longer sessions. Good to know.'
      : 'Longer sessions tend to feel tougher for you than faster speeds. Good to know.');
  }

  const completion = recent.map(completionRatio);
  const avg = completion.reduce((a, b) => a + b, 0) / completion.length;
  if (avg >= 0.9) insights.push('You finish almost every workout you start. That is what builds a habit.');

  return { insights, suggestedMinutes, totalMinutes: totalMinutes(history) };
}
