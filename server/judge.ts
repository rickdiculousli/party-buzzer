import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { matchAnswer } from './match.ts'
import type { Hub, Conn } from './hub.ts'
import type { PlayerId } from '../shared/protocol.ts'

export type Transcribe = (wavPath: string) => Promise<string | null>

export type JudgeOpts = {
  transcribe?: Transcribe
}

export type AnswerResult = { ok: true; hit: boolean; transcript: string } | { ok: false }

export class Judge {
  private hub: Hub
  private transcribe: Transcribe | undefined
  private conn: Conn = { id: 'judge', role: 'host', send: () => {} }
  private primed: string[] | undefined
  private windowKey: string | undefined
  private submittedFor: string | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(hub: Hub, opts: JudgeOpts = {}) {
    this.hub = hub
    this.transcribe = opts.transcribe
  }

  prime(answers: string[]): void {
    this.primed = [...answers]
  }

  unprime(): void {
    this.primed = undefined
    if (!this.windowKey) return
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })
  }

  onStateChange(): void {
    const state = this.hub.state
    const leader = state.round.order[0]
    if (state.round.phase !== 'LOCKED' || !leader || !this.primed || !this.transcribe) {
      if (this.windowKey && state.round.phase !== 'LOCKED') this.closeWindow()
      return
    }
    const key = `${state.round.attemptId}:${leader.playerId}`
    if (key === this.windowKey || key === this.submittedFor) return
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
    const key = this.windowKey
    this.submittedFor = key
    const name = leader.name
    const neg = state.round.value
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })

    const transcript = isText ? body.toString('utf8').trim() : await this.hear(body)
    if (
      this.hub.state.round.phase !== 'LOCKED' ||
      this.hub.state.round.order[0]?.playerId !== playerId ||
      `${this.hub.state.round.attemptId}:${playerId}` !== key ||
      this.primed !== answers
    ) {
      return { ok: false }
    }
    const hit = !!transcript && matchAnswer(transcript, answers)
    this.hub.send(this.conn, { t: 'act', act: 'spoken', data: { name, transcript, hit } })
    this.hub.dispatch(hit ? { a: 'correct' } : { a: 'wrong', neg })
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

  private lapse(key: string): void {
    if (this.windowKey !== key) return
    const state = this.hub.state
    const leader = state.round.order[0]
    if (state.round.phase !== 'LOCKED' || !leader) return
    const neg = state.round.value
    this.submittedFor = key
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })
    this.hub.send(this.conn, {
      t: 'act',
      act: 'spoken',
      data: { name: leader.name, transcript: '', hit: false },
    })
    this.hub.dispatch({ a: 'wrong', neg })
  }

  private closeWindow(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.windowKey = undefined
  }
}
