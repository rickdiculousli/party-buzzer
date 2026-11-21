import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz, type Resolved } from './resolve.ts'
import { applyHostAction } from './state.ts'
import { buzzBlockReason, guessBlockReason, pickBlockReason, reactBlockReason } from './eligibility.ts'
import { bump, lockedPlayerIds, scoreKey } from '../shared/scoring.ts'
import { catalog, moduleFor } from './modes/index.ts'
import { useItem } from './items.ts'
import { duelAct, duelCatalog } from './duel.ts'
import { listPacks, packSizes } from './packs.ts'
import { listSetlists, readSetlist, writeSetlist } from './setlists.ts'
import { clueBlockReason, refuses } from '../shared/legality.ts'
import { arrivalBlocksPlay, arrivalPresentation, endLobby, introductionLine, practiceAllowed } from '../shared/arrival.ts'
import { READY_FALLBACK_MS, beginFor, everyoneReady } from './night.ts'
import { COLLECT_MS, QUIZ_REACT_LABEL, REACT_COOLDOWN_MS, type QuizReactKind } from '../shared/protocol.ts'
import { makeTracer, type Tracer } from './trace.ts'
import { gameSnapshot, restoreGame, type GameSnapshot } from './snapshot.ts'
import { nightFacts } from './ledger.ts'
import type { MinigameRuntime } from './minigames/runtime.ts'
import type {
  ClientMsg, PlayerId, Role, ServerMsg, State, ReadingUpdate, HostAction, ActionResult,
} from '../shared/protocol.ts'

export type Conn = {
  id: string
  role: Role
  playerId?: PlayerId
  send: (msg: ServerMsg) => void
}

const UNDO_DEPTH = 20

const RESETS = new Set(['arm', 'wrong', 'correct', 'next', 'resetRound', 'undo', 'prepareMinigame', 'startMinigame', 'cancelMinigame', 'closeMinigame'])

const REVEAL_MS = 150

export type ReaderControls = {
  select(name: string): Promise<void>
  start(): void
  carryOn(): void
  pause(): void
  resume(): void
  stop(): void
  rewind(): void
  closeChoice(): void
  announce(text: string): void
}

export type HubOpts = {
  revealMs?: number
  collectMs?: number
  onChange?: (state: State) => void
  packDir?: string
  setlistDir?: string
  reader?: ReaderControls
  tracePath?: string
  tracer?: Tracer
}

export class Hub {
  readonly state: State
  private conns = new Set<Conn>()
  private pending: RawBuzz[] = []
  private history: GameSnapshot[] = []
  private timer: NodeJS.Timeout | undefined
  private revealTimer: NodeJS.Timeout | undefined
  private revealed = false
  private revealMs: number
  private collectMs: number
  private onChange: (state: State) => void
  private reader: ReaderControls | undefined
  private setlistDir: string | undefined
  private trace: Tracer
  private restoring = false
  private minigame: MinigameRuntime | undefined
  private practiceSeq = 0
  private reactSeq = 0
  private reactedAt = new Map<PlayerId, number>()
  private night = new Map<'intro' | 'ready' | 'results', { key: string; handle: NodeJS.Timeout; fired: boolean }>()
  private nightMatch: string | undefined
  private nightBusy = false
  private nightDirty = false

  constructor(state: State, opts: HubOpts = {}) {
    this.state = state
    this.state.games = catalog()
    this.state.duelRules = duelCatalog()
    this.state.packs = opts.packDir ? listPacks(opts.packDir) : []
    this.state.packSizes = opts.packDir ? packSizes(opts.packDir, this.state.packs) : {}
    this.setlistDir = opts.setlistDir
    this.state.setlists = opts.setlistDir ? listSetlists(opts.setlistDir) : []
    this.revealMs = opts.revealMs ?? REVEAL_MS
    this.collectMs = opts.collectMs ?? COLLECT_MS
    this.onChange = opts.onChange ?? (() => {})
    this.reader = opts.reader
    this.trace = opts.tracer ?? (opts.tracePath ? makeTracer(opts.tracePath) : () => {})
  }

