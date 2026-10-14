import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz, type Resolved } from './resolve.ts'
import { applyHostAction } from './state.ts'
import { buzzBlockReason, pickBlockReason } from './eligibility.ts'
import { bump, lockedPlayerIds, scoreKey } from '../shared/scoring.ts'
import { catalog, moduleFor } from './modes/index.ts'
import { useItem } from './items.ts'
import { duelAct, duelCatalog } from './duel.ts'
import { listPacks, packSizes } from './packs.ts'
import { listSetlists, readSetlist, writeSetlist } from './setlists.ts'
import { refuses } from '../shared/legality.ts'
import { arrivalBlocksPlay, arrivalPresentation, endLobby, introductionLine, practiceAllowed } from '../shared/arrival.ts'
import { READY_FALLBACK_MS, beginFor, everyoneReady } from './night.ts'
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
  /** Start the loop for the next block of a night: spent packs are not rewound. */
  carryOn(): void
  pause(): void
  resume(): void
  stop(): void
  rewind(): void
  /** End picking on the choice question being read. */
  closeChoice(): void
  /** Speak a line in the quip slot, if a performing voice is on; otherwise silent. */
  announce(text: string): void
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
  /** Practice receipts in the current lobby. Private, never in State; restarts per lobby. */
  private practiceSeq = 0
  /**
   * The night's automation, private runtime memory beside the collection
   * timers: one timer per slot, each keyed by the thing it waits on (an
   * arrival id, a matchId) so a changed key means the wait is over.
   */
  private night = new Map<'intro' | 'ready' | 'results', { key: string; handle: NodeJS.Timeout; fired: boolean }>()
  /** The match autoplay opened. A cancel mints a new matchId, which automation then leaves alone. */
  private nightMatch: string | undefined
  private nightBusy = false
  private nightDirty = false

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
        // A state-driven minigame may stay quiet for an entire turn. A join or
        // reconnect gets its own current role projection immediately.
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
        // Only the host panel may mutate the game.
        if (conn.role !== 'host') return
        conn.send({ t: 'actionResult', action: msg.action.a, result: this.dispatch(msg.action) })
        return

      case 'act':
        this.act(conn, msg.act, msg.data)
        return

      case 'practiceBuzz':
        this.practice(conn, msg.lobbyId)
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

  /** The single commit path for the host, reader, judge and setlist loader. */
  dispatch(action: HostAction): ActionResult {
    // The lobby is runtime: entering and leaving it is broadcast directly, with
    // no undo step and no change notification. An introduction closes below,
    // through the normal applier.
    if (action.a === 'openLobby' || (action.a === 'closeArrival' && this.state.arrival?.kind === 'lobby')) {
      return this.lobby(action)
    }
    let result: ActionResult
    let dismissedIntro = false
    let raisedIntro = false
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
        // Closing the minigame a setlist block named is what finishes that
        // block, in the same undo step as the close.
        const setlist = this.state.setlist
        if (action.a === 'closeMinigame' && setlist && setlist.blocks[setlist.at]?.game === before.minigame?.id) {
          applyHostAction(this.state, { a: 'setlistJump', at: setlist.at + 1 })
        }
        if (action.a === 'prepareMinigame') {
          // A minigame launch ends the lobby, as an arm does.
          endLobby(this.state)
          this.stopReaderQuietly()
        }
        if (this.introRaised(before)) {
          raisedIntro = true
          this.stopReaderQuietly()
        }
        if (action.a === 'startMinigame' && this.nightMatch !== undefined && before.minigame?.matchId === this.nightMatch) {
          // Starting mints a new matchId; the automated match follows it.
          this.nightMatch = this.state.minigame?.matchId
        }
        if (action.a === 'closeMinigame') this.nightMatch = undefined
        this.history.push(before)
        if (this.history.length > UNDO_DEPTH) this.history.shift()
      }
    } else {
      const before = gameSnapshot(this.state)
      result = applyHostAction(this.state, action)
      if (result.status === 'applied') {
        this.history.push(before)
        if (this.history.length > UNDO_DEPTH) this.history.shift()
        // A new introduction holds the room, so a reader mid-dwell or
        // mid-preparation stops here rather than arming over it.
        if (this.introRaised(before)) {
          raisedIntro = true
          this.stopReaderQuietly()
        }
        dismissedIntro = action.a === 'closeArrival' && before.arrival?.kind === 'introduction'
      }
    }
    if (result.status === 'applied') {
      // These end whatever the night was waiting on. Nothing here for a
      // refusal or a no-op: those leave every timer alone.
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

  /** Whether the applied action left a new introduction up, as opposed to none or the one that was. */
  private introRaised(before: GameSnapshot): boolean {
    const intro = this.state.arrival
    return intro?.kind === 'introduction' && intro.id !== before.arrival?.id
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
    // Duel entry belongs to players, like items. An introduction covers the
    // nomination window, so entries wait until the host continues.
    if (name.startsWith('duel')) {
      if (!conn.playerId || arrivalBlocksPlay(this.state)) return
      if (duelAct(this.state, conn.playerId, name, data)) this.changed('duel')
      return
    }
    // A pick belongs to a player, like an item.
    if (name === 'pick') {
      const round = this.state.round
      if (!conn.playerId || typeof data !== 'number' || !Number.isInteger(data)) return
      if (data < 0 || data >= (round.choices?.length ?? 0)) return
      if (pickBlockReason(this.state, conn.playerId)) return
      round.picks = { ...round.picks, [conn.playerId]: data }
      this.changed('pick')
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
    } else if (name === 'image' && typeof data === 'string') {
      round.image = data
    } else if (name === 'choices' && Array.isArray(data)) {
      round.choices = data.filter((c): c is string => typeof c === 'string')
    } else if (name === 'closesAt') {
      if (typeof data === 'number') round.closesAt = data
      else delete round.closesAt
    } else if (name === 'closeChoice') {
      this.reader?.closeChoice()
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
      // Reading accepted is real play starting: the lobby is over.
      if (this.state.readingActive) endLobby(this.state)
    } else if (name === 'selectPack' && typeof data === 'string') {
      // Mid-question would cut the room off; refuse it the way setMode does.
      if (this.state.round.phase !== 'IDLE') return
      this.reader?.select(data).catch((e) => console.warn(`[hub] selectPack failed: ${e}`))
    } else if (name === 'read') {
      // An introduction holds play: nothing starts, so nothing changed.
      if (arrivalBlocksPlay(this.state)) return
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

  /** Lobby entry and exit. Same refusals as any host action; no history, no `changed()`. */
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

  /**
   * A buzzer test. Only a registered player connection whose roster identity
   * may practice in this lobby; quiz lockouts and mode rules do not apply. The
   * first press marks the player tested and republishes views; every press
   * relays a receipt. Never `changed()`: practice is not gameplay.
   */
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

  /** Stop playback without publishing its intermediate frames; the caller publishes once. */
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
    // The checkpoint's data can hold secrets, such as Poker's deck seed; views get its label.
    const session = this.state.minigame
    const minigame = session?.checkpoint
      ? { ...session, checkpoint: { version: session.checkpoint.version, label: session.checkpoint.label } }
      : session
    if (conn.role !== 'player') return { ...this.state, game, minigame }
    const round = this.state.round
    // Shown and choice questions are on the board whole from the arm, so the
    // phone may have the same text; the mirror only governs read questions.
    const mirror = this.state.mirrorFragments || !!round.kind
    const mine = conn.playerId !== undefined ? round.picks?.[conn.playerId] : undefined
    return {
      ...this.state,
      game,
      round: {
        ...round,
        order: round.order
          .filter((b) => b.playerId === conn.playerId)
          .map((b) => ({ ...b, leader: round.order[0]?.playerId === b.playerId })),
        fragments: mirror ? round.fragments : undefined,
        // Unconditional, mirror or not: this is the unspoken remainder.
        whole: undefined,
        image: mirror ? round.image : undefined,
        answer: this.state.mirrorFragments ? round.answer : undefined,
        picks: mine === undefined ? undefined : { [conn.playerId!]: mine },
      },
      reading: undefined,
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

  /**
   * Re-derive the night's timers from the state, after every change. Steps go
   * through `dispatch` and accept a refusal quietly. A step that changes state
   * re-enters here; the guard turns that into one more pass of the loop.
   */
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
    // The first block's introduction is the host's to dismiss: nothing has started
    // yet, and Continue is the one press that starts the night.
    const intro = s.arrival?.kind === 'introduction' && s.arrival.blockAt > 0 ? s.arrival.id : undefined
    this.nightTimer('intro', intro, s.autoplay.introSec * 1000, (key) => {
      this.dispatch({ a: 'closeArrival', arrivalId: key })
    })

    const mg = s.minigame
    const mine = mg !== undefined && mg.matchId === this.nightMatch
    const waiting = mine && mg.phase === 'ready' ? mg.matchId : undefined
    this.nightTimer('ready', waiting, READY_FALLBACK_MS, () => this.nightStart())
    // Once the fallback has run out, any later change (a team pick, a join) that makes the start legal starts it.
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

  /** One timer per slot. The same key keeps it running; a new key restarts it; no key clears it. */
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

  /** An introduction was dismissed under autoplay: set the block going. Runs after that dismissal has committed. */
  private nightBegin(): void {
    const begin = beginFor(this.state)
    if (begin?.do === 'read') {
      this.reader?.carryOn()
    } else if (begin?.do === 'prepare') {
      const result = this.dispatch({ a: 'prepareMinigame', id: begin.id, options: begin.options })
      if (result.status === 'applied') {
        // The dismissal and the match it opens are one step: a single Undo
        // restores the introduction, and automation runs again from it.
        this.history.pop()
        this.nightMatch = this.state.minigame?.matchId
        this.nightEval()
      }
    }
  }
}
