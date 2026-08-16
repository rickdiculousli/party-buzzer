/**
 * The reader: speaks a question pack aloud, fragment by fragment, and drives the
 * game in time with its own voice.
 *
 * It drives the hub by sending the same `ClientMsg`s the old CLI reader sent
 * over a socket, through a synthetic host connection. That is deliberate: every
 * validation, broadcast and undo path applies unchanged, the module still cannot
 * tell who drove it, and the hub grows no reader-shaped API.
 *
 * The human host still judges. C and W on the host screen score the round as
 * always — a wrong answer re-arms for a rebound and the reader waits it out.
 *
 * Pause holds the audio and nothing else: buzzers stay live and `powerEndsAt` is
 * untouched, because the reason to pause is usually that someone interrupted,
 * and that is exactly when a buzz should still land. The power boundary stays
 * event-driven for the same reason — scheduling it from a known clip duration
 * would desynchronise the moment anyone paused.
 */
import type { Hub, Conn } from './hub.ts'
import { loadPack } from './packs.ts'
import { render as realRender, play as realPlay, type Playback, type Speech } from './speech.ts'
import type { Question } from '../shared/pack.ts'
import type { State } from '../shared/protocol.ts'

export type ReaderOpts = {
  packDir: string
  cacheDir: string
  speech?: Speech
  voice?: string
}

export class Reader {
  private hub: Hub
  private opts: ReaderOpts
  private speech: Speech
  private conn: Conn
  private questions: Question[] = []
  private clips = new Map<string, string>()
  private pack = ''
  private qIndex = 0
  private fragIndex = 0
  private paused = false
  private playback: Playback | undefined
  private loop: Promise<void> = Promise.resolve()
  private running = false
  private waiters = new Set<() => void>()

  constructor(hub: Hub, opts: ReaderOpts) {
    this.hub = hub
    this.opts = opts
    this.speech = opts.speech ?? { render: realRender, play: realPlay }
    this.conn = { id: 'reader', role: 'host', send: () => {} }
  }

  /** Called from the hub's onChange. Wakes anything waiting on a condition. */
  onStateChange(_state: State): void {
    for (const w of [...this.waiters]) w()
  }

  /** Resolves when the current loop has finished — the test seam for the loop. */
  settled(): Promise<void> {
    return this.loop
  }

