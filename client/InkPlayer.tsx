import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { INK_PEEK_ROWS } from '../shared/protocol.ts'
import type { InkInput, InkTeamName, MinigameFrame } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { TEAM_LABEL, stepLine } from './ink.ts'
import { sidewaysClass, useSideways } from './useSideways.ts'
import { HoldButton, InkCanvas, InkLobby, InkPad, InkRowSvg, Touchable, VotePips, useInkPad, useTouchClock } from './InkParts.tsx'

type Frame = Extract<MinigameFrame, { id: 'ink'; role: 'player' }>

export function InkPlayer({ state, playerId, frame, now, send, touches }: MinigamePlayerProps) {
  const session = state.minigame!
  const ink = frame?.role === 'player' && frame.id === 'ink' && frame.matchId === session.matchId ? frame as Frame : null
  const pad = useInkPad(ink)
  const seq = useRef(1)
  const [picked, setPicked] = useState<number[]>([])
  const stepAt = ink?.step.at ?? null
  // Cleared whenever the step leaves 'offer', so a stale pair from a finished
  // vote never carries into the next one.
  useEffect(() => { if (stepAt !== 'offer') setPicked([]) }, [stepAt])
  useTouchClock(touches)
  const rotation = useSideways()

  if (session.phase === 'ready') return <main class="ink-phone"><InkLobby state={state} playerId={playerId} send={send} /></main>
  if (!ink || !pad) return <main class="ink-phone"><p class="muted">{frame?.role === 'spectator' ? 'Watching this game' : 'Starting…'}</p></main>

  const nameOf = (id: string) => state.players.find((player) => player.id === id)?.name ?? '?'
  const input = (value: { kind: string } & Record<string, unknown>) => send({
    t: 'minigameInput', matchId: session.matchId, seq: seq.current++,
    input: (value.kind === 'ink' ? value : { ...value, at: now() }) as InkInput,
  })
  const touch = (target: string, x: number, y: number) => send({ t: 'minigameTouch', matchId: session.matchId, target, x, y })
  const s = ink.step
  const ours = ink.me.team === ink.turn
  const writer = ink.me.role === 'writer'
  const myVote = ink.votes.find((vote) => vote.player === playerId)?.choice ?? ''
  const vote = (choice: string) => input({ kind: 'vote', choice: myVote === choice ? '' : choice })
  const force = <HoldButton label="Force (hold 2 s)" onHeld={() => input({ kind: 'force' })} />

  const row = (team: InkTeamName, index: number, votable = false) => {
    const live = ink.live.filter((entry) => entry.team === team && entry.row === index).map((entry) => entry.points)
    return <Touchable state={state} target={`row:${team}:${index}`} touches={touches} onTouch={votable ? touch : undefined} class="ink-row ink-phone__row">
      <span class="ink-row__num">{TEAM_LABEL[team]} {index + 1}</span>
      <InkRowSvg row={pad[team][index]} extra={live} />
    </Touchable>
  }
  const turnRow = row(ink.turn, ink.row)
  const kept = ink.kept && <p class="ink-phone__kept">Prompt: <strong>{ink.kept}</strong></p>
  const canvas = (team: InkTeamName, index: number, buttons: ComponentChildren) => <section class="ink-write">
    <InkCanvas row={pad[team][index]} canUndo={ink.canUndo} send={(value) => input(value)}>{buttons}</InkCanvas>
  </section>
  const waiting = (text: string) => <p class="ink-phone__status">{text}</p>

  const writerFocus = (): ComponentChildren => {
    if (s.at === 'choosing') {
      return <ol class="ink-words">
        {ink.wordCard.map((word, i) => {
          const theirs = ink.picks[ink.me.team === 'sun' ? 'moon' : 'sun'] === i
          const mine = ink.picks[ink.me.team] === i
          return <li key={i}><button class={mine ? 'btn btn--major btn--primary' : 'btn btn--major'} onClick={() => input({ kind: 'pickWord', index: i })}>
            {i + 1}. {word}{theirs && !mine && ' — Confirm'}
          </button></li>
        })}
      </ol>
    }
    if (s.at === 'peekWrite' && ink.roster[s.team].writer === playerId) {
      return <>
        {waiting('Add one letter to your clue')}
        {canvas(s.team, s.row, <button class="btn btn--primary" onClick={() => input({ kind: 'done' })}>Done</button>)}
      </>
    }
    if (!ours || s.at === 'over') return null
    if (s.at === 'keep') {
      return <div class="ink-offer">
        <p class="eyebrow">Keep one prompt</p>
        {ink.offered.map((card) => <button key={card.id} class="btn btn--major ink-card" onClick={() => input({ kind: 'keep', prompt: card.id })}>{card.text}</button>)}
      </div>
    }
    if (s.at === 'clue') {
      return <>
        {kept}
        {/* Always laid out, so Stop never moves the canvas under a writing finger. */}
        <p class={s.stopped ? 'ink-phone__alert' : 'ink-phone__alert is-hidden'} aria-hidden={!s.stopped}>Stop — finish your letter</p>
        {canvas(ink.turn, ink.row, <>
          <button class="btn" onClick={() => input({ kind: 'endClue' })}>End clue</button>
          <button class={s.stopped ? 'btn btn--major btn--primary' : 'btn'} disabled={!s.stopped} onClick={() => input({ kind: 'done' })}>Done</button>
        </>)}
      </>
    }
    if (s.at === 'judgeLetter') {
      return <>
        {turnRow}
        <div class="ink-judge">
          <button class="btn btn--major btn--go" onClick={() => input({ kind: 'judge', correct: true })}>Correct letter</button>
          <button class="btn btn--major btn--no" onClick={() => input({ kind: 'judge', correct: false })}>Wrong letter</button>
        </div>
      </>
    }
    if (s.at === 'judgeWord') {
      return <>
        {turnRow}
        <div class="ink-judge">
          <button class="btn btn--major btn--go" onClick={() => input({ kind: 'verdict', win: true })}>Win</button>
          <button class="btn btn--major btn--no" onClick={() => input({ kind: 'verdict', win: false })}>Not it</button>
        </div>
      </>
    }
    return null
  }

  const guesserFocus = (): ComponentChildren => {
    if (s.at === 'choosing') return null
    if (s.at === 'peekWrite') return row(s.team, s.row)
    if (!ours || s.at === 'over') return null
    if (s.at === 'choose') {
      return <div class="ink-vote">
        {(['ask', 'guess', ...(s.canRedraw ? ['redraw'] : [])] as string[]).map((choice) => (
          <Touchable state={state} key={choice} target={`vote:${choice}`} touches={touches} onTouch={touch} class="ink-vote__option">
            <span>{choice === 'ask' ? 'Ask' : choice === 'guess' ? 'Guess' : 'Redraw hand'}</span>
            <VotePips state={state} votes={ink.votes} choice={(c) => c === choice} />
            <button class={myVote === choice ? 'btn btn--primary' : 'btn'} onClick={() => vote(choice)}>Vote</button>
          </Touchable>
        ))}
        {force}
      </div>
    }
    if (s.at === 'offer') {
      return <>
        <p class="eyebrow">Pick two prompts</p>
        <section class="ink-hand">
          {ink.hand.map((card) => {
            const selected = picked.includes(card.id)
            return <Touchable state={state} key={card.id} target={`card:${card.id}`} touches={touches} onTouch={touch} class={selected ? 'ink-card is-selected' : 'ink-card'}>
              <span>{card.text}</span>
              <VotePips state={state} votes={ink.votes} choice={(c) => c.split(',').includes(String(card.id))} />
              <button class={selected ? 'btn btn--primary' : 'btn'} onClick={() => {
                const next = selected ? picked.filter((id) => id !== card.id) : [...picked, card.id].slice(-2)
                setPicked(next)
                if (next.length === 2) vote([...next].sort((a, b) => a - b).join(','))
                else if (myVote) input({ kind: 'vote', choice: '' })
              }}>Vote</button>
            </Touchable>
          })}
        </section>
        {force}
      </>
    }
    if (s.at === 'keep') {
      return <div class="ink-offer">
        {ink.offered.map((card) => <div key={card.id} class="ink-card">{card.text}</div>)}
      </div>
    }
    if (s.at === 'clue') {
      return <>
        {kept}
        {turnRow}
        <button class="btn btn--major btn--no ink-stop" disabled={s.stopped} onClick={() => input({ kind: 'stop' })}>{s.stopped ? 'Stopped' : 'Stop'}</button>
      </>
    }
    if (s.at === 'guess') {
      if (s.holder !== null && s.holder !== playerId) return turnRow
      return canvas(ink.turn, ink.row, <>
        <button class="btn btn--primary" onClick={() => input({ kind: 'check' })}>Check</button>
        <button class="btn" onClick={() => input({ kind: 'finishGuess' })}>Finish guess</button>
      </>)
    }
    if (s.at === 'peekPick') {
      return <>
        <p class="eyebrow">Pick a clue to peek</p>
        <div class="ink-peek">
          {s.targets.map((target) => {
            const [team, index] = target.split(':') as [InkTeamName, string]
            return <div key={target} class="ink-peek__option">
              {row(team, Number(index), true)}
              <VotePips state={state} votes={ink.votes} choice={(c) => c === target} />
              <button class={myVote === target ? 'btn btn--primary' : 'btn'} onClick={() => vote(target)}>Vote</button>
            </div>
          })}
        </div>
        {force}
      </>
    }
    return turnRow
  }

  const focus = writer ? writerFocus() : guesserFocus()
  const header = <>
    <header class="ink-phone__bar">
      <span class={`chip ink-turn ink-turn--${ink.me.team}`}>{TEAM_LABEL[ink.me.team]} · {writer ? 'Writer' : 'Guesser'}</span>
      {writer && ink.secret && <span class="ink-phone__secret">{ink.secret}</span>}
    </header>
    <p class="ink-phone__status">{stepLine(ink, nameOf)}</p>
  </>
  const writing =
    (writer && ours && s.at === 'clue') ||
    (s.at === 'peekWrite' && ink.roster[s.team].writer === playerId) ||
    (!writer && ours && s.at === 'guess' && (s.holder === null || s.holder === playerId))
  // Writing is always sideways with the phone's left edge down, following autorotation.
  if (writing) {
    return <main class={`ink-phone ink-phone--${ink.me.team} ink-phone--write ${sidewaysClass(rotation)}`}>
      {header}
      {focus}
    </main>
  }
  // Another team's turn, or waiting on someone: show whose move it is and the row in play.
  const idleRow = !focus && s.at !== 'choosing' && s.at !== 'over' ? turnRow : null

  return <main class={`ink-phone ink-phone--${ink.me.team}`}>
    {header}

    {s.at === 'over' && ink.secret && !writer && <p class="ink-phone__reveal">It was <strong>{ink.secret}</strong></p>}
    {focus}
    {idleRow}

    <footer class="ink-phone__more">
      {!writer && !(ours && s.at === 'offer') && ink.hand.length > 0 && <details>
        <summary>Your prompts ({ink.hand.length})</summary>
        <ul>{ink.hand.map((card) => <li key={card.id}>{card.text}</li>)}</ul>
      </details>}
      {ink.asked.length > 0 && <details>
        <summary>Asked ({ink.asked.length})</summary>
        <ul>{ink.asked.map((text, i) => <li key={i}>{text}</li>)}</ul>
      </details>}
      <details>
        <summary>Show pad</summary>
        <InkPad state={state} frame={ink} pad={pad} touches={touches} peekRows={INK_PEEK_ROWS} />
      </details>
    </footer>
  </main>
}
