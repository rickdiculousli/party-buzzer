import { useEffect, useState } from 'preact/hooks'
import type { SketchInput } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { nextBowSequence } from './bow-control.ts'
import { SketchCanvas, SketchInk, useSketchCues, useSketchStrokes } from './SketchParts.tsx'
import { fmtSeconds, ordinal, secondsLeft, stepLine } from './sketch.ts'
import { playerName } from './ui.ts'

const CLOSE_MS = 1_500

export function SketchPlayer({ state, playerId, frame, now, send }: MinigamePlayerProps) {
  const session = state.minigame!
  const sketch = matchFrame(frame, 'sketch', 'player', session.matchId)
  const strokes = useSketchStrokes(sketch)
  const [text, setText] = useState('')
  const [flash, setFlash] = useState(false)
  useSketchCues(sketch, playerId)
  const close = sketch?.close ?? 0
  useEffect(() => {
    if (!close) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), CLOSE_MS)
    return () => clearTimeout(timer)
  }, [close])
  useEffect(() => setText(''), [sketch?.turn])

  if (session.phase === 'ready') return <main class="sketch-phone"><h1 class="sketch-board__title">Sketch</h1><p class="muted">Waiting for the host to start</p></main>
  if (session.phase === 'results') {
    const mine = session.results?.find((result) => result.playerId === playerId)
    return <main class="sketch-phone"><p class="eyebrow">Sketch</p><p class="sketch-phone__score">{mine ? `${mine.points} points` : 'Match over'}</p></main>
  }
  if (!sketch || !strokes) return <main class="sketch-phone"><p class="muted">{frame?.role === 'spectator' ? 'Watching this game' : 'Starting…'}</p></main>

  const nameOf = (id: string) => playerName(state, id)
  const input = (value: { kind: string } & Record<string, unknown>) => send({
    t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage),
    input: (value.kind === 'ink' ? value : { ...value, at: now() }) as SketchInput,
  })
  const drawer = sketch.drawer === playerId
  const header = <header class="sketch-phone__bar">
    <span>{stepLine(sketch, nameOf)}</span>
    {sketch.step === 'drawing' && <span class="sketch-phone__clock">{secondsLeft(sketch.endsAt, now())}</span>}
  </header>

  if (drawer && sketch.step === 'choosing') return <main class="sketch-phone">
    {header}
    <p class="eyebrow">Pick a word to draw</p>
    <ol class="sketch-choices">
      {sketch.choices.map((word, i) => <li key={word}><button class="btn btn--major" onClick={() => input({ kind: 'pickWord', index: i })}>{word}</button></li>)}
    </ol>
  </main>
  if (drawer && sketch.step === 'drawing') return <main class="sketch-phone">
    {header}
    <p class="sketch-phone__word">{sketch.word}</p>
    <SketchCanvas strokes={strokes} author={playerId!} processed={sketch.inkOps} send={input} onPass={() => input({ kind: 'pass' })} />
  </main>

  const place = sketch.correct.findIndex((c) => c.player === playerId)
  return <main class="sketch-phone">
    {header}
    <p class="sketch-phone__blanks">{sketch.word ?? sketch.blanks}</p>
    <SketchInk strokes={strokes} live={sketch.live} />
    {sketch.step === 'drawing' && !drawer && (place >= 0
      ? <p class="sketch-phone__got fx-pop">Got it · {ordinal(place + 1)} · <span class="sketch-got__ms">{fmtSeconds(sketch.correct[place].ms)}</span></p>
      : <form class="sketch-guess" onSubmit={(event) => {
          event.preventDefault()
          if (!text.trim()) return
          input({ kind: 'guess', text })
          setText('')
        }}>
          <input class="sketch-guess__field" value={text} maxLength={40} placeholder="Your guess"
            autocomplete="off" autocapitalize="off" enterkeyhint="send"
            onInput={(event) => setText((event.currentTarget as HTMLInputElement).value)} />
          <button class="btn btn--primary" type="submit">Send</button>
          <p class={`sketch-guess__close${flash ? '' : ' is-hidden'}`}>Close!</p>
        </form>)}
  </main>
}
