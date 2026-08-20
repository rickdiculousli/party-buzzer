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
 * rebound holds the miss for `reboundSec` with the buzzers shut and then opens
 * itself, and a question nobody
 * touched passes on its own rather than wedging the loop. With the spoken
 * judge running too, that is a pack that reads itself end to end.
 *
 * Pause holds the audio and nothing else: buzzers stay live and `powerEndsAt` is
 * untouched, because the reason to pause is usually that someone interrupted,
 * and that is exactly when a buzz should still land. The power boundary stays
 * event-driven for the same reason — scheduling it from a known clip duration
 * would desynchronise the moment anyone paused.
 */
import { join as joinFragments, type Fold, type Joined } from './align.ts'
import type { Hub, Conn } from './hub.ts'
import { loadPack } from './packs.ts'
import { render as realRender, play as realPlay, type Clip, type Playback, type Speech } from './speech.ts'
import type { Question } from '../shared/pack.ts'
import type { State } from '../shared/protocol.ts'
import type { Judge } from './judge.ts'

/**
 * Where the fragments and clauses fall inside a clip of the whole question.
 * Injected rather than reached for, so the reader neither spawns anything nor
 * knows that finding out involves speech recognition at all.
 */
export type Aligner = (joined: Joined, clip: Clip) => Promise<Fold[]>

export type ReaderOpts = {
  packDir: string
  cacheDir: string
  speech?: Speech
  voice?: string
  /** The judge scores the spoken answer; absent, the host judges as always. */
  judge?: Judge
  /**
   * Absent, the reader speaks a fragment at a time as it always did. Present,
   * it speaks the whole question in one breath and reveals it a clause at a
   * time — which needs to know where the clauses are, which is this.
   */
  align?: Aligner
}

/**
 * How far behind the voice the board is held. Negative, deliberately: a clause
 * is meant to be up as the reader starts saying it, and every estimate feeding
 * it rounds late — the bisection brackets to the far end, the oracle counts
 * pessimistically, and the audio device costs a few more milliseconds on top.
 * This cancels that, so "as it is spoken" does not drift into "just after".
 *
 * The knob for how far ahead the board runs. Toward zero to hold it back to the
 * voice; further negative to have the line waiting when the clause begins.
 */
const REVEAL_LAG_MS = -80

export class Reader {
  private hub: Hub
  private opts: ReaderOpts
  private speech: Speech
  private conn: Conn
  /** Every pack loaded this session, by filename. A setlist may name several. */
  private loaded = new Map<string, Question[]>()
  /** Where each of them is up to, so a block returning to one picks up there. */
  private pos = new Map<string, number>()
  /** Clips are keyed by the text spoken, so two packs sharing one share the clip. */
  private clips = new Map<string, string>()
  /**
   * A whole question's clip and where its fragments and clauses fall in it,
   * keyed by the joined text. Empty when no aligner was supplied, which is what
   * puts the reader back on one clip per fragment.
   */
  private aligned = new Map<string, { clip: Clip; folds: Fold[] }>()
  /**
   * Text -> resolves once its clip (and its folds) are in hand. Rendering runs
   * behind the game rather than in front of it, so this is what the loop waits
   * on before a question it may have reached first.
   */
  private ready = new Map<string, Promise<void>>()
  private resolvers = new Map<string, () => void>()
  private queue: string[] = []
  private renderers = 0
  private rendered = 0
  private renderTotal = 0
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
   * What gets spoken for a question: one utterance when we can place the folds
   * inside it, one per fragment when we cannot. Reading a whole question in a
   * breath is the point — a fragment spoken alone gets sentence-final
   * intonation even when it ends mid-sentence, which is what made the reader
   * sound chopped.
   */
  private textsFor(q: Question): string[] {
    return this.opts.align ? [joinFragments(q.fragments).text] : q.fragments
  }

  /**
   * Load a pack if this session has not already, and queue its audio. Resolves
   * once the *first* question is ready rather than the pack: a twenty-question
   * pack is a minute of synthesis, and none of it but the first question is
   * needed to start playing. The rest lands behind the game, which is safe
   * because `waitFor` gates every question on its own audio.
   *
   * Packs stay in memory once rendered, which is what lets a setlist cross
   * between them at a block boundary without a stall in the middle of the night.
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

    // Dedupe: two identical texts would otherwise land two workers on the same
    // cache path at once, and `speech.render` has no lock of its own to protect
    // that write. Deduped across packs too, so a shared line renders once ever.
    const texts = [...new Set(questions.flatMap((q) => this.textsFor(q)))]
    for (const text of texts) {
      if (this.ready.has(text)) continue
      this.ready.set(text, new Promise<void>((r) => this.resolvers.set(text, r)))
      this.queue.push(text)
      this.renderTotal += 1
    }
    this.pump()
    await this.ready.get(texts[0])
  }

  /**
   * ponytail: four at a time, FIFO. Serial is too slow for a long pack and
   * unbounded floods the box; alignment rides the same width, which is about
   * where the speech daemon stops going faster however many ask it. A pack
   * queued while another is still rendering waits its turn — the order packs
   * are ensured in is the order they are read in, so FIFO is the right guess.
   */
  private pump(): void {
    while (this.renderers < 4 && this.queue.length) {
      this.renderers += 1
      void this.drain().finally(() => {
        this.renderers -= 1
        if (this.renderers === 0 && this.queue.length === 0) {
          this.rendered = 0
          this.renderTotal = 0
          this.publish({ rendering: undefined })
        }
      })
    }
  }

