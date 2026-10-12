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

* **Starting level** from fitness × preference, one step gentler from age 45, two more from 60, and
  one or two gentler for BMI ≥ 30 / ≥ 35.
* **Speed factor** (0.85–1.12) on every segment: taller → faster, older → gradually slower, higher
  BMI → slower, fitter → slightly faster. Gender is stored but not used for speeds, since height,
  weight and age already capture what matters for treadmill pace.
* **How far the program goes:** walking only (up to stage 15), mix (up to stage 21: run/walk), or
  running (up to stage 24: continuous running). The "Run 5 km" goal switches on running.
* **Goal tweak:** weight loss adds 5 easy minutes per workout; habit caps sessions at 25 min.

## Levels and the progression ladder

Eight levels, each with explicit limits (duration, speeds, interval count, target effort), and a
24-stage ladder. Levels 1-5 are walking (from 13 min steady walking to 31 min power-walking
intervals at 4.4 km/h); levels 6-8 add jogs (5 × 1 min at 6.5 km/h) and build to 2 × 13 min runs
at 7.5 km/h (all before the speed factor). Adjacent stages differ in one thing: duration,
interval structure, or one speed; a unit test enforces this. Target effort never exceeds 7/10.

## Decision algorithm (`decide()` in `engine.js`)

```
assessment = ReadinessAssessment(readiness, history, now)
safety     = SafetyGuard(assessment, profile)

1  if red-flag symptom (chest pain, fainting, severe breathlessness) → status 'urgent', no workout
   if rest symptom (dizziness, significant pain, unexplained severe fatigue, palpitations) → 'rest', no workout
   if persistent unusual fatigue (≥2 flags in the last 3 check-ins) → pause progression, advise doctor
   if recovery poor or soreness severe → pause progression, block 'harder'

   prog = ProgressionEngine(state, history)   # only workouts since the last permanent change
          last 2 non-neutral workouts 'hard'          → decrease baseline ~12% workload
          last workout 'hard' or safety-stopped       → maintain, one-time −1 stage
          last 2 workouts AT baseline 'easy' (not on easier days, recovery not poor)
                 and progression not paused and below the profile's top stage → increase +1 stage
          otherwise                                    → maintain

   candidates for today (the LOWEST wins; reductions don't stack):
2    recovery/fatigue pause         → baseline − 1
3    days since last workout ≤14    → baseline (or the next step of a return ramp)
                             15–30  → min(baseline, last comfortable stage) − 1   (ramp)
                             >30    → min(baseline, last comfortable stage) − 3, max 15 min (ramp)
4    'easier' request or low energy → baseline − 2
5    one hard workout / skipped as too hard → baseline − 1
4b   'harder' request → +1 stage, refused if recovery/return ramp/low energy/top of program

7  WorkoutGenerator(stage, minutes = min(shortenTo, defaultMinutes, return cap), profile speed factor, goal tweak)
   SafetyGuard.clampWorkout(level limits, global limits)
   return workout + explanation + safety notes + whether progression/harder are allowed
```

**Workout classification** (`classifyWorkout`): `safety` (stopped for symptoms, never a failure),
`hard` (rated too hard, RPE > target max + 1, talk test failed, or stopped early for difficulty or low energy
with < 60% done), `neutral` (cut short for time/motivation/other: not a fitness signal), `easy`
(rated too easy or RPE below target, ≥ 90% done, talk test passed, didn't feel exhausted/unwell),
otherwise `appropriate`.

**When changes take effect:** a baseline change the engine proposes is committed when the user
*starts* the workout (`commitDecision`), so just browsing never changes anything. One-time
adjustments (`tempAdjustment`, `shortenTo`) are cleared when the workout is saved. Permanent
user changes go through `applyPermanentChange` (lower: always allowed; raise: one level at a
time, to the gentlest stage of that level, refused when safety/recovery/return ramp/recent hard
session/clearance say no).

**Return ramp:** after a break the user restarts lower, then moves up one stage per comfortable
session until back at the unchanged baseline. History and achievements are never reset.

## Example histories and expected next workouts

These are executable: `tests/examples.test.js`.

| # | History | Next workout | Baseline |
|---|---|---|---|
| A | none | Stage 1, 13 min steady walk | maintain |
| B | 2 walks at stage 4 rated *too easy*, 1×/week | Stage 5, 19 min | +1 (stage 5) |
| C | 2 OK walks then 1 *too hard* at stage 7 | Stage 6, 19 min (today only) | stays 7 |
| D | 2 consecutive *too hard* at stage 9 | Stage 8, 19 min | decrease to 8 (~19% less workload: the nearest lower step on the ladder to the ~12% target) |
| E | Last walk 20 days ago, 3 sessions missed for time/motivation | Stage 5, 19 min (return ramp) | stays 6 |
| F | Last walk 45 days ago at stage 8 | Stage 5, capped at 15 min | stays 8 |
| G | Low energy today at stage 6 | Stage 4, 15 min | stays 6 |
| H | Asks for harder but recovery is poor | Stage 5 (harder refused) | stays 6 |
| I | Reports chest pain | No workout, urgent care message | unchanged |
| J | Two walks cut short for time | Stage 5, unchanged | maintain |

## Heuristics vs. future personalization

* **Heuristic rules (now):** everything in `config.js` (`RULES`, `LEVELS`, `STAGES`, `GLOBAL_LIMITS`).
  These are conservative starting guesses, **not** medically validated thresholds, and are
  meant to be tuned from real feedback.
* **Personalization (future):** `personalization.js` only observes history and reports patterns:
  typical completed duration, whether misses are about scheduling or workload, whether speed or
  volume increases are tolerated better, and completion rate. It never changes the plan itself.
  Patterns that prove reliable can later be promoted into configurable rules, e.g. choosing which
  variable to progress next.
* An LLM is not used. If one is added later it should only rephrase the engine's explanation,
  never set speeds or workloads.

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
* **Reminders:** calendar alerts show the event title, so the title is a funny line ("Get your lazy
  ass on the treadmill, Tal"). While the app is open it also shows an in-app reminder.
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
