import { join as joinFragments, type Fold, type Joined } from './align.ts'
import type { Hub, Conn } from './hub.ts'
import { loadPack } from './packs.ts'
import { render as realRender, play as realPlay, type Clip, type Playback, type Speech } from './speech.ts'
import type { Question } from '../shared/pack.ts'
import type { State } from '../shared/protocol.ts'
import { allPicked, optionsText } from '../shared/choice.ts'
import { allGuessed, closestTimes } from '../shared/closest.ts'
import type { Judge } from './judge.ts'
import { Picker, type Pools, type Verdict } from './quips.ts'
import { isPenalty } from '../shared/protocol.ts'
import { arrivalBlocksPlay } from '../shared/arrival.ts'

export type Aligner = (joined: Joined, clip: Clip) => Promise<Fold[]>

export type ReaderOpts = {
  packDir: string
  cacheDir: string
  speech?: Speech
  voice?: string
  judge?: Judge
  align?: Aligner
  perform?: boolean
  quips?: { pools: Pools; plain?: Pools }
  onClip?: (clip: Clip, startedAt: number) => void
  nextCardMs?: number
  nextCue?: string
}

const REVEAL_LAG_MS = -80

const LOCK_BEAT_MS = 1000

export const NEXT_CUE = 'Next question.'

export class Reader {
  private hub: Hub
  private opts: ReaderOpts
  private speech: Speech
  private conn: Conn
  private loaded = new Map<string, Question[]>()
  private pos = new Map<string, number>()
  private clips = new Map<string, string>()
  private aligned = new Map<string, { clip: Clip; folds: Fold[] }>()
  private ready = new Map<string, Promise<void>>()
  private resolvers = new Map<string, () => void>()
  private queue: string[] = []
  private renderers = 0
  private rendered = 0
  private renderTotal = 0
  private pack = ''
  private fragIndex = 0
  private paused = false
  private closeNow = false
  private playback: Playback | undefined
  private quipback: Playback | undefined
  private voiceEpoch = 0
  private picker = new Picker()
  private loop: Promise<void> = Promise.resolve()
  private running = false
  private waiters = new Set<() => void>()
  private session = new AbortController()

  constructor(hub: Hub, opts: ReaderOpts) {
    this.hub = hub
    this.opts = opts
    this.speech = opts.speech ?? { render: realRender, play: realPlay }
    this.conn = { id: 'reader', role: 'host', send: () => {} }
  }

  onStateChange(state: State): void {
    if (state.round.phase !== 'ARMED') this.playback?.stop()
    for (const w of [...this.waiters]) w()
  }

  settled(): Promise<void> {
    return this.loop
  }

  private get questions(): Question[] {
    return this.loaded.get(this.pack) ?? []
  }

  private get qIndex(): number {
    return this.pos.get(this.pack) ?? 0
  }

  private set qIndex(n: number) {
    this.pos.set(this.pack, n)
  }

  rewind(): void {
    this.pos.clear()
  }

  async select(name: string): Promise<void> {
    this.stop()
    await this.ensure(name)
    this.pack = name
    this.qIndex = 0
    this.fragIndex = 0
    this.publish({})
  }

  private textsFor(q: Question): string[] {
    const question = this.opts.align ? [this.spoken(q)] : q.fragments
    const reaction = this.opts.perform && q.reaction ? [q.reaction] : []
    return [...question, ...(q.choices ? [optionsText(q.choices)] : []), ...reaction]
  }

  private async ensure(name: string, sig?: AbortSignal): Promise<void> {
    if (this.loaded.has(name)) {
      sig?.throwIfAborted()
      return
    }
    const { questions, errors } = loadPack(this.opts.packDir, name)
    for (const e of errors) console.warn(`[reader] ${name}: ${e}`)
    if (questions.length === 0) {
      throw new Error(`pack "${name}" has no valid questions`)
    }
    this.loaded.set(name, questions)
    if (!this.pack) this.pack = name

    const texts = [...new Set(questions.flatMap((q) => this.textsFor(q)))]
    for (const text of [...texts, ...this.cueTexts(), ...this.poolTexts()]) {
      if (this.ready.has(text)) continue
      this.ready.set(text, new Promise<void>((r) => this.resolvers.set(text, r)))
      this.queue.push(text)
      this.renderTotal += 1
    }
    this.pump()
    await this.ready.get(texts[0])
    sig?.throwIfAborted()
  }

