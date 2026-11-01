// The card's layouts: Runway, Orbit and Instrument on the desktop, and the terminal's bars (every mode).
// They take the elements and the figures, already prepared, and hold no `$`.
import type { ElementTable, RenderChildren } from 'claude-code'

import { HUE, hueFor, sparkSvg, terminalBar } from './draw'
import type { Run } from './draw'
import { counterSvg, gaugeSvg } from './instrument'
import type { Level } from './model'
import { ringsSvg } from './orbit'

// One bar: the context window or a limit.
export type Item = {
  key: string
  kind: string
  label: string
  percentText: string
  used: number
  elapsed?: number
  projected?: number
  level: Level
  // Set when the item is warm; undefined draws the theme's own text color.
  percentColor?: string
  reset: string
  pace?: string
  paceColor: string
  // Runway's bar for this item.
  barSvg: string
  barAlt: string
  isBarAnimated: boolean
}

export type Session = {
  time: string
  costText: string
  spentText?: string
  burn?: string
  history: number[]
  sparkColor: string
}

export type Card = {
  items: Item[]
  alert?: string
  isWorking: boolean
  session: Session
}

export type DesktopElements = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Svg'>
export type TerminalElements = Pick<ElementTable<'terminal'>, 'Box' | 'Text'>

// A small red dot that pulses beside the alert.
const ALERT_DOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#FF4F4F"><animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite"/></circle></svg>'

// The detail line: the reset part stays quiet, the pace part takes the item's warm color.
const detail = ({ Text }: DesktopElements, item: Item) => (
  <Text color="subtle" wrap="truncate-end">
    {item.reset}
    {item.pace === undefined ? null : <Text color={item.paceColor}>{` · ${item.pace}`}</Text>}
  </Text>
)

// What every desktop mode shares: the alert line on top, then the mode's row.
const frame = ({ Box, Text, Svg }: DesktopElements, card: Card, row: RenderChildren[]) => (
  <Box flexDirection="column" paddingX={1} rowGap={1}>
    {card.alert === undefined ? null : (
      <Box key="alert" flexDirection="row" alignItems="center" columnGap={1}>
        <Svg source={ALERT_DOT} alt="Warning" width={10} height={10} isInteractive />
        <Text weight="medium">{card.alert}</Text>
      </Box>
    )}
    <Box key="card" flexDirection="row" alignItems="center" columnGap={3}>
      {row}
    </Box>
  </Box>
)

export const runwayCard = (els: DesktopElements, card: Card) => {
  const { Box, Text, Svg } = els

  // The label, bar and percent keep their size so every row lines up; the detail takes what's left and truncates.
  const lane = (item: Item) => (
    <Box key={item.key} flexDirection="row" alignItems="center" columnGap={1}>
      <Box key={`${item.key}-label`} width={8} flexShrink={0}>
        <Text color="subtle">{item.label}</Text>
      </Box>
      <Box key={`${item.key}-bar`} flexShrink={0}>
        {/* Only an SVG that animates needs the sandboxed frame; the rest draw as plain images. */}
        {item.isBarAnimated ? (
          <Svg source={item.barSvg} alt={item.barAlt} width={190} height={16} isInteractive />
        ) : (
          <Svg source={item.barSvg} alt={item.barAlt} width={190} height={16} />
        )}
      </Box>
      <Box key={`${item.key}-percent`} width={5} flexShrink={0} justifyContent="flex-end">
        <Text bold tabular color={item.percentColor}>
          {item.percentText}
        </Text>
      </Box>
      <Box key={`${item.key}-detail`} flexGrow={1} flexShrink={1} width={0}>
        {detail(els, item)}
      </Box>
    </Box>
  )

  const { session } = card

  return frame(els, card, [
    <Box key="lanes" flexDirection="column" flexGrow={1} flexShrink={1} width={0}>
      {card.items.map(lane)}
    </Box>,
    <Box key="session" flexDirection="column" minWidth={14} flexShrink={0}>
      <Text>
        <Text color="subtle">Session </Text>
        <Text bold>{session.time}</Text>
      </Text>
      {session.history.length >= 3 ? <Svg source={sparkSvg(session.history, session.sparkColor)} alt="Cost over the session" width={96} height={20} /> : null}
      {session.costText === '' ? null : <Text color="subtle">{session.costText}</Text>}
    </Box>,
  ])
}

