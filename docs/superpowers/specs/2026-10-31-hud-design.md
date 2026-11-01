# hud: design

The first mod in `cloudkoders/claude-mods`. A compact card above Claude Code's message box that shows context, the 5-hour and weekly limits, and session cost, and tells you whether you're spending each limit faster than time is passing.

Visual reference: `docs/mocks/hud-runway.html` (the chosen direction, "Runway, compact"). The other directions considered are in `docs/mocks/hud-mocks.html`.

## Goal

Answer "am I going to make it?" at a glance. The angomedia `session-hud` mod shows how much is used. This one also shows pace (used compared with time gone) and where you'll land when each limit resets, and it warns you, with a time, when a limit will run out before it resets.

Success looks like:

- The card is no taller than 90px on desktop in a normal session, plus one alert row when something will run out.
- The numbers match `/context`, `/cost` and the status line (same source).
- A person can read the state of all three limits in under a second, without doing arithmetic.

## Repository

The repo is a plugin marketplace, so later mods go in as more folders under `plugins/`.

```
claude-mods/
  .claude-plugin/marketplace.json     name "claude-mods", owner CloudKoders
  plugins/hud/
    .claude-plugin/plugin.json        name "hud", types "./types/index.d.ts"
    hooks/hooks.json                  { "modules": ["./register.tsx"] }
    hooks/register.tsx                events, /hud command, buttons, drawing
    hooks/model.ts                    pure: pace, projection, levels, text
    hooks/draw.ts                     pure: SVG strings, terminal block strings
    hooks/model.test.ts
    hooks/hud.test.tsx
    types/index.d.ts                  PluginState contract
  docs/mocks/                         the mocks
  docs/superpowers/specs|plans/
  README.md
  LICENSE                             MIT
```

Install:

```bash
claude plugin marketplace add cloudkoders/claude-mods
claude plugin install hud@claude-mods
```

## What the card shows

One card in the `AbovePrompt` band, a single row with three parts.

1. **Lanes** (left, stacked): Context, 5-hour, Weekly. Each lane is a label, a bar, the percent used, and one line of detail.
2. **Session** (middle): `Session 9m` on the first line, a cost sparkline under it, then `$0.69 · $4.60/h`.
3. **Buttons** (right): Compact and Fresh start.

When a limit will run out before it resets, an alert row sits above the lanes: `5-hour limit runs out around 4:27 PM, 1h 17m before it resets.` If context is at 70% or more, the alert also says `Context is 74% full.`

### The bars

Every bar runs from 0 to 100% of its limit.

- **Solid fill** is what's used.
- **The tick** is even pace: the share of the window's time that has gone by. Fill past the tick means you're spending faster than time.
- **The dashed tail** runs from the fill to where you'll land at reset, ending in a hollow dot. If you'll run out first, the tail runs to the end of the bar and ends at a blinking wall.