  add(conn: Conn): void {
    this.conns.add(conn)
  }

  remove(conn: Conn): void {
    this.conns.delete(conn)
    const player = this.state.players.find((p) => p.id === conn.playerId)
    if (player && ![...this.conns].some((c) => c.playerId === player.id)) player.connected = false
    this.changed('leave')
  }

  setOnChange(fn: (state: State) => void): void {
    this.onChange = fn
  }

  setReader(reader: ReaderControls): void {
    this.reader = reader
  }

  setMinigameRuntime(runtime: MinigameRuntime): void {
    this.minigame = runtime
  }

  send(conn: Conn, msg: ClientMsg): void {
    this.handle(conn, msg)
  }

  handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        conn.role = msg.role
        if (msg.role === 'player') this.join(conn, msg.playerId, msg.name)
        else conn.send({ t: 'state', state: this.viewFor(conn) })
        if (this.minigame) {
          const frame = this.minigame.frameFor(conn.role, conn.playerId)
          if (frame) conn.send({ t: 'minigameFrame', frame })
        }
        return

      case 'ping':
        conn.send({ t: 'pong', t0: msg.t0, serverTime: Date.now() })
        return

      case 'buzz':
        this.buzz(conn, msg.at)
        return

      case 'host':
        if (conn.role !== 'host') return
        conn.send({ t: 'actionResult', action: msg.action.a, result: this.dispatch(msg.action) })
        return

      case 'act':
        this.act(conn, msg.act, msg.data)
        return

      case 'practiceBuzz':
        this.practice(conn, msg.lobbyId)
        return

      case 'react':
        this.react(conn, msg.kind)
        return

      case 'minigameInput':
        if (conn.role === 'player' && conn.playerId) this.minigame?.input(conn.playerId, msg)
        return

      case 'minigameLobby':
        if (conn.role === 'player' && conn.playerId && this.minigame?.lobby(conn.playerId, msg.change)) {
          this.changed('minigame:lobby')
        }
        return

