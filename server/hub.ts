import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz, type Resolved } from './resolve.ts'
import { applyHostAction } from './state.ts'
import { buzzBlockReason } from './eligibility.ts'
import { bump, lockedPlayerIds, scoreKey } from '../shared/scoring.ts'
import { catalog, moduleFor } from './modes/index.ts'
import { useItem } from './items.ts'
import { duelAct, duelCatalog } from './duel.ts'
import { listPacks, packSizes } from './packs.ts'
import { listSetlists, readSetlist, writeSetlist } from './setlists.ts'
import { refuses } from '../shared/legality.ts'
import { COLLECT_MS } from '../shared/protocol.ts'
import { makeTracer, type Tracer } from './trace.ts'
import { gameSnapshot, restoreGame, type GameSnapshot } from './snapshot.ts'
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

/**
 * How many host actions can be taken back. Awarding points to the wrong player
 * is the mistake a host actually makes, and it is unrecoverable without this.
 * A snapshot is a few KB, so depth is free.
 */
const UNDO_DEPTH = 20

/** Host actions that end or restart the question, and so close collection. */
const RESETS = new Set(['arm', 'wrong', 'correct', 'next', 'resetRound', 'undo', 'prepareMinigame', 'startMinigame', 'cancelMinigame', 'closeMinigame'])

/**
 * How long after the first buzz the room sees a provisional leader. This is
 * responsiveness, not a cut-off: collection keeps running for the full window
 * afterwards, and a late packet carrying an earlier clamped stamp still takes
 * the lead.
 */
const REVEAL_MS = 150

export type ReaderControls = {
  select(name: string): Promise<void>
  start(): void
  pause(): void
  resume(): void
  stop(): void
  rewind(): void
}

export type HubOpts = {
  /** Delay from the first buzz to publishing a provisional order. */
  revealMs?: number
  /** How long buzzes are collected after the first one lands. */
  collectMs?: number
  onChange?: (state: State) => void
  /** Question packs live here. Filenames only enter State; omit for no packs. */
  packDir?: string
  /** Saved setlists live here. Filenames only enter State; omit for no setlists. */
  setlistDir?: string
  reader?: ReaderControls
  /** Presence turns the trace tap on; the composition root maps TRACE=1 to it. */
  tracePath?: string
  /** In-memory tap, preferred over tracePath. Tests drive this; TRACE=1 uses the file. */
  tracer?: Tracer
}

export class Hub {
  readonly state: State
  private conns = new Set<Conn>()
  private pending: RawBuzz[] = []
  private history: GameSnapshot[] = []
  private timer: NodeJS.Timeout | undefined
  private revealTimer: NodeJS.Timeout | undefined
  /** Whether the room has been shown an order yet this round. */
  private revealed = false
  private revealMs: number
  private collectMs: number
  private onChange: (state: State) => void
  private reader: ReaderControls | undefined
  private setlistDir: string | undefined
  private trace: Tracer
  private restoring = false
  private minigame: MinigameRuntime | undefined

  constructor(state: State, opts: HubOpts = {}) {
    this.state = state
    // The catalog rides the state payload so the host form needs no fetch of
    // its own. Refresh on boot: a snapshot's copy may come from an older build.
    this.state.games = catalog()
    // Same reasoning as the games catalog: a snapshot's copy may be stale.
    this.state.duelRules = duelCatalog()
    // Filenames only, refreshed on boot for the same reason the catalog is: a
    // snapshot's copy is from whenever it was written.
    this.state.packs = opts.packDir ? listPacks(opts.packDir) : []
    this.state.packSizes = opts.packDir ? packSizes(opts.packDir, this.state.packs) : {}
    // Same reasoning as packs: filenames only, refreshed on boot.
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
    if (player) player.connected = false
    this.changed('leave')
  }

  /** Replace the change subscriber. The reader is built after the hub, so the
   *  composition root swaps in a fan-out once both exist. */
  setOnChange(fn: (state: State) => void): void {
    this.onChange = fn
  }

  /** The reader is built after the hub, so it wires itself in via this setter. */
  setReader(reader: ReaderControls): void {
    this.reader = reader
  }

  setMinigameRuntime(runtime: MinigameRuntime): void {
    this.minigame = runtime
  }

  /** Internal reader/judge publications use the same handler as wire messages. */
  send(conn: Conn, msg: ClientMsg): void {
    this.handle(conn, msg)
  }

  handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        conn.role = msg.role
        if (msg.role === 'player') this.join(conn, msg.playerId, msg.name)
        else conn.send({ t: 'state', state: this.viewFor(conn) })
        return

      case 'ping':
        conn.send({ t: 'pong', t0: msg.t0, serverTime: Date.now() })
        return

      case 'buzz':
        this.buzz(conn, msg.at)
        return

      case 'host':
        // Only the host panel may mutate the game.
        if (conn.role !== 'host') return
        conn.send({ t: 'actionResult', action: msg.action.a, result: this.dispatch(msg.action) })
        return

      case 'act':
        this.act(conn, msg.act, msg.data)
        return

