import type { MinigameFrame, State } from '../../shared/protocol.ts'

export type ReviewPhone = {
  playerId: string
  label: string
  state: State
  pressed: boolean
  frame?: MinigameFrame
}

export type ReviewPresentation = {
  now: number
  open: boolean
  settled: boolean
  retired: boolean
}

export type ReviewScenario = {
  id: string
  label: string
  board: State
  boardFrame?: MinigameFrame
  phones: ReviewPhone[]
  presentation: ReviewPresentation
}

export type ReviewBounds = { x: number; y: number; width: number; height: number }

export type Annotation = {
  id: string
  scenarioId: string
  surface: 'board' | 'phone'
  playerId?: string
  text: string
  targetId?: string
  targetText?: string
  bounds: ReviewBounds
  scroll: { x: number; y: number }
  /** Sent notes are held until the agent reports, then resolved and folded away. */
  status: 'open' | 'sent' | 'resolved'
  /** The batch a sent note went out in. */
  batchId?: string
  /** How that batch ended, once the agent reported it, and what it said. */
  outcome?: string
  message?: string
}

export type ReviewDraft = {
  version: 1
  annotations: Annotation[]
}

export type ReviewSelection = Omit<Annotation, 'id' | 'text' | 'status'>
