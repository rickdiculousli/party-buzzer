import type { MinigameResult, PlayerId, TugSide } from '../../../shared/protocol.ts'
import type { MinigameRoom } from '../definition.ts'

export const TUG_STEP_MS = 50
/** A tap's fatigue fades over this long: a tap 300 ms after the last is nearly full value, and flat-out mashing tops out near seven a second. */
export const FATIGUE_MS = 150
/** Flag travel per unit of pull, per connected member of the side. */
export const GAIN = 0.15
/** The sag back toward the centre, per second, in proportion to how far the flag is out. */
export const SPRING = 0.1
/** How long the crossed or final flag holds the board before the results. */
export const BEAT_MS = 1500

/** Side colours for a side that is not exactly one team, in order of preference. */
const PAINTS = [
  { name: 'Red', color: 'var(--id-2)' }, { name: 'Blue', color: 'var(--id-3)' }, { name: 'Green', color: 'var(--id-6)' },
  { name: 'Gold', color: 'var(--id-4)' }, { name: 'Pink', color: 'var(--id-5)' }, { name: 'Orange', color: 'var(--id-1)' },
]
const [RED, BLUE] = PAINTS

export type Puller = { side: 0 | 1; fatigue: number; lastMs: number; pull: number }

export type TugWorld = {
  tick: number
  nowMs: number
  durationMs: number
  value: number
  sides: [TugSide, TugSide]
  pullers: Record<PlayerId, Puller>
  connected: Set<PlayerId>
  /** Pull taken this step, per side, before it moves the flag. */
  impulse: [number, number]
  /** Pull rate per connected member, smoothed for the board; 1 is a flat-out masher. */
  effort: [number, number]
  /** -1 is side 0's mark, 1 is side 1's. */
  flag: number
  winner?: 0 | 1 | null
  endedAtMs?: number
}

/**
 * Two sides. In a teams grouping each team stays whole: the biggest teams go
 * first, each to the side with fewer members. Otherwise, or when the teams
 * leave a side empty, players alternate down the standings, ties in join order.
 */
export function splitSides(participants: PlayerId[], room: MinigameRoom): [TugSide, TugSide] {
  const joined = room.players.map((p) => p.id).filter((id) => participants.includes(id))
  for (const id of [...participants].sort()) if (!joined.includes(id)) joined.push(id)
  if (room.grouping === 'teams') {
    const groups: { team?: MinigameRoom['teams'][number]; ids: PlayerId[] }[] = []
    for (const team of room.teams) {
      const ids = joined.filter((id) => room.players.find((p) => p.id === id)?.teamId === team.id)
      if (ids.length) groups.push({ team, ids })
    }
    for (const id of joined) if (!groups.some((g) => g.ids.includes(id))) groups.push({ ids: [id] })
    const sorted = groups.map((g, i) => ({ ...g, i })).sort((a, b) => b.ids.length - a.ids.length || a.i - b.i)
    const halves: (typeof groups)[] = [[], []]
    for (const group of sorted) {
      const size = (h: typeof groups) => h.reduce((n, g) => n + g.ids.length, 0)
      halves[size(halves[1]) < size(halves[0]) ? 1 : 0].push(group)
    }
    if (halves.every((h) => h.length)) {
      const team = halves.map((h) => h.length === 1 ? h[0].team : undefined)
      const sides = halves.map((h, s) => ({
        name: team[s]?.name ?? '', color: team[s]?.color ?? '', members: joined.filter((id) => h.some((g) => g.ids.includes(id))),
      })) as [TugSide, TugSide]
      // A side of several teams paints itself in a colour the other side is not using.
      for (const s of [0, 1] as const) {
        if (team[s]) continue
        const other = sides[1 - s].color
        const paint = [s === 0 ? RED : BLUE, ...PAINTS].find((p) => p.color !== other)!
        Object.assign(sides[s], paint)
      }
      return sides
    }
  }
  const score = (id: PlayerId) => {
    const key = room.grouping === 'teams' ? room.players.find((p) => p.id === id)?.teamId ?? id : id
    return room.scores[key] ?? 0
  }
  const ranked = joined.map((id, i) => ({ id, i })).sort((a, b) => score(b.id) - score(a.id) || a.i - b.i)
  const members: [PlayerId[], PlayerId[]] = [[], []]
  ranked.forEach(({ id }, rank) => members[rank % 2].push(id))
  return [{ ...RED, members: joined.filter((id) => members[0].includes(id)) }, { ...BLUE, members: joined.filter((id) => members[1].includes(id)) }]
}

