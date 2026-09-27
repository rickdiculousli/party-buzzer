import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { SketchInk, useSketchCues, useSketchStrokes } from './SketchParts.tsx'
import { feedOf, fmtSeconds, secondsLeft, stepLine } from './sketch.ts'
import { playerName } from './ui.ts'

export function SketchBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const sketch = matchFrame(frame, 'sketch', 'board', session.matchId)
  const strokes = useSketchStrokes(sketch)
  useSketchCues(sketch, 'board')
  const nameOf = (id: string) => playerName(state, id)

  if (session.phase === 'results') return <main class="sketch-results">
    <p class="eyebrow">Sketch results</p>
    <ol class="sketch-results__list">
      {session.results?.map((result) => <li key={result.playerId}><span>{nameOf(result.playerId)}</span><span>{result.points}</span></li>)}
    </ol>
  </main>
  if (session.phase === 'ready' || !sketch || !strokes) return <main class="sketch-board sketch-board--idle">
    <h1 class="sketch-board__title">Sketch</h1>
    <p class="muted">{session.phase === 'ready' ? 'One player draws, everyone else guesses' : 'Starting…'}</p>
  </main>

  return <main class="sketch-board">
    <header class="sketch-board__bar">
      <span class="chip">{sketch.turn + 1} / {sketch.turns}</span>
      <span>{stepLine(sketch, nameOf)}</span>
      {sketch.step === 'drawing' && <span class="sketch-board__clock">{secondsLeft(sketch.endsAt, now())}</span>}
    </header>
    <p class={`sketch-board__blanks${sketch.word ? ' is-word' : ''}`}>{sketch.word ?? sketch.blanks}</p>
    <SketchInk strokes={strokes} live={sketch.live} class="sketch-board__ink" />
    <aside class="sketch-board__side">
      <ol class="sketch-got">
        {sketch.correct.map((c) => <li key={c.seq} class="fx-drop"><span>{nameOf(c.player)}</span><span class="sketch-got__ms">{fmtSeconds(c.ms)}</span></li>)}
      </ol>
      <ul class="sketch-feed">
        {feedOf(sketch).map((e) => e.text === null
          ? <li key={e.seq} class="fx-pop is-got"><span class="sketch-feed__name">{nameOf(e.player)}</span>guessed it!</li>
          : <li key={e.seq} class="fx-pop"><span class="sketch-feed__name">{nameOf(e.player)}</span>{e.text}</li>)}
      </ul>
    </aside>
  </main>
}
