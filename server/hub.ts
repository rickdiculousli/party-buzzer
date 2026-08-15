import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz, type Resolved } from './resolve.ts'
import { applyHostAction, buzzBlockReason, lockedPlayerIds } from './state.ts'
import { catalog, moduleFor } from './modes/index.ts'
import { useItem } from './items.ts'
import { COLLECT_MS } from '../shared/protocol.ts'
import type {
  ClientMsg, PlayerId, Role, ServerMsg, State,
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
const RESETS = new Set(['arm', 'wrong', 'correct', 'next', 'resetRound', 'undo'])

/**
 * How long after the first buzz the room sees a provisional leader. This is
 * responsiveness, not a cut-off: collection keeps running for the full window
 * afterwards, and a late packet carrying an earlier clamped stamp still takes
 * the lead.
 */
const REVEAL_MS = 150

export type HubOpts = {
  /** Delay from the first buzz to publishing a provisional order. */
  revealMs?: number
  /** How long buzzes are collected after the first one lands. */
  collectMs?: number
  onChange?: (state: State) => void
}

export class Hub {
  readonly state: State
  private conns = new Set<Conn>()
  private pending: RawBuzz[] = []
  private history: State[] = []
  private timer: NodeJS.Timeout | undefined
  private revealTimer: NodeJS.Timeout | undefined
  /** Whether the room has been shown an order yet this round. */
  private revealed = false
  private revealMs: number
  private collectMs: number
  private onChange: (state: State) => void

  constructor(state: State, opts: HubOpts = {}) {
    this.state = state
    // The catalog rides the state payload so the host form needs no fetch of
    // its own. Refresh on boot: a snapshot's copy may come from an older build.
    this.state.games = catalog()
    this.revealMs = opts.revealMs ?? REVEAL_MS
    this.collectMs = opts.collectMs ?? COLLECT_MS
    this.onChange = opts.onChange ?? (() => {})
  }

  add(conn: Conn): void {
    this.conns.add(conn)
  }

  remove(conn: Conn): void {
    this.conns.delete(conn)
    const player = this.state.players.find((p) => p.id === conn.playerId)
    if (player) player.connected = false
    this.changed()
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
        if (msg.action.a === 'undo') this.undo()
        else {
          this.history.push(structuredClone(this.state))
          if (this.history.length > UNDO_DEPTH) this.history.shift()
          applyHostAction(this.state, msg.action)
        }
        // Anything that ends or restarts the question also shuts collection;
        // setValue and the roster edits must not disturb a live round. A
        // refused judgement — correct/wrong before LOCKED — changes nothing,
        // so it must not kill the round's timers either.
        const refused =
          (msg.action.a === 'correct' || msg.action.a === 'wrong') &&
          this.state.round.phase !== 'LOCKED'
        if (RESETS.has(msg.action.a) && !refused) this.clearWindow()
        this.changed()
        return

      case 'act':
        this.act(conn, msg.act, msg.data)
        return
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
        this.changed()
      }
      return
    }
    if (conn.role !== 'host') return
    const round = this.state.round
    if (name === 'fragment' && typeof data === 'string') {
      round.fragments = [...(round.fragments ?? []), data]
    } else if (name === 'revealAnswer' && typeof data === 'string') {
      round.answer = data
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
    this.changed()
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
    this.changed()
  }

  private buzz(conn: Conn, at: number): void {
    const round = this.state.round
    if (!conn.playerId) return
    if (round.phase !== 'ARMED' && round.phase !== 'COLLECTING') return

    const arrivedAt = Date.now()
    // Arming is scheduled ahead, so ARMED includes a lead-in nobody may buzz
    // during. Arrival time is server truth, so this needs no clock tolerance:
    // a packet that landed before the arm instant was sent before it.
    if (arrivedAt < round.armedAt) return

    // Framework effects (freeze) and the module's own rules both live behind
    // this one question.
    if (buzzBlockReason(this.state, conn.playerId)) return

    this.pending.push({ playerId: conn.playerId, at, arrivedAt })

    if (round.phase === 'ARMED') {
      round.phase = 'COLLECTING'
      this.revealTimer = setTimeout(() => this.reveal(), this.revealMs)
      this.revealTimer.unref?.()
      this.timer = setTimeout(() => this.settle(), this.collectMs)
      this.timer.unref?.()
    }
    // Broadcast on every buzz. Before the reveal the aggregate is still empty,
    // so this leaks nothing about the field; after it, this is the timeline
    // filling in as the rest of the room lands.
    if (this.revealed) this.publish()
    this.changed()
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
        .filter((e) => e.kind === 'frozen' && e.roundArmedAt === round.armedAt)
        .map((e) => e.playerId),
    )
    round.order = resolveBuzzes(this.pending, round.armedAt, [...excluded, ...frozen]).map(
      (b) => this.entry(b),
    )
    // A steal jumps the window: first place, measured from the arm instant.
    const steal = this.state.effects.find(
      (e) => e.kind === 'steal' && e.roundArmedAt === round.armedAt,
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
    this.changed()
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
    this.changed()
  }

  /**
   * Restore the previous snapshot in place. `state` is handed out by reference
   * to the persistence layer, so the object identity has to survive; only its
   * top-level keys are swapped.
   */
  private undo(): void {
    const prev = this.history.pop()
    if (!prev) return
    Object.assign(this.state, prev)
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
   * Phones get the round redacted to their own buzz, question text and answer
   * stripped (the room reads the board; a phone must not leak the next
   * fragment before the voice reaches it), and module state only through the
   * module's own viewModuleState — a module without one exposes nothing.
   */
  viewFor(conn: Conn): State {
    const mod = moduleFor(this.state.game.id)
    let game = this.state.game
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
        fragments: undefined,
        answer: undefined,
      },
    }
  }

  broadcast(): void {
    for (const conn of this.conns) {
      conn.send({ t: 'state', state: this.viewFor(conn) })
    }
  }

  private changed(): void {
    this.broadcast()
    this.onChange(this.state)
  }
}