      case 'minigameInput':
        if (conn.role === 'player' && conn.playerId) this.minigame?.input(conn.playerId, msg)
        return
    }
  }

  /** The single commit path for the host, reader, judge and setlist loader. */
  dispatch(action: HostAction): ActionResult {
    let result: ActionResult
    if (action.a === 'undo') {
      result = { status: this.undo() ? 'applied' : 'unchanged' }
    } else if (
      action.a === 'prepareMinigame' || action.a === 'startMinigame' ||
      action.a === 'cancelMinigame' || action.a === 'closeMinigame'
    ) {
      const before = gameSnapshot(this.state)
      const reason = refuses(this.state, action)
      result = reason ? { status: 'refused', reason } : this.minigame?.host(action) ?? { status: 'unchanged' }
      if (result.status === 'applied') {
        if (action.a === 'prepareMinigame') {
          this.restoring = true
          try {
            this.reader?.stop()
          } finally {
            this.restoring = false
          }
        }
        this.history.push(before)
        if (this.history.length > UNDO_DEPTH) this.history.shift()
      }
    } else {
      const before = gameSnapshot(this.state)
      result = applyHostAction(this.state, action)
      if (result.status === 'applied') {
        this.history.push(before)
        if (this.history.length > UNDO_DEPTH) this.history.shift()
      }
    }
    if (result.status === 'applied') {
      if (RESETS.has(action.a)) this.clearWindow()
      this.changed(`host:${action.a}`)
      if (action.a === 'startMinigame') this.broadcastMinigame()
    }
    return result
  }

  /** Playback reports facts; the current mode decides what they mean. */
  fragmentEnded(questionId: string, completed: number): void {
    const round = this.state.round
    if (!questionId || round.questionId !== questionId || round.phase !== 'ARMED') return
    if (moduleFor(this.state.game.id).onFragmentEnd?.(this.state, completed, Date.now())) {
      this.changed('fragment:end')
    }
  }

  /** Unknown acts, so each is logged once rather than per packet. */
  private unknownActs = new Set<string>()

  /**
   * Module and item actions. Items belong to players; everything else is
   * host-scoped — the reader tool connects as host, and a phone must not be
   * able to reveal a fragment early or close the power window for itself.
   */
  private act(conn: Conn, name: string, data: unknown): void {
    if (name === 'useItem') {
      if (!conn.playerId) return
      if (useItem(this.state, conn.playerId, data)) {
        if (this.revealed) this.publish()
        this.changed('item')
      }
      return
    }
    // Duel entry belongs to players, like items.
    if (name.startsWith('duel')) {
      if (!conn.playerId) return
      if (duelAct(this.state, conn.playerId, name, data)) this.changed('duel')
      return
    }
    if (conn.role !== 'host') return
    const round = this.state.round
    if (name === 'fragment' && typeof data === 'string') {
      round.fragments = [...(round.fragments ?? []), data]
    } else if (name === 'extend' && typeof data === 'string') {
      // A fragment now arrives a clause at a time, so the board can lag the
      // voice instead of printing a whole clue before it is spoken. Only ever
      // the last entry, and only ever longer: `fragments` stays a list of
      // fragments, which is what `fragTotal` and the power boundary count.
      const f = round.fragments
      if (f?.length && data.length > f[f.length - 1].length) {
        round.fragments = [...f.slice(0, -1), data]
      }
    } else if (name === 'whole' && typeof data === 'string') {
      // Layout, not content: the board holds it invisible until the voice gets
      // there. Redacted for players in viewFor, which is what keeps it safe.
      round.whole = data
    } else if (name === 'revealAnswer' && typeof data === 'string') {
      round.answer = data
    } else if (name === 'judgeWindow') {
      // The judge's offer to the locked-in leader. {} is the open-ended window:
      // present means "offer push-to-talk", and only `until` carries a countdown.
      const d = data as { until?: number } | undefined
      if (d) round.judge = typeof d.until === 'number' ? { until: d.until } : {}
      else delete round.judge
    } else if (name === 'spoken') {
      round.spoken = (data ?? undefined) as State['round']['spoken']
    } else if (name === 'reading') {
      // Display-only progress from the reader. Undefined clears it.
      const update = data as ReadingUpdate | undefined
      this.state.reading = update?.progress
      this.state.readingActive = update?.active ?? false
    } else if (name === 'selectPack' && typeof data === 'string') {
      // Mid-question would cut the room off; refuse it the way setMode does.
      if (this.state.round.phase !== 'IDLE') return
      this.reader?.select(data).catch((e) => console.warn(`[hub] selectPack failed: ${e}`))
    } else if (name === 'read') {
      this.reader?.start()
    } else if (name === 'pauseRead') {
      this.reader?.pause()
    } else if (name === 'resumeRead') {
      this.reader?.resume()
    } else if (name === 'stopRead') {
      this.reader?.stop()
    } else if (name === 'rewindRead') {
      // No button: Read resumes on purpose. This is the scripted walkthroughs
      // asking for a known starting frame, and it costs one line to give them.
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

  private loadSetlist(name: string): ActionResult {
    // Refuse before disk access, then commit exactly as a builder edit would.
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
    // Fall back to whoever this connection already is, so a second hello on a
    // live socket renames that player instead of minting a duplicate.
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
    // Arming is scheduled ahead, so ARMED includes a countdown nobody may buzz
    // during. Arrival time is server truth, so this needs no clock tolerance:
    // a packet that landed before the arm instant was sent before it.
    if (arrivedAt < round.armedAt) return

    // A duel narrows the field to the seated pair for this arm.
    if (round.buzzable && !round.buzzable.includes(conn.playerId)) return

    // Framework effects (freeze) and the module's own rules both live behind
    // this one question.
    if (buzzBlockReason(this.state, conn.playerId)) return

    this.pending.push({ playerId: conn.playerId, at, arrivedAt })

    if (round.phase === 'ARMED') {
      round.phase = 'COLLECTING'
      // The first press of a window ends the previous one's story. A miss's
      // transcript is deliberately left up through the rebound — while nobody
      // has buzzed it, the red line is the only thing on the wall saying why
      // the question is still open — but the moment someone takes the question
      // over it is the last player's wrong answer sitting above the new name.
      delete round.spoken
      this.revealTimer = setTimeout(() => this.reveal(), this.revealMs)
      this.revealTimer.unref?.()
      this.timer = setTimeout(() => this.settle(), this.collectMs)
      this.timer.unref?.()
    }
    // Broadcast on every buzz. Before the reveal the aggregate is still empty,
    // so this leaks nothing about the field; after it, this is the timeline
    // filling in as the rest of the room lands.
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

  /** Resolve what has arrived so far into the published order. */
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
    // A steal jumps the window: first place, measured from the arm instant.
    const steal = this.state.effects.find(
      (e) => e.kind === 'steal' && e.attemptId === round.attemptId,
    )
    if (steal && !frozen.has(steal.playerId) && !excluded.includes(steal.playerId)) {
      const name =
        this.state.players.find((p) => p.id === steal.playerId)?.name ?? '?'
      round.order = [
        { playerId: steal.playerId, name, at: round.armedAt, deltaMs: 0 },
        ...round.order.filter((b) => b.playerId !== steal.playerId),
      ].map((b) => ({ ...b, deltaMs: Math.round(b.at - round.armedAt) }))
    }
    round.total = round.order.length
  }

  /**
   * Show the room a provisional leader shortly after the first buzz. The
   * window stays open: later buzzes keep joining the published order, and the
   * lead can still change hands on an earlier clamped stamp.
   */
  private reveal(): void {
    this.revealTimer = undefined
    this.revealed = true
    this.publish()
    this.changed('reveal')
  }

  /** Lock the round and publish the final order, once the window is up. */
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

  /**
   * Restore game data in place after stopping runtime work. The state object
   * remains stable for subscribers; one complete restoration is then published.
   */
  private undo(): boolean {
    const prev = this.history.pop()
    if (!prev) return false
    // Stopping the reader publishes runtime updates. Suppress those intermediate
    // frames so subscribers only observe the complete restored game.
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

  private clearWindow(): void {
    clearTimeout(this.timer)
    clearTimeout(this.revealTimer)
    this.timer = undefined
    this.revealTimer = undefined
    this.revealed = false
    this.pending = []
  }

  /**
   * Phones get the round redacted to their own buzz, module state only through
   * the module's own viewModuleState, and question text stripped unless the
   * room has turned the mirror on — quizbowl leaves it off, because reading a
   * sentence at its start beats hearing it word by word. Reader progress
   * (`reading`) is host/board only: even with the mirror off, `fragIndex`/
   * `fragTotal` would tell a player the question is about to end before the
   * room has heard it, and it also carries the pack filename.
   */
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
    if (conn.role !== 'player') return { ...this.state, game }
    const round = this.state.round
    return {
      ...this.state,
      game,
      round: {
        ...round,
        order: round.order.filter((b) => b.playerId === conn.playerId),
        fragments: this.state.mirrorFragments ? round.fragments : undefined,
        // Unconditional, mirror or not: this is the unspoken remainder.
        whole: undefined,
        answer: this.state.mirrorFragments ? round.answer : undefined,
      },
      reading: undefined,
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

  acknowledgeMinigame(playerId: PlayerId, ack: import('../shared/protocol.ts').BowInputAck): void {
    for (const conn of this.conns) {
      if (conn.role === 'player' && conn.playerId === playerId) conn.send({ t: 'minigameAck', ack })
    }
  }

  completeMinigame(matchId: string, results: import('../shared/protocol.ts').MinigameResult[]): void {
    if (!this.minigame || this.state.minigame?.matchId !== matchId) return
    const before = gameSnapshot(this.state)
    if (!this.minigame.finish(matchId, results)) return
    for (const result of results) bump(this.state, scoreKey(this.state, result.playerId), result.points)
    this.history.push(before)
    if (this.history.length > UNDO_DEPTH) this.history.shift()
    this.changed('minigame:results')
  }

  private changed(cause = 'change'): void {
    if (this.restoring) return
    this.trace(cause, this.state)
    this.broadcast()
    this.onChange(this.state)
  }
}
