export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// One reading of $.session.usage(), with `at` floored to the minute so the card redraws at most once a minute.
export type Reading = {
  model: string
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: Limit[]
  costUsd?: number
  // What the engine's cost total was when this conversation began (after /clear it may keep counting).
  costBase?: number
  startedAt: number
  at: number
}

export type Segment = { name: string; tokens: number }

// The conversation's cost at a moment, kept for the last hour so $/h measures recent spending.
export type CostSample = { at: number; usd: number }

// What fills the context window, from the engine's local estimate. autoCompactAt is a fraction of the window, 0..1.
export type Breakdown = { segments: Segment[]; autoCompactAt?: number }

export type TurnInfo = { model?: string; effort?: string }

// How the desktop card looks. The terminal draws Runway's bars in every mode.
export type Mode = 'orbit' | 'runway' | 'instrument'

// Whether /hud fresh is writing a handoff note right now.
export type Action = 'idle' | 'handoff'

declare module 'claude-code' {
  interface PluginState {
    hud: {
      reading: Reading | null
      breakdown: Breakdown | null
      costHistory: number[]
      costTrail: CostSample[]
      turn: TurnInfo
      isOn: boolean
      mode: Mode
      action: Action
    }
  }
}
