/**
 * When a host action is allowed, said once.
 *
 * The same rule was stated twice, on both sides of the socket: `applyHostAction`
 * guards eight of its cases with `if (round.phase !== 'IDLE') return`, and the
 * host surfaces independently restate it in roughly fourteen `disabled={…}`
 * expressions. Nothing checked that the two agreed, and the two failure modes
 * are both silent — a live button the server ignores is a dead click with no
 * feedback, a greyed button the server would have taken is a feature nobody can
 * reach. That is `momentOf` and `middleOf` again with a network hop in the
 * middle, and it gets the same treatment: one table, and both sides read it.
 *
 * Two rules, borrowed wholesale from `shared/wall.ts`:
 *
 * 1. **Content and identity, never appearance.** A refusal is a code, never a
 *    sentence — the surface owns the words. `closeBlockReason`'s prose is what
 *    happens without this rule: legality expressed as a string the server can
 *    neither produce nor compare.
 * 2. **One `switch` over `action.a`, and no `default`.** A twenty-fifth
 *    `HostAction` does not compile until it has said when it is legal. That is
 *    `middleOf`'s totality trick pointed at a second question, and it is the
 *    part that makes this structural rather than remembered.
 *
 * `shared/` may not import from `server/`, which is load-bearing rather than
 * incidental: it is what stops a legality rule from being expressible in terms
 * the client cannot evaluate. Anything that needs the duel catalog or the module
 * registry is a *lookup* rather than a precondition and stays at its call site.
 */
import { isPenalty } from './protocol.ts'
import type { HostAction, State } from './protocol.ts'

/**
 * Why an action would be refused. One code per reason, not per guard: `correct`
 * and `wrong` refuse for the same thing and share `no-leader`, and the six
 * setup actions that want a quiet round share `not-idle`.
 *
 * A code earns its place by being a refusal some surface needs to explain. Duel
 * eligibility ("fewer than two are in", "everyone still in is on one team") is
 * deliberately absent: it is a hint about what closing *would resolve*, not a
 * rule about what the host may press, and answering it needs `eligible` from
 * `server/duel.ts` and `willSeat` from `client/ui.ts` — one of which this file
 * may not import, and the other of which it must not.
 */
export type Refusal =
  | 'not-idle'
  | 'no-leader'
  | 'already-scored'
  | 'nothing-held'
  | 'no-duel'
  | 'duel-seated'
  | 'unknown-mode'
  | 'no-setlist'

export function refuses(s: State, a: HostAction): Refusal | null {
  const r = s.round

  // Annotated, not inferred: without it this widens to `string | null` and the
  // return type stops checking anything — every code in the switch would typecheck
  // against a `string`, including a misspelt one.
  const idle: Refusal | null = r.phase === 'IDLE' ? null : 'not-idle'

  switch (a.a) {
    // No legality rule, and that is not the same as unrestricted. Arming from
    // LOCKED is today's "clear the board and go again" — the walkthroughs use
    // it, and neither side refuses it. The one restriction that does exist is
    // that the buzzers are already open, and *that* is clock-derived: it is
    // `useOpen` counting down to `armedAt`, which this file may not read. So it
    // stays the surface's rule (`Host.tsx`'s `disabled={open}`) rather than the
    // table's. A refusal this file cannot express is one it must not claim.
    case 'arm':
      return null

    // Judging waits for the window: a provisional leader is on the board from
    // 150ms in, but scoring during COLLECTING would strand every buzz still in
    // the air. `already-scored` is the desk going dead after a verdict lands —
    // and it is `isPenalty`, not the sign, because a no-penalty wrong stamps
    // points of zero and a penalty means the question is still live, not scored.
    case 'correct':
    case 'wrong':
      if (r.phase !== 'LOCKED' || !r.order[0]) return 'no-leader'
      return r.award && !isPenalty(r.award) ? 'already-scored' : null

    // Only ever opens a rebound that is being held. A stray one — a double tap,
    // a reader waking on a round that already moved — has nothing to open.
    case 'rebound':
      return r.held ? null : 'nothing-held'

    // Modes are fixed per session; switching is a fresh game, refused
    // mid-question. The catalog is the one in `State`, because the registry it
    // was copied from lives in `server/modes/`.
    case 'setMode':
      if (idle) return idle
      // ponytail: an empty catalog is treated as "no opinion" rather than as
      // "nothing is known", because `newState()` ships `games: []` and the hub
      // fills it in at startup — refusing everything in the gap would make the
      // table stricter than the server it speaks for. Upgrade path: if `games`
      // ever becomes lazily populated rather than filled once at boot, this
      // needs a real "catalog loaded" fact to test instead.
      if (s.games.length > 0 && !s.games.some((g) => g.id === a.id)) return 'unknown-mode'
      return null

    // Seating happens before the question opens, so `buzzable` stamps at the arm.
    case 'openDuel':
      return idle

    // Order matters only for which sentence the host reads: a seated duel
    // mid-question is refused for being seated rather than for the phase,
    // because that is the thing the host can do something about.
    case 'closeDuel':
      if (!s.duel) return 'no-duel'
      if (s.duel.seated) return 'duel-seated'
      return idle

    // Setup, not play — refused mid-question the way `setMode` is.
    case 'setSetlist':
    case 'clearSetlist':
      return idle

    case 'setlistJump':
      return idle ?? (s.setlist ? null : 'no-setlist')

    // Handled by the hub, which owns the snapshot stack — `applyHostAction`'s
    // `undo` case is an empty `return`, which reads like a refusal and is not
    // one. It is always legal; there is simply nobody here to serve it.
    case 'undo':
      return null

    // The round moves. `next` and `resetRound` are how a host gets *out* of a
    // stuck question, so a phase guard on either would be the one thing that
    // could strand the room; `cancelDuel` is the same escape hatch for a duel,
    // and mid-round it reopens the floor rather than being refused.
    case 'next':
    case 'resetRound':
    case 'cancelDuel':
      return null

    // Settings and roster. None of these touch the round in flight, and every
    // one of them is something a host legitimately does mid-question — fixing a
    // typo'd name, correcting a score, kicking a phone that will not stop.
    // Their `applyHostAction` cases guard nothing, and this is that said out loud.
    case 'setValue':
    case 'setAnswerWindow':
    case 'setScore':
    case 'rename':
    case 'kick':
    case 'setGrouping':
    case 'addTeam':
    case 'assign':
    case 'setMirror':
    case 'setAutoplay':
      return null
  }
}
