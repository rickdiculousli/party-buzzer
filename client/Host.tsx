import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { REFUSAL_TEXT, colorForPlayer, credits, ordinal, playerName, sortHostRows, standings } from './ui.ts'
import { clueBlockReason, refuses } from '../shared/legality.ts'
import { DuelPanel } from './DuelPanel.tsx'
import { HostGames, HostPlayers, LobbyTeams } from './HostSetup.tsx'
import { Spoken } from './Spoken.tsx'
import { ArrivalHost, readBlockedReason } from './ArrivalHost.tsx'
import { momentOf, type Moment } from '../shared/wall.ts'
import { isMinigameId, isPenalty } from '../shared/protocol.ts'
import type { HostAction, HostRow, MinigameFrame, MinigameId, State } from '../shared/protocol.ts'
import { MINIGAMES } from './minigames.tsx'
import { MINIGAME_CATALOG } from './minigame-info.ts'

const TABS = ['play', 'games', 'players'] as const
type Tab = (typeof TABS)[number]
const tabFromHash = (): Tab => {
  const h = location.hash.slice(1)
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'play'
}

const clockLeft = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

const readyCount = (state: State) =>
  state.players.filter((p) => p.connected && state.minigame?.lobby?.ready?.includes(p.id)).length

function MatchRows({ state, rows }: { state: State; rows: HostRow[] }) {
  return <ol class="host__order host__match">
    {sortHostRows(rows).map((row) => <li key={row.players[0]} class="row">
      <span class="row__label host__crew">
        {row.players.map((id) => <span key={id} class="host__who" style={{ borderLeftColor: colorForPlayer(state, id) }}>
          <span class={state.players.find((p) => p.id === id)?.connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
          {playerName(state, id)}
        </span>)}
      </span>
      {row.word && <span class="muted">{row.word}</span>}
      {row.score !== undefined && <span class="row__score">{row.score}</span>}
    </li>)}
  </ol>
}

function MatchDesk({ state, act, now, frame }: {
  state: State
  act: (action: HostAction) => void
  now: () => number
  frame: MinigameFrame | null
}) {
  const session = state.minigame!
  const game = MINIGAMES[session.id]
  const remaining = session.endsAt ? Math.max(0, Math.ceil((session.endsAt - now()) / 1000)) : session.options.durationSec
  const close = <button class="btn" onClick={() => act({ a: 'closeMinigame' })}>Close {game.name}</button>
  return <>
    <section class="bow-host__panel">
      <p class="eyebrow">Match control</p>
      <p>{!game.timed
        ? 'No time limit'
        : session.phase === 'playing' ? `${remaining} seconds left` : `${session.options.durationSec} second match`}</p>
      {session.phase === 'ready' && game.picksTeams && <p class="muted">Players pick sides on their phones.</p>}
      {session.phase === 'ready' && session.id !== 'poker' && <p class="muted readout">{readyCount(state)} of {state.players.filter((p) => p.connected).length} ready</p>}
      <p class="muted">{session.participants.length} players in this match</p>
      {session.status?.map((line) => <p key={line.text}>
        {line.text}{line.until !== undefined && <> · <span class="readout">{clockLeft(line.until - now())}</span></>}
      </p>)}
      {session.phase === 'ready' && <div class="host__minor">
        <button class="btn btn--major btn--primary" onClick={() => act({ a: 'startMinigame' })}>
          {session.checkpoint ? `Resume from ${session.checkpoint.label}` : 'Start match'}
        </button>
        {close}
      </div>}
      {(session.phase === 'countdown' || session.phase === 'playing') && frame?.role === 'host' && frame.matchId === session.matchId && frame.rows.length > 0 &&
        <MatchRows state={state} rows={frame.rows} />}
      {(session.phase === 'countdown' || session.phase === 'playing') && <button class="btn btn--major btn--no" onClick={() => act({ a: 'cancelMinigame' })}>Cancel match</button>}
      {session.phase === 'results' && <>
        <ol class="host__order">
          {[...session.results ?? []].sort((a, b) => (a.place ?? 0) - (b.place ?? 0)).map((result) => <li key={result.playerId} class="row">
            <span class="row__label">{playerName(state, result.playerId)}</span>
            <span class="readout">{result.place ? ordinal(result.place) : `+${result.points}`}</span>
          </li>)}
        </ol>
        <div class="host__minor">
          <button class="btn btn--primary" onClick={() => act({ a: 'cancelMinigame' })}>Play again</button>
          {close}
        </div>
      </>}
    </section>
    <LobbyTeams state={state} />
  </>
}

const KEYS: Record<string, HostAction> = {
  c: { a: 'correct' },
  n: { a: 'next' },
  z: { a: 'undo' },
}

function notesFor(
  m: Moment,
  f: { leader: boolean; scored: boolean },
): { judge: string | null; arm: string | null } {
  const played = 'Press N for next round. Arm to redo (score not reverted)'

  switch (m) {
    case 'arrival:lobby':
      return { judge: null, arm: 'Arming closes the lobby.' }
    case 'arrival:introduction':
      return { judge: null, arm: REFUSAL_TEXT['introduction-active'] }

    case 'choice:listening':
      return { judge: 'Everyone picks on their phone once the question is read.', arm: null }
    case 'choice:picking':
      return { judge: 'Close picking to settle it now.', arm: null }
    case 'choice:reveal':
      return { judge: null, arm: played }

    case 'closest:listening':
      return { judge: 'Everyone types a number on their phone once the question is read.', arm: null }
    case 'closest:guessing':
      return { judge: 'Close guessing to settle it now.', arm: null }
    case 'closest:reveal':
      return { judge: null, arm: played }

    case 'answer:judging':
      return { judge: null, arm: played }

    case 'answer:locked':
      return {
        judge: !f.leader ? 'The lock caught no buzz.' : f.scored ? REFUSAL_TEXT['already-scored'] : null,
        arm: played,
      }

    case 'verdict:hold':
      return {
        judge: 'Reopen puts the question back to the room.',
        arm: 'Arming drops the rebound.',
      }

    case 'verdict:award':
      return { judge: REFUSAL_TEXT['already-scored'], arm: played }
    case 'verdict:unanswered':
      return { judge: null, arm: played }

    case 'verdict:penalty':
      return { judge: null, arm: played }

    case 'duel:faceoff':
      return { judge: null, arm: 'Arming rematches the same pair.' }
    case 'duel:dead':
      return { judge: 'Both seated players have missed.', arm: 'Arming puts them both back in.' }
    case 'duel:nominating':
      return { judge: null, arm: null }

    case 'buzz:collecting':
    case 'buzz:open':
    case 'buzz:arming':
      return { judge: null, arm: null }

    case 'idle:finale':
    case 'idle:ready':
    case 'idle:welcome':
      return { judge: null, arm: null }
  }
}

export function Host() {
  const { state, connected, send, now, actionMessage, minigameFrame } = useSocket('host')
  const act = (action: HostAction) => send({ t: 'host', action })
  const fire = (a: string, data?: unknown) => send({ t: 'act', act: a, data })
  const { open } = useOpen(state?.round, now)
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const go = (t: Tab) => {
    setTab(t)
    history.replaceState(null, '', `#${t}`)
  }

  const block = state?.setlist?.blocks[state.setlist.at]
  const upNext = !state?.minigame && block && isMinigameId(block.game) ? block.game : null

  const value = useRef(0)
  value.current = state?.round.value ?? 0
  const armable = !!state && !refuses(state, { a: 'arm' })
  const idleRef = useRef(false)
  idleRef.current = armable && state.round.phase === 'IDLE'
  const missedRef = useRef(false)
  missedRef.current = armable && isPenalty(state.round.award) && state.round.order.length === 0
  const judgeableRef = useRef(false)
  const reopenableRef = useRef(false)
  const keysOffRef = useRef(false)
  keysOffRef.current = !!state?.minigame || !!upNext || tab !== 'play'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keysOffRef.current) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === ' ') {
        e.preventDefault()
        if (judgeableRef.current) act({ a: 'correct' })
        else if (idleRef.current) act({ a: 'arm' })
        return
      }
      if (e.key === 'Shift') {
        if (judgeableRef.current) act({ a: 'wrong', neg: value.current })
        else if (missedRef.current) act({ a: 'arm' })
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'w') {
        e.preventDefault()
        if (judgeableRef.current) act({ a: 'wrong', neg: value.current })
        return
      }
      if (key === 'r') {
        e.preventDefault()
        if (reopenableRef.current) act({ a: 'rebound' })
        return
      }
      const hit = KEYS[key]
      if (!hit) return
      e.preventDefault()
      if (hit.a === 'correct' && reopenableRef.current) {
        act({ a: 'rebound' })
        return
      }
      if (hit.a === 'correct' && !judgeableRef.current) return
      act(hit)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!state) return <main class="host"><p class="muted">Connecting…</p></main>

  const nowLabel = state.minigame
    ? `${MINIGAMES[state.minigame.id].name} · ${state.minigame.phase}`
    : `${state.games.find((g) => g.id === state.game.id)?.name ?? 'Quiz'} · ${state.round.phase}`

  return (
    <main class="host">
      <div class="host__bar">
        <span class="host__title">Host</span>
        <span class="lamp">
          <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span class="chip">{nowLabel}</span>
        <span class="host__spacer" />
        <button class="btn btn--ghost" onClick={() => act({ a: 'undo' })}>
          Undo<span class="key">Z</span>
        </button>
      </div>
      <nav class="host__tabs">
        {TABS.map((t) => (
          <button key={t} class="host__tab" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
            {t}
          </button>
        ))}
      </nav>
      {actionMessage && <p class="muted" role="status">{actionMessage}</p>}
      {tab === 'games' && <HostGames state={state} act={act} fire={fire} play={() => go('play')} />}
      {tab === 'players' && <HostPlayers state={state} act={act} />}
      {tab === 'play' && (state.minigame
        ? <MatchDesk state={state} act={act} now={now} frame={minigameFrame} />
        : <QuizDesk state={state} act={act} fire={fire} open={open} upNext={upNext}
            judgeableRef={judgeableRef} reopenableRef={reopenableRef} />)}
    </main>
  )
}