  private pump(): void {
    while (this.renderers < 4 && this.queue.length) {
      this.renderers += 1
      void this.drain().finally(() => {
        this.renderers -= 1
        if (this.renderers === 0 && this.queue.length === 0) {
          this.rendered = 0
          this.renderTotal = 0
          this.publish({ rendering: undefined })
          this.priceUp()
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
          const j = joinFragments(this.fragmentsFor(text))
          const folds = await this.opts.align(j, clip).catch((e) => {
            console.warn(`[reader] alignment failed, reveal stays coarse — ${e}`)
            return [] as Fold[]
          })
          this.aligned.set(text, { clip, folds })
        }
      } catch (e) {
        console.warn(`[reader] could not render — ${e}`)
      } finally {
        this.resolvers.get(text)?.()
        this.resolvers.delete(text)
        this.rendered += 1
        this.publish({ rendering: { done: this.rendered, total: this.renderTotal } })
      }
    }
  }

  priceUp(): void {
    const cached = this.speech.cached
    if (!cached) return
    const cost: Record<string, number> = {}
    for (const name of this.hub.state.packs) {
      let texts: string[]
      try {
        texts = this.textsOf(name)
      } catch {
        continue
      }
      cost[name] = texts.reduce((n, t) => n + (cached(this.opts.cacheDir, t) ? 0 : t.length), 0)
    }
    this.hub.state.packCost = cost
    this.hub.broadcast()
  }

  textsOf(name: string): string[] {
    const { questions } = loadPack(this.opts.packDir, name)
    return [...new Set([...questions.flatMap((q) => this.textsFor(q)), ...this.cueTexts(), ...this.poolTexts()])]
  }

  private cueTexts(): string[] {
    return this.opts.nextCue ? [this.opts.nextCue] : []
  }

  private poolTexts(): string[] {
    const q = this.opts.perform ? this.opts.quips : undefined
    return [q?.pools, q?.plain].flatMap((p) => Object.values(p ?? {})).flat().map((l) => l.text)
  }

  private async quip(v: Verdict, q?: Question): Promise<void> {
    if (!this.opts.perform) return
    let path: string | undefined
    if (v === 'correct' && q?.reaction) {
      path = this.clips.get(q.reaction)
    } else {
      const quips = this.opts.quips
      const line = this.picker.pick(v, quips?.pools[v] ?? [], quips?.plain?.[v])
      if (!line) return
      path = this.clips.get(line.text)
    }
    if (!path) return
    const pb = this.speech.play(path)
    this.quipback = pb
    await pb.done
    if (this.quipback === pb) this.quipback = undefined
  }

  announce(text: string): void {
    if (!this.opts.perform || !text) return
    const epoch = this.voiceEpoch
    void (async () => {
      if (!this.ready.has(text)) {
        this.ready.set(text, this.speech.render(this.opts.cacheDir, text, this.opts.voice).then(
          (clip) => { this.clips.set(text, clip.path) },
          (e) => { console.warn(`[reader] could not render announcement — ${e}`) },
        ))
      }
      await this.ready.get(text)
      const path = this.clips.get(text)
      if (!path || epoch !== this.voiceEpoch) return
      const pb = this.speech.play(path)
      this.quipback?.stop()
      this.quipback = pb
      await pb.done
      if (this.quipback === pb) this.quipback = undefined
    })().catch((e) => console.warn(`[reader] announcement failed — ${e}`))
  }

  private async cue(text: string | undefined): Promise<void> {
    if (!text) return
    await this.ready.get(text)
    const path = this.clips.get(text)
    if (!path || !this.running) return
    const pb = this.speech.play(path)
    this.quipback = pb
    await pb.done
    if (this.quipback === pb) this.quipback = undefined
  }

  private async waitFor(q: Question, sig?: AbortSignal): Promise<void> {
    await Promise.all(this.textsFor(q).map((t) => this.ready.get(t)))
    sig?.throwIfAborted()
  }

  private spoken(q: Question): string {
    return (this.opts.perform && q.script) || joinFragments(q.fragments).text
  }

  private fragmentsFor(spokenText: string): string[] {
    for (const questions of this.loaded.values()) {
      const q = questions.find((x) => this.spoken(x) === spokenText)
      if (q) return q.fragments
    }
    return [spokenText]
  }

  start(): void {
    if (this.running) return
    if (arrivalBlocksPlay(this.hub.state)) return
    for (const [name, questions] of this.loaded) {
      if ((this.pos.get(name) ?? 0) >= questions.length) this.pos.set(name, 0)
    }
    this.begin()
  }

  carryOn(): void {
    if (this.running) return
    if (arrivalBlocksPlay(this.hub.state)) return
    this.begin()
  }

  private begin(): void {
    this.voiceEpoch += 1
    this.quipback?.stop()
    this.running = true
    this.paused = false
    this.session = new AbortController()
    this.publish({})
    const session = this.session
    this.loop = this.run().finally(() => {
      if (this.session === session && this.running) this.stop()
    })
  }

  pause(): void {
    this.paused = true
    this.voiceEpoch += 1
    this.playback?.stop()
    this.quipback?.stop()
    this.publish({})
  }

  closeChoice(): void {
    this.closeNow = true
    this.wake()
  }

  resume(): void {
    this.paused = false
    this.publish({})
  }

  stop(): void {
    this.running = false
    this.voiceEpoch += 1
    this.session.abort()
    this.paused = false
    this.playback?.stop()
    this.quipback?.stop()
    this.playback = undefined
    this.opts.judge?.unprime()
    this.hub.send(this.conn, { t: 'act', act: 'reading', data: undefined })
    this.wake()
  }

  private wake(): void {
    for (const w of [...this.waiters]) w()
  }

  private watch(ok: () => boolean): AbortSignal {
    const c = new AbortController()
    const check = () => {
      if (ok()) return
      this.waiters.delete(check)
      c.abort()
    }
    this.waiters.add(check)
    c.signal.addEventListener('abort', () => this.waiters.delete(check), { once: true })
    return c.signal
  }

  private publish(patch: { rendering?: { done: number; total: number } | undefined }): void {
    const q = this.questions[this.qIndex]
    const reading = {
      pack: this.pack,
      qIndex: this.qIndex,
      qTotal: this.questions.length,
      fragIndex: this.fragIndex,
      fragTotal: q?.fragments.length ?? 0,
      paused: this.paused,
      rendering: 'rendering' in patch ? patch.rendering : this.hub.state.reading?.rendering,
    }
    this.hub.send(this.conn, { t: 'act', act: 'reading', data: { progress: reading, active: this.running } })
  }

  private nextPack(): string | undefined {
    const setlist = this.hub.state.setlist
    if (!setlist) return this.pack || undefined
    return setlist.blocks[setlist.at]?.pack
  }

  private async run(): Promise<void> {
    const session = this.session
    for (const b of this.hub.state.setlist?.blocks ?? []) {
      if (b.pack) void this.ensure(b.pack).catch((e) => console.warn(`[reader] ${b.pack}: ${e}`))
    }

    let spent = false
    while (this.running) {
      let mine = true
      try {
        const want = this.nextPack()
        if (!want) {
          spent = true
          break
        }
        if (want !== this.pack) {
          await this.ensure(want, session.signal)
          this.pack = want
        }
        const q = this.questions[this.qIndex]
        if (!q) {
          spent = true
          break
        }
        await this.waitFor(q, session.signal)
        this.fragIndex = 0
        if (q.value !== undefined) {
          this.hub.dispatch({ a: 'setValue', value: q.value })
        }
        await Promise.all([this.cue(this.opts.nextCue), this.opts.nextCardMs && sleep(this.opts.nextCardMs, session.signal)])
        session.signal.throwIfAborted()
        if (this.hub.dispatch({ a: 'arm', ...(q.kind && { kind: q.kind }) }).status !== 'applied') return
        if (q.kind !== 'choice' && q.kind !== 'closest') this.opts.judge?.prime(q.answers)
        await this.until((s) => s.round.phase === 'ARMED', undefined, session.signal)

        const stamp = this.hub.state.round.armedAt

        const questionId = this.hub.state.round.questionId
        const stillMine = () => this.hub.state.round.questionId === questionId

        const sig = AbortSignal.any([session.signal, this.watch(() => mine && stillMine())])

        await sleep(Math.max(0, stamp - Date.now()), sig)

        await this.speakQuestion(q, questionId, stillMine, sig)

        if (q.kind === 'choice' || q.kind === 'closest') {
          if (q.kind === 'choice') await this.runChoice(q, stillMine, sig)
          else await this.runClosest(q, stillMine, sig)
          const dwell = this.dwellMs()
          const reveal = q.kind === 'closest' ? closestTimes(this.hub.state.round.guessed ?? 0).doneAt : 0
          await this.until(() => !stillMine(), dwell === undefined ? undefined : dwell + reveal, session.signal)
          if (!stillMine() && this.hub.state.round.questionId) {
            throw new DOMException('Question replaced', 'AbortError')
          }
          if (stillMine()) this.hub.dispatch({ a: 'next' })
          this.qIndex += 1
          continue
        }

        const resolved = (s: State) =>
          s.round.phase === 'IDLE' &&
          (!!s.round.award || (s.round.order.length === 0 && s.round.lockedOut.length === 0))

        let deadAir = false
        while (this.running && !resolved(this.hub.state)) {
          if (this.hub.state.round.held) {
            await this.waitOutBuzz(session.signal)
            continue
          }
          const sharpAt = this.hub.state.round.reveal?.until
          const beat = this.dwellMs('buzzSec')
          const dwell = beat === undefined ? undefined : beat + Math.max(0, (sharpAt ?? 0) - Date.now())
          this.hub.send(this.conn, { t: 'act', act: 'closesAt', data: dwell === undefined ? undefined : Date.now() + dwell })
          await this.until(
            (s) => resolved(s) || !stillMine() || !!s.round.held || s.round.reveal?.until !== sharpAt,
            dwell,
            session.signal,
          )
          if (!stillMine()) {
            if (this.hub.state.round.questionId) throw new DOMException('Question replaced', 'AbortError')
            break
          }
          if (this.hub.state.round.held || this.hub.state.round.reveal?.until !== sharpAt) continue
          const r = this.hub.state.round
          if (!resolved(this.hub.state) && r.phase === 'ARMED' && r.order.length === 0) {
            deadAir = true
            break
          }
        }
        if (stillMine() && (this.hub.state.round.award || deadAir)) {
          this.hub.send(this.conn, { t: 'act', act: 'revealAnswer', data: q.answer })
        }
        if (stillMine() && deadAir) this.hub.dispatch({ a: 'timeUp' })
        const award = this.hub.state.round.award
        const said = stillMine()
          ? this.quip(award && !isPenalty(award) ? 'correct' : deadAir ? 'nobody' : 'wrong', q)
          : Promise.resolve()
        await this.until(
          (s) => !stillMine() || (!deadAir && s.round.phase === 'IDLE' && !s.round.award),
          this.dwellMs(),
          session.signal,
        )
        if (!stillMine() && this.hub.state.round.questionId) {
          throw new DOMException('Question replaced', 'AbortError')
        }
        await said
        session.signal.throwIfAborted()
        if (stillMine() && (this.hub.state.round.award || deadAir)) {
          this.hub.dispatch({ a: 'next' })
        }
        this.qIndex += 1
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) throw e
        return
      } finally {
        mine = false
        this.wake()
      }
    }
    if (!spent) return
    const auto = this.hub.state.autoplay
    if (auto.on) {
      this.hub.dispatch({ ...auto, a: 'setAutoplay', on: false })
    }
    this.stop()
  }