  private async drain(): Promise<void> {
    for (let text = this.queue.shift(); text !== undefined; text = this.queue.shift()) {
      try {
        const clip = await this.speech.render(this.opts.cacheDir, text, this.opts.voice)
        this.clips.set(text, clip.path)
        if (this.opts.align) {
          // A question whose folds cannot be found is still read aloud in full;
          // its text simply lands when the clip ends, because the one thing
          // worse than a board that lags is a board that runs ahead.
          const j = joinFragments(this.fragmentsFor(text))
          const folds = await this.opts.align(j, clip).catch((e) => {
            console.warn(`[reader] alignment failed, reveal stays coarse — ${e}`)
            return [] as Fold[]
          })
          this.aligned.set(text, { clip, folds })
        }
      } catch (e) {
        // A text that cannot be rendered still has to release whoever is
        // waiting on it; the question goes up on the board unspoken.
        console.warn(`[reader] could not render — ${e}`)
      } finally {
        this.resolvers.get(text)?.()
        this.resolvers.delete(text)
        this.rendered += 1
        this.publish({ rendering: { done: this.rendered, total: this.renderTotal } })
      }
    }
  }

  /** Hold the loop until this question's audio exists. Usually already true. */
  private async waitFor(q: Question): Promise<void> {
    await Promise.all(this.textsFor(q).map((t) => this.ready.get(t)))
  }

