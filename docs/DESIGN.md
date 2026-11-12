# Stride: Adaptive Treadmill Training App, design notes

## Platform and stack

* **Platform:** iPhone (iOS 16.4+) as an installable Progressive Web App. You open it in Safari and
  choose *Share → Add to Home Screen*. It then runs full screen, works offline (service worker)
  and keeps its data on the phone (localStorage). No App Store, Mac or developer account needed.
* **Stack:** plain HTML/CSS and ES modules. No build step, no dependencies. Hosted as static files
  (GitHub Pages serves the `docs/` folder).
* **Tests:** Node's built-in test runner (`cd docs && node --test tests/*.test.js`).

## Module map (spec section 12)

| Module | File |
|---|---|
| WorkoutHistory | `js/engine/history.js` |
| ReadinessAssessment | `js/engine/readiness.js` |
| ProgressionEngine | `js/engine/progression.js` |
| WorkoutGenerator | `js/engine/generator.js` |
| SafetyGuard | `js/engine/safety.js` |
| FeedbackProcessor | `js/engine/feedback.js` |
| Decision orchestration | `js/engine/engine.js` |
| PersistenceService | `js/storage.js` |
| UI | `js/app.js`, `index.html`, `styles.css` |
| Heuristic configuration | `js/engine/config.js` |
| Runner profile → plan | `js/engine/profile.js` |
| Medals | `js/engine/medals.js` |
| Scheduler, funny reminders, .ics export | `js/engine/schedule.js` |
| Google Calendar connector | `js/google.js` |
| Future personalization (observes only) | `js/engine/personalization.js` |

Everything under `js/engine/` is pure and deterministic: no clock, storage or randomness inside.
`now` is passed in, so the same inputs and history always produce the same decision.

## Data schema

Stored under the `stride.v1` key:

```
{
  schemaVersion: 1,
  onboarded: bool,
  profile:  { name, age, heightCm, weightKg, fitness, workoutsPerWeek, defaultMinutes|null,
              medicalClearance, autoEasierOnLowEnergy, voiceCues },
  state:    { baselineStage (1-15), baselineChangedAt, baselineLog[{at,from,to,source,reason}],
              tempAdjustment ('none'|'easier'|'harder'), shortenTo (min|null),
              readiness { energy, recovery, soreness, symptoms[], at },
              lastCompletedAt, lastSuccessfulWorkoutId, algorithmVersion, lastDecision },
  history:  [ WorkoutRecord | MissedRecord ],
  activeSession: in-progress workout or null
}
```

**WorkoutRecord** (`kind: 'workout'`): `workout_id, date, planned_duration, actual_duration,
planned_intervals[{type,minutes,speed}], completed_intervals, planned_work_intervals,
completed_work_intervals, actual_speed_by_interval[{type,minutes,speed,skipped}],
baseline_program_level, baseline_stage, effective_stage, temporary_adjustment,
pre_workout_energy (low|normal|high), perceived_exertion (1-10), talk_test_result (yes|mostly|no),
post_workout_feeling (great|good|tired|exhausted|unwell), recovery_status (poor|normal|good),
muscle_soreness, rating (too_easy|appropriate|too_hard), ended_early, stopped_for_safety,
reason_for_shortening_or_skipping, user_feedback, target_exertion, algorithm_version,
algorithm_decision, algorithm_decision_explanation, return_ramp`.

**MissedRecord** (`kind: 'missed'`): `id, date, reason (time|low_energy|too_difficult|pain|motivation|illness|other), note`.
Missed sessions are stored separately and are never by themselves a fitness signal.

The plan is stored with every workout (`planned_intervals`) next to what was actually done
(`actual_speed_by_interval`), so planned and actual workload can be compared.

## Runner profile

Built in a wizard on first launch (name, age, gender, height, weight, fitness, walk/mix/run preference,
goal, weekly schedule) and editable any time from Settings → Runner profile. It changes the plan in
`profile.js`:

* **Starting stage** from fitness (low 1, some 6, regular 14, fit 24), a few stages lower from age 45/60
  and for BMI ≥ 30/35.
* **Speed boost** (1.00-1.12) for taller and fitter people. It only ever speeds things up, never
  below the plan's minimums. Gender is stored but not used for speeds.
* **Fast-part cap** by preference: walk 6.5 km/h (fast walking, no running in the plan), mix 8.5 km/h,
  run 10 km/h. The "Run 5 km" goal switches on running.
* **Goal tweak:** weight loss adds 5 easy minutes per workout; habit caps sessions at 30 min.

## The plan: a tiny bit harder every workout

