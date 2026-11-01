// Instrument mode's drawing: a small dial per bar, and the session cost on a flip counter.
// Pure. Colors work on light and dark alike, since an Svg can't read the app's theme.
import { hueFor } from './draw'
import type { Ring } from './orbit'

export type Dial = Ring & { projected?: number }

const TRACK = 'rgba(128,128,128,0.22)'
const TICK = '#8E8E93'
const FONT = "-apple-system, 'SF Pro Text', Inter, system-ui, sans-serif"
// A 270-degree sweep with the gap at the bottom, like a gauge.
const START = 135
const SWEEP = 270

const n = (value: number) => +value.toFixed(2)
const clamp = (value: number) => Math.min(100, Math.max(0, value))

export const gaugeSvg = (dial: Dial, size = 56): string => {
  const c = size / 2
  const r = 19
  const color = hueFor(dial.kind, dial.level)
  const point = (degrees: number, rr: number): [number, number] => {
    const angle = (degrees * Math.PI) / 180

    return [n(c + rr * Math.cos(angle)), n(c + rr * Math.sin(angle))]
  }
  const at = (percent: number) => START + (clamp(percent) / 100) * SWEEP
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(at(from), r)
    const [x2, y2] = point(at(to), r)
    const large = ((clamp(to) - clamp(from)) / 100) * SWEEP > 180 ? 1 : 0

    return `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  const ticks = Array.from({ length: 11 }, (_, index) => {
    const degrees = START + (index / 10) * SWEEP
    const [x1, y1] = point(degrees, r + 3.5)
    const [x2, y2] = point(degrees, r + (index % 5 === 0 ? 6.5 : 5))

    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${TICK}" stroke-opacity="${index % 5 === 0 ? 0.8 : 0.45}" stroke-width="1"/>`
  }).join('')

  const used = clamp(dial.used)
  const parts = [ticks, `<path d="${arc(0, 100)}" fill="none" stroke="${TRACK}" stroke-width="4.5" stroke-linecap="round"/>`]

  if (dial.projected !== undefined && dial.projected > dial.used && used < 100) {
    parts.push(`<path d="${arc(used, Math.min(100, dial.projected))}" fill="none" stroke="${color}" stroke-opacity="0.4" stroke-width="4.5" stroke-dasharray="1.5 2.5"/>`)
  }

  if (used > 0) {
    if (dial.level === 'hot') {
      parts.push(
        `<path d="${arc(0, used)}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" filter="url(#hud-glow)"><animate attributeName="stroke-opacity" values="0.1;0.8;0.1" dur="2.2s" repeatCount="indefinite"/></path>`,
      )
    }

    parts.push(`<path d="${arc(0, used)}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>`)
  }

  // Even pace: a small triangle on the rim, pointing in.
  if (dial.elapsed !== undefined) {
    const degrees = at(dial.elapsed * 100)
    const [tx, ty] = point(degrees, r + 4)
    parts.push(`<g transform="rotate(${n(degrees + 90)} ${tx} ${ty})"><path d="M${tx} ${n(ty - 0.5)} l-2.6 -4 h5.2 z" fill="${TICK}"/></g>`)
  }

  parts.push(
    `<text x="${c}" y="${c + 5}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${color}" style="font-variant-numeric:tabular-nums">${Math.round(dial.used)}<tspan font-size="8" dx="0.5" fill="${color}" fill-opacity="0.6">%</tspan></text>`,
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${dial.label} ${Math.round(dial.used)}% used"><defs><filter id="hud-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>${parts.join('')}</svg>`
}

// The session cost on dark tiles with light digits, like a mechanical counter: it reads on light and dark alike.
export const counterSvg = (text: string): string => {
  const width = 13
  const height = 22
  const gap = 2
  const chars = [...text]
  const total = chars.length * width + Math.max(0, chars.length - 1) * gap
  const tiles = chars
    .map((ch, index) => {
      const x = index * (width + gap)

      return `<rect x="${x}" y="0" width="${width}" height="${height}" rx="3" fill="#2C2C2E" stroke="rgba(128,128,128,0.45)" stroke-width="1"/><text x="${n(x + width / 2)}" y="16" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="#FFFFFF" style="font-variant-numeric:tabular-nums">${ch}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" role="img" aria-label="Session cost ${text}">${tiles}</svg>`
}
