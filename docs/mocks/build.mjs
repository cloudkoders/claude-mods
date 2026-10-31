// Builds hud-mocks.html: three directions for the hud mod, light + dark, calm + hot.
// Every SVG here is baked per theme, the way the mod has to bake it (an Svg element can't read page CSS).
import { writeFileSync } from 'node:fs'

const FONT = `-apple-system, 'SF Pro Text', Inter, system-ui, sans-serif`

// Cool hues mean fine. Warm hues mean look at me.
const HUE = { ctx: '#8B7CF6', five: '#12B5CB', week: '#4F86F7', warn: '#FFA51F', hot: '#FF4F4F' }

const THEMES = {
  light: { bg: '#FFFFFF', card: '#F5F6F8', edge: 'rgba(0,0,0,0.06)', text: '#1C1C1E', subtle: '#6E6E73', track: 'rgba(120,120,128,0.16)', notch: '#F5F6F8', box: '#FFFFFF', boxEdge: '#E3E3E6', btn: '#FFFFFF', btnEdge: '#DADADE', chat: '#3A3A3C' },
  dark: { bg: '#1E1E1D', card: '#272726', edge: 'rgba(255,255,255,0.07)', text: '#F2F2F0', subtle: '#9E9E9B', track: 'rgba(255,255,255,0.11)', notch: '#272726', box: '#2A2A29', boxEdge: '#3A3A39', btn: '#323231', btnEdge: '#454544', chat: '#C9C9C6' },
}

const STATES = {
  calm: {
    working: true,
    ctx: { pct: 10, detail: '97k of 1M tokens', segs: [6, 14, 22, 5, 3, 47], compactAt: 93 },
    five: { label: '5-hour limit', pct: 51, pace: 65, proj: 78, reset: 'resets in 1h 44m', paceText: 'lands ~78% at reset' },
    week: { label: 'Weekly limit', pct: 7, pace: 39, proj: 18, reset: 'resets Thu 5 PM', paceText: 'lands ~18% at reset' },
    session: { time: '9m', cost: '$0.69', rate: '$4.60/h', spark: [0, 0.05, 0.08, 0.15, 0.2, 0.31, 0.38, 0.47, 0.52, 0.6, 0.69] },
  },
  hot: {
    working: false,
    ctx: { pct: 74, detail: '740k of 1M tokens', segs: [6, 14, 22, 5, 3, 690], compactAt: 93 },
    five: { label: '5-hour limit', pct: 88, pace: 65, proj: 135, reset: 'resets in 1h 44m', paceText: 'out ~4:27 PM', out: true },
    week: { label: 'Weekly limit', pct: 34, pace: 39, proj: 87, reset: 'resets Thu 5 PM', paceText: 'lands ~87% at reset' },
    session: { time: '2h 18m', cost: '$41.20', rate: '$17.90/h', spark: [0, 2, 5, 7, 12, 14, 19, 25, 30, 36, 41.2] },
    alert: '5-hour limit runs out around 4:27 PM, 1h 17m before it resets. Context is 74% full.',
  },
}

// fine / warn / hot, from usage and where it's heading
const level = m => (m.out || m.pct >= 90 ? 'hot' : m.pct >= 70 || (m.proj ?? 0) >= 95 ? 'warn' : 'ok')
const tint = (m, base) => ({ ok: base, warn: HUE.warn, hot: HUE.hot })[level(m)]

let uid = 0
const id = p => `${p}${++uid}`

// ---------- shared bits ----------

