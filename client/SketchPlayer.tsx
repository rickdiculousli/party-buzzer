import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { SketchInput } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { nextBowSequence } from './bow-control.ts'
import { PendingBar } from './InkParts.tsx'
import { StandingsDial } from './Player.tsx'
import { Blanks, SketchCanvas, SketchInk, focusInPlace, useKeyboardLift, useSketchCues, useSketchStrokes } from './SketchParts.tsx'
import { ScoreChange } from './fx.tsx'
import { SKETCH_RULES, fmtSeconds, ordinal, revealStamp, secondsLeft, stepLine } from './sketch.ts'
import { colorForPlayer, playerName } from './ui.ts'
import { sidewaysClass, useSideways } from './useSideways.ts'

const CLOSE_MS = 1_500
/** Your own wrong guesses kept on the phone, newest last. */
const MINE = 3

/**
 * The quiz phone's blocking, kept for every Sketch screen: the identity bar,
 * one centred line where the countdown sits, the card that fills the middle
 * the way the buzzer does, and whatever you act with below it. Everything
 * shares the one gutter and the one centre line.
 */
function Screen({ bar, line, card, foot, tight }: { bar: ComponentChildren; line?: ComponentChildren; card: ComponentChildren; foot?: ComponentChildren; tight?: boolean }) {
  return <main class={tight ? 'player sketch-phone sketch-phone--tight' : 'player sketch-phone'}>
    {bar}
    <div class="sketch-phone__line">{line}</div>
    <section class="sketch-card">{card}</section>
    {foot && <div class="sketch-phone__foot">{foot}</div>}
  </main>
}