export function createTugWorld(input: { participants: PlayerId[]; room: MinigameRoom; durationSec: number; value: number }): TugWorld {
  const sides = splitSides(input.participants, input.room)
  const pullers: Record<PlayerId, Puller> = {}
  sides.forEach((side, s) => { for (const id of side.members) pullers[id] = { side: s as 0 | 1, fatigue: 0, lastMs: -Infinity, pull: 0 } })
  return {
    tick: 0, nowMs: 0, durationMs: input.durationSec * 1000, value: input.value,
    sides, pullers, connected: new Set(input.participants),
    impulse: [0, 0], effort: [0, 0], flag: 0,
  }
}

/**
 * One tap. Each tap's worth is 1 / (1 + fatigue), and fatigue fades over
 * FATIGUE_MS; at a steady interval T a tap is worth 1 - e^(-T/150 ms). So
 * more taps always pull more, but the pull per second levels off near seven,
 * and for the same number of taps an even rhythm beats bursts.
 * Taps before the first step were sent during the countdown and do nothing.
 */
export function pull(world: TugWorld, playerId: PlayerId): boolean {
  const puller = world.pullers[playerId]
  if (!puller || !world.connected.has(playerId) || world.tick === 0 || world.endedAtMs !== undefined) return false
  puller.fatigue *= Math.exp(-(world.nowMs - puller.lastMs) / FATIGUE_MS)
  const worth = 1 / (1 + puller.fatigue)
  puller.fatigue += 1
  puller.lastMs = world.nowMs
  puller.pull += worth
  world.impulse[puller.side] += worth
  return true
}

/** Connected members of a side, at least one so an empty side pulls nothing rather than dividing by zero. */
const present = (world: TugWorld, side: 0 | 1) => Math.max(1, world.sides[side].members.filter((id) => world.connected.has(id)).length)

export function stepTug(world: TugWorld): void {
  world.tick++
  world.nowMs = world.tick * TUG_STEP_MS
  const dt = TUG_STEP_MS / 1000
  // Each side pulls as the mean of its connected members, so an odd room or a
  // dropped phone neither helps nor hurts a side by headcount.
  const per = [world.impulse[0] / present(world, 0), world.impulse[1] / present(world, 1)] as const
  world.impulse = [0, 0]
  const smooth = 1 - Math.exp(-TUG_STEP_MS / FATIGUE_MS)
  for (const s of [0, 1] as const) world.effort[s] += smooth * (per[s] * FATIGUE_MS / TUG_STEP_MS - world.effort[s])
  if (world.endedAtMs !== undefined) return
  world.flag += GAIN * (per[1] - per[0]) - SPRING * world.flag * dt
  if (Math.abs(world.flag) >= 1) {
    world.flag = Math.sign(world.flag)
    world.winner = world.flag > 0 ? 1 : 0
    world.endedAtMs = world.nowMs
  } else if (world.nowMs >= world.durationMs) {
    world.winner = aheadSide(world)
    world.endedAtMs = world.nowMs
  }
}

const aheadSide = (world: TugWorld): 0 | 1 | null => world.flag > 0 ? 1 : world.flag < 0 ? 0 : null

export const tugFinished = (world: TugWorld) => world.endedAtMs !== undefined && world.nowMs >= world.endedAtMs + BEAT_MS

export function tugPresence(world: TugWorld, connected: PlayerId[]): void {
  world.connected = new Set(connected)
}

/** Every member of the winning side gains `value`; a draw pays nobody. `shots` counts taps' worth, rounded. */
export function tugResults(world: TugWorld): MinigameResult[] {
  const winner = world.winner !== undefined ? world.winner : aheadSide(world)
  return world.sides.flatMap((side, s) => side.members.map((id) => ({
    playerId: id, points: s === winner ? world.value : 0, shots: Math.round(world.pullers[id].pull),
  }))).sort((a, b) => b.points - a.points || b.shots - a.shots || (a.playerId < b.playerId ? -1 : 1))
}
