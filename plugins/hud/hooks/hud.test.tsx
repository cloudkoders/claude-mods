import { expect, mock, test } from 'claude-code/testing'

// Wed Oct 14 2026, 4 PM local.
const NOW = new Date(2026, 9, 14, 16, 0).getTime()
const MIN = 60_000
const H = 60 * MIN

const band = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} } as any

const breakdown = {
  categories: [
    { name: 'System prompt', tokens: 6_000, kind: 'used', color: 'promptBorder', isDeferred: false },
    { name: 'System tools', tokens: 14_000, kind: 'used', color: 'inactive', isDeferred: false },
    { name: 'Messages', tokens: 77_000, kind: 'used', color: 'permission', isDeferred: false },
    { name: 'Free space', tokens: 903_000, kind: 'free', color: 'inactive', isDeferred: false },
  ],
  autoCompactThreshold: 930_000,
}

const baseUsage = () =>
  ({
    startedAt: NOW - 9 * MIN,
    context: { tokens: 97_000, window: 1_000_000, percent: 10 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 51, resetsAt: new Date(NOW + H + 44 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 7, resetsAt: new Date(2026, 9, 19, 17, 0).toISOString() },
    ],
    cost: { usd: 0.69 },
  }) as any

type Setup = { usage?: any; calls?: string[]; failUsage?: boolean }

const setup = async ($: any, on: any, { usage = baseUsage(), calls = [], failUsage = false }: Setup = {}) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', (_$: unknown, e: { breakdown?: string }) => {
    if (failUsage) {
      throw new Error('not ready')
    }

    return { value: e?.breakdown ? { ...usage, context: { ...usage.context, breakdown } } : usage }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('command.register', () => ({ value: undefined }) as any)
  on('command.list', () => ({ value: [{ name: 'clear' }, { name: 'compact' }] }) as any)
  on('command.run', (_$: unknown, e: { command: string }) => {
    calls.push(`/${e.command}`)

    return { text: '' }
  })
  on('model.fork', () => {
    calls.push('fork')

    return { value: { isAnswered: true, text: 'Goal: ship the HUD.', usage: {} } } as any
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as any)
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    calls.push('toast: ' + e.text)

    return { value: undefined } as any
  })
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as const)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  return clock
}

