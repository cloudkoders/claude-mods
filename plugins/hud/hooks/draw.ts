// SVG strings for the desktop card and block-character runs for the terminal.
// Pure functions. SVG can't read the app's theme, so neutrals here work on light and dark alike.
import type { Level, LimitView } from './model'

// Cool hues mean fine. Warm hues mean look.
export const HUE = {
  context: '#8B7CF6',
  five_hour: '#12B5CB',
  seven_day: '#4F86F7',
  other: '#4F86F7',
  warn: '#FFA51F',
  hot: '#FF4F4F',
} as const

const TRACK = 'rgba(128,128,128,0.22)'
const TICK = '#8E8E93'
// Context segments, lightest first; the conversation (last) takes the context hue.
const SHADES = ['#C9C1FB', '#B5AAF9', '#A194F8', '#9A8CF7', '#9282F6']

const BAR = 8

export const hueFor = (kind: string, level: Level): string => {
  if (level !== 'ok') {
    return HUE[level]
  }

  return kind === 'five_hour' ? HUE.five_hour : kind === 'seven_day' ? HUE.seven_day : kind === 'context' ? HUE.context : HUE.other
}

// Ids inside one SVG must not clash with another SVG drawn on the same page.
let serial = 0
const nextId = (prefix: string) => `hud-${prefix}${++serial}`

const n = (value: number) => +value.toFixed(2)

const frame = (width: number, height: number, label: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${body}</svg>`

// x for a percentage along a bar `width` wide, inside a 1px margin.
const along = (width: number) => (percent: number) => n(1 + (Math.min(100, Math.max(0, percent)) / 100) * (width - 2))

const track = (width: number, y: number) => `<rect x="1" y="${y - BAR / 2}" width="${width - 2}" height="${BAR}" rx="${BAR / 2}" fill="${TRACK}"/>`

const paceTick = (x: number, height: number) =>
  `<line x1="${x}" y1="1.5" x2="${x}" y2="${height - 1.5}" stroke="${TICK}" stroke-width="1.4" stroke-linecap="round"/>`

// One limit: solid is used, the tick is even pace, the dashed tail is where it lands at reset.
export const laneSvg = (view: LimitView, width = 190): string => {
  const height = 16
  const y = height / 2
  const x = along(width)
  const color = hueFor(view.kind, view.level)
  const end = x(view.used)
  const parts = [track(width, y)]

  if (view.runsOutAt !== undefined) {
    parts.push(
      `<line x1="${n(end + 3)}" y1="${y}" x2="${width - 4}" y2="${y}" stroke="${color}" stroke-width="2" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>`,
      `<rect x="${width - 3}" y="${y - 6}" width="2.5" height="12" rx="1.25" fill="${HUE.hot}"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite"/></rect>`,
    )
  } else if (view.projected !== undefined && view.projected > view.used) {
    const to = x(view.projected)
    parts.push(
      `<line x1="${n(end + 3)}" y1="${y}" x2="${to}" y2="${y}" stroke="${color}" stroke-opacity="0.75" stroke-width="2" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>`,
      `<circle cx="${to}" cy="${y}" r="2.6" fill="none" stroke="${color}" stroke-width="1.5"/>`,
    )
  }

  if (view.used > 0) {
    parts.push(`<rect x="1" y="${y - BAR / 2}" width="${n(Math.max(BAR, end - 1))}" height="${BAR}" rx="${BAR / 2}" fill="${color}"/>`)
  }

  if (view.elapsed !== undefined) {
    parts.push(paceTick(x(view.elapsed * 100), height))
  }

  return frame(width, height, `${view.label} ${Math.round(view.used)}% used`, parts.join(''))
}

