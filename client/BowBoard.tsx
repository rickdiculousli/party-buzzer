import type { MinigameFrame, State } from '../shared/protocol.ts'
import { colorForPlayer } from './ui.ts'

type BoardFrame = Extract<MinigameFrame, { role: 'board' }>

function Arrow({ arrow, color }: { arrow: BoardFrame['arrows'][number]; color: string }) {
  const length = 48
  const tailX = arrow.position.x - Math.cos(arrow.angle) * length
  const tailY = arrow.position.y - Math.sin(arrow.angle) * length
  return (
    <g style={{ color }}>
      <line x1={tailX} y1={tailY} x2={arrow.position.x} y2={arrow.position.y} class="bow-field__arrow" />
      <circle cx={arrow.position.x} cy={arrow.position.y} r="5" fill="currentColor" />
    </g>
  )
}

export function BowBoard({ state, frame, now }: { state: State; frame: MinigameFrame | null; now: () => number }) {
  const session = state.minigame!
  const board = frame?.role === 'board' && frame.matchId === session.matchId ? frame : null
  const remaining = session.endsAt ? Math.max(0, Math.ceil((session.endsAt - now()) / 1000)) : session.options.durationSec
  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0

  if (session.phase === 'results') return (
    <main class="bow-results">
      <p class="eyebrow">Bow results</p>
      <ol class="bow-results__list">
        {session.results?.map((result, index) => (
          <li key={result.playerId}>
            <span>{index + 1}. {state.players.find((player) => player.id === result.playerId)?.name ?? '?'}</span>
            <strong>{result.points}</strong>
          </li>
        ))}
      </ol>
    </main>
  )

  return (
    <main class="bow-board">
      <header class="bow-board__header">
        <strong>Bow</strong>
        <span>{session.phase === 'ready' ? 'Ready' : session.phase === 'countdown' ? `Starts in ${countdown}` : `${remaining}s`}</span>
      </header>
      <svg class="bow-field" viewBox="0 0 1600 900" aria-label="Shared bow field">
        <rect width="1600" height="900" class="bow-field__ground" />
        {board?.targets.map((target) => (
          <g key={target.id}>
            <circle cx={target.center.x} cy={target.center.y} r={target.radius + 5} class="bow-field__target-outline" />
            <circle cx={target.center.x} cy={target.center.y} r={target.radius} class="bow-field__target-white" />
            <circle cx={target.center.x} cy={target.center.y} r={target.radius * .8} class="bow-field__target-black" />
            <circle cx={target.center.x} cy={target.center.y} r={target.radius * .6} class="bow-field__target-blue" />
            <circle cx={target.center.x} cy={target.center.y} r={target.radius * .4} class="bow-field__target-red" />
            <circle cx={target.center.x} cy={target.center.y} r={target.radius * .2} class="bow-field__target-yellow" />
          </g>
        ))}
        {board?.players.map((player) => {
          const color = colorForPlayer(state, player.id)
          const name = state.players.find((candidate) => candidate.id === player.id)?.name ?? '?'
          return <g key={player.id} style={{ color }}>
            <path d={`M ${player.origin.x - 35} ${player.origin.y} Q ${player.origin.x} ${player.origin.y - 28} ${player.origin.x + 35} ${player.origin.y}`} class="bow-field__bow" />
            <text x={player.origin.x} y={player.origin.y + 30} class="bow-field__name">{name} · {player.score}</text>
          </g>
        })}
        {board?.arrows.map((arrow) => <Arrow key={arrow.id} arrow={arrow} color={colorForPlayer(state, arrow.playerId)} />)}
      </svg>
    </main>
  )
}