const sparkSvg = (t, values, color, w = 84, h = 22) => {
  const max = Math.max(...values) || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - (v / max) * (h - 7)])
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const g = id('sp')
  const [lx, ly] = pts.at(-1)
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cost over the session">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="2,${h} ${line} ${w - 2},${h}" fill="url(#${g})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.4" fill="${color}"/>
  </svg>`
}

const buttons = (t, s) => {
  const ctxFull = s.ctx.pct >= 70
  return `<div class="actions">
    <span class="btn ${ctxFull ? 'primary' : ''}" style="--b:${t.btn};--be:${t.btnEdge};--t:${t.text}">Compact</span>
    <span class="btn" style="--b:${t.btn};--be:${t.btnEdge};--t:${t.text}">Fresh start</span>
  </div>`
}

const alertRow = (t, s) =>
  s.alert
    ? `<div class="alert" style="color:${t.text}"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${HUE.hot}"><animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite"/></circle></svg>${s.alert}</div>`
    : ''

// ---------- A. Orbit ----------

const ringsSvg = (t, s, size = 84) => {
  const c = size / 2
  const rings = [
    { m: s.week, r: 36.5, base: HUE.week, name: 'Weekly' },
    { m: s.five, r: 28, base: HUE.five, name: '5-hour' },
    { m: { ...s.ctx, proj: undefined }, r: 19.5, base: HUE.ctx, name: 'Context' },
  ]
  const glow = id('glow')
  const parts = rings.map(({ m, r, base, name }) => {
    const col = tint(m, base)
    const pct = Math.min(100, m.pct)
    const hot = level(m) === 'hot'
    const notch =
      m.pace === undefined
        ? ''
        : (() => {
            const a = ((m.pace / 100) * 360 - 90) * (Math.PI / 180)
            const x1 = c + (r - 3.4) * Math.cos(a), y1 = c + (r - 3.4) * Math.sin(a)
            const x2 = c + (r + 3.4) * Math.cos(a), y2 = c + (r + 3.4) * Math.sin(a)
            return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${t.notch}" stroke-width="2.4" stroke-linecap="round"/>
                    <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${t.text}" stroke-opacity="0.55" stroke-width="1" stroke-linecap="round"/>`
          })()
    return `<g><title>${name}: ${m.pct}% used${m.pace !== undefined ? `, ${m.pace}% of the window gone` : ''}</title>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${t.track}" stroke-width="6"/>
      ${hot ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="6" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 ${c} ${c})" filter="url(#${glow})"><animate attributeName="stroke-opacity" values="0.15;0.75;0.15" dur="2.2s" repeatCount="indefinite"/></circle>` : ''}
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 ${c} ${c})">
        <animate attributeName="stroke-dasharray" from="0 100" to="${pct} 100" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>
      </circle>
      ${notch}</g>`
  })
  const comet = s.working
    ? `<circle cx="${c}" cy="${c - 19.5}" r="2.4" fill="${t.card}" stroke="${HUE.ctx}" stroke-width="1.6"><animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="2.4s" repeatCount="indefinite"/></circle>`
    : ''
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Usage rings">
    <defs><filter id="${glow}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.6"/></filter></defs>
    ${parts.join('')}${comet}</svg>`
}

const orbit = (t, s) => {
  const col = (m, base, label, value, l2, l3) => {
    const c = tint(m, base)
    const warm = level(m) !== 'ok'
    return `<div class="col">
      <div class="lbl" style="color:${t.subtle}"><i class="dot" style="background:${c}"></i>${label}</div>
      <div class="val" style="color:${warm ? c : t.text}">${value}</div>
      <div class="sub" style="color:${t.subtle}">${l2}</div>
      ${l3 ? `<div class="sub" style="color:${warm ? c : t.subtle}">${l3}</div>` : ''}
    </div>`
  }
  return `<div class="hud orbit" style="background:${t.card};border-color:${t.edge};color:${t.text}">
    ${alertRow(t, s)}
    <div class="row">
      ${ringsSvg(t, s)}
      ${col(s.ctx, HUE.ctx, 'Context', `${s.ctx.pct}%`, s.ctx.detail, s.ctx.pct >= 70 ? 'compact soon' : '')}
      ${col(s.five, HUE.five, s.five.label, `${s.five.pct}%`, s.five.reset, s.five.paceText)}
      ${col(s.week, HUE.week, s.week.label, `${s.week.pct}%`, s.week.reset, s.week.paceText)}
      <div class="col">
        <div class="lbl" style="color:${t.subtle}">Session</div>
        <div class="val">${s.session.time}</div>
        <div class="sub" style="color:${t.subtle}">API ≈ ${s.session.cost}</div>
        <div class="sub" style="color:${t.subtle}">${s.session.rate}</div>
      </div>
      ${buttons(t, s)}
    </div>
  </div>`
}

