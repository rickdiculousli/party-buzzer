/**
 * A scripted Tug of war match on the real board. The server's own world runs
 * here with six scripted pullers, publishing a frame every 50 ms like the
 * runtime, so the flag eases, jitters, swaps halves and crosses a mark exactly
 * as it does in a room. Retrigger to replay from the countdown.
 */
import { useEffect, useState } from 'preact/hooks'
import type { MinigameFrame, State } from '../../shared/protocol.ts'
import { mulberry32 } from '../../shared/random.ts'
import { createTugWorld, pull, stepTug, tugFinished, tugResults, TUG_STEP_MS } from '../../server/minigames/tug/world.ts'
import { TugBoard } from '../TugBoard.tsx'
import { tugRate } from './tug-script.ts'

const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay']
const COUNTDOWN_MS = 3000
const DURATION_SEC = 30

function room(): State {
  return {
    grouping: 'solo', teams: [], scores: {},
    players: NAMES.map((name) => ({ id: name.toLowerCase(), name, connected: true })),
  } as unknown as State
}

export function TugReplay({ lead }: { lead: boolean }) {
  const [view, setView] = useState<{ state: State; frame: MinigameFrame | null }>(() => ({ state: { ...room(), minigame: { id: 'tug', matchId: 'replay', phase: 'ready', options: { durationSec: DURATION_SEC, value: 100, seed: 1 }, participants: [] } } as State, frame: null }))
  useEffect(() => {
    if (lead) return
    const base = room()
    const ids = base.players.map((p) => p.id)
    const world = createTugWorld({ participants: ids, room: base, durationSec: DURATION_SEC, value: 100 })
    const random = mulberry32(7)
    const t0 = performance.now()
    const startsAt = t0 + COUNTDOWN_MS
    const session: NonNullable<State['minigame']> = { id: 'tug', matchId: 'replay', phase: 'countdown', options: { durationSec: DURATION_SEC, value: 100, seed: 1 }, participants: ids, startsAt, endsAt: startsAt + DURATION_SEC * 1000 }
    const frame = (): MinigameFrame => ({
      id: 'tug', role: 'board', matchId: 'replay', tick: world.tick, serverTime: performance.now(),
      sides: [{ ...world.sides[0] }, { ...world.sides[1] }],
      flag: world.flag, effort: [...world.effort] as [number, number], endsAt: startsAt + world.durationMs,
      ...(world.endedAtMs !== undefined ? { winner: world.winner ?? null } : {}),
    })
    let last: MinigameFrame | null = null
    const publish = () => setView({ state: { ...base, minigame: { ...session } }, frame: last })
    const timer = setInterval(() => {
      const now = performance.now()
      if (session.phase === 'countdown') {
        if (now >= startsAt) session.phase = 'playing'
        else { last = frame(); publish(); return }
      }
      if (session.phase === 'results') return
      while (world.nowMs + TUG_STEP_MS <= now - startsAt) {
        for (const id of ids) {
          const side = world.pullers[id].side
          if (random() < tugRate(side, world.nowMs) * TUG_STEP_MS / 1000) pull(world, id)
        }
        stepTug(world)
      }
      last = frame()
      if (tugFinished(world)) {
        session.phase = 'results'
        session.results = tugResults(world)
      }
      publish()
    }, 50)
    return () => clearInterval(timer)
  }, [lead])
  return (
    <div class="harness-tug">
      <TugBoard state={view.state} frame={view.frame} now={() => performance.now()} touches={[]} />
    </div>
  )
}