export const orbitCard = (els: DesktopElements, card: Card) => {
  const { Box, Text, Svg } = els
  const rings = ringsSvg(
    card.items.map(item => ({ kind: item.kind, label: item.label, used: item.used, elapsed: item.elapsed, level: item.level })),
    card.isWorking,
  )

  // Three lines a column: the ring's color and label, the big percent, the detail.
  const column = (item: Item) => (
    <Box key={`${item.key}-column`} flexDirection="column" flexGrow={1} flexShrink={1} width={0} minWidth={12}>
      <Text color="subtle" wrap="truncate-end">
        <Text color={hueFor(item.kind, item.level)}>● </Text>
        {item.label}
      </Text>
      <Text size="heading" weight="semibold" tabular color={item.percentColor}>
        {item.percentText}
      </Text>
      {detail(els, item)}
    </Box>
  )

  const { session } = card

  return frame(els, card, [
    // Interactive, so hovering a ring shows its numbers and a hot ring's glow and the working dot move.
    <Box key="rings" flexShrink={0}>
      <Svg source={rings} alt="Usage rings" width={64} height={64} isInteractive />
    </Box>,
    ...card.items.map(column),
    <Box key="session" flexDirection="column" minWidth={12} flexShrink={0}>
      <Text color="subtle">Session</Text>
      <Text size="heading" weight="semibold">
        {session.time}
      </Text>
      {session.costText === '' ? null : <Text color="subtle">{session.costText}</Text>}
    </Box>,
  ])
}

export const instrumentCard = (els: DesktopElements, card: Card) => {
  const { Box, Text, Svg } = els

  const unit = (item: Item) => {
    const dial = gaugeSvg({ kind: item.kind, label: item.label, used: item.used, elapsed: item.elapsed, projected: item.projected, level: item.level })
    const alt = `${item.label} dial, ${item.percentText === '—' ? 'no reading yet' : `${item.percentText} used`}`

    return (
      <Box key={`${item.key}-unit`} flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} flexShrink={1} width={0} minWidth={16}>
        <Box key={`${item.key}-dial`} flexShrink={0}>
          {item.level === 'hot' ? <Svg source={dial} alt={alt} width={56} height={56} isInteractive /> : <Svg source={dial} alt={alt} width={56} height={56} />}
        </Box>
        <Box key={`${item.key}-text`} flexDirection="column" flexGrow={1} flexShrink={1} width={0}>
          <Text color="subtle" wrap="truncate-end">
            {item.label}
          </Text>
          <Text color="subtle" wrap="truncate-end">
            {item.reset}
          </Text>
          {item.pace === undefined ? null : (
            <Text color={item.paceColor} wrap="truncate-end">
              {item.pace}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  const { session } = card

  return frame(els, card, [
    ...card.items.map(unit),
    <Box key="session" flexDirection="column" minWidth={12} flexShrink={0}>
      <Text>
        <Text color="subtle">Session </Text>
        <Text bold>{session.time}</Text>
      </Text>
      {session.spentText === undefined ? null : <Svg source={counterSvg(session.spentText)} alt={`Session cost ${session.spentText}`} />}
      {session.burn === undefined ? null : <Text color="subtle">{`${session.burn} burn`}</Text>}
    </Box>,
  ])
}

// The terminal has no Svg: block-character bars, in every mode.
export const terminalCard = ({ Box, Text }: TerminalElements, card: Card, cells: number, modelText: string) => {
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

  const line = (item: Item) => (
    <Text wrap="truncate-end">
      <Text color="subtle">{item.label.padEnd(9)}</Text>
      {bar(terminalBar(item.used, item.projected, item.elapsed, cells), hueFor(item.kind, item.level))}
      <Text bold color={item.percentColor}>{` ${item.percentText.padStart(4)}`}</Text>
      <Text color="subtle">{`  ${item.reset}`}</Text>
      {item.pace === undefined ? null : <Text color={item.paceColor}>{` · ${item.pace}`}</Text>}
    </Text>
  )

  const { session } = card

  return (
    <Box flexDirection="column" paddingX={1}>
      {card.alert === undefined ? null : (
        <Text wrap="truncate-end">
          <Text color={HUE.hot}>● </Text>
          <Text bold>{card.alert}</Text>
        </Text>
      )}
      {card.items.map(line)}
      <Text wrap="truncate-end">
        <Text color="subtle">{'Session'.padEnd(9)}</Text>
        <Text bold>{session.time}</Text>
        <Text color="subtle">{[session.costText === '' ? '' : `  API ≈ ${session.costText}`, modelText === '' ? '' : `  ${modelText}`].join('')}</Text>
      </Text>
    </Box>
  )
}
