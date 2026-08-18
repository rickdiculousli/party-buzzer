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
 * Autoplay removes the keypresses either side of that judgment, not the
 * judgment: the payoff sits for `nextSec` and the reader presses N itself, a
 * rebound waits `reboundSec` before the clue picks up, and a question nobody
 * touched passes on its own rather than wedging the loop. With the spoken
 * judge running too, that is a pack that reads itself end to end.
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
import type { Judge } from './judge.ts'

export type ReaderOpts = {
  packDir: string
  cacheDir: string
  speech?: Speech
  voice?: string
  /** The judge scores the spoken answer; absent, the host judges as always. */
  judge?: Judge
}

export class Reader {
  private hub: Hub
  private opts: ReaderOpts
  private speech: Speech
  private conn: Conn
  /** Every pack loaded this session, by filename. A setlist may name several. */
  private loaded = new Map<string, Question[]>()
  /** Where each of them is up to, so a block returning to one picks up there. */
  private pos = new Map<string, number>()
  /** Clips are keyed by fragment text, so two packs sharing one share the clip. */
  private clips = new Map<string, string>()
  private pack = ''
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
  onStateChange(state: State): void {
    // A buzz cuts the voice mid-word. The room is answering now, and a reader
    // who keeps talking over the buzz is giving away the rest of the clue.
    if (state.round.phase !== 'ARMED') this.playback?.stop()
    for (const w of [...this.waiters]) w()
  }

  /** Resolves when the current loop has finished — the test seam for the loop. */
  settled(): Promise<void> {
    return this.loop
  }

  /** The pack being read right now, and how far into it we are. */
  private get questions(): Question[] {
    return this.loaded.get(this.pack) ?? []
  }

  private get qIndex(): number {
    return this.pos.get(this.pack) ?? 0
  }

  private set qIndex(n: number) {
    this.pos.set(this.pack, n)
  }

  /**
   * Forget where every pack got to. Read normally resumes — stopping for the
   * night and coming back should not lose your place — so this exists for the
   * one caller that needs the opposite: a scripted walkthrough has to start
   * from the same frame however the last run ended.
   */
  rewind(): void {
    this.pos.clear()
  }

  /** The host picked a pack: stop, and start it from the top. */
  async select(name: string): Promise<void> {
    this.stop()
    await this.ensure(name)
    this.pack = name
    this.qIndex = 0
    this.fragIndex = 0
    this.publish({})
  }

  /**
   * Load and synthesise a pack if this session has not already. Packs stay in
   * memory once rendered, which is what lets a setlist cross between them at a
   * block boundary without a thirty-second stall in the middle of the night.
   */
  private async ensure(name: string): Promise<void> {
    if (this.loaded.has(name)) return
    const { questions, errors } = loadPack(this.opts.packDir, name)
    for (const e of errors) console.warn(`[reader] ${name}: ${e}`)
    if (questions.length === 0) {
      throw new Error(`pack "${name}" has no valid questions`)
    }
    this.loaded.set(name, questions)
    // Publishing needs a current pack to report against, and the first ensure
    // of a session has none yet.
    if (!this.pack) this.pack = name

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
    // Read means read. A pack played to its end keeps its position past the
    // last question — that is what makes a setlist stop there rather than wrap
    // — so pressing Read is the boundary where every spent pack starts over.
    // All of them, not just the current one: under a setlist the pack this
    // press is about to reach is not necessarily the one it left off in.
    for (const [name, questions] of this.loaded) {
      if ((this.pos.get(name) ?? 0) >= questions.length) this.pos.set(name, 0)
    }
    this.running = true
    this.paused = false
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
    // Kill the clip; `speak` sees `paused` still set and holds, then replays it.
    this.playback?.stop()
    this.publish({})
  }

  resume(): void {
    this.paused = false
    this.publish({})
  }

