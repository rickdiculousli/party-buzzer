import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { Blanks, SketchChat, SketchInk, SketchStandings, useSketchCues, useSketchStrokes, type SketchRow } from './SketchParts.tsx'
import { SKETCH_RULES, revealStamp, secondsLeft, stepLine } from './sketch.ts'
import { colorForPlayer, playerName, setlistPosition, standings } from './ui.ts'

/**
 * Sketch on the big screen, in the quiz's frame: the stage on the left, the
 * standings beside it. The drawing is the stage; the word and the guesses sit
 * above and below it, and the reveal stamps the result the way a scored
 * question does.
 */
export function SketchBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const sketch = matchFrame(frame, 'sketch', 'board', session.matchId)
  const strokes = useSketchStrokes(sketch)
  useSketchCues(sketch, 'board')
  const nameOf = (id: string) => playerName(state, id)
  const rowOf = (id: string, score: number): SketchRow => ({ key: id, label: nameOf(id), color: colorForPlayer(state, id), score })
  const place = setlistPosition(state) ?? 'Sketch'

  if (session.phase === 'results') {
    const results = session.results ?? []
    const top = results.filter((r) => r.points === results[0]?.points)
    return <main class="board">
      <section class="board__wall">
        <div class="board__status"><span class="chip">{place}</span></div>
        <div class="board__above">
          {results[0] && <p class="board__award fx-anchor">+{results[0].points}</p>}
        </div>
        <div class="board__mid">
          {top.length
            ? <p key="winner" class="board__hero fx-anchor is-awarded">{top.map((r) => nameOf(r.playerId)).join(' & ')}</p>
            : <p class="board__idle">Match over</p>}
        </div>
        <div class="board__below">
          {!!top.length && <p class="board__answer">{top.length > 1 ? 'Share the win' : 'Wins Sketch'}</p>}
        </div>
      </section>
      <SketchStandings title="Sketch points" rows={results.map((r) => rowOf(r.playerId, r.points))} />
    </main>
  }

  if (session.phase === 'ready' || !sketch || !strokes) return <main class="board">
    <section class="board__wall">
      <div class="board__status"><span class="chip">{place}</span></div>
      <div class="board__above" />
      <div class="board__mid">
        <div class="board__next">
          <p class="board__next-label">{session.phase === 'ready' ? 'Next up' : 'Starting'}</p>
          <p class="board__next-value">Sketch</p>
        </div>
      </div>
      <div class="board__below"><p class="sketch-rules">{SKETCH_RULES}</p></div>
    </section>
    <SketchStandings title="Standings" rows={standings(state)} />
  </main>

  const rows = Object.entries(sketch.scores)
    .map(([id, score]) => rowOf(id, score))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))
  const drawer = <span class="sketch-name" style={{ '--id': colorForPlayer(state, sketch.drawer) }}>{nameOf(sketch.drawer)}</span>
  const timed = sketch.step === 'choosing' || sketch.step === 'drawing'

  return <main class="board">
    <section class="board__wall sketch-wall">
      <header class="sketch-top">
        <span class="chip">{place}</span>
        <span class="chip">Turn {sketch.turn + 1}/{sketch.turns}</span>
        {sketch.step === 'drawing' && <p class="sketch-who">{drawer} is drawing</p>}
        {sketch.step === 'reveal' && (sketch.end === 'pass'
          ? <p class="sketch-who">{drawer} passed</p>
          : <p class="sketch-who">{stepLine(sketch, nameOf)}</p>)}
        {timed && <p class="sketch-clock readout" aria-label="seconds left">{secondsLeft(sketch.endsAt, now())}</p>}
      </header>

      {sketch.step === 'choosing' ? (
        // Nothing to look at yet, so the stage says whose turn it is instead of
        // showing an empty frame.
        <div class="sketch-stage">
          <div class="board__next fx-rise" key={sketch.turn}>
            <p class="board__next-label">Choosing a word</p>
            <p class="board__next-value sketch-name" style={{ '--id': colorForPlayer(state, sketch.drawer) }}>{nameOf(sketch.drawer)}</p>
          </div>
        </div>
      ) : (
        <>
          {sketch.word ? (
            <div class="sketch-head" key={`reveal:${sketch.turn}`}>
              <p class="board__award fx-anchor">{revealStamp(sketch)}</p>
              <p class="board__hero fx-anchor is-awarded">{sketch.word}</p>
            </div>
          ) : (
            <div class="sketch-head"><Blanks text={sketch.blanks} /></div>
          )}
          <div class="sketch-stage">
            <div class="sketch-frame">
              <SketchInk strokes={strokes} live={sketch.live} />
              <SketchChat
                turn={`${sketch.matchId}:${sketch.turn}`}
                misses={sketch.misses}
                correct={sketch.correct}
                nameOf={nameOf}
                colorOf={(id) => colorForPlayer(state, id)}
              />
            </div>
          </div>
        </>
      )}
    </section>
    <SketchStandings title="Sketch points" rows={rows} />
  </main>
}