// ---------- B. Runway ----------

// One lane: solid = used, notch = even pace (share of the window's time gone), dashed = where it lands at reset.
const laneSvg = (t, m, base, { w = 190, h = 16, segs, compactAt, working } = {}) => {
  const col = tint(m, base)
  const x = p => 1 + (Math.min(100, p) / 100) * (w - 2)
  const y = h / 2
  const bh = 8
  const g = id('sh')
  let fill
  if (segs) {
    const total = segs.reduce((a, b) => a + b, 0)
    const shades = ['#C9C1FB', '#B5AAF9', '#A194F8', '#9A8CF7', '#9282F6', base]
    let at = 0
    const scale = m.pct / total
    fill = segs
      .map((v, i) => {
        const x0 = x(at), x1 = x(at + v * scale)
        at += v * scale
        return `<rect x="${x0.toFixed(2)}" y="${y - bh / 2}" width="${Math.max(0.8, x1 - x0).toFixed(2)}" height="${bh}" fill="${level(m) === 'ok' ? shades[i] : i === 5 ? col : shades[i]}"/>`
      })
      .join('')
    fill = `<g clip-path="url(#${g}c)">${fill}</g>`
  } else {
    fill = `<rect x="1" y="${y - bh / 2}" width="${(x(m.pct) - 1).toFixed(2)}" height="${bh}" rx="${bh / 2}" fill="${col}"/>`
  }
  const proj =
    m.proj === undefined
      ? ''
      : m.proj > 100
        ? `<line x1="${x(m.pct) + 3}" y1="${y}" x2="${w - 4}" y2="${y}" stroke="${col}" stroke-width="2" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>
           <rect x="${w - 3}" y="${y - 6}" width="2.5" height="12" rx="1.25" fill="${HUE.hot}"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite"/></rect>`
        : `<line x1="${x(m.pct) + 3}" y1="${y}" x2="${x(m.proj)}" y2="${y}" stroke="${col}" stroke-opacity="0.75" stroke-width="2" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>
           <circle cx="${x(m.proj)}" cy="${y}" r="2.6" fill="${t.card}" stroke="${col}" stroke-width="1.5"/>`
  const pace =
    m.pace === undefined
      ? ''
      : `<line x1="${x(m.pace)}" y1="1.5" x2="${x(m.pace)}" y2="${h - 1.5}" stroke="${t.text}" stroke-opacity="0.6" stroke-width="1.4" stroke-linecap="round"/>`
  const flag =
    compactAt === undefined
      ? ''
      : `<path d="M${x(compactAt)} 2 v${h - 4}" stroke="${t.subtle}" stroke-width="1" stroke-dasharray="1.5 1.5"/>`
  const shimmer = working
    ? `<rect x="1" y="${y - bh / 2}" width="${(x(m.pct) - 1).toFixed(2)}" height="${bh}" rx="${bh / 2}" fill="url(#${g}s)"/>`
    : ''
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${m.pct}% used">
    <defs>
      <clipPath id="${g}c"><rect x="1" y="${y - bh / 2}" width="${(x(m.pct) - 1).toFixed(2)}" height="${bh}" rx="${bh / 2}"/></clipPath>
      <linearGradient id="${g}s" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="1.6s" repeatCount="indefinite"/></linearGradient>
    </defs>
    <rect x="1" y="${y - bh / 2}" width="${w - 2}" height="${bh}" rx="${bh / 2}" fill="${t.track}"/>
    ${proj}${fill}${shimmer}${flag}${pace}
  </svg>`
}

const runway = (t, s) => {
  const lane = (label, m, base, detail, opts) => {
    const warm = level(m) !== 'ok'
    const c = tint(m, base)
    return `<div class="lane">
      <span class="ll" style="color:${t.subtle}">${label}</span>
      ${laneSvg(t, m, base, opts)}
      <span class="lv" style="color:${warm ? c : t.text}">${m.pct}%</span>
      <span class="ld" style="color:${t.subtle}">${detail}</span>
    </div>`
  }
  const five = s.five
  const week = s.week
  return `<div class="hud runway" style="background:${t.card};border-color:${t.edge};color:${t.text}">
    ${alertRow(t, s)}
    <div class="row">
      <div class="lanes">
        ${lane('Context', s.ctx, HUE.ctx, s.ctx.detail, { segs: s.ctx.segs, compactAt: s.ctx.compactAt, working: s.working })}
        ${lane('5-hour', five, HUE.five, `${five.reset.replace('resets ', 'resets ')} <b style="color:${level(five) === 'ok' ? t.subtle : tint(five, HUE.five)}">· ${five.paceText.replace(' at reset', '')}</b>`)}
        ${lane('Weekly', week, HUE.week, `${week.reset} <b style="color:${t.subtle}">· ${week.paceText.replace(' at reset', '')}</b>`)}
      </div>
      <div class="sess">
        <div class="lbl" style="color:${t.subtle}">Session <b style="color:${t.text}">${s.session.time}</b></div>
        ${sparkSvg(t, s.session.spark, level(s.ctx) === 'ok' && !s.alert ? HUE.ctx : HUE.warn, 96, 20)}
        <div class="sub" style="color:${t.subtle}">${s.session.cost} · ${s.session.rate}</div>
      </div>
      ${buttons(t, s)}
    </div>
  </div>`
}

// ---------- C. Instrument ----------

const gaugeSvg = (t, m, base, label, size = 64) => {
  const c = size / 2
  const r = 25
  const col = tint(m, base)
  const sweep = 270
  const start = 135
  const pt = (deg, rr) => {
    const a = (deg * Math.PI) / 180
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)]
  }
  const arc = (rr, from, to) => {
    const [x1, y1] = pt(start + (from / 100) * sweep, rr)
    const [x2, y2] = pt(start + (to / 100) * sweep, rr)
    const large = ((to - from) / 100) * sweep > 180 ? 1 : 0
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${rr} ${rr} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const [x1, y1] = pt(start + (i / 10) * sweep, r + 4.5)
    const [x2, y2] = pt(start + (i / 10) * sweep, r + (i % 5 === 0 ? 7.5 : 6))
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${t.subtle}" stroke-opacity="${i % 5 === 0 ? 0.8 : 0.45}" stroke-width="1"/>`
  }).join('')
  const pct = Math.min(100, m.pct)
  const hot = level(m) === 'hot'
  const g = id('gg')
  const pace =
    m.pace === undefined
      ? ''
      : (() => {
          const a = start + (m.pace / 100) * sweep
          const [tx, ty] = pt(a, r + 5)
          return `<g transform="rotate(${a + 90} ${tx.toFixed(2)} ${ty.toFixed(2)})"><path d="M${tx.toFixed(2)} ${(ty - 0.5).toFixed(2)} l-3 -4.5 h6 z" fill="${t.text}" fill-opacity="0.75"/></g>`
        })()
  const proj =
    m.proj === undefined || m.proj <= m.pct
      ? ''
      : `<path d="${arc(r, pct, Math.min(100, m.proj))}" fill="none" stroke="${col}" stroke-opacity="0.35" stroke-width="5" stroke-dasharray="1.5 2.5"/>`
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label} ${m.pct}% used">
    <defs><filter id="${g}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>
    <title>${label}: ${m.pct}% used</title>
    ${ticks}
    <path d="${arc(r, 0, 100)}" fill="none" stroke="${t.track}" stroke-width="5" stroke-linecap="round"/>
    ${proj}
    ${hot ? `<path d="${arc(r, 0, pct)}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" filter="url(#${g})"><animate attributeName="stroke-opacity" values="0.1;0.8;0.1" dur="2.2s" repeatCount="indefinite"/></path>` : ''}
    <path d="${arc(r, 0, pct)}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100 100">
      <animate attributeName="stroke-dashoffset" from="100" to="0" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>
    </path>
    ${pace}
    <text x="${c}" y="${c + 2}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="${level(m) === 'ok' ? t.text : col}" style="font-variant-numeric:tabular-nums">${m.pct}<tspan font-size="8.5" font-weight="500" dx="0.5" fill="${t.subtle}">%</tspan></text>
    <text x="${c}" y="${c + 22}" text-anchor="middle" font-family="${FONT}" font-size="8.5" font-weight="500" fill="${t.subtle}">${label}</text>
  </svg>`
}

const instrument = (t, s) => {
  const unit = (m, base, label, l1, l2) => {
    const warm = level(m) !== 'ok'
    return `<div class="unit">
      ${gaugeSvg(t, m, base, label)}
      <div class="ut">
        <div class="sub" style="color:${t.subtle}">${l1}</div>
        <div class="sub" style="color:${warm ? tint(m, base) : t.subtle}">${l2}</div>
      </div>
    </div>`
  }
  return `<div class="hud instrument" style="background:${t.card};border-color:${t.edge};color:${t.text}">
    ${alertRow(t, s)}
    <div class="row">
      ${unit({ ...s.ctx }, HUE.ctx, 'CONTEXT'.toLowerCase(), s.ctx.detail.replace(' tokens', ''), s.ctx.pct >= 70 ? 'compact soon' : 'plenty of room')}
      ${unit(s.five, HUE.five, '5-hour', s.five.reset, s.five.paceText.replace(' at reset', ''))}
      ${unit(s.week, HUE.week, 'weekly', s.week.reset, s.week.paceText.replace(' at reset', ''))}
      <div class="odo">
        <div class="lbl" style="color:${t.subtle}">Session ${s.session.time}</div>
        <div class="digits" style="color:${t.text};--d:${t.track}">${s.session.cost
          .split('')
          .map(ch => `<span>${ch}</span>`)
          .join('')}</div>
        <div class="sub" style="color:${t.subtle}">${s.session.rate} burn</div>
      </div>
      ${buttons(t, s)}
    </div>
  </div>`
}

// ---------- terminal fallback ----------

const termLane = (label, m, detail, hueCls) => {
  const cells = 20
  const used = m.pct > 0 ? Math.max(1, Math.round((Math.min(100, m.pct) / 100) * cells)) : 0
  const proj = m.proj === undefined ? used : Math.min(cells, Math.round((Math.min(100, m.proj) / 100) * cells))
  const pace = m.pace === undefined ? -1 : Math.min(cells - 1, Math.round((m.pace / 100) * cells))
  let bar = ''
  for (let i = 0; i < cells; i++) {
    if (i === pace) bar += `<span class="tp">│</span>`
    else if (i < used) bar += `<span class="${hueCls}">█</span>`
    else if (i < proj) bar += `<span class="${hueCls} dim">▒</span>`
    else bar += `<span class="te">░</span>`
  }
  return `${label.padEnd(9)}${bar} <b>${String(m.pct).padStart(3)}%</b>  <span class="te2">${detail}</span>`
}

const terminal = s =>
  `<pre class="term">${[
    termLane('Context', s.ctx, s.ctx.detail, { ok: 'tc', warn: 'ta', hot: 'th' }[level(s.ctx)]),
    termLane('5-hour', s.five, `${s.five.reset} · ${s.five.paceText.replace(' at reset', '')}`, s.five.out ? 'th' : 'tf'),
    termLane('Weekly', s.week, `${s.week.reset} · ${s.week.paceText.replace(' at reset', '')}`, 'tw'),
    `Session  <b>${s.session.time}</b>  <span class="te2">API ≈ ${s.session.cost} · ${s.session.rate}</span>          <span class="tb">[1] Compact</span> <span class="tb">[2] Fresh start</span>`,
  ].join('\n')}</pre>`

// ---------- frame: the bottom of the Claude desktop app ----------

const frame = (theme, state, body, caption) => {
  const t = THEMES[theme]
  const s = STATES[state]
  return `<figure class="frame">
    <div class="app" style="background:${t.bg}">
      <p class="tail" style="color:${t.chat}">${state === 'hot' ? 'Refactored the session store and reran the suite. 214 passing, 0 failing.' : 'Done. The migration runs clean on a fresh database and on a copy of prod.'}</p>
      ${body(t, s)}
      <div class="composer" style="background:${t.box};border-color:${t.boxEdge};color:${t.subtle}">
        <span>+</span><span class="ph">Type / for commands</span>
        <svg width="14" height="14" viewBox="0 0 14 14"><rect x="4.5" y="1" width="5" height="8" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.5a4.5 4.5 0 0 0 9 0M7 11v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      </div>
    </div>
    <figcaption>${caption}</figcaption>
  </figure>`
}

const direction = (key, name, pitch, notes, body) => `
<section class="dir" id="${key}">
  <header><h2>${name}</h2><p>${pitch}</p></header>
  ${frame('light', 'calm', body, 'Light, normal session, Claude working')}
  ${frame('dark', 'hot', body, 'Dark, running hot: limit projected to run out before it resets')}
  <ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>