// The context window, split by what fills it, with the auto-compact line and a sweep while Claude works.
export const contextSvg = (
  percent: number,
  segments: number[],
  autoCompactAt: number | undefined,
  isWorking: boolean,
  level: Level,
  width = 190,
): string => {
  const height = 16
  const y = height / 2
  const x = along(width)
  const end = x(percent)
  const clip = nextId('clip')
  const sweep = nextId('sweep')
  const total = segments.reduce((sum, tokens) => sum + tokens, 0)
  const last = segments.length - 1
  const lastColor = level === 'ok' ? HUE.context : HUE[level]
  const parts = [track(width, y)]

  if (percent > 0) {
    let at = 0
    const pieces =
      total > 0
        ? segments.map((tokens, index) => {
            const from = x(at)
            at += (tokens / total) * percent
            const color = index === last ? lastColor : SHADES[Math.min(index, SHADES.length - 1)]

            return `<rect x="${from}" y="${y - BAR / 2}" width="${n(Math.max(0.8, x(at) - from))}" height="${BAR}" fill="${color}"/>`
          })
        : [`<rect x="1" y="${y - BAR / 2}" width="${n(end - 1)}" height="${BAR}" fill="${lastColor}"/>`]

    parts.push(
      `<defs><clipPath id="${clip}"><rect x="1" y="${y - BAR / 2}" width="${n(Math.max(BAR, end - 1))}" height="${BAR}" rx="${BAR / 2}"/></clipPath>`,
      isWorking
        ? `<linearGradient id="${sweep}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="1.6s" repeatCount="indefinite"/></linearGradient>`
        : '',
      '</defs>',
      `<g clip-path="url(#${clip})">${pieces.join('')}${isWorking ? `<rect x="1" y="${y - BAR / 2}" width="${n(end - 1)}" height="${BAR}" fill="url(#${sweep})"/>` : ''}</g>`,
    )
  }

  if (autoCompactAt !== undefined) {
    const at = x(autoCompactAt * 100)
    parts.push(`<path d="M${at} 2 v${height - 4}" stroke="${TICK}" stroke-width="1" stroke-dasharray="1.5 1.5"/>`)
  }

  return frame(width, height, `Context ${Math.round(percent)}% used`, parts.join(''))
}

// Cost over the session: a line with a soft fill under it and a dot at the latest reading.
export const sparkSvg = (values: number[], color: string, width = 96, height = 20): string => {
  const max = Math.max(...values) || 1
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const points = values.map((value, index) => [
    n((index / Math.max(1, values.length - 1)) * (width - 4) + 2),
    n(height - 3 - ((value - min) / range) * (height - 7)),
  ])
  const line = points.map(([px, py]) => `${px},${py}`).join(' ')
  const [lastX, lastY] = points[points.length - 1] ?? [2, height - 3]
  const fade = nextId('fade')

  return frame(
    width,
    height,
    'Cost over the session',
    [
      `<defs><linearGradient id="${fade}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`,
      `<polygon points="2,${height} ${line} ${width - 2},${height}" fill="url(#${fade})"/>`,
      `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<circle cx="${lastX}" cy="${lastY}" r="2.4" fill="${color}"/>`,
    ].join(''),
  )
}

export type Run = { text: string; part: 'used' | 'projected' | 'tick' | 'empty' }

const GLYPH: Record<Run['part'], string> = { used: '█', projected: '▒', tick: '│', empty: '░' }

// The terminal's bar: █ used, ▒ projected, │ pace tick, ░ empty, merged into runs of one part.
export const terminalBar = (used: number, projected: number | undefined, elapsed: number | undefined, cells: number): Run[] => {
  const cellsOf = (percent: number) => Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells)
  // Any use at all shows at least one cell.
  const usedCells = used > 0 ? Math.max(1, cellsOf(used)) : 0
  const projectedCells = projected === undefined ? usedCells : Math.max(usedCells, cellsOf(projected))
  const tickAt = elapsed === undefined ? -1 : Math.min(cells - 1, Math.round(elapsed * cells))
  const runs: Run[] = []

  for (let cell = 0; cell < cells; cell++) {
    const part: Run['part'] = cell === tickAt ? 'tick' : cell < usedCells ? 'used' : cell < projectedCells ? 'projected' : 'empty'
    const previous = runs[runs.length - 1]

    if (previous?.part === part) {
      previous.text += GLYPH[part]
    } else {
      runs.push({ text: GLYPH[part], part })
    }
  }

  return runs
}
