// hud: a compact card above the message box. Context, the 5-hour and weekly limits with pace and
// where you'll land at reset, and session cost. Desktop draws SVG bars; the terminal draws blocks.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Action, Breakdown, Reading, TurnInfo } from '../types'
import { contextSvg, HUE, hueFor, laneSvg, sparkSvg, terminalBar } from './draw'
import type { Run } from './draw'
import { alertText, burnRate, contextLevel, laneParts, limitView, modelName, money, span, tokens, trimTrail } from './model'
import type { LimitView } from './model'

const reading = atom({ plugin: 'hud', key: 'reading' } as const, null)
const breakdown = atom({ plugin: 'hud', key: 'breakdown' } as const, null)
const costHistory = atom({ plugin: 'hud', key: 'costHistory' } as const, [])
const costTrail = atom({ plugin: 'hud', key: 'costTrail' } as const, [])
const turn = atom({ plugin: 'hud', key: 'turn' } as const, {})
const isOn = atom({ plugin: 'hud', key: 'isOn' } as const, true)
const action = atom({ plugin: 'hud', key: 'action' } as const, 'idle')

const REFRESH_MS = 30_000
const CONFIRM_MS = 5_000
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

// A small red dot that pulses beside the alert.
const ALERT_DOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#FF4F4F"><animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite"/></circle></svg>'

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