export function SketchPlayer({ state, playerId, connected = true, frame, now, send }: MinigamePlayerProps) {
  const session = state.minigame!
  const sketch = matchFrame(frame, 'sketch', 'player', session.matchId)
  const strokes = useSketchStrokes(sketch)
  const [text, setText] = useState('')
  const [flash, setFlash] = useState(false)
  const rotation = useSideways()
  const form = useRef<HTMLFormElement>(null)
  const field = useRef<HTMLInputElement>(null)
  useKeyboardLift(form)
  useSketchCues(sketch, playerId)
  const close = sketch?.close ?? 0
  useEffect(() => {
    if (!close) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), CLOSE_MS)
    return () => clearTimeout(timer)
  }, [close])
  useEffect(() => setText(''), [sketch?.turn])

  const nameOf = (id: string) => playerName(state, id)
  const me = playerId ?? ''
  // This match's points while it runs; the night's once it is over.
  const score = sketch && session.phase === 'playing' ? sketch.scores[me] ?? 0 : state.scores[me] ?? 0
  const bar = <div class="player__bar">
    <span class="player__name" style={{ '--id': playerId ? colorForPlayer(state, playerId) : undefined }}>{nameOf(me)}</span>
    <span class="lamp">
      <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
      {connected ? 'Connected' : 'Disconnected'}
    </span>
    <ScoreChange class="player__score readout" score={score} />
  </div>

  if (session.phase === 'ready') return <Screen
    bar={bar}
    card={<>
      <p class="sketch-card__title">Sketch</p>
      <p class="sketch-card__note">{SKETCH_RULES}</p>
    </>}
    foot={<PendingBar label="Waiting for the host to start" />}
  />

  if (session.phase === 'results') {
    const results = session.results ?? []
    const at = results.findIndex((r) => r.playerId === playerId)
    return <main class="player sketch-phone">
      {bar}
      <div class="sketch-phone__line" />
      <section class="sketch-card">
        {at >= 0 ? <>
          <p class={at === 0 ? 'sketch-card__title is-won fx-tada' : 'sketch-card__title'}>{ordinal(at + 1)} in Sketch</p>
          <p class="sketch-card__note"><span class="readout">+{results[at].points}</span> for the night</p>
        </> : <p class="sketch-card__title">Match over</p>}
      </section>
      <StandingsDial state={state} />
    </main>
  }

  if (!sketch || !strokes) return <Screen
    bar={bar}
    card={<PendingBar label={frame?.role === 'spectator' ? 'Watching this game' : 'Starting'} />}
  />

  const input = (value: { kind: string } & Record<string, unknown>) => send({
    t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage),
    input: (value.kind === 'ink' ? value : { ...value, at: now() }) as SketchInput,
  })
  const drawer = sketch.drawer === playerId
  const clock = <p class="player__countdown" aria-label="seconds left">{secondsLeft(sketch.endsAt, now())}</p>
  const who = <span class="sketch-name" style={{ '--id': colorForPlayer(state, sketch.drawer) }}>{nameOf(sketch.drawer)}</span>

  if (sketch.step === 'choosing') return drawer
    ? <Screen
        bar={bar}
        line={clock}
        card={<>
          <p class="sketch-card__head">Choose a word to draw</p>
          <p class="sketch-card__note">You draw sideways: hold the phone with its left edge down.</p>
        </>}
        foot={<ol class="sketch-choices">
          {sketch.choices.map((word, i) => <li key={word}><button class="btn btn--major" onClick={() => input({ kind: 'pickWord', index: i })}>{word}</button></li>)}
        </ol>}
      />
    : <Screen
        bar={bar}
        line={clock}
        card={<>
          <p class="sketch-card__note">Choosing a word</p>
          <p class="sketch-card__title">{who}</p>
        </>}
        foot={<PendingBar label="Get ready to guess" />}
      />

  // Drawing is sideways with the phone's left edge down, as Ink's writing is:
  // a 4:3 drawing gets the phone's long side instead of its short one.
  if (drawer && sketch.step === 'drawing') return <main class={`player sketch-phone sketch-phone--draw ${sidewaysClass(rotation)}`}>
    {bar}
    <div class="sketch-phone__row">
      <p class="sketch-phone__word">{sketch.word}</p>
      {clock}
    </div>
    <SketchCanvas strokes={strokes} author={me} processed={sketch.inkOps} send={input} onPass={() => input({ kind: 'pass' })} />
  </main>

  const place = sketch.correct.findIndex((c) => c.player === playerId)
  const got = place >= 0 && <p class="sketch-phone__got fx-pop">
    Got it · {ordinal(place + 1)} · <span class="readout readout--ms">{fmtSeconds(sketch.correct[place].ms)}</span>
  </p>
  const drawing = <div class="sketch-stage"><SketchInk strokes={strokes} live={sketch.step === 'drawing' ? sketch.live : null} /></div>

  if (sketch.step === 'reveal' || sketch.step === 'over') return <Screen
    tight
    bar={bar}
    line={<p class="sketch-phone__step">{stepLine(sketch, nameOf)}</p>}
    card={<>
      {drawing}
      <p class="sketch-card__word fx-rise">{sketch.word}</p>
    </>}
    foot={got || <p class="sketch-phone__step">{drawer ? revealStamp(sketch) : 'Missed this one'}</p>}
  />

  const mine = sketch.misses.filter((m) => m.player === playerId).slice(-MINE)
  return <Screen
    tight
    bar={bar}
    line={clock}
    card={<>
      {drawing}
      {sketch.word ? <p class="sketch-card__word">{sketch.word}</p> : <Blanks text={sketch.blanks} />}
    </>}
    foot={got || <form class="sketch-guess" ref={form} onSubmit={(event) => {
      event.preventDefault()
      if (!text.trim()) return
      input({ kind: 'guess', text })
      setText('')
      // Guessing is a run of tries: the keyboard stays up between them.
      field.current?.focus({ preventScroll: true })
    }}>
      <input ref={field} class="input sketch-guess__field" value={text} maxLength={40} placeholder="Your guess"
        aria-label="Your guess" autocomplete="off" autocapitalize="off" enterkeyhint="send" onTouchEnd={focusInPlace}
        onInput={(event) => setText((event.currentTarget as HTMLInputElement).value)} />
      {/* Pressing Send never takes focus from the field, so the keyboard stays open. */}
      <button class="btn btn--primary sketch-guess__send" type="submit" disabled={!text.trim()}
        onPointerDown={(event) => event.preventDefault()}>Send</button>
      {/* Your own misses stay in view, so a cleared field never reads as a
          guess that went nowhere; Close takes their place for a moment. */}
      <p class="sketch-guess__tried">
        {flash
          ? <span class="chip chip--armed fx-pop">Close</span>
          : mine.map((m) => <span key={m.seq} class="chip fx-nudge">{m.text}</span>)}
      </p>
    </form>}
  />
}
