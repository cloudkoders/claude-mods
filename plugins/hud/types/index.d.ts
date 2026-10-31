export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// One reading of $.session.usage(), with `at` floored to the minute so the card redraws at most once a minute.
export type Reading = {
  model: string
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: Limit[]
  costUsd?: number
  startedAt: number
  at: number
}

export type Segment = { name: string; tokens: number }

// What fills the context window, from the engine's local estimate. autoCompactAt is a fraction of the window, 0..1.
export type Breakdown = { segments: Segment[]; autoCompactAt?: number }

export type TurnInfo = { model?: string; effort?: string }

// What the buttons are doing: nothing, waiting on a second press, or running.
export type Action = 'idle' | 'confirm' | 'compacting' | 'handoff'

declare module 'claude-code' {
  interface PluginState {
    hud: {
      reading: Reading | null
      breakdown: Breakdown | null
      costHistory: number[]
      turn: TurnInfo
      isOn: boolean
      action: Action
    }
  }
}