function TypedClue({ state, fire }: { state: State; fire: (a: string, data?: unknown) => void }) {
  const [draft, setDraft] = useState(state.typed ?? '')
  useEffect(() => {
    if (!state.typed) setDraft('')
  }, [state.typed])
  const blocked = !!clueBlockReason(state)
  return (
    <form
      class="host__reader"
      onSubmit={(e) => {
        e.preventDefault()
        fire('typeClue', draft)
      }}
    >
      <input
        class="input host__typed"
        placeholder="Question for the wall"
        aria-label="Question for the wall"
        value={draft}
        disabled={blocked}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
      />
      <button class="btn" type="submit" disabled={blocked || !draft.trim()}>
        Show<span class="key">Enter</span>
      </button>
      <button class="btn btn--ghost" type="button" disabled={!state.typed} onClick={() => fire('typeClue', '')}>
        Clear
      </button>
    </form>
  )
}

function QuizDesk({ state, act, fire, open, upNext, judgeableRef, reopenableRef }: {
  state: State
  act: (action: HostAction) => void
  fire: (a: string, data?: unknown) => void
  open: boolean
  upNext: MinigameId | null
  judgeableRef: { current: boolean }
  reopenableRef: { current: boolean }
}) {
  const { round } = state
  const leader = round.order[0]
  const scored = !!round.award && !isPenalty(round.award)
  const moment = momentOf(state, { open, settled: true, retired: true })
  const judgeable = moment === 'answer:locked' && !!leader && !scored
  judgeableRef.current = judgeable

  const missed = isPenalty(round.award) && round.order.length === 0
  const reopenable = !refuses(state, { a: 'rebound' })
  reopenableRef.current = reopenable

  const notes = notesFor(moment, { leader: !!leader, scored })
  const judgeReason = judgeable ? null : notes.judge
  const armNote = notes.arm

  const setlist = !!state.setlist
  const block = state.setlist?.blocks[state.setlist.at]
  const readable = setlist ? !!block?.pack : !!state.reading?.pack
  const unpaid = state.packCost[(setlist ? block?.pack : state.reading?.pack) ?? ''] ?? 0
  const scoreless = !!state.games.find((g) => g.id === state.game.id)?.scoreless

  const introBlocked = refuses(state, { a: 'arm' }) === 'introduction-active'
  const readNote = readBlockedReason(state)

  return (
    <>
      <ArrivalHost state={state} act={act} />
      <div class="host__bar">
        {state.game.status && (
          <span class={state.game.status.tone === 'inactive' ? 'chip chip--barred' : 'chip chip--data'}>
            {state.game.status.label}
          </span>
        )}

        {!upNext && !scoreless && <label class="field">
          Value
          <span class="stepper">
            <button
              class="btn btn--ghost"
              onClick={() => act({ a: 'setValue', value: Math.max(0, round.value - 100) })}
            >
              −
            </button>
            <input
              class="input input--num"
              type="number"
              step={100}
              value={round.value}
              onInput={(e) =>
                act({ a: 'setValue', value: Number((e.target as HTMLInputElement).value) })
              }
            />
            <button
              class="btn btn--ghost"
              onClick={() => act({ a: 'setValue', value: round.value + 100 })}
            >
              +
            </button>
          </span>
        </label>}
      </div>

      <section>
        {state.setlist && (() => {
          const at = state.setlist.at
          const block = state.setlist.blocks[at]
          const name = [...state.games, ...MINIGAME_CATALOG].find((g) => g.id === block?.game)?.name
          const jump = refuses(state, { a: 'setlistJump', at: at + 1 })
          return (
            <div class="host__setlist">
              {block ? (
                <>
                  <span class="chip chip--data">Block {at + 1} of {state.setlist.blocks.length}</span>
                  <span class="row__label">{name}</span>
                  {!upNext && <span class="chip">Q{state.setlist.done + 1} of {block.count}</span>}
                  {block.duel && <span class="chip chip--armed">duel</span>}
                </>
              ) : (
                <span class="chip chip--data">Setlist complete</span>
              )}
              <span class="host__spacer" />
              {block ? (
                <button class="btn btn--ghost" disabled={!!jump} onClick={() => act({ a: 'setlistJump', at: at + 1 })}>
                  Skip block
                </button>
              ) : (
                <button class="btn btn--ghost" disabled={!!jump} onClick={() => act({ a: 'setlistJump', at: state.setlist!.blocks.length })}>
                  Replay finale
                </button>
              )}
              {jump && <span class="muted">{REFUSAL_TEXT[jump]}</span>}
            </div>
          )
        })()}
        {upNext ? (
          <div class="host__controls">
            <button
              class="btn btn--major btn--primary"
              onClick={() => act({ a: 'prepareMinigame', id: upNext, options: block?.options ?? {} })}
              disabled={introBlocked}
            >
              Open {MINIGAMES[upNext].name}
            </button>
            {introBlocked && <span class="muted">{REFUSAL_TEXT['introduction-active']}</span>}
          </div>
        ) : <>
        <p
          class={judgeable ? 'host__up is-judging' : 'host__up'}
          style={leader ? { borderLeftColor: colorForPlayer(state, leader.playerId) } : undefined}
        >
          <span class="eyebrow">{leader ? 'Answering' : open ? 'Buzzers open' : 'Nobody answering'}</span>
          <span class="host__up-name">{leader?.name ?? '—'}</span>
        </p>
        <div class="host__controls">
          <button class="btn btn--major btn--primary" onClick={() => act({ a: 'arm' })} disabled={(open && !missed) || introBlocked}>
            {open && !missed ? 'Buzzers open' : 'Arm'}<span class="key">{missed ? 'Shift' : 'Space'}</span>
          </button>
          {reopenable ? (
            <button class="btn btn--major btn--go" onClick={() => act({ a: 'rebound' })}>
              Reopen now<span class="key">R</span>
            </button>
          ) : (
            <button class="btn btn--major btn--go" onClick={() => act({ a: 'correct' })} disabled={!judgeable}>
              Correct<span class="key">Space</span>
            </button>
          )}
          <button
            class="btn btn--major btn--no"
            onClick={() => act({ a: 'wrong', neg: round.value })}
            disabled={!judgeable}
          >
            Wrong<span class="key">Shift</span>
          </button>
        </div>
        <div class="host__notes">
          {judgeReason && <p class="muted host__note">{judgeReason}</p>}
          {armNote && !scoreless && <p class="muted host__note">{armNote}</p>}
        </div>
        <div class="host__minor" style={{ marginTop: 'var(--s3)' }}>
          {!scoreless && <button class="btn" onClick={() => act({ a: 'wrong', neg: 0 })} disabled={!judgeable}>
            Wrong, no penalty
          </button>}
          {(!scoreless || setlist) && <button class="btn" onClick={() => act({ a: 'next' })}>
            Next question<span class="key">N</span>
          </button>}
          {moment === 'choice:picking' && (
            <button class="btn" onClick={() => fire('closeChoice')}>
              Close picking
            </button>
          )}
          {moment === 'closest:guessing' && (
            <button class="btn" onClick={() => fire('closeChoice')}>
              Close guessing
            </button>
          )}
        </div>

        {round.spoken && (
          <Spoken
            prefix="host"
            transcript={round.spoken.transcript}
            hit={round.spoken.hit}
            tail={` — ${round.spoken.name}`}
          />
        )}

        {state.packs.length > 0 && !scoreless && (
          <div class="host__reader">
            {state.reading?.rendering && (
              <span class="chip chip--data">
                Rendering {state.reading.rendering.done}/{state.reading.rendering.total}
              </span>
            )}
            {state.readingActive ? (
              <button class="btn" onClick={() => fire(state.reading?.paused ? 'resumeRead' : 'pauseRead')}>
                {state.reading?.paused ? 'Resume' : 'Pause'}
              </button>
            ) : !(state.reading?.rendering && !setlist) && (
              <>
                <button class="btn btn--primary" disabled={!readable || !!readNote} onClick={() => fire('read')}>
                  Read
                </button>
                {readNote && <span class="muted">{readNote}</span>}
                {unpaid > 0 && (
                  <span class="chip chip--data">~{credits(unpaid)} credits to read</span>
                )}
              </>
            )}
            <button class="btn btn--ghost" onClick={() => fire('stopRead')} disabled={!state.reading || (!!state.reading.rendering && !state.readingActive)}>
              Stop
            </button>
            {state.reading ? (
              <span class="chip">
                {state.reading.pack} · Q{state.reading.qIndex + 1}/{state.reading.qTotal}
                {state.reading.fragTotal > 0 &&
                  ` · fragment ${state.reading.fragIndex}/${state.reading.fragTotal}`}
              </span>
            ) : (
              !readable && (
                <span class="muted">
                  {setlist ? 'This block names no pack — read it yourself' : 'No pack chosen'}
                </span>
              )
            )}
            {state.autoplay.on && <span class="chip chip--armed">Autoplay</span>}
          </div>
        )}
        {!scoreless && <TypedClue state={state} fire={fire} />}
        </>}
      </section>

      {!upNext && <>
      <section>
        <p class="eyebrow">Buzz order</p>
        {round.order.length === 0 ? (
          <p class="muted">No buzzes yet.</p>
        ) : (
          <ol class="host__order">
            {round.order.map((b, i) => (
              <li
                key={b.playerId}
                class={i === 0 ? 'row is-lead' : 'row'}
                style={{ borderLeftColor: colorForPlayer(state, b.playerId) }}
              >
                <span class="row__label">{b.name}</span>
                {i === 0 ? (
                  <span>first</span>
                ) : (
                  <span class="readout readout--ms">+{b.deltaMs} ms</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {round.lockedOut.length > 0 && (
          <p class="muted" style={{ marginTop: 'var(--s2)' }}>
            {round.lockedOut.length} locked out this question
          </p>
        )}
      </section>

      {!scoreless && <section>
        <p class="eyebrow">Standings</p>
        {state.players.length === 0 ? (
          <p class="muted">No players yet.</p>
        ) : (
          <ol class="host__standings">
            {standings(state).map((r, i) => (
              <li key={r.key} class="row" style={{ borderLeftColor: r.color }}>
                <span class={i < 3 ? `rank rank--${i + 1}` : 'rank'}>
                  {i < 3 ? ['1st', '2nd', '3rd'][i] : ''}
                </span>
                <span class="row__label">{r.label}</span>
                <span class="readout">{r.score}</span>
              </li>
            ))}
          </ol>
        )}
      </section>}

      {!scoreless && <DuelPanel state={state} act={act} />}
      </>}
    </>
  )
}