  private async speakQuestion(
    q: Question,
    questionId: string,
    stillMine: () => boolean,
    sig: AbortSignal,
  ): Promise<void> {
    const revealAll = !!q.kind
    const j = joinFragments(q.fragments)
    this.hub.send(this.conn, { t: 'act', act: 'whole', data: j.text })
    if (q.image) {
      this.hub.send(this.conn, { t: 'act', act: 'image', data: `/pack-media/${encodeURI(q.image)}` })
    }
    if (revealAll) {
      for (const f of q.fragments) this.hub.send(this.conn, { t: 'act', act: 'fragment', data: f })
      this.fragIndex = q.fragments.length
      this.publish({})
    }
    const whole = this.aligned.get(this.spoken(q))

    if (whole) {
      let shown = 0
      let frags = 0
      let completed = 0

      const revealTo = (upto: number) => {
        if (upto <= shown) return
        shown = upto
        for (let i = 0; !revealAll && i < q.fragments.length; i++) {
          const start = j.fragmentAt[i]
          if (upto <= start) break
          const text = q.fragments[i].slice(0, Math.min(q.fragments[i].length, upto - start)).trimEnd()
          if (!text) continue
          if (i >= frags) {
            this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
            frags = i + 1
            this.fragIndex = i + 1
            this.publish({})
          } else if (i === frags - 1) {
            this.hub.send(this.conn, { t: 'act', act: 'extend', data: text })
          }
        }
        const complete = q.fragments.filter((f, i) => upto >= j.fragmentAt[i] + f.length).length
        if (complete > completed) {
          completed = complete
          this.hub.fragmentEnded(questionId, completed)
        }
      }

      const live = () => !sig.aborted && stillMine()
      const finished = await this.speakWhole(whole, j, revealTo, live, sig)
      if (finished) revealTo(j.text.length)
    } else {
      for (let f = 0; f < q.fragments.length; f++) {
        const text = q.fragments[f]
        if (!revealAll) {
          this.fragIndex = f + 1
          this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
          this.publish({})
        }
        const finished = await this.speak(text, sig)
        if (!finished) break
        this.hub.fragmentEnded(questionId, f + 1)
      }
    }
  }

