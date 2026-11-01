// Orbit mode's drawing: nested rings, context innermost, one ring per limit going outward.
// Pure. Colors work on light and dark alike, since an Svg can't read the app's theme.
import { HUE, hueFor } from './draw'
import type { Level } from './model'

export type Ring = { kind: string; label: string; used: number; elapsed?: number; level: Level }

const TRACK = 'rgba(128,128,128,0.22)'
const TICK = '#8E8E93'
const STROKE = 5

const n = (value: number) => +value.toFixed(2)

export const ringsSvg = (rings: Ring[], isWorking: boolean, size = 64): string => {
  const c = size / 2
  const outer = c - 4
  // Rings sit a stroke and a hair apart, closer when there are many.
  const step = rings.length <= 1 ? 0 : Math.min(7, (outer - 7) / (rings.length - 1))
  const radius = (index: number) => n(outer - (rings.length - 1 - index) * step)

  const drawn = rings.map((ring, index) => {
    const r = radius(index)
    const color = hueFor(ring.kind, ring.level)
    const pct = Math.min(100, Math.max(0, ring.used))
    const arc = `cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${STROKE}" pathLength="100" stroke-dasharray="${n(pct)} 100" transform="rotate(-90 ${c} ${c})"`
    const title = `${ring.label}: ${Math.round(ring.used)}% used${ring.elapsed === undefined ? '' : `, ${Math.round(ring.elapsed * 100)}% of the window gone`}`
    const glow =
      ring.level === 'hot' && pct > 0
        ? `<circle ${arc} stroke="${color}" filter="url(#hud-glow)"><animate attributeName="stroke-opacity" values="0.15;0.75;0.15" dur="2.2s" repeatCount="indefinite"/></circle>`
        : ''
    const fill = pct > 0 ? `<circle ${arc} stroke="${color}" stroke-linecap="round"/>` : ''
    const notch =
      ring.elapsed === undefined
        ? ''
        : (() => {
            const angle = (ring.elapsed * 360 - 90) * (Math.PI / 180)
            const point = (rr: number): [number, number] => [n(c + rr * Math.cos(angle)), n(c + rr * Math.sin(angle))]
            const [x1, y1] = point(r - 3.4)
            const [x2, y2] = point(r + 3.4)

            return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${TICK}" stroke-width="1.4" stroke-linecap="round"/>`
          })()

    return `<g><title>${title}</title><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${STROKE}"/>${glow}${fill}${notch}</g>`
  })

  // A small dot circling the context ring while Claude works.
  const inner = radius(0)
  const comet =
    isWorking && rings.length > 0
      ? `<circle cx="${c}" cy="${n(c - inner)}" r="2.2" fill="#FFFFFF" stroke="${HUE.context}" stroke-width="1.5"><animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="2.4s" repeatCount="indefinite"/></circle>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Usage rings"><defs><filter id="hud-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>${drawn.join('')}${comet}</svg>`
}