      case 'minigameTouch': {
        if (conn.role !== 'player' || !conn.playerId || !this.minigame) return
        const audience = this.minigame.touch(conn.playerId, msg)
        if (!audience) return
        const name = this.state.players.find((player) => player.id === conn.playerId)?.name ?? '?'
        const out: ServerMsg = { t: 'minigameTouch', touch: { playerId: conn.playerId, name, target: msg.target, x: msg.x, y: msg.y } }
        for (const other of this.conns) {
          const wanted = other.role === 'board'
            ? audience.board
            : other.role === 'player' && !!other.playerId && audience.players.includes(other.playerId)
          if (wanted) other.send(out)
        }
        return
      }
    }
  }

  dispatch(action: HostAction): ActionResult {
    if (action.a === 'openLobby' || (action.a === 'closeArrival' && this.state.arrival?.kind === 'lobby')) {
      return this.lobby(action)
    }
    let result: ActionResult
    let before: GameSnapshot | undefined
    let dismissedIntro = false
    let raisedIntro = false
    if (action.a === 'undo') {
      result = { status: this.undo() ? 'applied' : 'unchanged' }
    } else if (
      action.a === 'prepareMinigame' || action.a === 'startMinigame' ||
      action.a === 'cancelMinigame' || action.a === 'closeMinigame'
    ) {
      before = gameSnapshot(this.state)
      const reason = refuses(this.state, action)
      result = reason ? { status: 'refused', reason } : this.minigame?.host(action) ?? { status: 'unchanged' }
      if (result.status === 'applied') {
        const setlist = this.state.setlist
        if (action.a === 'closeMinigame' && setlist && setlist.blocks[setlist.at]?.game === before.minigame?.id) {
          applyHostAction(this.state, { a: 'setlistJump', at: setlist.at + 1 })
        }
        if (action.a === 'prepareMinigame') {
          endLobby(this.state)
          this.stopReaderQuietly()
        }
        if (this.introRaised(before)) {
          raisedIntro = true
          this.stopReaderQuietly()
        }
        if (action.a === 'startMinigame' && this.nightMatch !== undefined && before.minigame?.matchId === this.nightMatch) {
          this.nightMatch = this.state.minigame?.matchId
        }
        if (action.a === 'closeMinigame') this.nightMatch = undefined
        this.history.push(before)
        if (this.history.length > UNDO_DEPTH) this.history.shift()
      }
    } else {
      before = gameSnapshot(this.state)
      result = applyHostAction(this.state, action)
      if (result.status === 'applied') {
        this.history.push(before)
        if (this.history.length > UNDO_DEPTH) this.history.shift()
        if (this.introRaised(before)) {
          raisedIntro = true
          this.stopReaderQuietly()
        }
        dismissedIntro = action.a === 'closeArrival' && before.arrival?.kind === 'introduction'
      }
    }
    if (result.status === 'applied') {
      if (before && action.a !== 'undo') this.state.night?.facts.push(...nightFacts(before, this.state, { action }, Date.now()))
      if (action.a === 'undo' || action.a === 'clearSetlist' || action.a === 'setlistJump') this.nightClear(true)
      if (RESETS.has(action.a)) this.clearWindow()
      this.changed(`host:${action.a}`)
      if (action.a === 'startMinigame') this.broadcastMinigame()
      const shown = this.state.autoplay.on && raisedIntro ? arrivalPresentation(this.state) : null
      if (shown?.kind === 'introduction') this.reader?.announce(introductionLine(shown))
      if (dismissedIntro) this.nightBegin()
    }
    return result
  }

  private introRaised(before: GameSnapshot): boolean {
    const intro = this.state.arrival
    return intro?.kind === 'introduction' && intro.id !== before.arrival?.id
  }

  fragmentEnded(questionId: string, completed: number): void {
    const round = this.state.round
    if (!questionId || round.questionId !== questionId || round.phase !== 'ARMED') return
    if (moduleFor(this.state.game.id).onFragmentEnd?.(this.state, completed, Date.now())) {
      this.changed('fragment:end')
    }
  }

  private unknownActs = new Set<string>()

  private act(conn: Conn, name: string, data: unknown): void {
    if (name === 'useItem') {
      if (!conn.playerId) return
      if (useItem(this.state, conn.playerId, data)) {
        const used = (data ?? {}) as Record<string, unknown>
        this.state.night?.facts.push(...nightFacts(this.state, this.state, {
          item: {
            itemId: String(used.itemId),
            playerId: conn.playerId,
            targetId: typeof used.targetId === 'string' ? used.targetId : undefined,
          },
        }, Date.now()))
        if (this.revealed) this.publish()
        this.changed('item')
      }
      return
    }
    if (name.startsWith('duel')) {
      if (!conn.playerId || arrivalBlocksPlay(this.state)) return
      if (duelAct(this.state, conn.playerId, name, data)) this.changed('duel')
      return
    }
    if (name === 'pick') {
      const round = this.state.round
      if (!conn.playerId || typeof data !== 'number' || !Number.isInteger(data)) return
      if (data < 0 || data >= (round.choices?.length ?? 0)) return
      if (pickBlockReason(this.state, conn.playerId)) return
      round.picks = { ...round.picks, [conn.playerId]: data }
      this.changed('pick')
      return
    }
    if (name === 'guess') {
      if (!conn.playerId || guessBlockReason(this.state, conn.playerId, data)) return
      this.state.round.guesses = { ...this.state.round.guesses, [conn.playerId]: data as number }
      this.changed('guess')
      return
    }
    if (conn.role !== 'host') return
    const round = this.state.round
    if (name === 'fragment' && typeof data === 'string') {
      round.fragments = [...(round.fragments ?? []), data]
    } else if (name === 'extend' && typeof data === 'string') {
      const f = round.fragments
      if (f?.length && data.length > f[f.length - 1].length) {
        round.fragments = [...f.slice(0, -1), data]
      }
    } else if (name === 'whole' && typeof data === 'string') {
      round.whole = data
    } else if (name === 'image' && typeof data === 'string') {
      round.image = data
    } else if (name === 'choices' && Array.isArray(data)) {
      round.choices = data.filter((c): c is string => typeof c === 'string')
    } else if (name === 'guessing') {
      const d = data as State['round']['guessing']
      if (round.kind === 'closest' && d && typeof d.closesAt === 'number') round.guessing = d
    } else if (name === 'closesAt') {
      if (typeof data === 'number') round.closesAt = data
      else delete round.closesAt
    } else if (name === 'closeChoice') {
      this.reader?.closeChoice()
    } else if (name === 'revealAnswer' && typeof data === 'string') {
      round.answer = data
    } else if (name === 'judgeWindow') {
      const d = data as { until?: number } | undefined
      if (d) round.judge = typeof d.until === 'number' ? { until: d.until } : {}
      else delete round.judge
    } else if (name === 'spoken') {
      round.spoken = (data ?? undefined) as State['round']['spoken']
    } else if (name === 'reading') {
      const update = data as ReadingUpdate | undefined
      this.state.reading = update?.progress
      this.state.readingActive = update?.active ?? false
      if (this.state.readingActive) {
        endLobby(this.state)
        delete this.state.typed
      }
    } else if (name === 'selectPack' && typeof data === 'string') {
      if (this.state.round.phase !== 'IDLE') return
      this.reader?.select(data).catch((e) => console.warn(`[hub] selectPack failed: ${e}`))
    } else if (name === 'typeClue' && typeof data === 'string') {
      const text = data.trim()
      if (clueBlockReason(this.state) || text === (this.state.typed ?? '')) return
      if (text) this.state.typed = text
      else delete this.state.typed
    } else if (name === 'read') {
      if (arrivalBlocksPlay(this.state)) return
      this.reader?.start()
    } else if (name === 'pauseRead') {
      this.reader?.pause()
    } else if (name === 'resumeRead') {
      this.reader?.resume()
    } else if (name === 'stopRead') {
      this.reader?.stop()
    } else if (name === 'rewindRead') {
      this.reader?.rewind()
    } else if (name === 'saveSetlist' && typeof data === 'string') {
      if (!this.setlistDir || !this.state.setlist) return
      try {
        writeSetlist(this.setlistDir, data, this.state.setlist.blocks)
      } catch (e) {
        console.warn(`[hub] saveSetlist failed: ${e}`)
        return
      }
      this.state.setlists = listSetlists(this.setlistDir)
    } else if (name === 'loadSetlist' && typeof data === 'string') {
      conn.send({ t: 'actionResult', action: 'loadSetlist', result: this.loadSetlist(data) })
      return
    } else {
      const handled = moduleFor(this.state.game.id).onAct?.(this.state, name, data) ?? false
      if (!handled) {
        if (!this.unknownActs.has(name)) {
          this.unknownActs.add(name)
          console.warn(`[hub] unknown act "${name}" — dropped`)
        }
        return
      }
    }
    this.changed(`act:${name}`)
  }

  private lobby(action: HostAction): ActionResult {
    const reason = refuses(this.state, action)
    if (reason) return { status: 'refused', reason }
    if (action.a === 'openLobby') {
      if (this.state.arrival?.kind === 'lobby') return { status: 'unchanged' }
      this.state.arrival = { kind: 'lobby', id: randomUUID(), testedPlayerIds: [] }
      this.practiceSeq = 0
    } else {
      delete this.state.arrival
    }
    this.trace(`host:${action.a}`, this.state)
    this.broadcast()
    return { status: 'applied' }
  }

  private practice(conn: Conn, lobbyId: unknown): void {
    const playerId = conn.playerId
    const lobby = this.state.arrival
    if (conn.role !== 'player' || !playerId || !this.conns.has(conn) || typeof lobbyId !== 'string') return
    if (lobby?.kind !== 'lobby' || !practiceAllowed(this.state, playerId, lobbyId)) return
    if (!lobby.testedPlayerIds.includes(playerId)) {
      lobby.testedPlayerIds = [...lobby.testedPlayerIds, playerId]
      this.broadcast()
    }
    const out: ServerMsg = { t: 'practiceBuzz', receipt: { lobbyId, seq: ++this.practiceSeq, playerId } }
    for (const other of this.conns) other.send(out)
  }

  private react(conn: Conn, kind: unknown): void {
    const playerId = conn.playerId
    if (conn.role !== 'player' || !playerId || !this.conns.has(conn)) return
    if (typeof kind !== 'string' || !(kind in QUIZ_REACT_LABEL)) return
    if (reactBlockReason(this.state, playerId)) return
    const now = Date.now()
    const last = this.reactedAt.get(playerId)
    if (last !== undefined && now - last < REACT_COOLDOWN_MS) return
    this.reactedAt.set(playerId, now)
    const receipt = { questionId: this.state.round.questionId, seq: ++this.reactSeq, playerId, kind: kind as QuizReactKind }
    const out: ServerMsg = { t: 'reaction', receipt }
    for (const other of this.conns) if (other.role === 'board') other.send(out)
  }

  private loadSetlist(name: string): ActionResult {
    const reason = refuses(this.state, { a: 'setSetlist', blocks: [] })
    if (reason) return { status: 'refused', reason }
    if (!this.setlistDir) return { status: 'failed', message: 'Saved setlists are unavailable.' }
    try {
      const blocks = readSetlist(this.setlistDir, name)
      if (!blocks.length) return { status: 'failed', message: 'This setlist has no playable blocks.' }
      return this.dispatch({ a: 'setSetlist', blocks })
    } catch (e) {
      console.warn(`[hub] loadSetlist failed: ${e}`)
      return { status: 'failed', message: 'The setlist could not be loaded.' }
    }
  }

  private join(conn: Conn, playerId: PlayerId | undefined, name?: string): void {
    const id = playerId ?? conn.playerId
    let player = id ? this.state.players.find((p) => p.id === id) : undefined

    if (!player) {
      player = {
        id: playerId ?? randomUUID(),
        name: name?.trim() || 'Player',
        connected: true,
      }
      this.state.players.push(player)
      this.state.scores[player.id] ??= 0
    } else {
      player.connected = true
      if (name?.trim()) player.name = name.trim()
    }

    conn.playerId = player.id
    conn.send({ t: 'welcome', playerId: player.id, serverTime: Date.now() })
    this.changed('join')
  }

  private buzz(conn: Conn, at: number): void {
    const round = this.state.round
    if (!conn.playerId) return
    if (round.phase !== 'ARMED' && round.phase !== 'COLLECTING') return

    const arrivedAt = Date.now()
    if (arrivedAt < round.armedAt) return

    if (round.buzzable && !round.buzzable.includes(conn.playerId)) return

    if (lockedPlayerIds(this.state).includes(conn.playerId)) return

    if (buzzBlockReason(this.state, conn.playerId)) return

    this.pending.push({ playerId: conn.playerId, at, arrivedAt })

    if (round.phase === 'ARMED') {
      round.phase = 'COLLECTING'
      delete round.spoken
      this.revealTimer = setTimeout(() => this.reveal(), this.revealMs)
      this.revealTimer.unref?.()
      this.timer = setTimeout(() => this.settle(), this.collectMs)
      this.timer.unref?.()
    }
    if (this.revealed) this.publish()
    this.changed('buzz')
  }

  private entry(b: Resolved) {
    return {
      playerId: b.playerId,
      name: this.state.players.find((p) => p.id === b.playerId)?.name ?? '?',
      at: b.at,
      deltaMs: b.deltaMs,
    }
  }

  private publish(): void {
    const round = this.state.round
    const excluded = lockedPlayerIds(this.state)
    const frozen = new Set(
      this.state.effects
        .filter((e) => e.kind === 'frozen' && e.attemptId === round.attemptId)
        .map((e) => e.playerId),
    )
    round.order = resolveBuzzes(this.pending, round.armedAt, [...excluded, ...frozen]).map(
      (b) => this.entry(b),
    )
    const steal = this.state.effects.find(
      (e) => e.kind === 'steal' && e.attemptId === round.attemptId,
    )
    if (steal && !frozen.has(steal.playerId) && !excluded.includes(steal.playerId)) {
      const name =
        this.state.players.find((p) => p.id === steal.playerId)?.name ?? '?'
      const at = round.reveal
        ? (round.order.find((b) => b.playerId === steal.playerId) ?? round.order[0])?.at ?? round.armedAt
        : round.armedAt
      round.order = [
        { playerId: steal.playerId, name, at, deltaMs: 0 },
        ...round.order.filter((b) => b.playerId !== steal.playerId),
      ].map((b) => ({ ...b, deltaMs: Math.max(0, Math.round(b.at - at)) }))
    }
    round.total = round.order.length
  }

  private reveal(): void {
    this.revealTimer = undefined
    this.revealed = true
    this.publish()
    this.changed('reveal')
  }

  private settle(): void {
    clearTimeout(this.revealTimer)
    this.revealTimer = undefined
    this.timer = undefined
    this.state.round.phase = 'LOCKED'
    this.revealed = true
    this.publish()
    this.pending = []
    this.changed('settle')
  }

  private undo(): boolean {
    const prev = this.history.pop()
    if (!prev) return false
    this.restoring = true
    try {
      this.reader?.stop()
      this.minigame?.stop()
      restoreGame(this.state, prev)
    } finally {
      this.restoring = false
    }
    return true
  }

  private stopReaderQuietly(): void {
    this.restoring = true
    try {
      this.reader?.stop()
    } finally {
      this.restoring = false
    }
  }

  private clearWindow(): void {
    clearTimeout(this.timer)
    clearTimeout(this.revealTimer)
    this.timer = undefined
    this.revealTimer = undefined
    this.revealed = false
    this.pending = []
  }

  viewFor(conn: Conn): State {
    const mod = moduleFor(this.state.game.id)
    let game = {
      ...this.state.game,
      status: conn.role === 'host' ? mod.hostStatus?.(this.state) : undefined,
    }
    if (mod.viewModuleState) {
      const viewer = conn.role === 'player' ? (conn.playerId ?? '') : conn.role
      game = { ...game, moduleState: mod.viewModuleState(this.state, viewer) }
    } else if (conn.role === 'player') {
      game = { ...game, moduleState: undefined }
    }
    const session = this.state.minigame
    const minigame = session?.checkpoint
      ? { ...session, checkpoint: { version: session.checkpoint.version, label: session.checkpoint.label } }
      : session
    if (conn.role !== 'player') return { ...this.state, game, minigame }
    const round = this.state.round
    const mirror = this.state.mirrorFragments || !!round.kind
    const own = <T>(all: Record<string, T> | undefined) => {
      const v = conn.playerId !== undefined ? all?.[conn.playerId] : undefined
      return v === undefined ? undefined : { [conn.playerId!]: v }
    }
    return {
      ...this.state,
      game,
      round: {
        ...round,
        order: round.order
          .filter((b) => b.playerId === conn.playerId)
          .map((b) => ({ ...b, leader: round.order[0]?.playerId === b.playerId })),
        fragments: mirror ? round.fragments : undefined,
        whole: undefined,
        image: round.kind === 'reveal'
          ? (this.state.mirrorFragments && round.phase === 'IDLE' ? round.image : undefined)
          : mirror ? round.image : undefined,
        answer: this.state.mirrorFragments ? round.answer : undefined,
        picks: own(round.picks),
        guesses: own(round.guesses),
      },
      reading: undefined,
      typed: this.state.mirrorFragments ? this.state.typed : undefined,
      night: undefined,
      minigame,
    }
  }

  broadcast(): void {
    for (const conn of this.conns) {
      conn.send({ t: 'state', state: this.viewFor(conn) })
    }
  }

  minigameChanged(cause: string): void {
    this.changed(cause)
  }

  broadcastMinigame(): void {
    if (!this.minigame) return
    for (const conn of this.conns) {
      const frame = this.minigame.frameFor(conn.role, conn.playerId)
      if (frame) conn.send({ t: 'minigameFrame', frame })
    }
  }

  acknowledgeMinigame(playerId: PlayerId, ack: import('../shared/protocol.ts').MinigameInputAck): void {
    for (const conn of this.conns) {
      if (conn.role === 'player' && conn.playerId === playerId) conn.send({ t: 'minigameAck', ack })
    }
  }

  completeMinigame(matchId: string, results: import('../shared/protocol.ts').MinigameResult[]): void {
    if (!this.minigame || this.state.minigame?.matchId !== matchId) return
    const before = gameSnapshot(this.state)
    if (!this.minigame.finish(matchId, results)) return
    for (const result of results) bump(this.state, scoreKey(this.state, result.playerId), result.points)
    const id = this.state.minigame?.id
    if (id) this.state.night?.facts.push(...nightFacts(before, this.state, { results, matchId, id }, Date.now()))
    this.history.push(before)
    if (this.history.length > UNDO_DEPTH) this.history.shift()
    this.changed('minigame:results')
  }

  private changed(cause = 'change'): void {
    if (this.restoring) return
    this.trace(cause, this.state)
    this.broadcast()
    this.onChange(this.state)
    this.nightEval()
  }

  private nightEval(): void {
    if (this.nightBusy) {
      this.nightDirty = true
      return
    }
    this.nightBusy = true
    try {
      for (let pass = 0; pass < 8; pass++) {
        this.nightDirty = false
        this.nightStep()
        if (!this.nightDirty) break
      }
    } finally {
      this.nightBusy = false
    }
  }

  private nightStep(): void {
    const s = this.state
    if (!s.autoplay.on) {
      this.nightClear(false)
      return
    }
    const intro = s.arrival?.kind === 'introduction' && s.arrival.blockAt > 0 ? s.arrival.id : undefined
    this.nightTimer('intro', intro, s.autoplay.introSec * 1000, (key) => {
      this.dispatch({ a: 'closeArrival', arrivalId: key })
    })

    const mg = s.minigame
    const mine = mg !== undefined && mg.matchId === this.nightMatch
    const waiting = mine && mg.phase === 'ready' ? mg.matchId : undefined
    this.nightTimer('ready', waiting, READY_FALLBACK_MS, () => this.nightStart())
    if (waiting && (everyoneReady(s) || this.night.get('ready')?.fired)) this.nightStart()

    const done = mine && mg.phase === 'results' ? mg.matchId : undefined
    this.nightTimer('results', done, s.autoplay.nextSec * 1000, (key) => {
      if (this.state.minigame?.matchId === key) this.dispatch({ a: 'closeMinigame' })
    })
  }

  private nightStart(): void {
    const mg = this.state.minigame
    if (mg && mg.matchId === this.nightMatch && mg.phase === 'ready') this.dispatch({ a: 'startMinigame' })
  }

  private nightTimer(slot: 'intro' | 'ready' | 'results', key: string | undefined, ms: number, fire: (key: string) => void): void {
    const held = this.night.get(slot)
    if (held && held.key === key) return
    if (held) clearTimeout(held.handle)
    this.night.delete(slot)
    if (key === undefined) return
    const handle = setTimeout(() => {
      const entry = this.night.get(slot)
      if (!entry || entry.key !== key) return
      entry.fired = true
      fire(key)
    }, ms)
    handle.unref?.()
    this.night.set(slot, { key, handle, fired: false })
  }

  private nightClear(forgetMatch: boolean): void {
    for (const entry of this.night.values()) clearTimeout(entry.handle)
    this.night.clear()
    if (forgetMatch) this.nightMatch = undefined
  }

  private nightBegin(): void {
    const begin = beginFor(this.state)
    if (begin?.do === 'read') {
      this.reader?.carryOn()
    } else if (begin?.do === 'prepare') {
      const result = this.dispatch({ a: 'prepareMinigame', id: begin.id, options: begin.options })
      if (result.status === 'applied') {
        this.history.pop()
        this.nightMatch = this.state.minigame?.matchId
        this.nightEval()
      }
    }
  }
}
