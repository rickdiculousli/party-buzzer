import { useRef } from 'preact/hooks'
import { INK_PEEK_ROWS } from '../shared/protocol.ts'
import type { InkInput, MinigameFrame } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { TEAM_LABEL } from './ink.ts'
import { stepLine } from './InkBoard.tsx'
import { HoldButton, InkCanvas, InkLobby, InkPad, Touchable, VotePips, useInkPad, useTouchClock } from './InkParts.tsx'

type Frame = Extract<MinigameFrame, { id: 'ink'; role: 'player' }>

export function InkPlayer({ state, playerId, frame, now, send, touches }: MinigamePlayerProps) {
  const session = state.minigame!
  const ink = frame?.role === 'player' && frame.id === 'ink' && frame.matchId === session.matchId ? frame as Frame : null
  const pad = useInkPad(ink)
  const seq = useRef(1)
  const picked = useRef<number[]>([])
  useTouchClock(touches)

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
  const voting = ours && !writer && (s.at === 'choose' || s.at === 'offer' || s.at === 'peekPick')
  const writingRow = s.at === 'peekWrite' ? pad[s.team][s.row] : pad[ink.turn][ink.row]
  const canWrite =
    (s.at === 'clue' && ours && writer) ||
    (s.at === 'peekWrite' && ink.roster[s.team].writer === playerId) ||
    (s.at === 'guess' && ours && !writer && (s.holder === null || s.holder === playerId))

  if (s.at !== 'offer') picked.current = []

  return <main class={`ink-phone ink-phone--${ink.me.team}`}>
    <header class="ink-phone__bar">
      <span class={`chip ink-turn ink-turn--${ink.me.team}`}>{TEAM_LABEL[ink.me.team]} · {writer ? 'Writer' : 'Guesser'}</span>
      <span>{stepLine(ink, nameOf)}</span>
    </header>

    {writer && ink.secret && <p class="ink-phone__secret">Secret word: <strong>{ink.secret}</strong></p>}
    {!writer && s.at === 'over' && ink.secret && <p class="ink-phone__secret">It was <strong>{ink.secret}</strong></p>}
    {ink.kept && <p class="ink-phone__kept">Prompt: {ink.kept}</p>}

    {s.at === 'choosing' && writer && <ol class="ink-words">
      {ink.wordCard.map((word, i) => {
        const theirs = ink.picks[ink.me.team === 'sun' ? 'moon' : 'sun'] === i
        const mine = ink.picks[ink.me.team] === i
        return <li key={i}><button class={mine ? 'btn btn--primary' : 'btn'} onClick={() => input({ kind: 'pickWord', index: i })}>
          {i + 1}. {word}{theirs && !mine && ' — Confirm'}
        </button></li>
      })}
    </ol>}

    {s.at === 'keep' && ours && writer && <div class="ink-offer">
      {ink.offered.map((card) => <button key={card.id} class="btn ink-card" onClick={() => input({ kind: 'keep', prompt: card.id })}>{card.text}</button>)}
    </div>}

    {canWrite && <section class="ink-write">
      <InkCanvas row={writingRow} enabled send={(value) => input(value)} />
      <div class="ink-write__buttons">
        <button class="btn" disabled={!ink.canUndo} onClick={() => input({ kind: 'undo' })}>Undo last stroke</button>
        {s.at === 'clue' && <>
          <button class="btn btn--primary" disabled={!s.stopped} onClick={() => input({ kind: 'done' })}>{s.stopped ? 'Finish your letter, then Done' : 'Done'}</button>
          <button class="btn" onClick={() => input({ kind: 'endClue' })}>End clue</button>
        </>}
        {s.at === 'peekWrite' && <button class="btn btn--primary" onClick={() => input({ kind: 'done' })}>Done</button>}
        {s.at === 'guess' && <>
          <button class="btn btn--primary" onClick={() => input({ kind: 'check' })}>Check</button>
          <button class="btn" onClick={() => input({ kind: 'finishGuess' })}>Finish guess</button>
        </>}
      </div>
    </section>}

    {s.at === 'clue' && ours && !writer && <button class="btn btn--major btn--no ink-stop" disabled={s.stopped} onClick={() => input({ kind: 'stop' })}>Stop</button>}
    {s.at === 'judgeLetter' && ours && writer && <div class="ink-judge">
      <button class="btn btn--major btn--go" onClick={() => input({ kind: 'judge', correct: true })}>Correct letter</button>
      <button class="btn btn--major btn--no" onClick={() => input({ kind: 'judge', correct: false })}>Wrong letter</button>
    </div>}
    {s.at === 'judgeWord' && ours && writer && <div class="ink-judge">
      <button class="btn btn--major btn--go" onClick={() => input({ kind: 'verdict', win: true })}>Win</button>
      <button class="btn btn--major btn--no" onClick={() => input({ kind: 'verdict', win: false })}>Not it</button>
    </div>}

    {voting && s.at === 'choose' && <div class="ink-vote">
      {(['ask', 'guess', ...(s.canRedraw ? ['redraw'] : [])] as string[]).map((choice) => (
        <Touchable key={choice} target={`vote:${choice}`} touches={touches} onTouch={touch} class="ink-vote__option">
          <span>{choice === 'ask' ? 'Ask' : choice === 'guess' ? 'Guess' : 'Redraw hand'}</span>
          <VotePips state={state} votes={ink.votes} choice={(c) => c === choice} />
          <button class={myVote === choice ? 'btn btn--primary' : 'btn'} onClick={() => vote(choice)}>Vote</button>
        </Touchable>
      ))}
    </div>}

    {!writer && <section class="ink-hand">
      {s.at === 'offer' && ours && <p class="eyebrow">Pick two prompts</p>}
      {ink.hand.map((card) => {
        const inVote = (c: string) => c.split(',').includes(String(card.id))
        const selected = picked.current.includes(card.id)
        return <Touchable key={card.id} target={`card:${card.id}`} touches={touches} onTouch={touch} class={selected ? 'ink-card is-selected' : 'ink-card'}>
          <span>{card.text}</span>
          {voting && s.at === 'offer' && <>
            <VotePips state={state} votes={ink.votes} choice={inVote} />
            <button class={selected ? 'btn btn--primary' : 'btn'} onClick={() => {
              picked.current = selected ? picked.current.filter((id) => id !== card.id) : [...picked.current, card.id].slice(-2)
              if (picked.current.length === 2) vote([...picked.current].sort((a, b) => a - b).join(','))
              else if (myVote) input({ kind: 'vote', choice: '' })
            }}>Vote</button>
          </>}
        </Touchable>
      })}
    </section>}

    {voting && <HoldButton label="Force (hold 2 s)" onHeld={() => input({ kind: 'force' })} />}

    <InkPad
      frame={ink}
      pad={pad}
      touches={touches}
      onTouch={touch}
      peekRows={INK_PEEK_ROWS}
      pickable={voting && s.at === 'peekPick' ? (target) => s.targets.includes(target) && <>
        <VotePips state={state} votes={ink.votes} choice={(c) => c === target} />
        <button class={myVote === target ? 'btn btn--primary' : 'btn'} onClick={() => vote(target)}>Vote</button>
      </> : undefined}
    />

    {ink.asked.length > 0 && <details class="ink-asked"><summary>Asked prompts</summary>
      <ul>{ink.asked.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>}
  </main>
}