  /** The fragments that joined to this text — needed to place their boundaries. */
  private fragmentsFor(joinedText: string): string[] {
    for (const questions of this.loaded.values()) {
      const q = questions.find((x) => joinFragments(x.fragments).text === joinedText)
      if (q) return q.fragments
    }
    return [joinedText]
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
   * the reader follows the setlist across pack boundaries; without a setlist it is
   * whatever the host picked. Undefined means there is nothing to read — a
   * spent setlist, or a block whose questions the host is reading aloud
   * themselves — and the loop ends rather than reading the wrong pack.
   */
  private nextPack(): string | undefined {
    const setlist = this.hub.state.setlist
    if (!setlist) return this.pack || undefined
    return setlist.blocks[setlist.at]?.pack
  }

  private async run(): Promise<void> {
    // Every pack the setlist names, queued before the first question rather
    // than at the block boundary where it would be thirty seconds of silence.
    // Queued, not awaited: rendering runs behind the game now, in the order the
    // blocks will be read, so the first question is not held up by the last.
    for (const b of this.hub.state.setlist?.blocks ?? []) {
      if (b.pack) void this.ensure(b.pack).catch((e) => console.warn(`[reader] ${b.pack}: ${e}`))
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
      // The one place the warm start can bite: a room that outran the renderer.
      // Wait here rather than arming onto a clip that does not exist yet, which
      // would open the buzzers on silence.
      await this.waitFor(q)
      if (!this.running) return
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
      // than ARM_DELAY_MS, so a genuine wrong-judgment rebound cannot land
      // before this question's first fragment goes out.
      let pushed = 0
      const stillMine = () =>
        pushed === 0
          ? this.hub.state.round.armedAt === stamp
          : (this.hub.state.round.fragments?.length ?? 0) >= pushed

      const powerAfter = Number(this.hub.state.game.options.powerAfterFragment ?? 0)
      const j = joinFragments(q.fragments)
      // The board needs the shape of the whole question before it says any of
      // it, or every line it has already put up moves when the next one lands.
      // Players never see this — the hub strips it.
      this.hub.send(this.conn, { t: 'act', act: 'whole', data: j.text })
      const whole = this.aligned.get(j.text)

      if (whole) {
        // One clip, revealed a clause at a time as the voice reaches each one.
        let shown = 0 // characters of the joined text on the board
        let frags = 0 // how many fragment entries that has taken
        let powered = false

        const revealTo = (upto: number) => {
          if (upto <= shown || !stillMine()) return
          shown = upto
          for (let i = 0; i < q.fragments.length; i++) {
            const start = j.fragmentAt[i]
            if (upto <= start) break
            const text = q.fragments[i].slice(0, Math.min(q.fragments[i].length, upto - start)).trimEnd()
            if (!text) continue
            if (i >= frags) {
              // Crossing into a fragment starts a new entry, so `fragments`
              // stays a list of fragments however finely it is revealed.
              this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
              frags = i + 1
              pushed += 1
              this.fragIndex = i + 1
              this.publish({})
            } else if (i === frags - 1) {
              this.hub.send(this.conn, { t: 'act', act: 'extend', data: text })
            }
          }
          // The power boundary counts whole fragments, and a fragment is whole
          // once the reveal has passed its last character.
          if (powerAfter > 0 && !powered) {
            const complete = q.fragments.filter((f, i) => upto >= j.fragmentAt[i] + f.length).length
            if (complete >= powerAfter) {
              powered = true
              this.hub.send(this.conn, { t: 'act', act: 'powerEnds' })
            }
          }
        }

        const finished = await this.speakWhole(whole, j, revealTo, stillMine)
        if (!this.running || !stillMine()) return
        if (finished) revealTo(j.text.length)
      } else {
        for (let f = 0; f < q.fragments.length && this.running; f++) {
          if (!stillMine()) return
          this.fragIndex = f + 1
          const text = q.fragments[f]
          this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
          pushed += 1
          this.publish({})
          const finished = await this.speak(text)
          if (!this.running || !stillMine()) return
          // Someone buzzed and the question was scored while they held the
          // floor. The rest of the clue is not read out — the host judges.
          if (!finished) break
          if (powerAfter > 0 && f + 1 === powerAfter) {
            this.hub.send(this.conn, { t: 'act', act: 'powerEnds' })
          }
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
   * Speak a whole question, revealing it as the voice reaches each fold.
   *
   * The reveal is driven by timers rather than by the player reporting where it
   * is, and the clock starts when playback actually begins rather than when the
   * process spawns — a board keyed off the spawn would run ahead of the sound by
   * however long the audio device took to open.
   *
   * Interruption still re-reads the clause, exactly as it re-read the fragment
   * before: playback resumes at the last clause or fragment fold, so the room
   * hears a whole clause rather than being dropped between two words. The board
   * may already be a few words ahead of that point — the reveal never rewinds —
   * which is the same thing a human reader backing up a clause does. Without a
   * seeking player the resume starts the question over instead, and the reveal
   * simply catches up.
   */
  private async speakWhole(
    whole: { clip: Clip; folds: Fold[] },
    j: Joined,
    revealTo: (upto: number) => void,
    ok: () => boolean,
  ): Promise<boolean> {
    const { clip, folds } = whole
    const steps = [...folds].sort((a, b) => a.ms - b.ms)
    let atMs = 0

    while (this.running) {
      if (this.paused) {
        await this.until(() => !this.paused)
        continue
      }
      if (this.buzzed()) {
        if (!(await this.waitOutBuzz())) return false
        continue
      }

      const pb = this.speech.play(clip.path, atMs)
      this.playback = pb
      await pb.started
      const from = atMs
      const t0 = Date.now()
      const timers = steps
        .filter((s) => s.ms >= from)
        .map((s) => {
          const t = setTimeout(
            () => {
              if (ok()) revealTo(s.at)
            },
            Math.max(0, s.ms - from) + REVEAL_LAG_MS,
          )
          t.unref?.()
          return t
        })

      await pb.done
      for (const t of timers) clearTimeout(t)
      this.playback = undefined
      if (!this.paused && !this.buzzed()) return true

      // Back to the top of the clause that was in progress. Folds are the only
      // places the board has moved, so this is always a point the room has both
      // heard and seen.
      const stoppedAt = from + (Date.now() - t0)
      atMs = steps.reduce((best, s) => (s.ms <= stoppedAt && s.ms > best ? s.ms : best), 0)
    }
    return true
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
        if (!(await this.waitOutBuzz())) return false
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
  /**
   * Held here from the moment someone buzzes until the question is either the
   * reader's again or gone. False means gone — scored, stopped, or replaced —
   * and the caller stops reading it.
   *
   * A held rebound is the reader's to open. The miss sits on the board with the
   * buzzers shut for the rebound beat, and only then does the arm go out, so
   * the room and the phones learn the question is live again at the same
   * moment. The beat used to run on the far side of the arm: buzzers open for
   * the whole of it while nothing was being read and the wall was showing a
   * result, which made buzzing on the verdict itself the dominant strategy and
   * a race on a signal only the phones had.
   *
   * An unheld rebound — a host judging by hand while the box reads — keeps the
   * old shape, because they opened it themselves when they pressed W.
   */
  private async waitOutBuzz(): Promise<boolean> {
    await this.until(
      (s) => s.round.phase === 'ARMED' || s.round.phase === 'IDLE' || !!s.round.held,
    )
    if (!this.running) return false
    const auto = this.hub.state.autoplay
    if (this.hub.state.round.held) {
      // Ends early if anything else takes the round — a host arming, an undo.
      await this.until((s) => !s.round.held, auto.reboundSec * 1000)
      if (!this.running) return false
      if (this.hub.state.round.held) {
        this.hub.send(this.conn, { t: 'host', action: { a: 'rebound' } })
      }
      return this.running && !this.buzzed()
    }
    if (this.buzzed()) return false
    if (auto.on) await this.until(() => false, auto.reboundSec * 1000)
    return this.running && !this.buzzed()
  }

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
