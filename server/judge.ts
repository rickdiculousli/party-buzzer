/**
 * The judge: scores spoken answers while the reader drives a pack.
 *
 * It watches the same state stream the reader waits on, opens an answer window
 * when a round locks with a leader while primed, and returns its verdict as
 * ordinary host actions through a synthetic host connection — undo, validation,
 * rebound and the reader's wait-for-award loop all apply unchanged, and the hub
 * grows no judge-shaped API.
 *
 * The pack's answers are primed by the reader at arm time and live in memory
 * only, never in State. No prime — or no speech-to-text helper — and the judge
 * simply opens no windows, which is the whole degradation story: the phone
 * never offers push-to-talk and the host judges by hand, exactly as today.
 */
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { matchAnswer } from './match.ts'
import type { Hub, Conn } from './hub.ts'
import type { PlayerId } from '../shared/protocol.ts'

/** Speech-to-text, injected so tests never touch the Swift helper. */
export type Transcribe = (wavPath: string) => Promise<string | null>

export type JudgeOpts = {
  /** Absent = the judge is off: it opens no windows and the host judges. */
  transcribe?: Transcribe
}

export type AnswerResult = { ok: true; hit: boolean; transcript: string } | { ok: false }

export class Judge {
  private hub: Hub
  private transcribe: Transcribe | undefined
  private conn: Conn = { id: 'judge', role: 'host', send: () => {} }
  /** The current question's answer variants. Memory only — never State. */
  private primed: string[] | undefined
  /** `${armedAt}:${leaderId}` for the open window, so repeat broadcasts don't re-open it. */
  private windowKey: string | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(hub: Hub, opts: JudgeOpts = {}) {
    this.hub = hub
    this.transcribe = opts.transcribe
  }

  /** The reader calls this at arm time with the question's answer variants. */
  prime(answers: string[]): void {
    this.primed = answers
  }

  unprime(): void {
    this.primed = undefined
    if (!this.windowKey) return
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })
  }

  /** Called from the hub's onChange. */
  onStateChange(): void {
    const state = this.hub.state
    const leader = state.round.order[0]
    if (state.round.phase !== 'LOCKED' || !leader || !this.primed || !this.transcribe) {
      // Anything that left LOCKED — a verdict, a host W, a next — ends the window.
      if (this.windowKey && state.round.phase !== 'LOCKED') this.closeWindow()
      return
    }
    const key = `${state.round.armedAt}:${leader.playerId}`
    if (key === this.windowKey) return
    this.closeWindow()
    this.windowKey = key
    const sec = state.answerWindowSec
    const until = sec > 0 ? Date.now() + sec * 1000 : undefined
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: until ? { until } : {} })
    if (until) {
      this.timer = setTimeout(() => this.lapse(key), sec * 1000)
      this.timer.unref?.()
    }
  }

  /**
   * One answer per window. Anything that isn't the current leader inside the
   * open window — a late packet after a rebound, a bystander's phone — is
   * refused, and the caller turns that into a 409.
   */
  async submit(playerId: PlayerId, body: Buffer, isText: boolean): Promise<AnswerResult> {
    const state = this.hub.state
    const leader = state.round.order[0]
    if (
      !this.primed ||
      !this.windowKey ||
      state.round.phase !== 'LOCKED' ||
      leader?.playerId !== playerId
    ) {
      return { ok: false }
    }
    const answers = this.primed
    const name = leader.name
    const neg = state.round.value
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })

    const transcript = isText ? body.toString('utf8').trim() : await this.hear(body)
    // The round may have moved while transcription was in flight — a host
    // score, or a wrong that rebounded to a new leader. A late verdict must
    // not land on the rebound's leader, and the transcript belongs to a round
    // that is gone.
    if (
      this.hub.state.round.phase !== 'LOCKED' ||
      this.hub.state.round.order[0]?.playerId !== playerId
    ) {
      return { ok: false }
    }
    const hit = !!transcript && matchAnswer(transcript, answers)
    this.hub.send(this.conn, { t: 'act', act: 'spoken', data: { name, transcript, hit } })
    this.hub.send(this.conn, { t: 'host', action: hit ? { a: 'correct' } : { a: 'wrong', neg } })
    return { ok: true, hit, transcript }
  }

  private async hear(body: Buffer): Promise<string> {
    const path = join(tmpdir(), `buzzer-answer-${randomUUID()}.wav`)
    try {
      writeFileSync(path, body)
      return (await this.transcribe?.(path)) ?? ''
    } finally {
      rmSync(path, { force: true })
    }
  }

  /** The window ran out with no answer: silence is a wrong, through the same path. */
  private lapse(key: string): void {
    if (this.windowKey !== key) return
    const state = this.hub.state
    const leader = state.round.order[0]
    if (state.round.phase !== 'LOCKED' || !leader) return
    const neg = state.round.value
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })
    this.hub.send(this.conn, {
      t: 'act',
      act: 'spoken',
      data: { name: leader.name, transcript: '', hit: false },
    })
    this.hub.send(this.conn, { t: 'host', action: { a: 'wrong', neg } })
  }

  private closeWindow(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.windowKey = undefined
  }
}