</section>`

// ---------- anatomy of a lane ----------

const anatomy = () => {
  const t = THEMES.light
  const m = STATES.calm.five
  const W = 520
  const at = p => (p / 100) * W
  return `<div class="anatomy">
    <div class="keys top"><div style="left:${at(m.pace)}px"><b>65% even pace</b>how much of the 5 hours has gone by</div></div>
    <div class="big">${laneSvg(t, m, HUE.five, { w: W, h: 22 })}</div>
    <div class="keys"><div style="left:${at(m.pct / 2)}px"><b>51% used</b>what you've spent so far</div><div style="left:${at(m.proj) + 30}px"><b>~78% at reset</b>where this pace lands you</div></div>
  </div>`
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>hud mocks</title>
<style>
  :root { color-scheme: light; --ink:#18181B; --mute:#6B6B73; --page:#ECEDF0; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:15px/1.5 ${FONT}; -webkit-font-smoothing:antialiased; }
  main { max-width: 900px; margin: 0 auto; padding: 48px 20px 80px; }
  h1 { font-size: 40px; line-height:1.05; letter-spacing:-0.02em; margin:0 0 10px; font-weight:700; }
  h1 small { font-size: 15px; font-weight:500; color:var(--mute); letter-spacing:0; margin-left:6px; }
  .lede { max-width: 62ch; color:#3F3F46; margin:0 0 28px; }
  h2 { font-size: 22px; letter-spacing:-0.01em; margin:0; }
  .dir header p { margin: 4px 0 16px; color:#3F3F46; max-width: 64ch; }
  .dir { margin-top: 56px; }
  .pick { display:inline-block; font-size:12px; font-weight:600; color:#0E7C8B; background:#D9F3F6; border-radius:99px; padding:1px 9px; margin-left:8px; vertical-align: 3px; }
  .frame { margin: 0 0 18px; overflow-x: auto; padding-bottom: 14px; }
  .frame figcaption { font-size: 13px; color: var(--mute); margin-top: 8px; }
  .scaler { overflow-x: auto; }
  .app { width: 860px; border-radius: 14px; padding: 18px 22px 18px; box-shadow: 0 1px 0 rgba(0,0,0,.04), 0 10px 30px -12px rgba(0,0,0,.18); }
  .tail { margin: 0 0 16px; font-size: 14px; }
  .composer { display:flex; align-items:center; gap: 12px; border:1px solid; border-radius: 14px; padding: 14px 16px; font-size: 15px; margin-top: 10px; }
  .composer .ph { flex:1; }
  .notes { margin: 6px 0 0; padding-left: 18px; color:#3F3F46; max-width: 66ch; }
  .notes li { margin: 3px 0; }

  /* the hud card itself: sizes and spacing mirror Box/Text props the mod can set */
  .hud { border: 1px solid; border-radius: 12px; padding: 12px 14px; font-size: 13px; }
  .hud .row { display:flex; align-items:center; gap: 18px; }
  .hud .lbl { font-size: 12px; display:flex; align-items:center; gap:6px; white-space:nowrap; }
  .hud .val { font-size: 19px; font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; letter-spacing:-0.01em; }
  .hud .sub { font-size: 12px; line-height: 1.4; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .dot { width:7px; height:7px; border-radius:99px; display:inline-block; }
  .actions { display:flex; flex-direction:column; gap:6px; margin-left:auto; align-items:flex-end; }
  .btn { font-size: 12.5px; padding: 3px 10px; border-radius: 7px; border:1px solid var(--be); background:var(--b); color:var(--t); white-space:nowrap; }
  .btn.primary { background:#1C1C1E; color:#fff; border-color:#1C1C1E; }
  [style*="--b:#323231"].btn.primary { background:#F2F2F0; color:#1C1C1E; border-color:#F2F2F0; }
  .alert { display:flex; align-items:center; gap:8px; font-size: 12.5px; font-weight:500; margin: -2px 0 10px; }

  .orbit .col { flex: 1 1 0; min-width: 0; }
  .runway .lanes { display:grid; gap: 4px; flex: 1 1 auto; }
  .runway .lane { display:grid; grid-template-columns: 52px 190px 36px 1fr; align-items:center; gap: 8px; }
  .runway .ll { font-size: 12px; }
  .runway .lane { line-height: 1.3; }
  .runway .lv { font-size: 13px; font-weight:600; text-align:right; font-variant-numeric: tabular-nums; }
  .runway .ld { font-size: 12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .runway .ld b { font-weight: 500; }
  .runway .sess { min-width: 118px; } .runway .sess .sub { overflow:visible; }
  .runway .sess svg { display:block; margin: 3px 0 2px; }
  .runway .sess .lbl b { font-size: 13px; font-weight: 600; }
  .instrument .unit { display:flex; align-items:center; gap: 6px; flex: 1 1 auto; min-width:0; }
  .instrument .row { gap: 14px; }
  .instrument .ut { min-width:0; }
  .odo .digits { display:flex; gap:2px; margin: 3px 0 2px; }
  .odo .digits span { font: 600 15px/1 ${FONT}; font-variant-numeric: tabular-nums; background: var(--d); border-radius: 4px; padding: 4px 3px; min-width: 13px; text-align:center; }

  .anatomy { background:#fff; border-radius: 14px; padding: 26px 26px 18px; box-shadow: 0 10px 30px -14px rgba(0,0,0,.2); width: 572px; max-width:100%; }
  .anatomy .big svg { width: 520px; max-width: 100%; height: auto; }
  .anatomy .keys { position:relative; height: 44px; margin-top: 6px; width:520px; }
  .anatomy .keys.top { margin: 0 0 10px; height: 38px; }
  .anatomy .keys div { position:absolute; transform: translateX(-50%); font-size:12px; color: var(--mute); width: 250px; text-align:center; line-height:1.35; }
  .anatomy .keys div b { display:block; color: var(--ink); font-weight:600; }
  .anatomy { overflow-x:auto; }

  .term { background:#141414; color:#D4D4D4; font: 12.5px/1.6 'SF Mono', 'DejaVu Sans Mono', ui-monospace, monospace; padding: 16px 18px; border-radius: 12px; width: 860px; overflow-x:auto; margin:0; }
  .term b { color:#fff; font-weight:600; }
  .term .tc { color:${HUE.ctx}; } .term .tf { color:${HUE.five}; } .term .tw { color:${HUE.week}; } .term .th { color:${HUE.hot}; } .term .ta { color:${HUE.warn}; }
  .term .dim { opacity: .55; } .term .te { color:#3A3A3A; } .term .te2 { color:#8A8A8A; } .term .tp { color:#fff; }
  .term .tb { color:#141414; background:#9A9A9A; }
  .legend { display:flex; gap: 18px; flex-wrap:wrap; font-size: 13px; color: #3F3F46; margin: 14px 0 0; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style></head>
<body><main>
  <h1>hud <small>mocks for the first claude mod</small></h1>
  <p class="lede">Three takes on the card above the message box. All three read the same numbers as the original (context, the 5-hour and weekly limits, session time, cost) and add one new idea: <b>pace</b>. Each limit shows how fast you're spending it compared with how fast the clock is running, and where you'll land when it resets.</p>

  ${anatomy()}
  <div class="legend">
    <span><i style="background:${HUE.ctx}"></i>context</span>
    <span><i style="background:${HUE.five}"></i>5-hour limit</span>
    <span><i style="background:${HUE.week}"></i>weekly limit</span>
    <span><i style="background:${HUE.warn}"></i>getting full (70%+)</span>
    <span><i style="background:${HUE.hot}"></i>will run out before reset, or 90%+</span>
  </div>
  <p class="notes" style="padding:0;margin-top:10px">Cool colors mean you're fine. A metric only turns warm when it needs you.</p>

  ${direction(
    'orbit',
    'A. Orbit',
    'Three nested rings, one per limit, with the numbers beside them. The most compact and the most glanceable: you learn the ring colors once and stop reading.',
    [
      'Each ring has a small notch at even pace. Fill past the notch means you’re spending faster than time.',
      'A small dot circles the context ring while Claude works. A ring that will run out glows and breathes.',
      'Hover a ring for its exact numbers (desktop draws it as an interactive SVG).',
    ],
    orbit,
  )}

  ${direction(
    'runway',
    'B. Runway <span class="pick">my pick</span>',
    'One lane per limit. Solid is used, the tick is even pace, the dashed tail is where you’ll land at reset. It answers “am I going to make it?” without any math.',
    [
      'The context lane is split by what fills it: system prompt, tools, MCP tools, skills, memory, then your conversation. The dotted line is where auto-compact kicks in.',
      'A light sweeps across the context lane while Claude works. When a limit will run out, the dashed tail hits a blinking wall and the time it runs out replaces the projection.',
      'Session shows a cost sparkline and burn rate per hour.',
      'It maps one to one onto the terminal version (bottom of this page), so both surfaces feel like the same mod.',
    ],
    runway,
  )}

  ${direction(
    'instrument',
    'C. Instrument',
    'Three small dials with tick marks, like a cockpit panel, and the session cost on a flip counter. The most dramatic of the three. Big personality, slightly less detail per square inch.',
    [
      'The triangle on each dial’s rim is even pace. The faint dotted arc ahead of the needle is the projection.',
      'Cost ticks over digit by digit as the session runs.',
      'Takes the same height as the original card.',
    ],
    instrument,
  )}

  <section class="dir" id="terminal">
    <header><h2>In the terminal</h2><p>The terminal can’t draw SVG, so every direction falls back to this. Same colors, same pace tick (│), the projection is the shaded ▒ part.</p></header>
    <div class="scaler">${terminal(STATES.calm)}</div>
    <div class="scaler" style="margin-top:10px">${terminal(STATES.hot)}</div>
  </section>
</main></body></html>`