  stop(): void {
    this.running = false
    this.paused = false
    this.playback?.stop()
    this.playback = undefined
    this.opts.judge?.unprime()
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

  /**
   * Which pack the next question comes from. A setlist block names its own, so
   * the reader follows the flow across pack boundaries; without a setlist it is
   * whatever the host picked. Undefined means there is nothing to read — a
   * spent setlist, or a block whose questions the host is reading aloud
   * themselves — and the loop ends rather than reading the wrong pack.
   */
  private nextPack(): string | undefined {
    const flow = this.hub.state.flow
    if (!flow) return this.pack || undefined
    return flow.blocks[flow.at]?.pack
  }

  private async run(): Promise<void> {
    // Every pack the setlist names, rendered before the first question rather
    // than at the block boundary where it would be thirty seconds of silence.
    for (const b of this.hub.state.flow?.blocks ?? []) {
      if (b.pack) await this.ensure(b.pack)
      if (!this.running) return
    }

    while (this.running) {
      const want = this.nextPack()
      if (!want) break
      if (want !== this.pack) {
        await this.ensure(want)
        if (!this.running) return
        this.pack = want
      }
      const q = this.questions[this.qIndex]
      if (!q) break
      this.fragIndex = 0
      if (q.value !== undefined) {
        this.hub.send(this.conn, { t: 'host', action: { a: 'setValue', value: q.value } })
      }
      this.hub.send(this.conn, { t: 'host', action: { a: 'arm' } })
      // Answer variants, memory only — this is the one path by which the judge
      // ever learns what the room is about to be asked.
      this.opts.judge?.prime(q.answers)
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
        const finished = await this.speak(text)
        if (!this.running || !stillMine()) return
        // Someone buzzed and the question was scored while they held the floor.
        // The rest of the clue is not read out — the host judges from here.
        if (!finished) break
        if (powerAfter > 0 && f + 1 === powerAfter) {
          this.hub.send(this.conn, { t: 'act', act: 'powerEnds' })
        }
      }

      // The host judges from here. Resolved means scored, or passed with nobody
      // left in the round.
      const resolved = (s: State) =>
        s.round.phase === 'IDLE' &&
        (!!s.round.award || (s.round.order.length === 0 && s.round.lockedOut.length === 0))

      // Dead air — the clue ran out and nobody pressed anything — has no
      // resolution to wait for. A host passes it by hand; autoplay gives it the
      // same dwell as a payoff and then moves on, since the alternative is a
      // loop that waits forever on a room that has already stopped playing.
      let deadAir = false
      while (this.running && !resolved(this.hub.state)) {
        await this.until(resolved, this.dwellMs())
        const r = this.hub.state.round
        // Only silence passes itself. Anything else still pending is somebody
        // mid-answer, and their verdict is worth waiting out however long the
        // host takes over it.
        if (this.running && !resolved(this.hub.state) && r.phase === 'ARMED' && r.order.length === 0) {
          deadAir = true
          break
        }
      }
      if (!this.running) return
      if (this.hub.state.round.award || deadAir) {
        this.hub.send(this.conn, { t: 'act', act: 'revealAnswer', data: q.answer })
      }
      // Let the payoff sit on the wall; the host's N clears it and releases us —
      // under autoplay the reader presses N itself once the dwell is up.
      await this.until((s) => s.round.phase === 'IDLE' && !s.round.award, this.dwellMs())
      if (!this.running) return
      if (this.hub.state.round.award || deadAir) {
        this.hub.send(this.conn, { t: 'host', action: { a: 'next' } })
      }
      // Done with this one. The `next` above may have rolled the setlist into a
      // block with a different pack, which the top of the loop picks up.
      this.qIndex += 1
    }
    // The pack is spent, so autoplay goes off with it. Leaving it on would hand
    // the room back to a host whose next question advances itself out from
    // under them; off, the game simply carries on by hand.
    const auto = this.hub.state.autoplay
    if (auto.on) {
      this.hub.send(this.conn, { t: 'host', action: { ...auto, a: 'setAutoplay', on: false } })
    }
    this.stop()
  }

  /**
   * Speak one fragment, holding here for as long as the host keeps us paused.
   *
   * There is no seek: an interruption kills the clip and the fragment is
   * replayed from its start. That is the whole cost of the stutter-free pause,
   * and it is the right behaviour anyway — a human reader interrupted
   * mid-clause re-reads the clause rather than picking up mid-word.
   *
   * Two things interrupt: the host's pause, and a buzz. A buzz holds here until
   * the question either rebounds (wrong answer, ARMED again — the fragment is
   * re-read) or is done with (returns false, and the caller stops reading it).
   */
  private async speak(text: string): Promise<boolean> {
    const path = this.clips.get(text)
    if (!path) return true
    while (this.running) {
      if (this.paused) {
        // publish() on resume is what wakes this.
        await this.until(() => !this.paused)
        continue
      }
      if (this.buzzed()) {
        await this.until((s) => s.round.phase === 'ARMED' || s.round.phase === 'IDLE')
        if (!this.running || this.buzzed()) return false
        // A rebound. Under autoplay nobody is talking over the gap, so the clue
        // takes a beat before picking up rather than stepping on the miss.
        const auto = this.hub.state.autoplay
        if (auto.on) await this.until(() => false, auto.reboundSec * 1000)
        if (!this.running || this.buzzed()) return false
        continue
      }
      const pb = this.speech.play(path)
      this.playback = pb
      await pb.done
      this.playback = undefined
      // An untouched clip reached its own end; otherwise pause() or a buzz
      // killed it, so loop round and wait to say it again.
      if (!this.paused && !this.buzzed()) return true
    }
    return true
  }

  /** Somebody has the floor: collecting, locked, or already judged. */
  private buzzed(): boolean {
    return this.hub.state.round.phase !== 'ARMED'
  }

  /**
   * How long a wait for the host may run before the reader takes the decision
   * itself, or undefined for the wait that never expires. Read fresh each time:
   * the toggle is a live setting, so turning autoplay on mid-question takes
   * effect on the next beat rather than the next pack.
   */
  private dwellMs(): number | undefined {
    const auto = this.hub.state.autoplay
    return auto.on ? auto.nextSec * 1000 : undefined
  }

  /** Wait until the state satisfies a predicate, the dwell runs out, or we stop. */
  private until(ok: (s: State) => boolean, dwellMs?: number): Promise<void> {
    if (!this.running || ok(this.hub.state)) return Promise.resolve()
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const done = () => {
        this.waiters.delete(check)
        if (timer) clearTimeout(timer)
        resolve()
      }
      const check = () => {
        if (this.running && !ok(this.hub.state)) return
        done()
      }
      this.waiters.add(check)
      if (dwellMs !== undefined) {
        timer = setTimeout(done, dwellMs)
        timer.unref?.()
      }
    })
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