`config.js` defines an 80-stage ladder (8 levels × 10 stages). **Stage 1, the easiest normal
workout:** 25 min, warm-up 3.5 km/h, easy 4.5 / brisk 5.5 km/h walking, 2 min fast walk at 6 km/h,
recovery and cool-down. Each next stage changes exactly one thing, in a repeating cycle:

1. +1 minute (up to 45)
2. +0.1 km/h on the walking parts (up to +1.0)
3. +1 fast minute (up to 20, split into blocks of 2-5 min)
4. +0.2 km/h on the fast parts (cap by preference; at 7 km/h+ fast parts become jogs/runs)

**Every completed workout moves the plan one stage up** (two if rated "too easy"). A workout that
felt too hard holds the plan and makes the next one 2 stages lighter; two in a row step the plan back
by about 12% of workload. Workouts cut short for time, easy days and back-from-a-break workouts don't
move it.

**Today-only versions** (never change the plan):

* **Tired / low energy / poor recovery:** 25 min, everything between 3.5 and 4.5 km/h.
* **Advanced (high energy):** the stage 4 steps ahead, 2 min longer, with all fast parts as running:
  at least 3 min at ≥ 7 km/h (more running and faster for more advanced plans), even for walkers.
  Completing it counts as one normal step.

## Decision order (`decide()` in `engine.js`)

```
1  rest / urgent if a red-flag symptom is reported (no workout)
2  plan step: +1 / +2 / hold / step back (ProgressionEngine)
3  today's stage: back from a break (15-30 days −3 stages, >30 days −8 and 25 min),
                  after a hard one −2 (the lowest applies)
4  today's version: advanced (asked) / easy (asked, low energy, poor recovery) / normal
5  fit to time: shorten, preferred length, goal cap; never longer than the plan
```

## Example histories and expected next workouts

Executable in `tests/examples.test.js`:

| # | History | Next workout | Plan |
|---|---|---|---|
| A | none | Stage 1, 25 min | stage 1 |
| B | first workout felt about right | Stage 2, 26 min | +1 |
| C | rated "too easy" at stage 10 | Stage 12 | +2 |
| D | one too-hard workout at stage 20 | Stage 18 today | holds at 20 |
| E | two too-hard in a row at stage 30 | lighter stage | steps back ~12% |
| F | low energy today | easy version, 3.5-4.5 km/h, 25 min | unchanged |
| G | asks for advanced | ≥ 3 min running | unchanged |
| H | last workout 21 days ago | 3 stages lighter today | unchanged (+1 for that last workout) |
| I | last workout 60 days ago | 8 stages lighter, 25 min | unchanged (+ that workout) |
| J | two workouts cut short for time | same stage | unchanged |

## Scheduling and calendars

* **Planner** (`planSchedule`): fills each week with *workouts per week* sessions on the chosen days
  inside the time window, spread out, avoiding weekly busy times and calendar events (with a
  10-minute buffer). Sessions that start clashing are moved (same day later, then the next free
  preferred day, then any free time in the next 3 days). Valid sessions never move. Skipped or
  missed sessions still count toward the week, so there are **never catch-up sessions**.
* **Google Calendar** (`google.js`): with the user's own OAuth Client ID, Stride reads busy events
  (timed, not marked "free"), plans around them, and writes workout events with two pop-up
  reminders. Moving a Stride event in Google moves the session; deleting it counts as skipped.
* **iPhone Calendar:** upcoming sessions export as an `.ics` file with two alerts per event.
* **Reminders:** calendar events are titled "Stride time" and carry a funny line in their notes.
  While the app is open it pops up a funny reminder at workout time. With the optional push
  service (`push/`, a Cloudflare Worker + Durable Object), the phone gets a funny Web Push
  notification 10 minutes before and at the start of each workout even when the app is closed.
  The app sends the service only its push subscription and upcoming workout times; payloads are
  encrypted per RFC 8291 and authenticated with VAPID (RFC 8292).
* **Missed sessions:** a planned session that passes without a workout prompts "What happened?";
  the answer is logged as a missed record and never lowers fitness by itself.

## Medals

Computed from history (`medals.js`): workouts (1-100), total distance (1-250 km, incl. half and
full marathon), weekly streaks (2-52 weeks in a row hitting the weekly goal; the current week never
breaks a streak early), and specials (first jog, early bird, night owl, comeback, 30-minute workout).
New medals pop up after the check-in.

## Safety stance

The user is assumed healthy: there are no medical warnings, symptom questionnaires or permission
gates. The plan still eases off for poor recovery, repeated exhaustion and hard sessions, the user can
stop any workout instantly, and the "I don't feel well" button ends a workout without counting it
against them.
