import type { State } from '../../shared/protocol.ts'

export type ReviewPhone = {
  playerId: string
  label: string
  state: State
  pressed: boolean
}

export type ReviewPresentation = {
  now: number
  open: boolean
  delay: number
  settled: boolean
  retired: boolean
}

export type ReviewScenario = {
  id: string
  label: string
  board: State
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
  status: 'open' | 'resolved'
}

export type ReviewDraft = {
  version: 1
  annotations: Annotation[]
}

export type ReviewSelection = Omit<Annotation, 'id' | 'text' | 'status'>
