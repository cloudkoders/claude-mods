import { expect, test } from 'claude-code/testing'

import { HUE } from './draw'
import { counterSvg, gaugeSvg } from './instrument'
import { ringsSvg } from './orbit'
import type { Ring } from './orbit'

const context: Ring = { kind: 'context', label: 'Context', used: 10, level: 'ok' }
const five: Ring = { kind: 'five_hour', label: '5-hour', used: 51, elapsed: 0.65, level: 'ok' }
const week: Ring = { kind: 'seven_day', label: 'Weekly', used: 7, elapsed: 0.28, level: 'ok' }

test('orbit: one ring per bar, in its hue, with a hover title each', () => {
  const svg = ringsSvg([context, five, week], false)
  expect(svg).toContain(HUE.context)
  expect(svg).toContain(HUE.five_hour)
  expect(svg).toContain(HUE.seven_day)
  expect(svg.match(/<title>/g)?.length).toBe(3)
  expect(svg).toContain('<title>5-hour: 51% used, 65% of the window gone</title>')
  expect(svg).toContain('<title>Context: 10% used</title>')
  expect(svg).not.toContain('<animate')
  expect(svg.length).toBeLessThan(131_072)
})

test('orbit: a pace notch only where the window has a pace', () => {
  expect(ringsSvg([context], false)).not.toContain('#8E8E93')
  expect(ringsSvg([context, five], false)).toContain('#8E8E93')
})

test('orbit: a ring that runs out glows; the context ring has a dot while Claude works', () => {
  const hot = ringsSvg([context, { ...five, used: 88, level: 'hot' }], false)
  expect(hot).toContain(HUE.hot)
  expect(hot).toContain('<animate attributeName="stroke-opacity"')
  expect(ringsSvg([context, five], true)).toContain('<animateTransform attributeName="transform" type="rotate"')
})

test('orbit: four bars still fit inside the drawing', () => {
  const svg = ringsSvg([context, five, week, { kind: 'spend_limit', label: 'Spend', used: 40, level: 'ok' }], false)
  const radii = [...svg.matchAll(/ r="([\d.]+)"/g)].map(match => Number(match[1]))
  expect(Math.min(...radii)).toBeGreaterThanOrEqual(5)
  expect(Math.max(...radii)).toBeLessThanOrEqual(30)
})

test('instrument: a dial with the percent inside, pace triangle and projection arc', () => {
  const svg = gaugeSvg({ ...five, projected: 78 })
  expect(svg).toContain('>51<')
  expect(svg).toContain(HUE.five_hour)
  expect(svg).toContain('<path d="M') // the arc
  expect(svg).toContain('stroke-dasharray="1.5 2.5"') // projection
  expect(svg).toContain('fill="#8E8E93"') // pace triangle
  expect(svg).not.toContain('<animate')
})

test('instrument: no pace or projection without them; a hot dial glows', () => {
  const plain = gaugeSvg(context)
  expect(plain).not.toContain('stroke-dasharray="1.5 2.5"')
  expect(plain).not.toContain('fill="#8E8E93"')
  expect(gaugeSvg({ ...five, used: 92, level: 'hot' })).toContain('<animate attributeName="stroke-opacity"')
  expect(gaugeSvg({ ...five, used: 112, level: 'hot' })).toContain('>112<')
})

test('instrument: the cost counter has one tile per character', () => {
  const svg = counterSvg('$41.20')
  expect(svg.match(/<rect /g)?.length).toBe(6)
  for (const ch of ['$', '4', '1', '.', '2', '0']) {
    expect(svg).toContain(`>${ch}</text>`)
  }
})
