import { expect, test } from 'claude-code/testing'

import { alertText, burnRate, clockTime, contextLevel, laneDetail, limitView, modelName, money, resetText, span, tokens, whenText } from './model'

// Local times, on dates clear of daylight-saving changes. Wed Oct 14 2026, 4 PM.
const NOW = new Date(2026, 9, 14, 16, 0).getTime()
const MIN = 60_000
const H = 60 * MIN
const iso = (ms: number) => new Date(ms).toISOString()
const five = (used: number, inMs: number) => limitView({ kind: 'five_hour', percentUsed: used, resetsAt: iso(NOW + inMs) }, NOW)

test('a 5-hour window on track lands under 100', () => {
  const v = five(51, H + 44 * MIN)
  expect(v.label).toBe('5-hour')
  expect(Math.round(v.elapsed! * 10_000)).toBe(6533)
  expect(Math.round(v.projected!)).toBe(78)
  expect(v.runsOutAt).toBeUndefined()
  expect(v.level).toBe('ok')
  expect(laneDetail(v, NOW)).toBe('resets in 1h 44m · lands ~78%')
})

test('a 5-hour window that will run out says when', () => {
  const v = five(88, H + 44 * MIN)
  expect(v.level).toBe('hot')
  expect(clockTime(v.runsOutAt!)).toBe('4:27 PM')
  expect(laneDetail(v, NOW)).toBe('resets in 1h 44m · out ~4:27 PM')
  expect(alertText([v], 74, NOW)).toBe('5-hour limit runs out around 4:27 PM, 1h 17m before it resets. Context is 74% full.')
  expect(alertText([five(51, H + 44 * MIN)], 74, NOW)).toBeUndefined()
})

test('too early in the window: no projection', () => {
  const v = five(2, 4 * H + 40 * MIN)
  expect(v.projected).toBeUndefined()
  expect(laneDetail(v, NOW)).toBe('resets in 4h 40m')
})

test('weekly resets show a day and time inside six days', () => {
  const v = limitView({ kind: 'seven_day', percentUsed: 7, resetsAt: iso(new Date(2026, 9, 19, 17, 0).getTime()) }, NOW)
  expect(v.label).toBe('Weekly')
  expect(laneDetail(v, NOW)).toBe('resets Mon 5 PM · lands ~25%')
  expect(resetText(NOW + 6.5 * 24 * H, NOW)).toBe('resets Oct 21')
})

test('warn from usage or from projection', () => {
  expect(five(72, 30 * MIN).level).toBe('warn') // used >= 70, projects ~80
  expect(five(66, H + 30 * MIN).level).toBe('ok') // projects ~94
  expect(five(67, H + 30 * MIN).level).toBe('warn') // projects ~96
})

test('a window that already rolled over clamps', () => {
  const v = five(40, -5 * MIN)
  expect(v.elapsed).toBe(1)
  expect(v.projected).toBe(40)
  expect(resetText(NOW - 5 * MIN, NOW)).toBe('resets in 0m')
})

test('a spend limit past 100 is hot with no pace', () => {
  const v = limitView({ kind: 'spend_limit', percentUsed: 112 }, NOW)
  expect(v.label).toBe('Spend')
  expect(v.level).toBe('hot')
  expect(v.elapsed).toBeUndefined()
  expect(v.projected).toBeUndefined()
})

test('formatting', () => {
  expect(span(9 * MIN)).toBe('9m')
  expect(span(77 * MIN + 16_000)).toBe('1h 17m')
  expect(span(52 * H)).toBe('2d 4h')
  expect(span(-1)).toBe('0m')
  expect(tokens(950)).toBe('950')
  expect(tokens(97_000)).toBe('97k')
  expect(tokens(1_000_000)).toBe('1M')
  expect(tokens(1_500_000)).toBe('1.5M')
  expect(money(0.69)).toBe('$0.69')
  expect(money(41.2)).toBe('$41.20')
  expect(burnRate(0.69, NOW - 9 * MIN, NOW)).toBe('$4.60/h')
  expect(burnRate(0.2, NOW - 4 * MIN, NOW)).toBeUndefined()
  expect(burnRate(undefined, NOW - H, NOW)).toBeUndefined()
  expect(clockTime(new Date(2026, 9, 14, 17, 0).getTime())).toBe('5 PM')
  expect(whenText(new Date(2026, 9, 18, 15, 0).getTime(), NOW)).toBe('Sun 3 PM')
  expect(contextLevel(74)).toBe('warn')
  expect(contextLevel(91)).toBe('hot')
  expect(contextLevel(undefined)).toBe('ok')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
})
