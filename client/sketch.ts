import type { SketchEnd, SketchShared } from '../shared/protocol.ts'
import type { Cue } from './sound.ts'
import { ordinal } from './ui.ts'

export { ordinal }

export type SketchView = SketchShared & { matchId: string; tick: number; serverTime: number; close?: number }

export const MISS_GAP_MS = 120
const TICK_FROM = 5
const PLACE_RATE = 0.06
const END_CUE: Record<SketchEnd, Cue> = { all: 'sketch-all', timeup: 'sketch-timeup', pass: 'sketch-pass' }

export const SKETCH_RULES = 'One player draws and everyone else types guesses. Faster guesses score more, and the drawer scores for everyone who gets it.'

export const secondsLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000))
const hidden = (blanks: string) => blanks.split('_').length - 1
const newest = (list: { seq: number }[]) => Math.max(0, ...list.map((entry) => entry.seq))

export function sketchCues(prev: SketchView | null, next: SketchView, who: 'board' | string): { cue: Cue; rateScale?: number }[] {
  if (!prev || prev.matchId !== next.matchId) return []
  const board = who === 'board'
  const drawer = next.drawer === who
  const turnStart = next.step === 'choosing' && (next.turn !== prev.turn || (prev.tick === 0 && next.tick > 0))
  const sameTurn = next.turn === prev.turn
  const out: { cue: Cue; rateScale?: number }[] = []

  if (turnStart && board) out.push({ cue: 'sketch-turn' })
  if (turnStart && drawer) out.push({ cue: 'sketch-yours' })
  if (!sameTurn) return out

  if (board && prev.step === 'choosing' && next.step === 'drawing') out.push({ cue: 'sketch-go' })
  if (board && newest(next.misses) > newest(prev.misses)) out.push({ cue: 'sketch-miss' })

  const top = newest(prev.correct)
  next.correct.forEach((entry, place) => {
    if (entry.seq <= top) return
    const rateScale = 1 + PLACE_RATE * place
    if (board || drawer) out.push({ cue: 'sketch-got', rateScale })
    else if (entry.player === who) out.push({ cue: 'sketch-right' })
  })

  if (!board && !drawer && (next.close ?? 0) > (prev.close ?? 0)) out.push({ cue: 'sketch-close' })
  if (!board) return out

  if (prev.step === 'drawing' && next.step === 'drawing') {
    if (prev.blanks && hidden(next.blanks) < hidden(prev.blanks)) out.push({ cue: 'sketch-hint' })
    const before = secondsLeft(prev.endsAt, prev.serverTime)
    const after = secondsLeft(next.endsAt, next.serverTime)
    if (after < before && after >= 1 && after <= TICK_FROM) out.push({ cue: 'sketch-tick' })
  }
  if (prev.step === 'drawing' && next.step === 'reveal' && next.end) out.push({ cue: END_CUE[next.end] })
  if (prev.step !== 'over' && next.step === 'over') out.push({ cue: 'sketch-over' })
  return out
}

export function stepLine(v: Pick<SketchShared, 'step' | 'drawer' | 'end'>, nameOf: (id: string) => string): string {
  switch (v.step) {
    case 'choosing': return `${nameOf(v.drawer)} is choosing a word`
    case 'drawing': return `${nameOf(v.drawer)} is drawing`
    case 'reveal': return v.end === 'pass' ? `${nameOf(v.drawer)} passed` : v.end === 'all' ? 'Everyone got it' : "Time's up"
    case 'over': return 'Match over'
  }
}

export function revealStamp(v: Pick<SketchShared, 'end' | 'correct'>): string {
  if (v.correct.length) return `${v.correct.length} got it`
  return v.end === 'pass' ? 'Passed' : 'Nobody'
}

export type ChatLine = { seq: number; player: string; text: string | null; ms?: number }

export function pushChat(lines: ChatLine[], incoming: ChatLine[], max: number): { lines: ChatLine[]; evicted: ChatLine[] } {
  const next = [...lines]
  const evicted: ChatLine[] = []
  for (const line of [...incoming].sort((a, b) => a.seq - b.seq)) {
    next.push(line)
    while (next.length > max) {
      const miss = next.findIndex((l) => l.text !== null)
      evicted.push(...next.splice(miss < 0 ? 0 : miss, 1))
    }
  }
  return { lines: next, evicted }
}

export const CHAT_SLIDE_MS = 260
const CHAT_SLIDE_MIN_MS = 90
export function chatSlideMs(now: number, endsAt: number): number {
  const left = Math.max(0, endsAt - now)
  return Math.round(Math.min(CHAT_SLIDE_MS, Math.max(CHAT_SLIDE_MIN_MS, left + CHAT_SLIDE_MS / 4)))
}

export type ChatRow = { key: string; before?: number; now: number; carried: number; height: number }

export function chatStarts(rows: ChatRow[], gap: number): Map<string, number> {
  const last = rows.findLast((row) => row.before !== undefined)
  const entry = last
    ? last.before! + last.carried - last.now
    : rows.reduce((sum, row) => sum + row.height + gap, 0)
  return new Map(rows.map((row) => [row.key, row.before === undefined ? entry : row.before + row.carried - row.now]))
}

export function wipeCut(top: number, bottom: number, nextTop: number | null, gap: number): number {
  if (nextTop === null) return 0
  return Math.min(bottom - top, Math.max(0, bottom - nextTop + gap))
}

export const fmtSeconds = (ms: number) => `+${(ms / 1000).toFixed(2)}s`

