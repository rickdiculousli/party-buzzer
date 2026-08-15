import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz } from './resolve.ts'
import { applyHostAction, lockedPlayerIds } from './state.ts'
import type {
  ClientMsg, PlayerId, Role, ServerMsg, State,
} from '../shared/protocol.ts'

export type Conn = {
  id: string
  role: Role
  playerId?: PlayerId
  send: (msg: ServerMsg) => void
}

export type HubOpts = {
  /** Grace window in ms between the first buzz and locking the order. */
  windowMs?: number
  onChange?: (state: State) => void
}

export class Hub {
  readonly state: State
  private conns = new Set<Conn>()
  private pending: RawBuzz[] = []
  private timer: NodeJS.Timeout | undefined
  private windowMs: number
  private onChange: (state: State) => void

  constructor(state: State, opts: HubOpts = {}) {
    this.state = state
    this.windowMs = opts.windowMs ?? 150
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
        applyHostAction(this.state, msg.action)
        if (msg.action.a === 'arm' || msg.action.a === 'wrong') this.clearWindow()
        this.changed()
        return
    }
  }

  private join(conn: Conn, playerId: PlayerId | undefined, name?: string): void {
    let player = playerId
      ? this.state.players.find((p) => p.id === playerId)
      : undefined

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

    this.pending.push({
      playerId: conn.playerId,
      at,
      arrivedAt: Date.now(),
    })

    if (round.phase === 'ARMED') {
      round.phase = 'COLLECTING'
      this.timer = setTimeout(() => this.lock(), this.windowMs)
      this.timer.unref?.()
      this.changed()
    }
  }

  private lock(): void {
    const round = this.state.round
    const resolved = resolveBuzzes(
      this.pending,
      round.armedAt,
      lockedPlayerIds(this.state),
    )

    round.order = resolved.map((b) => ({
      playerId: b.playerId,
      name: this.state.players.find((p) => p.id === b.playerId)?.name ?? '?',
      at: b.at,
      deltaMs: b.deltaMs,
    }))
    round.total = round.order.length
    round.phase = 'LOCKED'
    this.pending = []
    this.timer = undefined
    this.changed()
  }

  private clearWindow(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = []
  }

  /**
   * Phones get the round redacted to their own buzz, so nobody can peek at
   * where they placed relative to the field before the host reveals it.
   */
  viewFor(conn: Conn): State {
    if (conn.role !== 'player') return this.state
    const round = this.state.round
    return {
      ...this.state,
      round: {
        ...round,
        order: round.order.filter((b) => b.playerId === conn.playerId),
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
