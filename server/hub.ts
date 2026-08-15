import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz, type Resolved } from './resolve.ts'
import { applyHostAction, lockedPlayerIds } from './state.ts'
import { LATE_MS } from '../shared/protocol.ts'
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

/** Host actions that end or restart the question, and so close late collection. */
const RESETS = new Set(['arm', 'wrong', 'correct', 'next', 'resetRound', 'undo'])

export type HubOpts = {
  /** Grace window in ms between the first buzz and locking the order. */
  windowMs?: number
  /** How long buzzes keep being recorded, unscored, after that window shuts. */
  lateMs?: number
  onChange?: (state: State) => void
}

export class Hub {
  readonly state: State
  private conns = new Set<Conn>()
  private pending: RawBuzz[] = []
  private history: State[] = []
  private timer: NodeJS.Timeout | undefined
  private windowMs: number
  private lateMs: number
  /** Server time of the first buzz of the round, or 0 between rounds. */
  private collectFrom = 0
  private onChange: (state: State) => void

  constructor(state: State, opts: HubOpts = {}) {
    this.state = state
    this.windowMs = opts.windowMs ?? 150
    this.lateMs = opts.lateMs ?? LATE_MS
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
        // Anything that ends or restarts the question also shuts the late
        // window; setValue and the roster edits must not disturb a live round.
        if (RESETS.has(msg.action.a)) this.clearWindow()
        this.changed()
        return
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

    this.pending.push({ playerId: conn.playerId, at, arrivedAt })

    if (round.phase === 'ARMED') {
      round.phase = 'COLLECTING'
      this.collectFrom = arrivedAt
      // One timer, for the full second. The competitive cut-off inside it is
      // arithmetic, not another timer.
      this.timer = setTimeout(() => this.settle(), this.lateMs)
      this.timer.unref?.()
    }
    // Broadcast on every buzz. The aggregate is still empty, so this leaks
    // nothing about the field — it is what carries `youMissed` back to the
    // player who just pressed, while the room waits.
    this.changed()
  }

  /** The instant the buzz stopped being winnable. Everything after is late. */
  private get windowClosedAt(): number {
    return this.collectFrom + this.windowMs
  }

  private entry(b: Resolved) {
    return {
      playerId: b.playerId,
      name: this.state.players.find((p) => p.id === b.playerId)?.name ?? '?',
      at: b.at,
      deltaMs: b.deltaMs,
    }
  }

  /**
   * Publish the round, once, when the full second of collection is up.
   *
   * Nothing goes out before this: a board that revealed the winner at the
   * competitive cut-off would be announcing the result while people were still
   * arriving, which is the opposite of watching a race finish.
   */
  private settle(): void {
    const round = this.state.round
    const barred = lockedPlayerIds(this.state)
    round.phase = 'LOCKED'

    const contenders = resolveBuzzes(
      this.pending.filter((b) => b.arrivedAt <= this.windowClosedAt),
      round.armedAt,
      barred,
    )
    round.order = contenders.map((b) => this.entry(b))
    round.total = round.order.length

    // Latecomers resolve separately, with everyone already placed passed in as
    // excluded so a contender's second buzz is ignored rather than duplicated.
    const winner = contenders[0]
    const stragglers = resolveBuzzes(
      this.pending.filter((b) => b.arrivedAt > this.windowClosedAt),
      round.armedAt,
      [...barred, ...contenders.map((b) => b.playerId)],
    )
    round.late = stragglers.map((b) =>
      this.entry({
        ...b,
        // Re-based on the winner rather than the first straggler, and floored at
        // zero: a slow phone can carry a press stamp that genuinely predates the
        // winner's, and the board must never show a non-contender ahead of the
        // player who actually won the buzz.
        deltaMs: winner ? Math.max(0, Math.round(b.at - winner.at)) : 0,
      }),
    )

    this.pending = []
    this.collectFrom = 0
    this.timer = undefined
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
    this.timer = undefined
    this.pending = []
    this.collectFrom = 0
  }

  /**
   * Phones get the round redacted to their own buzz, so nobody can peek at
   * where they placed relative to the field before the host reveals it.
   */
  viewFor(conn: Conn): State {
    if (conn.role !== 'player') return this.state
    const round = this.state.round
    const mine = this.collectFrom
      ? this.pending.find((b) => b.playerId === conn.playerId)
      : undefined
    return {
      ...this.state,
      round: {
        ...round,
        order: round.order.filter((b) => b.playerId === conn.playerId),
        late: round.late.filter((b) => b.playerId === conn.playerId),
        // Told to this phone the moment its packet lands, a full second before
        // the room finds out anything. Missing the window is the player's own
        // business, so it travels in their redacted view and nowhere else.
        youMissed: mine ? mine.arrivedAt > this.windowClosedAt : undefined,
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
