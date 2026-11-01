// hud: a compact card above the message box. Context, the 5-hour and weekly limits with pace and
// where you'll land at reset, and session cost. Three desktop looks (/hud mode); the terminal draws blocks.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, Breakdown, Mode, Reading, TurnInfo } from '../types'
import { contextSvg, HUE, hueFor, laneSvg } from './draw'
import { instrumentCard, orbitCard, runwayCard, terminalCard } from './layouts'
import type { Card, Item } from './layouts'
import { alertText, burnRate, contextLevel, laneParts, limitView, modelName, money, span, tokens, trimTrail } from './model'

const reading = atom({ plugin: 'hud', key: 'reading' } as const, null)
const breakdown = atom({ plugin: 'hud', key: 'breakdown' } as const, null)
const costHistory = atom({ plugin: 'hud', key: 'costHistory' } as const, [])
const costTrail = atom({ plugin: 'hud', key: 'costTrail' } as const, [])
const turn = atom({ plugin: 'hud', key: 'turn' } as const, {})
const isOn = atom({ plugin: 'hud', key: 'isOn' } as const, true)
const action = atom({ plugin: 'hud', key: 'action' } as const, 'idle')
const mode = atom({ plugin: 'hud', key: 'mode' } as const, 'runway')

const MODE_NAMES: Record<Mode, string> = { orbit: 'Orbit', runway: 'Runway', instrument: 'Instrument' }
const isMode = (value: unknown): value is Mode => value === 'orbit' || value === 'runway' || value === 'instrument'

const REFRESH_MS = 30_000
const HISTORY = 24

// The labels the desktop app's effort picker uses.
const EFFORT_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' }

const HANDOFF_PROMPT = [
  'Write a handoff note so a fresh session with no memory of this conversation can carry on the work.',
  'Use these sections: Goal (one or two sentences); Current state (what is done, what was verified and what was not);',
  'Decisions and constraints (each with its reason); Files and places (paths, repos, URLs that matter);',
  'Next steps (in order); Open questions.',
  'Be specific: names, paths, commands, versions. Leave out pleasantries and settled detours that do not affect the next steps.',
  'Keep it under 400 words. Reply with the note alone.',
].join(' ')

const swallow = () => {}

const refresh = async ($: EngineInterface) => {
  const [usage, model, now] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now()])
  const previous = await read($, reading)
  const cost = usage.cost?.usd
  // /clear starts the session over. The engine may or may not start its cost total over with it.
  const isNewConversation = previous !== null && previous.startedAt !== usage.startedAt
  const costBase = isNewConversation
    ? cost !== undefined && previous.costUsd !== undefined && cost >= previous.costUsd
      ? previous.costUsd
      : 0
    : (previous?.costBase ?? 0)
  const next: Reading = {
    model,
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    contextPercent: usage.context.percent,
    limits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    costUsd: cost,
    costBase,
    startedAt: usage.startedAt,
    // Whole minutes, so countdowns redraw once a minute and no more.
    at: Math.floor(now / 60_000) * 60_000,
  }

  if (JSON.stringify(previous) !== JSON.stringify(next)) {
    await update($, reading, () => next)
  }

  if (isNewConversation) {
    await update($, costHistory, () => (cost === undefined ? [] : [cost - costBase]))
    await update($, costTrail, () => (cost === undefined ? [] : [{ at: now, usd: cost - costBase }]))
  } else if (cost !== undefined) {
    const spent = cost - costBase
    const [history, trail] = await Promise.all([read($, costHistory), read($, costTrail)])

    if (history[history.length - 1] !== spent) {
      await update($, costHistory, old => (old[old.length - 1] === spent ? old : [...old, spent].slice(-HISTORY)))
    }

    // A sample only when the cost moves: it changes in steps, and burnRate reads the steps.
    if (trail[trail.length - 1]?.usd !== spent) {
      await update($, costTrail, old => (old[old.length - 1]?.usd === spent ? old : trimTrail([...old, { at: now, usd: spent }], now)))
    }
  }
}

// What fills the context window. The engine's local estimate: no API calls.
const refreshBreakdown = async ($: EngineInterface) => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const found = usage.context.breakdown

  if (found === undefined) {
    return
  }

  const next: Breakdown = {
    segments: found.categories.filter(row => row.kind === 'used').map(({ name, tokens: count }) => ({ name, tokens: count })),
    autoCompactAt: found.autoCompactThreshold === undefined ? undefined : found.autoCompactThreshold / usage.context.window,
  }

  if (JSON.stringify(await read($, breakdown)) !== JSON.stringify(next)) {
    await update($, breakdown, () => next)
  }
}