  private async runChoice(q: Question, stillMine: () => boolean, sig: AbortSignal): Promise<void> {
    const choices = q.choices!
    this.closeNow = false
    this.hub.send(this.conn, { t: 'act', act: 'choices', data: choices })
    let done = false
    let expired = false
    let timer: NodeJS.Timeout | undefined
    const options = this.speak(optionsText(choices), sig).then(
      () => {
        if (done || sig.aborted || !stillMine()) return
        const ms = this.hub.state.choiceSec * 1000
        this.hub.send(this.conn, { t: 'act', act: 'closesAt', data: Date.now() + ms })
        timer = setTimeout(() => {
          expired = true
          this.wake()
        }, ms)
        timer.unref?.()
      },
      () => {},
    )
    try {
      await this.until(
        (s) => this.closeNow || expired || allPicked(s),
        undefined,
        sig,
      )
    } finally {
      done = true
      clearTimeout(timer)
    }
    if (this.closeNow && stillMine()) this.hub.send(this.conn, { t: 'act', act: 'closesAt', data: Date.now() })
    this.playback?.stop()
    await options
    await sleep(LOCK_BEAT_MS, sig)
    if (stillMine()) this.hub.dispatch({ a: 'settleChoice', correct: q.correct! })
  }

  private async runClosest(q: Question, stillMine: () => boolean, sig: AbortSignal): Promise<void> {
    this.closeNow = false
    const ms = this.hub.state.choiceSec * 1000
    const data = { ...(q.unit && { unit: q.unit }), ...(q.plain && { plain: true }), closesAt: Date.now() + ms }
    this.hub.send(this.conn, { t: 'act', act: 'guessing', data })
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      this.wake()
    }, ms)
    timer.unref?.()
    try {
      await this.until((s) => this.closeNow || expired || allGuessed(s), undefined, sig)
    } finally {
      clearTimeout(timer)
    }
    if (this.closeNow && stillMine()) {
      this.hub.send(this.conn, { t: 'act', act: 'guessing', data: { ...data, closesAt: Date.now() } })
    }
    await sleep(LOCK_BEAT_MS, sig)
    if (stillMine()) this.hub.dispatch({ a: 'settleClosest', truth: q.truth! })
  }

  private async speakWhole(
    whole: { clip: Clip; folds: Fold[] },
    j: Joined,
    revealTo: (upto: number) => void,
    ok: () => boolean,
    sig: AbortSignal,
  ): Promise<boolean> {
    const { clip, folds } = whole
    const steps = [...folds].sort((a, b) => a.ms - b.ms)
    let atMs = 0

    while (this.running) {
      if (this.paused) {
        await this.until(() => !this.paused, undefined, sig)
        continue
      }
      if (this.buzzed()) {
        if (!(await this.waitOutBuzz(sig))) return false
        continue
      }

      const pb = this.speech.play(clip.path, atMs)
      this.opts.onClip?.(clip, Date.now())
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
      sig.throwIfAborted()
      if (!this.paused && !this.buzzed()) return true

      const stoppedAt = from + (Date.now() - t0)
      atMs = steps.reduce((best, s) => (s.ms <= stoppedAt && s.ms > best ? s.ms : best), 0)
    }
    sig.throwIfAborted()
    return true
  }

  private async speak(text: string, sig: AbortSignal): Promise<boolean> {
    const path = this.clips.get(text)
    if (!path) return true
    while (this.running) {
      if (this.paused) {
        await this.until(() => !this.paused, undefined, sig)
        continue
      }
      if (this.buzzed()) {
        if (!(await this.waitOutBuzz(sig))) return false
        continue
      }
      const pb = this.speech.play(path)
      this.opts.onClip?.({ path, durationMs: 0 }, Date.now())
      this.playback = pb
      await pb.done
      this.playback = undefined
      sig.throwIfAborted()
      if (!this.paused && !this.buzzed()) return true
    }
    sig.throwIfAborted()
    return true
  }

  private async waitOutBuzz(sig: AbortSignal): Promise<boolean> {
    const session = this.session
    await this.until(
      (s) => s.round.phase === 'ARMED' || s.round.phase === 'IDLE' || !!s.round.held,
      undefined,
      sig,
    )
    const auto = this.hub.state.autoplay
    if (this.hub.state.round.held) {
      const said = this.quip('wrong')
      await this.until((s) => !s.round.held, auto.reboundSec * 1000, sig)
      await said
      session.signal.throwIfAborted()
      if (this.hub.state.round.held) {
        this.hub.dispatch({ a: 'rebound' })
      }
      return !this.buzzed()
    }
    if (this.buzzed()) return false
    if (auto.on) await this.until(() => false, auto.reboundSec * 1000, sig)
    return !this.buzzed()
  }

  private buzzed(): boolean {
    return this.hub.state.round.phase !== 'ARMED'
  }

  private dwellMs(beat: 'nextSec' | 'buzzSec' = 'nextSec'): number | undefined {
    const auto = this.hub.state.autoplay
    return auto.on ? auto[beat] * 1000 : undefined
  }

  private async until(ok: (s: State) => boolean, dwellMs?: number, sig?: AbortSignal): Promise<void> {
    sig?.throwIfAborted()
    if (this.running && !ok(this.hub.state)) {
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | undefined
        const done = () => {
          this.waiters.delete(check)
          sig?.removeEventListener('abort', done)
          if (timer) clearTimeout(timer)
          resolve()
        }
        const check = () => {
          if (this.running && !ok(this.hub.state)) return
          done()
        }
        this.waiters.add(check)
        sig?.addEventListener('abort', done, { once: true })
        if (dwellMs !== undefined) {
          timer = setTimeout(done, dwellMs)
          timer.unref?.()
        }
      })
    }
    sig?.throwIfAborted()
  }
}

const sleep = (ms: number, sig?: AbortSignal): Promise<void> => {
  sig?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(sig?.reason)
    }
    const timer = setTimeout(() => {
      sig?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    sig?.addEventListener('abort', onAbort, { once: true })
  })
}
