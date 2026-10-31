import { expect, test } from 'claude-code/testing'

import { contextSvg, HUE, hueFor, laneSvg, sparkSvg, terminalBar } from './draw'
import type { LimitView } from './model'

const view = (over: Partial<LimitView>): LimitView => ({ kind: 'five_hour', label: '5-hour', used: 51, elapsed: 0.65, projected: 78, level: 'ok', ...over })

test('hues', () => {
  expect(hueFor('five_hour', 'ok')).toBe(HUE.five_hour)
  expect(hueFor('seven_day', 'warn')).toBe(HUE.warn)
  expect(hueFor('spend_limit', 'hot')).toBe(HUE.hot)
})

test('a lane on track has fill, tick and a hollow projection dot', () => {
  const svg = laneSvg(view({}))
  expect(svg).toContain(HUE.five_hour)
  expect(svg).toContain('#8E8E93')
  expect(svg).toContain('stroke-dasharray="2.5 2.5"')
  expect(svg).toContain('fill="none"')
  expect(svg).not.toContain('<animate')
})

test('a lane that runs out ends at a blinking wall', () => {
  const svg = laneSvg(view({ used: 88, projected: 135, runsOutAt: 1, level: 'hot' }))
  expect(svg).toContain(HUE.hot)
  expect(svg).toContain('<animate attributeName="opacity"')
})

test('no projection and no tick when the view has none', () => {
  const svg = laneSvg(view({ kind: 'spend_limit', used: 112, elapsed: undefined, projected: undefined, level: 'hot' }))
  expect(svg).not.toContain('stroke-dasharray')
  expect(svg).not.toContain('#8E8E93')
})

test('context: segments, compact marker, shimmer only while working', () => {
  const idle = contextSvg(10, [6, 14, 22, 5, 3, 47], 0.93, false, 'ok')
  expect(idle).toContain('#C9C1FB')
  expect(idle).toContain(HUE.context)
  expect(idle).not.toContain('animateTransform')
  expect(contextSvg(10, [6, 14, 22, 5, 3, 47], 0.93, true, 'ok')).toContain('animateTransform')
  expect(contextSvg(74, [6, 14, 22, 5, 3, 690], undefined, false, 'warn')).toContain(HUE.warn)
})

test('sparkline and size limit', () => {
  const svg = sparkSvg(
    Array.from({ length: 24 }, (_, i) => i * 1.7),
    HUE.context,
  )
  expect(svg).toContain('<polyline')
  expect(svg.length).toBeLessThan(131_072)
})

test('terminal bar runs', () => {
  expect(terminalBar(51, 78, 0.65, 20)).toEqual([
    { text: '██████████', part: 'used' },
    { text: '▒▒▒', part: 'projected' },
    { text: '│', part: 'tick' },
    { text: '▒▒', part: 'projected' },
    { text: '░░░░', part: 'empty' },
  ])
  expect(terminalBar(1, undefined, undefined, 10)).toEqual([
    { text: '█', part: 'used' },
    { text: '░░░░░░░░░', part: 'empty' },
  ])
  expect(terminalBar(112, undefined, undefined, 10)).toEqual([{ text: '██████████', part: 'used' }])
})