writeFileSync(new URL('./hud-mocks.html', import.meta.url), html)

const page2 = html
  .replace(/<h1>[\s\S]*<\/main>/, `<h1>hud <small>Runway, compact</small></h1>
  <p class="lede">Runway at Instrument's height: the bars sit closer together and the session column is three short lines instead of four. Same card in all four combinations of theme and state.</p>
  ${anatomy()}
  <section class="dir" style="margin-top:36px">
    ${frame('light', 'calm', runway, 'Light, normal session, Claude working')}
    ${frame('dark', 'calm', runway, 'Dark, normal session, Claude working')}
    ${frame('light', 'hot', runway, 'Light, running hot')}
    ${frame('dark', 'hot', runway, 'Dark, running hot')}
  </section>
  <section class="dir" id="terminal">
    <header><h2>In the terminal</h2><p>No SVG here, so the bars are block characters. │ is even pace, ▒ is the projection.</p></header>
    <div class="scaler">${terminal(STATES.calm)}</div>
    <div class="scaler" style="margin-top:10px">${terminal(STATES.hot)}</div>
  </section>
</main>`)
  .replace('<title>hud mocks</title>', '<title>hud: Runway, compact</title>')
writeFileSync(new URL('./hud-runway.html', import.meta.url), page2)
console.log('wrote hud-mocks.html', html.length, 'chars')