const setAction = ($: EngineInterface, next: Action) => update($, action, () => next)

// A backup of the note, on the macOS clipboard: the desktop app gives mods no clipboard of its own.
const copyNote = async ($: EngineInterface, note: string) => {
  try {
    await $.process.run(['/usr/bin/pbcopy'], { stdin: note, timeoutMs: 5_000 })

    return true
  } catch {
    return false
  }
}

// /hud fresh: Claude writes a handoff note, the conversation clears, and the new one starts from the note.
// Answers what happened, as the command's reply.
const freshStart = async ($: EngineInterface): Promise<string> => {
  if ((await read($, action)) === 'handoff') {
    return 'A fresh start is already under way.'
  }

  await setAction($, 'handoff')

  try {
    if (!(await $.command.list()).some(command => command.name === 'clear')) {
      return "Fresh start needs /clear, which this app doesn't offer."
    }

    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })

    if (!reply.isAnswered) {
      return reply.reason === 'nothing-to-fork' ? 'Nothing to hand off yet.' : `Couldn't write the handoff note (${reply.reason}).`
    }

    const note = reply.text.trim()
    const isCopied = await copyNote($, note)

    await $.command.run({ command: 'clear' })
    // The model reads the note as the fresh conversation's first row; the person sees it as a notice.
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `Handoff note from the previous session, to continue from:\n\n${note}` }] },
    })
    await $.session.append({
      message: { type: 'system', content: [{ type: 'text', text: `Fresh start. Claude has this handoff note from the last session:\n\n${note}` }] },
    })

    return isCopied ? 'Fresh start. Claude has the handoff note, and it is also on your clipboard.' : 'Fresh start. Claude has the handoff note.'
  } catch (error) {
    return `Fresh start stopped: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    await setAction($, 'idle')
    void refresh($).catch(swallow)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hud',
      description: 'Show or hide the hud card, switch its look, or start fresh with a handoff note',
      // Not `immediate`: typed during a reply, it waits for the reply to end, so /hud fresh never clears mid-reply.
      argumentHint: '[on|off|fresh|mode orbit|runway|instrument]',
    })
    const saved = await $.store.get('isOn')
    await update($, isOn, () => saved !== false)
    const savedMode = await $.store.get('mode')
    await update($, mode, () => (isMode(savedMode) ? savedMode : 'runway'))
    await setAction($, 'idle')
    // A first reading that fails still leaves the timer running: the card fills in on its next tick.
    await refresh($).catch(swallow)
    $.clock.every(REFRESH_MS, () => void refresh($).catch(swallow))

    return started
  })

  // The engine says the figures moved.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await refresh($).catch(swallow)

    return measured
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined) {
      await refresh($).catch(swallow)
      await refreshBreakdown($).catch(swallow)
    }

    return done
  })

  // The model and effort each request in the main conversation goes out with.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const seen: TurnInfo = { model: e.model, effort: e.effort === undefined ? undefined : String(e.effort) }
      const current = await read($, turn)

      if (current.model !== seen.model || current.effort !== seen.effort) {
        await update($, turn, () => seen)
      }
    }

    return yield* next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)

    if (word.toLowerCase() === 'fresh') {
      if ((await read($, action)) === 'handoff') {
        return { text: 'A fresh start is already under way.' }
      }

      // The engine won't run /clear from inside this hook (it would wait on the command being answered),
      // so the handoff runs just after, and its outcome arrives as a toast.
      $.clock.after(0, () => void freshStart($).then(message => $.ui.toast(message)).catch(swallow))

      return { text: 'Writing a handoff note. The conversation clears when it is ready.' }
    }

    if (word.toLowerCase() === 'mode') {
      const asked = rest.join(' ').trim()
      const wanted = asked.toLowerCase()

      if (wanted === '') {
        return { text: `Mode: ${MODE_NAMES[await read($, mode)]}. Options: orbit, runway, instrument.` }
      }

      if (!isMode(wanted)) {
        return { text: `No mode called "${asked}". Try orbit, runway or instrument.` }
      }

      await update($, mode, () => wanted)
      await $.store.set('mode', wanted)
      const notes = [`Mode set to ${MODE_NAMES[wanted]}.`]

      if (!(await read($, isOn))) {
        notes.push('The card is hidden; /hud on shows it.')
      } else if (wanted !== 'runway' && (await $.session.surfaces().catch((): readonly string[] => [])).includes('terminal')) {
        notes.push('The terminal shows Runway bars in every mode.')
      }

      return { text: notes.join(' ') }
    }

    const arg = word.toLowerCase()
    const shown = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isOn))
    await update($, isOn, () => shown)
    await $.store.set('isOn', shown)

    return { text: shown ? 'Card shown.' : 'Card hidden. Run /hud to show it again.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods draw here stays, above the card.
    const below = await next(e)
    const data = await read($, reading)

    if (e.props.hasSurvey || data === null || !(await read($, isOn))) {
      return below
    }

    const [parts, history, trail, turnInfo, look] = await Promise.all([
      read($, breakdown),
      read($, costHistory),
      read($, costTrail),
      read($, turn),
      read($, mode),
    ])
    const { Box, Text } = $.ui.resolve(e)
    // The terminal has no Svg: its bars are block characters, in every mode.
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const now = data.at
    const views = data.limits.map(limit => limitView(limit, now))
    const alert = alertText(views, data.contextPercent, now)
    const contextPct = data.contextPercent
    const ctxLevel = contextLevel(contextPct)
    const spent = data.costUsd === undefined ? undefined : data.costUsd - (data.costBase ?? 0)
    const burn = burnRate(trail, spent, now)
    const costText = [spent === undefined ? undefined : money(spent), burn].filter(Boolean).join(' · ')
    const warmColor = (kind: string, level: Item['level']) => (level === 'ok' ? undefined : hueFor(kind, level))

    // Every mode draws the same items: the context window, then each limit.
    const contextItem: Item = {
      key: 'context',
      kind: 'context',
      label: 'Context',
      percentText: contextPct === undefined ? '—' : `${contextPct}%`,
      used: contextPct ?? 0,
      level: ctxLevel,
      percentColor: warmColor('context', ctxLevel),
      reset: contextPct === undefined ? `${tokens(data.contextWindow)} window` : `${tokens(data.contextTokens ?? 0)} of ${tokens(data.contextWindow)} tokens`,
      pace: (contextPct ?? 0) >= 70 ? 'compact soon' : undefined,
      paceColor: warmColor('context', ctxLevel) ?? 'subtle',
      barSvg: contextSvg(contextPct ?? 0, (parts?.segments ?? []).map(segment => segment.tokens), parts?.autoCompactAt, e.props.isWorking, ctxLevel),
      barAlt: contextPct === undefined ? 'Context: no reading yet' : `Context ${contextPct}% used`,
      isBarAnimated: e.props.isWorking,
    }
    const limitItems: Item[] = views.map(view => ({
      key: `limit-${view.kind}`,
      kind: view.kind,
      label: view.label,
      percentText: `${Math.round(view.used)}%`,
      used: view.used,
      elapsed: view.elapsed,
      projected: view.projected,
      level: view.level,
      percentColor: warmColor(view.kind, view.level),
      ...laneParts(view, now),
      paceColor: warmColor(view.kind, view.level) ?? 'subtle',
      barSvg: laneSvg(view),
      barAlt: `${view.label} ${Math.round(view.used)}% used`,
      isBarAnimated: view.runsOutAt !== undefined,
    }))

    const card: Card = {
      items: [contextItem, ...limitItems],
      alert,
      isWorking: e.props.isWorking,
      session: {
        time: span(now - data.startedAt),
        costText,
        spentText: spent === undefined ? undefined : money(spent),
        burn,
        history,
        sparkColor: alert === undefined ? HUE.context : HUE.warn,
      },
    }

    if (Svg === undefined) {
      const { model, effort } = turnInfo
      const modelText = [modelName(model ?? data.model), effort === undefined ? undefined : `${EFFORT_LABELS[effort] ?? effort} effort`]
        .filter(Boolean)
        .join(' · ')

      return (
        <Box flexDirection="column">
          {below}
          {terminalCard({ Box, Text }, card, e.props.bodyColumns < 80 ? 10 : 20, modelText)}
        </Box>
      )
    }

    const layout = look === 'orbit' ? orbitCard : look === 'instrument' ? instrumentCard : runwayCard

    return (
      <Box flexDirection="column">
        {below}
        {layout({ Box, Text, Svg }, card)}
      </Box>
    )
  })
}