  async select(name: string): Promise<void> {
    this.stop()
    const { questions } = loadPack(this.opts.packDir, name)
    this.questions = questions
    this.pack = name
    this.qIndex = 0
    this.fragIndex = 0
    this.clips.clear()

    // Dedupe before rendering: two fragments with identical text would
    // otherwise land two workers on the same cache path at once, and
    // `speech.render` has no lock of its own to protect that write.
    const texts = [...new Set(questions.flatMap((q) => q.fragments))]
    this.publish({ rendering: { done: 0, total: texts.length } })

    // ponytail: renders four at a time. Serial is too slow for a long pack and
    // unbounded floods the box; a queue with real backpressure if it matters.
    let done = 0
    const queue = [...texts]
    const worker = async () => {
      for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
        const clip = await this.speech.render(this.opts.cacheDir, text, this.opts.voice)
        this.clips.set(text, clip.path)
        done += 1
        this.publish({ rendering: { done, total: texts.length } })
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    this.publish({ rendering: undefined })
  }

  start(): void {
    if (this.running) return
    this.running = true
    // Flip the host screen to Pause the instant playback genuinely begins;
    // `stop()` (called explicitly, or by `run()` when the pack ends) is what
    // clears `state.reading` — this call must not race a later one that undoes it.
    this.publish({})
    this.loop = this.run().finally(() => {
      this.running = false
    })
  }

  pause(): void {
    this.paused = true
    this.playback?.pause()
    this.publish({})
  }

  resume(): void {
    this.paused = false
    this.playback?.resume()
    this.publish({})
  }

  stop(): void {
    this.running = false
    this.paused = false
    this.playback?.stop()
    this.playback = undefined
    this.hub.send(this.conn, { t: 'act', act: 'reading', data: undefined })
    this.wake()
  }

  private wake(): void {
    for (const w of [...this.waiters]) w()
  }

  /** Push the current position into State, for the host screen only. */
  private publish(patch: { rendering?: { done: number; total: number } | undefined }): void {
    const q = this.questions[this.qIndex]
    const reading = {
      pack: this.pack,
      qIndex: this.qIndex,
      qTotal: this.questions.length,
      fragIndex: this.fragIndex,
      fragTotal: q?.fragments.length ?? 0,
      paused: this.paused,
      running: this.running,
      rendering: 'rendering' in patch ? patch.rendering : this.hub.state.reading?.rendering,
    }
    this.hub.send(this.conn, { t: 'act', act: 'reading', data: reading })
  }

  private async run(): Promise<void> {
    for (; this.qIndex < this.questions.length && this.running; this.qIndex++) {
      const q = this.questions[this.qIndex]
      this.fragIndex = 0
      if (q.value !== undefined) {
        this.hub.send(this.conn, { t: 'host', action: { a: 'setValue', value: q.value } })
      }
      this.hub.send(this.conn, { t: 'host', action: { a: 'arm' } })
      await this.until((s) => s.round.phase === 'ARMED')
      if (!this.running) return

      const stamp = this.hub.state.round.armedAt
      await sleep(Math.max(0, stamp - Date.now()))

      // A replaced round (undo, a fresh `arm`/`next`) deletes round.fragments;
      // a `wrong` rebound re-arms but keeps them, since the question is still
      // live. Tracking how many we've pushed lets the reader tell "the round
      // moved on without me" from "the round bounced and is still mine" —
      // `armedAt` alone can't, because a rebound changes it too.
      //
      // Before the first fragment is pushed, fragments can't carry that
      // signal yet (both cases read as empty), so that one check falls back
      // to `armedAt`. That's safe specifically here: COLLECT_MS is longer
      // than ARM_LEAD_MS, so a genuine wrong-judgment rebound cannot land
      // before this question's first fragment goes out.
      let pushed = 0
      const stillMine = () =>
        pushed === 0
          ? this.hub.state.round.armedAt === stamp
          : (this.hub.state.round.fragments?.length ?? 0) >= pushed

      const powerAfter = Number(this.hub.state.game.options.powerAfterFragment ?? 0)
      for (let f = 0; f < q.fragments.length && this.running; f++) {
        if (!stillMine()) return
        this.fragIndex = f + 1
        const text = q.fragments[f]
        this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
        pushed += 1
        this.publish({})
        await this.speak(text)
        if (!this.running || !stillMine()) return
        if (powerAfter > 0 && f + 1 === powerAfter) {
          this.hub.send(this.conn, { t: 'act', act: 'powerEnds' })
        }
      }

      // The host judges from here. Resolved means scored, or passed with nobody
      // left in the round.
      await this.until(
        (s) =>
          s.round.phase === 'IDLE' &&
          (!!s.round.award || (s.round.order.length === 0 && s.round.lockedOut.length === 0)),
      )
      if (!this.running) return
      if (this.hub.state.round.award) {
        this.hub.send(this.conn, { t: 'act', act: 'revealAnswer', data: q.answer })
      }
      // Let the payoff sit on the wall; the host's N clears it and releases us.
      await this.until((s) => s.round.phase === 'IDLE' && !s.round.award)
    }
    this.stop()
  }

  private async speak(text: string): Promise<void> {
    const path = this.clips.get(text)
    if (!path) return
    const pb = this.speech.play(path)
    this.playback = pb
    if (this.paused) pb.pause()
    await pb.done
    this.playback = undefined
  }

  /** Wait until the state satisfies a predicate, or the reader stops. */
  private until(ok: (s: State) => boolean): Promise<void> {
    if (!this.running || ok(this.hub.state)) return Promise.resolve()
    return new Promise((resolve) => {
      const check = () => {
        if (this.running && !ok(this.hub.state)) return
        this.waiters.delete(check)
        resolve()
      }
      this.waiters.add(check)
    })
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