const compact = async ($: EngineInterface) => {
  await setAction($, 'compacting')

  try {
    await $.command.run({ command: 'compact' })
  } catch (error) {
    $.ui.toast(`Couldn't compact: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await setAction($, 'idle')
    void refresh($).catch(swallow)
  }
}

// A backup of the note, on the macOS clipboard: the desktop app gives mods no clipboard of its own.
const copyNote = async ($: EngineInterface, note: string) => {
  try {
    await $.process.run(['/usr/bin/pbcopy'], { stdin: note, timeoutMs: 5_000 })

    return true
  } catch {
    return false
  }
}

const freshStart = async ($: EngineInterface) => {
  await setAction($, 'handoff')

  try {
    if (!(await $.command.list()).some(command => command.name === 'clear')) {
      $.ui.toast("Fresh start needs /clear, which this app doesn't offer.")

      return
    }

    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })

    if (!reply.isAnswered) {
      $.ui.toast(reply.reason === 'nothing-to-fork' ? 'Nothing to hand off yet.' : `Couldn't write the handoff note (${reply.reason}).`)

      return
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
    $.ui.toast(isCopied ? 'Fresh start. The handoff note is also on your clipboard.' : 'Fresh start. Claude has the handoff note.')
  } catch (error) {
    $.ui.toast(`Fresh start stopped: ${error instanceof Error ? error.message : String(error)}`)
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
      description: 'Show or hide the hud card above the message box',
      argumentHint: '[on|off]',
      immediate: true,
    })
    const saved = await $.store.get('isOn')
    await update($, isOn, () => saved !== false)
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
    const arg = e.args.trim().toLowerCase()
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

    const [parts, history, trail, turnInfo, current] = await Promise.all([
      read($, breakdown),
      read($, costHistory),
      read($, costTrail),
      read($, turn),
      read($, action),
    ])
    const { Box, Button, Text } = $.ui.resolve(e)
    // The terminal has no Svg: its bars are block characters.
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const now = data.at
    const views = data.limits.map(limit => limitView(limit, now))
    const alert = alertText(views, data.contextPercent, now)
    const contextPct = data.contextPercent
    const ctxLevel = contextLevel(contextPct)
    const contextDetail = contextPct === undefined ? `${tokens(data.contextWindow)} window` : `${tokens(data.contextTokens ?? 0)} of ${tokens(data.contextWindow)} tokens`
    const contextText = contextPct === undefined ? '—' : `${contextPct}%`
    const spent = data.costUsd === undefined ? undefined : data.costUsd - (data.costBase ?? 0)
    const costText = [spent === undefined ? undefined : money(spent), burnRate(trail, spent, now)].filter(Boolean).join(' · ')
    const sessionTime = span(now - data.startedAt)

    const warmColor = (kind: string, level: LimitView['level']) => (level === 'ok' ? undefined : hueFor(kind, level))
    // The pace part of a lane's detail takes the lane's warm color; the reset part stays quiet.
    const detailOf = (view: LimitView) => ({ ...laneParts(view, now), paceColor: warmColor(view.kind, view.level) ?? 'subtle' })
    type Detail = { reset: string; pace?: string; paceColor?: string }

    // ---------- buttons, shared ----------

    const isBusy = e.props.isWorking || current === 'compacting' || current === 'handoff'

    const onCompact = () => {
      if (isBusy) {
        $.ui.toast('Wait until Claude finishes, then compact.')

        return
      }

      void compact($)
    }

    const onFreshStart = async () => {
      if (isBusy) {
        $.ui.toast('Wait until Claude finishes, then start fresh.')

        return
      }

      // First press asks; a second press within a few seconds goes ahead.
      if (current !== 'confirm') {
        await setAction($, 'confirm')
        // One read-and-write, so a press that lands as the timer fires (Compacting, the handoff) stands.
        $.clock.after(CONFIRM_MS, () => void update($, action, now => (now === 'confirm' ? 'idle' : now)).catch(swallow))

        return
      }

      void freshStart($)
    }

    const buttons = [
      <Button
        key="compact"
        label={current === 'compacting' ? 'Compacting…' : 'Compact'}
        variant={(contextPct ?? 0) >= 70 ? 'primary' : 'secondary'}
        dimColor={isBusy && current !== 'compacting'}
        onPress={onCompact}
      />,
      <Button
        key="fresh"
        label={current === 'handoff' ? 'Writing handoff…' : current === 'confirm' ? 'Press again to start fresh' : 'Fresh start'}
        variant={current === 'confirm' ? 'primary' : 'secondary'}
        dimColor={isBusy && current !== 'handoff'}
        onPress={onFreshStart}
      />,
    ]

    // ---------- terminal ----------

    if (Svg === undefined) {
      const cells = e.props.bodyColumns < 80 ? 10 : 20

      const bar = (runs: Run[], color: string) =>
        runs.map(run =>
          run.part === 'used' ? (
            <Text color={color}>{run.text}</Text>
          ) : run.part === 'projected' ? (
            <Text color={color} dimColor>
              {run.text}
            </Text>
          ) : run.part === 'tick' ? (
            <Text>{run.text}</Text>
          ) : (
            <Text dimColor>{run.text}</Text>
          ),
        )

      const line = (label: string, runs: Run[], color: string, percent: string, percentColor: string | undefined, detail: Detail) => (
        <Text wrap="truncate-end">
          <Text color="subtle">{label.padEnd(9)}</Text>
          {bar(runs, color)}
          <Text bold color={percentColor}>{` ${percent.padStart(4)}`}</Text>
          <Text color="subtle">{`  ${detail.reset}`}</Text>
          {detail.pace === undefined ? null : <Text color={detail.paceColor}>{` · ${detail.pace}`}</Text>}
        </Text>
      )

      const contextLine = line(
        'Context',
        terminalBar(contextPct ?? 0, undefined, undefined, cells),
        hueFor('context', ctxLevel),
        contextText,
        warmColor('context', ctxLevel),
        { reset: contextDetail },
      )
      const limitLines = views.map(view =>
        line(
          view.label,
          terminalBar(view.used, view.projected, view.elapsed, cells),
          hueFor(view.kind, view.level),
          `${Math.round(view.used)}%`,
          warmColor(view.kind, view.level),
          detailOf(view),
        ),
      )
      const { model, effort } = turnInfo
      const modelText = [modelName(model ?? data.model), effort === undefined ? undefined : `${EFFORT_LABELS[effort] ?? effort} effort`]
        .filter(Boolean)
        .join(' · ')

      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="column" paddingX={1}>
            {alert === undefined ? null : (
              <Text wrap="truncate-end">
                <Text color={HUE.hot}>● </Text>
                <Text bold>{alert}</Text>
              </Text>
            )}
            {contextLine}
            {limitLines}
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Text wrap="truncate-end">
                <Text color="subtle">{'Session'.padEnd(9)}</Text>
                <Text bold>{sessionTime}</Text>
                <Text color="subtle">{[costText === '' ? '' : `  API ≈ ${costText}`, modelText === '' ? '' : `  ${modelText}`].join('')}</Text>
              </Text>
              <Box flexDirection="row" columnGap={1}>
                {buttons}
              </Box>
            </Box>
          </Box>
        </Box>
      )
    }

    // ---------- desktop ----------

    // Only an SVG that animates needs the sandboxed frame; the rest draw as plain images.
    const lane = (key: string, label: string, svg: string, alt: string, isAnimated: boolean, percent: string, percentColor: string | undefined, detail: Detail) => (
      // The label, bar and percent keep their size so every row lines up; the detail takes what's left and truncates.
      <Box key={key} flexDirection="row" alignItems="center" columnGap={1}>
        <Box key={`${key}-label`} width={8} flexShrink={0}>
          <Text color="subtle">{label}</Text>
        </Box>
        <Box key={`${key}-bar`} flexShrink={0}>
          {isAnimated ? <Svg source={svg} alt={alt} width={190} height={16} isInteractive /> : <Svg source={svg} alt={alt} width={190} height={16} />}
        </Box>
        <Box key={`${key}-percent`} width={5} flexShrink={0} justifyContent="flex-end">
          <Text bold tabular color={percentColor}>
            {percent}
          </Text>
        </Box>
        <Box key={`${key}-detail`} flexGrow={1} flexShrink={1} width={0}>
          <Text color="subtle" wrap="truncate-end">
            {detail.reset}
            {detail.pace === undefined ? null : <Text color={detail.paceColor}>{` · ${detail.pace}`}</Text>}
          </Text>
        </Box>
      </Box>
    )

    const lanes: RenderChildren[] = [
      lane(
        'context',
        'Context',
        contextSvg(contextPct ?? 0, (parts?.segments ?? []).map(segment => segment.tokens), parts?.autoCompactAt, e.props.isWorking, ctxLevel),
        contextPct === undefined ? 'Context: no reading yet' : `Context ${contextPct}% used`,
        e.props.isWorking,
        contextText,
        warmColor('context', ctxLevel),
        { reset: contextDetail },
      ),
      ...views.map(view =>
        lane(
          `limit-${view.kind}`,
          view.label,
          laneSvg(view),
          `${view.label} ${Math.round(view.used)}% used`,
          view.runsOutAt !== undefined,
          `${Math.round(view.used)}%`,
          warmColor(view.kind, view.level),
          detailOf(view),
        ),
      ),
    ]

    const session = (
      <Box key="session" flexDirection="column" minWidth={14} flexShrink={0}>
        <Text>
          <Text color="subtle">Session </Text>
          <Text bold>{sessionTime}</Text>
        </Text>
        {history.length >= 3 ? <Svg source={sparkSvg(history, alert === undefined ? HUE.context : HUE.warn)} alt="Cost over the session" width={96} height={20} /> : null}
        {costText === '' ? null : <Text color="subtle">{costText}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" paddingX={1} rowGap={1}>
          {alert === undefined ? null : (
            <Box key="alert" flexDirection="row" alignItems="center" columnGap={1}>
              <Svg source={ALERT_DOT} alt="Warning" width={10} height={10} isInteractive />
              <Text weight="medium">{alert}</Text>
            </Box>
          )}
          <Box key="card" flexDirection="row" alignItems="center" columnGap={3}>
            <Box key="lanes" flexDirection="column" flexGrow={1} flexShrink={1} width={0}>
              {lanes}
            </Box>
            {session}
            {/* Always a gap: a Box of Buttons without one is spaced by the desktop's own rule, which stacked them on top of each other. */}
            <Box key="actions" flexDirection="column" alignItems="flex-end" justifyContent="center" gap="xs" flexShrink={0}>
              {buttons}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
