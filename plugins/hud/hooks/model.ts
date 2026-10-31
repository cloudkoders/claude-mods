// Turns raw usage figures into what the card shows: pace, projection, levels and text.
// Pure functions, no `$`, so they are tested on their own.
import type { Limit } from '../types'

export type Level = 'ok' | 'warn' | 'hot'

export type LimitView = {
  kind: string
  label: string
  used: number
  // Share of the window's time gone by, 0..1: the pace tick.
  elapsed?: number
  // Percent used at reset if spending keeps this rate. Hidden early in a window.
  projected?: number
  // When the limit runs out, if that comes before the reset.
  runsOutAt?: number
  resetsAt?: number
  // The window already reset: `used` is from before it, until the next API response brings a new figure.
  hasReset?: boolean
  level: Level
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * DAY }

const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', spend_limit: 'Spend' }

// Early readings swing too much to project from.
const MIN_ELAPSED = 0.1

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const levelOf = (used: number, projected: number | undefined, runsOut: boolean): Level =>
  runsOut || used >= 90 ? 'hot' : used >= 70 || (projected ?? 0) >= 95 ? 'warn' : 'ok'

export const limitView = (limit: Limit, now: number): LimitView => {
  const used = limit.percentUsed
  const window = WINDOW_MS[limit.kind]
  const resetsAt = limit.resetsAt === undefined ? undefined : new Date(limit.resetsAt).getTime()
  const view: LimitView = { kind: limit.kind, label: LABELS[limit.kind] ?? limit.kind, used, level: 'ok' }

  if (resetsAt !== undefined && !Number.isNaN(resetsAt)) {
    view.resetsAt = resetsAt

    if (resetsAt <= now) {
      view.hasReset = true

      return view
    }

    if (window !== undefined) {
      const elapsed = clamp(1 - (resetsAt - now) / window, 0, 1)
      view.elapsed = elapsed

      if (elapsed >= MIN_ELAPSED) {
        view.projected = used / elapsed

        if (view.projected > 100) {
          const perMs = used / (elapsed * window)
          view.runsOutAt = now + (100 - used) / perMs
        }
      }
    }
  }

  view.level = levelOf(used, view.projected, view.runsOutAt !== undefined)

  return view
}

export const contextLevel = (percent: number | undefined): Level =>
  percent === undefined ? 'ok' : percent >= 90 ? 'hot' : percent >= 70 ? 'warn' : 'ok'

// 9m, 1h 17m, 2d 4h. Never negative.
export const span = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / MINUTE))

  if (minutes < 60) {
    return `${minutes}m`
  }

  if (minutes < 24 * 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  const hours = Math.round(minutes / 60)

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const toMinute = (ms: number) => new Date(Math.round(ms / MINUTE) * MINUTE)

// 4:27 PM; 5 PM on the hour.
export const clockTime = (ms: number) => {
  const date = toMinute(ms)
  const hours = date.getHours()
  const minutes = date.getMinutes()

  return `${hours % 12 || 12}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`} ${hours < 12 ? 'AM' : 'PM'}`
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// A moment ahead: 4:27 PM today, Sun 3 PM later on.
export const whenText = (at: number, now: number) =>
  sameDay(toMinute(at), new Date(now)) ? clockTime(at) : `${DAYS[toMinute(at).getDay()]} ${clockTime(at)}`

// Within a day: resets in 3h 20m. Within six days: resets Mon 5 PM. Further out: resets Oct 21.
export const resetText = (resetsAt: number, now: number) => {
  const ms = resetsAt - now

  if (ms < DAY) {
    return `resets in ${span(ms)}`
  }

  const date = new Date(resetsAt)

  return ms < 6 * DAY ? `resets ${DAYS[date.getDay()]} ${clockTime(resetsAt)}` : `resets ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// The detail line in two parts, so the pace part can take the lane's warm color.
export const laneParts = (view: LimitView, now: number): { reset: string; pace?: string } => {
  const reset =
    view.resetsAt === undefined ? '' : view.hasReset ? `reset at ${whenText(view.resetsAt, now)}` : resetText(view.resetsAt, now)
  const pace =
    view.runsOutAt !== undefined
      ? `out ~${whenText(view.runsOutAt, now)}`
      : view.projected !== undefined
        ? `lands ~${Math.round(view.projected)}%`
        : undefined

  return pace === undefined ? { reset } : { reset, pace }
}

export const laneDetail = (view: LimitView, now: number) => {
  const { reset, pace } = laneParts(view, now)

  return [reset, pace].filter(Boolean).join(' · ')
}

const ALERT_NAMES: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', spend_limit: 'Spend limit' }

// One line, only when a limit will run out before it resets.
export const alertText = (views: LimitView[], contextPercent: number | undefined, now: number) => {
  const out = views.find(view => view.runsOutAt !== undefined)

  if (out?.runsOutAt === undefined) {
    return undefined
  }

  const name = ALERT_NAMES[out.kind] ?? `${out.label} limit`
  const early = out.resetsAt === undefined ? '' : `, ${span(out.resetsAt - out.runsOutAt)} before it resets`
  const context = (contextPercent ?? 0) >= 70 ? ` Context is ${contextPercent}% full.` : ''

  return `${name} runs out around ${whenText(out.runsOutAt, now)}${early}.${context}`
}

export const tokens = (count: number) =>
  count >= 1_000_000
    ? `${+(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`
    : count >= 1_000
      ? `${Math.round(count / 1_000)}k`
      : `${count}`

export const money = (usd: number) => `$${usd.toFixed(2)}`

// Cost per hour, once the session is old enough for the figure to mean something.
export const burnRate = (costUsd: number | undefined, startedAt: number, now: number) => {
  const ms = now - startedAt

  if (costUsd === undefined || ms < 5 * MINUTE) {
    return undefined
  }

  return `${money(costUsd / (ms / HOUR))}/h`
}

// claude-opus-5-5[1m] -> Opus 5.5 1M; claude-haiku-4-5-20251001 -> Haiku 4.5
export const modelName = (id: string) => {
  const isLong = /\[1m\]/i.test(id)
  const parts = id
    .replace(/\[.*?\]/g, '')
    .replace(/^claude-/, '')
    .split('-')
    .filter(part => !/^\d{8}$/.test(part))
  const words = parts.filter(part => !/^\d+$/.test(part))
  const version = parts.filter(part => /^\d+$/.test(part)).join('.')
  const family = words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

  return [family || id, version, isLong ? '1M' : ''].filter(Boolean).join(' ')
}