The context bar has no tick or tail. It is split into segments by what fills it (each `used` row of the context breakdown, in the engine's order), in lighter to deeper shades of the context hue, with the conversation last and deepest. A dotted line marks where auto-compact runs, if it's on.

While Claude works (`isWorking`), a highlight sweeps across the context fill.

### Detail text

| Lane | Detail |
| --- | --- |
| Context | `97k of 1M tokens` |
| 5-hour, weekly | `resets in 1h 44m · lands ~78%` |
| 5-hour, weekly, will run out | `resets in 1h 44m · out ~4:27 PM` |
| 5-hour, weekly, too early to project | `resets in 4h 40m` |

Reset text follows the original: within a day `resets in 3h 20m`, within six days `resets Thu 5 PM`, further out `resets Oct 12`.

### Colors

Cool means fine. Warm means look.

| Thing | Hex |
| --- | --- |
| Context | `#8B7CF6` |
| 5-hour | `#12B5CB` |
| Weekly | `#4F86F7` |
| Warn (amber) | `#FFA51F` |
| Hot (red) | `#FF4F4F` |

Levels:

- **hot** if used ≥ 90%, or the projection says it runs out before reset.
- **warn** if used ≥ 70%, or projected ≥ 95% at reset.
- **ok** otherwise.

A lane at warn or hot draws its fill, its percent and its projection text in the warm color. Context only uses the used thresholds (it has no projection).

SVG can't read the app's theme, so SVG colors work on both light and dark: track `rgba(128,128,128,0.22)`, tick `#8E8E93`, hollow dot with no fill. Text uses the app's own theme colors (`subtle` for labels and detail).

## How the numbers work

All times are `$.clock.now()` milliseconds.

**Window length:** `five_hour` is 5 hours, `seven_day` is 7 days. Any other kind (a gateway's `spend_limit`) is drawn as a plain lane with no tick or projection, labeled with its kind.

**Elapsed share:** `elapsed = 1 - (resetsAt - now) / windowLength`, clamped to 0..1. With no `resetsAt`, no tick and no projection.

**Projection at reset:** `used / elapsed`. Hidden while `elapsed < 0.10`, since early readings swing too much.

**Runs out:** when the projection is over 100%. The rate is `used / elapsedMs`, and run-out time is `now + (100 - used) / rate`. Shown as a clock time (`4:27 PM`). The alert gives how long before the reset that is (`1h 17m before it resets`).

**Burn rate:** cost over the last hour of the conversation (or since its first reading, if younger), shown once there are 5 minutes to measure. Cost changes in steps, so its value an hour ago is the last sample at or before then. (Changed in 0.1.2: dividing by the whole session made a 6-day session read $0.02/h.)

**Sparkline:** the last 24 distinct cost readings, kept in `$.state` for the session. Hidden until there are at least 3.

## Data flow

- `session.start`: register `/hud`, read the saved on/off from `$.store`, take a first reading, start a 30-second clock.
- `session.measure`: take a reading when the engine says the figures moved.
- The 30-second clock: take a reading, so countdowns and elapsed shares keep moving.
- `turn.complete`: take a reading, and refresh the context breakdown with `$.session.usage({ breakdown: 'summary' })` (a local estimate, no API calls). The breakdown is not refreshed on the timer.
- `turn.step` (main thread only): remember the model and effort, for the terminal.
- A reading writes to `$.state` only when something drawn would change. Time is rounded to the minute, so the card redraws at most once a minute when nothing else moves.
- `ui.render` on `AbovePrompt`: draws from `$.state`. It yields to a survey (`hasSurvey`), draws nothing until the first reading, and draws nothing when switched off. Whatever other mods draw in the band stays, above the card.

## Surfaces

- **Desktop:** SVG bars and sparkline as above. Model and effort are left out, since the app shows them under the message box.
- **Terminal:** no SVG. Each bar is 20 cells: `█` used, `▒` projected, `│` pace tick, `░` empty, colored as above. Session is one line (`Session 9m  API ≈ $0.69 · $4.60/h`), and model and effort are shown. Lane detail truncates to the band's `bodyColumns`.
- **Mobile and VS Code:** the engine doesn't raise `AbovePrompt` there, so the HUD doesn't show.

## Modes (0.2.0)

`/hud mode orbit|runway|instrument` picks the desktop layout; Runway is the default. The choice is saved in `$.store` under `mode` and restored at `session.start`; an unknown saved value falls back to Runway. `/hud mode` alone replies `Mode: Runway. Options: orbit, runway, instrument.`, an unknown name replies `No mode called "x". Try orbit, runway or instrument.`, and a change replies `Mode set to Orbit.`, adding `The card is hidden; /hud on shows it.` when hidden, or `The terminal shows Runway bars in every mode.` when a terminal is attached.

Every mode draws the same items (context, then each limit), the same alert line and the same buttons, at about Runway's height:

- **Orbit:** one 64px interactive Svg of nested rings (context innermost) with an even-pace notch per limit, a `<title>` per ring for hover, a glow on a hot ring and a dot circling the context ring while Claude works. Beside it, a three-line column per item (hue dot and label, big percent, detail with the warm pace part) and a session column (label, time, cost and $/h).
- **Instrument:** a 56px dial per item (270-degree arc, ticks, percent inside in the item's hue, a rim triangle for even pace, a dotted projection arc, a glow when hot, interactive only when hot) with label, reset and pace lines beside it. The session column shows the time, the cost on a flip counter (dark tiles, light digits, readable on both themes) and `$/h burn`.
- **Terminal:** the Runway block bars in every mode.

## Commands (buttons removed in 0.3.0)

The card has no buttons: stacked Buttons drew on top of each other in the desktop app, and both were shortcuts. `/compact` is Claude Code's own.

- `/hud fresh`: Claude writes a handoff note (`$.model.fork`), the conversation clears (`/clear`), and the note becomes the new conversation's first message. It also tries to copy the note to the macOS clipboard. The command replies at once (`Writing a handoff note. The conversation clears when it is ready.`) and runs the handoff just after, from a `$.clock.after(0)` callback, because the engine refuses `/clear` from inside a `command.run` hook; the outcome arrives as a toast. A second `/hud fresh` while one runs replies `A fresh start is already under way.` It needs `/clear` to exist and says so if it doesn't.
- `/hud`, `/hud on`, `/hud off`: show or hide the card. The choice is saved in `$.store`.
- `/hud` is registered without `immediate`, so typed during a reply it waits for the reply to end: `/hud fresh` never clears mid-reply.

## Failure handling

- A failed reading leaves the last good state on screen. The next tick tries again.
- A failed breakdown leaves the context bar as one plain segment.
- No rate limits (an API key with no subscription): the 5-hour and weekly lanes aren't drawn. The card shrinks to context and session.
- `/hud fresh` failing: a toast saying what failed.

## State contract

`types/index.d.ts` declares, under `hud`:

- `reading`: the latest figures (context, limits, cost, startedAt, at), or null.
- `breakdown`: used segments `{ name, tokens }[]` and `autoCompactAt` (a fraction of the window), or null.
- `costHistory`: `number[]`, at most 24.
- `turn`: `{ model?, effort? }`.
- `isOn`: boolean.
- `action`: `'idle' | 'confirm' | 'compacting' | 'handoff'`.

## Testing

- `model.test.ts`: elapsed share, projection, the 10% rule, run-out time, levels, reset text, token and money formatting, model names. Fixed clock values.
- `hud.test.tsx`: mount the band on both `terminal` and `desktop`. Check it draws nothing before a reading, draws three lanes for a subscription reading, drops the limit lanes with none, shows the alert when a limit will run out, and that `/hud off` hides it.
- `claude plugin validate plugins/hud` and `tsc -p plugins/hud`, both clean.
- Load it live in this session and look at it.

## Out of scope

- Reading the app's light or dark theme.
- Settings for colors, thresholds or bar width.
- Per-turn cost or a token breakdown in the session column.
- Any mod other than `hud`.