// The drawn tree's Svg whose alt is `alt` (ui.find matches an Svg by type, key or text, not alt).
const svgByAlt = (node: any, alt: string): any => {
  if (node === null || typeof node !== 'object') {
    return undefined
  }

  if (node.type === 'Svg' && node.props?.alt === alt) {
    return node
  }

  for (const child of node.children ?? []) {
    const found = svgByAlt(child, alt)

    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

const draw = async ($: any, surface: 'desktop' | 'terminal', props = band) => {
  const ui = await $.ui.mount({ plugin: 'hud', surface, component: 'AbovePrompt', props })

  return { ui, drawn: JSON.stringify(await ui.drawn()) }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`draws the card on the ${surface}`, async ($, on) => {
    await setup($, on)
    const { drawn } = await draw($, surface)

    expect(drawn).toContain('97k of 1M tokens')
    // The detail is two Texts so its pace part can take the lane's warm color.
    expect(drawn).toContain('resets in 1h 44m')
    expect(drawn).toContain(' · lands ~78%')
    expect(drawn).toContain('Weekly')
    expect(drawn).toContain('$0.69')
    expect(drawn).toContain('"label":"Compact"')
    expect(drawn).toContain('"label":"Fresh start"')
    // What other mods draw in the band stays, above the card.
    expect(drawn).toContain('"type":"engine"')
    expect(drawn.includes('"type":"Svg"')).toBe(surface === 'desktop')
    expect(drawn.includes('█')).toBe(surface === 'terminal')
    // The desktop shows the model under the message box already.
    expect(drawn.includes('Opus 5.5 1M')).toBe(surface === 'terminal')
  })
}

test('nothing but the engine before the first reading', async ($, on) => {
  await setup($, on, { failUsage: true })
  const { drawn } = await draw($, 'desktop')

  expect(drawn).toContain('"type":"engine"')
  expect(drawn).not.toContain('Context')
  expect(drawn).not.toContain('Compact')
})

test('no rate limits: no limit lanes', async ($, on) => {
  await setup($, on, { usage: { ...baseUsage(), rateLimits: [] } })
  const { drawn } = await draw($, 'desktop')

  expect(drawn).not.toContain('5-hour')
  expect(drawn).toContain('97k of 1M tokens')
})

test('a limit that will run out raises the alert', async ($, on) => {
  const usage = baseUsage()
  usage.rateLimits[0].percentUsed = 88
  await setup($, on, { usage })
  const { drawn } = await draw($, 'desktop')

  expect(drawn).toContain('5-hour limit runs out around 4:27 PM, 1h 17m before it resets.')
  expect(drawn).toContain('out ~4:27 PM')
})

test('/hud off hides the card and /hud on brings it back', async ($, on) => {
  await setup($, on)
  const { ui } = await draw($, 'desktop')

  await $.command.run({ command: 'hud', args: 'off' } as any)
  expect(JSON.stringify(await ui.drawn())).not.toContain('97k of 1M tokens')

  await $.command.run({ command: 'hud', args: 'on' } as any)
  expect(JSON.stringify(await ui.drawn())).toContain('97k of 1M tokens')
})

test('Compact runs /compact', async ($, on) => {
  const calls: string[] = []
  await setup($, on, { calls })
  const { ui } = await draw($, 'desktop')
  await ui.press({ key: 'compact' })

  expect(calls).toContain('/compact')
})

test('Fresh start asks first, then hands off and clears', async ($, on) => {
  const calls: string[] = []
  await setup($, on, { calls })
  const { ui } = await draw($, 'desktop')

  await ui.press({ key: 'fresh' })
  expect(calls).toEqual([])
  expect(JSON.stringify(await ui.drawn())).toContain('Press again to start fresh')

  await ui.press({ key: 'fresh' })
  expect(calls.slice(0, 2)).toEqual(['fork', '/clear'])
})

test('a finished turn fills in what the context holds', async ($, on) => {
  await setup($, on)
  const before = await draw($, 'desktop')
  expect(before.drawn).not.toContain('#C9C1FB')

  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', category: null, explanation: null } as any)
  expect(JSON.stringify(await before.ui.drawn())).toContain('#C9C1FB')
})

test('the cost sparkline needs three readings', async ($, on) => {
  const usage = baseUsage()
  usage.cost.usd = 0.2
  const clock = await setup($, on, { usage })
  const { ui, drawn } = await draw($, 'desktop')
  expect(drawn).not.toContain('Cost over the session')

  usage.cost.usd = 0.4
  await clock.advance(30_000)
  usage.cost.usd = 0.69
  await clock.advance(30_000)
  expect(JSON.stringify(await ui.drawn())).toContain('Cost over the session')
})

test('no context figure yet still draws the card', async ($, on) => {
  await setup($, on, { usage: { ...baseUsage(), context: { window: 1_000_000 } } })
  const { drawn } = await draw($, 'desktop')

  expect(drawn).toContain('1M window')
  expect(drawn).toContain('5-hour')
})

test('a narrow terminal gets 10-cell bars', async ($, on) => {
  await setup($, on)
  const { drawn } = await draw($, 'terminal', { ...band, bodyColumns: 60 })

  // 5-hour at 51% with the pace tick at 65%: five used cells, two projected, then the tick.
  expect(drawn).toContain('"█████"')
  expect(drawn).toContain('"▒▒"')
  expect(drawn).not.toContain('░░░░░░░░░░')
})

test('no cost ledger: time only, no sparkline or rate', async ($, on) => {
  const usage = baseUsage()
  delete usage.cost
  await setup($, on, { usage })
  const { drawn } = await draw($, 'desktop')

  expect(drawn).toContain('9m')
  expect(drawn).not.toContain('Cost over the session')
  expect(drawn).not.toContain('/h')
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the projection text turns warm with its lane on the ${surface}`, async ($, on) => {
    const usage = baseUsage()
    usage.rateLimits[0].percentUsed = 88
    await setup($, on, { usage })
    const { ui } = await draw($, surface)

    const out = await ui.find({ type: 'Text', text: /^ ?· out ~4:27 PM$/ })
    expect(out?.props.color).toBe('#FF4F4F')
    const lands = await ui.find({ type: 'Text', text: /^ ?· lands ~25%$/ })
    expect(lands?.props.color).toBe('subtle')
  })
}

test('a new conversation (/clear) starts the session cost over', async ($, on) => {
  const usage = baseUsage()
  usage.cost.usd = 5
  const clock = await setup($, on, { usage })
  const { ui } = await draw($, 'desktop')
  usage.cost.usd = 10
  await clock.advance(30_000)
  usage.cost.usd = 15
  await clock.advance(30_000)
  expect(JSON.stringify(await ui.drawn())).toContain('Cost over the session')

  // /clear: the session restarts now and the engine keeps counting cost from where it was.
  usage.startedAt = NOW + 60_000
  usage.cost.usd = 15.1
  await clock.advance(30_000)
  const drawn = JSON.stringify(await ui.drawn())

  expect(drawn).toContain('$0.10')
  expect(drawn).not.toContain('$15.10')
  expect(drawn).not.toContain('Cost over the session')
})

test('a new conversation where the engine resets cost also starts over', async ($, on) => {
  const usage = baseUsage()
  usage.cost.usd = 5
  const clock = await setup($, on, { usage })
  const { ui } = await draw($, 'desktop')

  usage.startedAt = NOW + 30_000
  usage.cost.usd = 0.1
  await clock.advance(30_000)

  expect(JSON.stringify(await ui.drawn())).toContain('$0.10')
})

test('only animated SVGs are drawn interactive', async ($, on) => {
  await setup($, on)
  const calm = await draw($, 'desktop')
  expect(calm.drawn).not.toContain('"isInteractive":true')

  const working = await draw($, 'desktop', { ...band, isWorking: true })
  expect(svgByAlt(await working.ui.drawn(), 'Context 10% used')?.props.isInteractive).toBe(true)
})

test('a lane that runs out is drawn interactive so its wall blinks', async ($, on) => {
  const usage = baseUsage()
  usage.rateLimits[0].percentUsed = 88
  await setup($, on, { usage })
  const { ui } = await draw($, 'desktop')

  expect(svgByAlt(await ui.drawn(), '5-hour 88% used')?.props.isInteractive).toBe(true)
})

test('stacked buttons get a row between them so they never overlap', async ($, on) => {
  await setup($, on, { usage: { ...baseUsage(), rateLimits: [] } })
  const { ui } = await draw($, 'desktop')

  // A Box of Buttons with no `gap` is spaced by the desktop's own rule; the original card always sets one.
  expect((await ui.find({ type: 'Box', key: 'actions' }))?.props.gap).toBe('xs')
})

test('/hud answers in plain words', async ($, on) => {
  await setup($, on)

  expect((await $.command.run({ command: 'hud', args: 'off' } as any)).text).toBe('Card hidden. Run /hud to show it again.')
  expect((await $.command.run({ command: 'hud', args: 'on' } as any)).text).toBe('Card shown.')
})

test('fixed parts of a lane never shrink; the detail takes what is left and truncates', async ($, on) => {
  await setup($, on)
  const { ui } = await draw($, 'desktop')

  for (const key of ['context', 'limit-seven_day']) {
    expect((await ui.find({ type: 'Box', key: `${key}-label` }))?.props.flexShrink).toBe(0)
    expect((await ui.find({ type: 'Box', key: `${key}-bar` }))?.props.flexShrink).toBe(0)
    expect((await ui.find({ type: 'Box', key: `${key}-percent` }))?.props.flexShrink).toBe(0)
    const detail = await ui.find({ type: 'Box', key: `${key}-detail` })
    expect(detail?.props.flexGrow).toBe(1)
    expect(detail?.props.width).toBe(0)
  }
})

test('$/h appears once there is ten minutes of spending to measure', async ($, on) => {
  const usage = baseUsage()
  usage.cost.usd = 0.2
  const clock = await setup($, on, { usage })
  const { ui } = await draw($, 'desktop')
  usage.cost.usd = 0.7
  await clock.advance(10 * MIN)

  expect(JSON.stringify(await ui.drawn())).toContain('$0.70 · $3.00/h')
})
