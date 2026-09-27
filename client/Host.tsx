import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { REFUSAL_TEXT, colorForPlayer, credits, playerName, standings } from './ui.ts'
import { refuses } from '../shared/legality.ts'
import { DuelPanel } from './DuelPanel.tsx'
import { HostGames, HostPlayers, LobbyTeams } from './HostSetup.tsx'
import { Spoken } from './Spoken.tsx'
import { momentOf, type Moment } from '../shared/wall.ts'
import { isMinigameId, isPenalty } from '../shared/protocol.ts'
import type { HostAction, MinigameId, State } from '../shared/protocol.ts'
import { MINIGAMES } from './minigames.tsx'
import { MINIGAME_CATALOG } from './minigame-info.ts'

/**
 * Three bounded pages rather than one long scroll. Play is the only one that
 * changes with what the room is doing; Games and Players are setup, and each
 * holds one kind of it. The tab lives in the hash so a reload keeps it.
 */
const TABS = ['play', 'games', 'players'] as const
type Tab = (typeof TABS)[number]
const tabFromHash = (): Tab => {
  const h = location.hash.slice(1)
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'play'
}

/** The Play tab while a minigame is up: its clock, its lobby and its way out. */
function MatchDesk({ state, act, now }: {
  state: State
  act: (action: HostAction) => void
  now: () => number
}) {
  const session = state.minigame!
  const game = MINIGAMES[session.id]
  const remaining = session.endsAt ? Math.max(0, Math.ceil((session.endsAt - now()) / 1000)) : session.options.durationSec
  // Closing is what finishes a setlist block that named this minigame.
  const close = <button class="btn" onClick={() => act({ a: 'closeMinigame' })}>Close {game.name}</button>
  return <>
    <section class="bow-host__panel">
      <p class="eyebrow">Match control</p>
      <p>{!game.timed
        ? 'No time limit'
        : session.phase === 'playing' ? `${remaining} seconds left` : `${session.options.durationSec} second match`}</p>
      {session.phase === 'ready' && game.picksTeams && <p class="muted">Players pick sides on their phones.</p>}
      <p class="muted">{session.participants.length} players in this match</p>
      {session.phase === 'ready' && <div class="host__minor">
        <button class="btn btn--major btn--primary" onClick={() => act({ a: 'startMinigame' })}>Start match</button>
        {close}
      </div>}
      {(session.phase === 'countdown' || session.phase === 'playing') && <button class="btn btn--major btn--no" onClick={() => act({ a: 'cancelMinigame' })}>Cancel match</button>}
      {session.phase === 'results' && <>
        <ol class="host__order">
          {session.results?.map((result) => <li key={result.playerId} class="row">
            <span class="row__label">{playerName(state, result.playerId)}</span>
            <span class="readout">+{result.points}</span>
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

/**
 * The host runs the game from a laptop and presses the same five controls all
 * night. Reaching for the mouse between every question is the single biggest
 * drag on pace, so each control has a key and each key is shown on the control.
 */
const KEYS: Record<string, HostAction> = {
  c: { a: 'correct' },
  n: { a: 'next' },
  z: { a: 'undo' },
}

/**
 * What the desk says, as a lookup against the moment.
 *
 * One row per `Moment`, no `default`, so a new moment does not compile
 * until it has said what the judging row and the arm row show while it is up.
 * Rows never rank each other — `momentOf` has already done that. A row reading
 * `f` is fetching its own data, not holding a second opinion about what is on
 * top.
 *
 * Most rows are silent on purpose. The desk shows the round, so a note that
 * names the state the host is looking at is noise; these say only what the
 * screen does not already show. `judge` is therefore null in states where the
 * judging buttons are dead, and that is deliberate.
 *
 * Arm stays pressable everywhere it appears here. Arming a round still on the
 * board is legal, and on a seated pair it is the rematch — `duelOnArm` clears
 * `missed` and hands the buzzers back to both. These notes say what it does,
 * they do not refuse it.
 */
function notesFor(
  m: Moment,
  f: { leader: boolean; scored: boolean },
): { judge: string | null; arm: string | null } {
  // The two ways out of a played round. Arm re-opens the same slot: `next` is
  // what ends the question, advances a setlist block, and drops a duel. The
  // score is already applied either way — Z reverts it, arming does not.
  const played = 'Press N for next round. Arm to redo (score not reverted)'

  switch (m) {
    case 'choice:listening':
      return { judge: 'Everyone picks on their phone once the question is read.', arm: null }
    case 'choice:picking':
      return { judge: 'Close picking to settle it now.', arm: null }
    case 'choice:reveal':
      return { judge: null, arm: played }

    // The desk passes `settled: true`, so this moment does not reach it.
    case 'answer:judging':
      return { judge: null, arm: played }

    case 'answer:locked':
      return {
        // `judgeable`'s remaining two terms, and the only null judge that means
        // "the buttons are live": everywhere else null means "nothing to add".
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

    // A penalty survives into the rebound it caused: the question is still live
    // and the retake is what the buttons are waiting for.
    case 'verdict:penalty':
      return { judge: null, arm: played }

    case 'duel:faceoff':
      return { judge: null, arm: 'Arming rematches the same pair.' }
    case 'duel:dead':
      return { judge: 'Both seated players have missed.', arm: 'Arming puts them both back in.' }
    case 'duel:nominating':
      return { judge: null, arm: null }

    // Arm is disabled through all three, so the arm row has no reader.
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
  const { state, connected, send, now, actionMessage } = useSocket('host')
  const act = (action: HostAction) => send({ t: 'host', action })
  const fire = (a: string, data?: unknown) => send({ t: 'act', act: a, data })
  const { open } = useOpen(state?.round, now)
  const [tab, setTab] = useState<Tab>(tabFromHash)
  // replaceState, not a hash assignment: switching tabs is not a page the back
  // button should walk through.
  const go = (t: Tab) => {
    setTab(t)
    history.replaceState(null, '', `#${t}`)
  }

  // A setlist parked on a minigame block, before the host has opened it. The
  // quiz desk is not what comes next, so its keys stay quiet too.
  const block = state?.setlist?.blocks[state.setlist.at]
  const upNext = !state?.minigame && block && isMinigameId(block.game) ? block.game : null

  // The handler is bound once but needs the live round to judge against.
  const value = useRef(0)
  value.current = state?.round.value ?? 0
  const idleRef = useRef(false)
  idleRef.current = state?.round.phase === 'IDLE'
  // A miss is up and nobody has taken the rebound yet.
  const missedRef = useRef(false)
  missedRef.current = !!state && isPenalty(state.round.award) && state.round.order.length === 0
  const judgeableRef = useRef(false)
  const reopenableRef = useRef(false)
  const keysOffRef = useRef(false)
  // Keys drive the quiz desk, so they only fire while it is the page in front
  // of the host: never behind the Games or Players tab, never under a minigame.
  keysOffRef.current = !!state?.minigame || !!upNext || tab !== 'play'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keysOffRef.current) return
      const el = e.target as HTMLElement | null
      // Never steal a keystroke from something the host is typing into.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // The two entry keys. Space is the next thing to do: correct when there
      // is someone to judge, arm when nothing is armed, and nothing while the
      // buzzers are up — re-arming there would throw the question away.
      if (e.key === ' ') {
        e.preventDefault()
        if (judgeableRef.current) act({ a: 'correct' })
        else if (idleRef.current) act({ a: 'arm' })
        return
      }
      // Shift again on an untaken rebound moves on: the same key that called
      // the miss is the one that gives up on the question.
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
      // C follows whatever is in that slot. During a hold the button there says
      // Reopen, and a host's hand goes to the key it has gone to all night; the
      // action is a no-op unless a rebound is actually being held, so this
      // cannot misfire into anything.
      if (hit.a === 'correct' && reopenableRef.current) {
        act({ a: 'rebound' })
        return
      }
      // Same guard the buttons carry: a scored question cannot be scored again.
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
        ? <MatchDesk state={state} act={act} now={now} />
        : <QuizDesk state={state} act={act} fire={fire} open={open} upNext={upNext}
            judgeableRef={judgeableRef} reopenableRef={reopenableRef} />)}
    </main>
  )
}

/**
 * The Play tab while the quiz is up: the value, where the setlist is, the
 * three keys, the reader's transport and the buzz order. Nothing that is setup.
 */
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
  // Judging waits for LOCKED even though the leader shows early: scoring
  // mid-collection would strand buzzes still in the air, so the buttons stay
  // dead until the window closes. The server enforces the same rule.
  //
  // The host is a desk, not a stage, so both `settled` and `retired` are
  // already true. `<Spoken>` below does type its transcript out — it types on
  // every surface — but the desk passes it no `onSettled` and gates nothing on
  // the reveal, which is what those two flags actually mean: whether this
  // surface is still waiting to act. Only the board waits. `settled: false`
  // would put the desk in `answer:judging` and take the judging buttons away at
  // the one moment they are wanted.
  //
  // The two extra terms are not `answer:locked` restated. A lock with nobody in
  // the order is reachable if a freeze lands mid-window, and there is nothing to
  // judge there.
  //
  // The award term asks "has this question already paid out", which is not
  // `!round.award`: a penalty survives into the rebound it caused (`openRebound`
  // leaves it up so the wall keeps saying why the question is still open), and
  // the retake must stay judgeable with that penalty on State. `isPenalty`, not
  // the sign — a no-penalty wrong stamps points of zero, and `>= 0` reads that
  // as a payoff.
  //
  // Written once and read twice — `notesFor` needs the same fact.
  // `refuses(state, { a: 'correct' }) === 'already-scored'` is exactly it,
  // but only from LOCKED with a leader: the table answers `no-leader` first
  // everywhere else, so asking it here would report the wrong reason.
  const scored = !!round.award && !isPenalty(round.award)
  const moment = momentOf(state, { open, settled: true, retired: true })
  const judgeable = moment === 'answer:locked' && !!leader && !scored
  judgeableRef.current = judgeable

  // A miss is up and the box has not opened its rebound yet. Nobody is
  // answering, so `Correct` has nothing to score — the slot is free, and the
  // host gets the one control they otherwise lack: skipping the beat rather
  // than waiting out `reboundSec`.
  //
  // Asked of the table rather than of `round.held` directly, even though the
  // two are the same fact today. This one does not grey a button, it chooses
  // which button is in the slot at all — so a `rebound` the server would refuse
  // would put a live Reopen in front of the host, which is the same dead click
  // wearing a different hat. It is also what the R key fires.
  // Same fact as the Shift key's: a miss is up and nobody has buzzed on it.
  const missed = isPenalty(round.award) && round.order.length === 0
  const reopenable = !refuses(state, { a: 'rebound' })
  reopenableRef.current = reopenable

  // Both notes come from the moment, and neither asks `refuses`: `judgeable` is
  // strictly narrower than the table, which may not read `settled` or `retired`,
  // so a sentence driven off the table would come back null inside the gap
  // between them. Sentences that are `REFUSAL_TEXT`'s are the ones that really
  // are those codes; the rest are facts about the moment, which the table cannot
  // read and must not claim to.
  const notes = notesFor(moment, { leader: !!leader, scored })
  const judgeReason = judgeable ? null : notes.judge
  const armNote = notes.arm

  // The night is run one of two ways, and the panel only ever offers one of
  // them: freehand, where the host picks the game and the pack; or a setlist,
  // where each block carries its own and the pickers would only fight it.
  const setlist = !!state.setlist
  const block = state.setlist?.blocks[state.setlist.at]
  // Something to read: the block's pack under a setlist, the chosen one without.
  const readable = setlist ? !!block?.pack : !!state.reading?.pack
  const unpaid = state.packCost[(setlist ? block?.pack : state.reading?.pack) ?? ''] ?? 0
  // A mode with no points keeps the three keys and the buzz order, nothing else.
  const scoreless = !!state.games.find((g) => g.id === state.game.id)?.scoreless

  return (
    <>
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
          // The table answers "may the host jump at all" — mid-question, or with
          // no setlist to jump within. It does not answer "is there a block
          // after this one", because that is a fact about this particular `at`
          // rather than about the room, and the table takes the whole action but
          // rules only on the round. So the bound stays here, next to the `+ 1`
          // that produced it.
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
              <button
                class="btn btn--ghost"
                disabled={!!jump || at >= state.setlist.blocks.length}
                onClick={() => act({ a: 'setlistJump', at: at + 1 })}
              >
                Skip block
              </button>
              {/* A `title` on a disabled button never fires — the control eats
                  its own pointer events — so the reason is printed. This strip
                  is one flex row of chips, so it is a `span` here rather than
                  the `p.muted` the two stacked panels use. */}
              {jump && <span class="muted">{REFUSAL_TEXT[jump]}</span>}
            </div>
          )
        })()}
        {upNext ? (
          <div class="host__controls">
            <button
              class="btn btn--major btn--primary"
              onClick={() => act({ a: 'prepareMinigame', id: upNext, options: block?.options ?? {} })}
            >
              Open {MINIGAMES[upNext].name}
            </button>
          </div>
        ) : <>
        {/* Who the keys below act on, big enough to read from across the desk.
            The leader shows as soon as they are in, dimmed until judging opens. */}
        <p
          class={judgeable ? 'host__up is-judging' : 'host__up'}
          style={leader ? { borderLeftColor: colorForPlayer(state, leader.playerId) } : undefined}
        >
          <span class="eyebrow">{leader ? 'Answering' : open ? 'Buzzers open' : 'Nobody answering'}</span>
          <span class="host__up-name">{leader?.name ?? '—'}</span>
        </p>
        <div class="host__controls">
          {/* On an untaken rebound Arm is live again: it is how the host gives
              up on the question, and Shift is its key there. */}
          <button class="btn btn--major btn--primary" onClick={() => act({ a: 'arm' })} disabled={open && !missed}>
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
        {/* Notes sit right under the keys they explain: a `title` on a
            disabled button is never shown — the control suppresses the
            pointer events that would trigger it. */}
        {judgeReason && <p class="muted host__note">{judgeReason}</p>}
        {armNote && !scoreless && <p class="muted host__note">{armNote}</p>}
        <div class="host__minor" style={{ marginTop: 'var(--s3)' }}>
          {!scoreless && <button class="btn" onClick={() => act({ a: 'wrong', neg: 0 })} disabled={!judgeable}>
            Wrong, no penalty
          </button>}
          {/* Arm already starts a fresh question; next only matters where it
              advances something. */}
          {(!scoreless || setlist) && <button class="btn" onClick={() => act({ a: 'next' })}>
            Next question<span class="key">N</span>
          </button>}
          {moment === 'choice:picking' && (
            <button class="btn" onClick={() => fire('closeChoice')}>
              Close picking
            </button>
          )}
        </div>

        {/* What the locked-in player said, as the judge heard it. The verdict
            itself is the award above; this is the evidence for the undo. */}
        {round.spoken && (
          <Spoken
            prefix="host"
            transcript={round.spoken.transcript}
            hit={round.spoken.hit}
            tail={` — ${round.spoken.name}`}
          />
        )}

        {/* The transport only. Which pack, and how the reading behaves, are
            setup and live below with the rest of it — what a host needs during
            a question is play, pause and where we are. */}
        {state.packs.length > 0 && !scoreless && (
          <div class="host__reader">
            {state.reading?.rendering ? (
              <span class="chip chip--data">
                Rendering {state.reading.rendering.done}/{state.reading.rendering.total}
              </span>
            ) : (
              <>
                {state.readingActive ? (
                  <button class="btn" onClick={() => fire(state.reading?.paused ? 'resumeRead' : 'pauseRead')}>
                    {state.reading?.paused ? 'Resume' : 'Pause'}
                  </button>
                ) : (
                  <button class="btn btn--primary" disabled={!readable} onClick={() => fire('read')}>
                    Read
                  </button>
                )}
                {!state.readingActive && unpaid > 0 && (
                  <span class="chip chip--data">~{credits(unpaid)} credits to read</span>
                )}
                <button class="btn btn--ghost" onClick={() => fire('stopRead')} disabled={!state.reading}>
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
                {/* Autoplay changes what the room does without anyone touching
                    it, so it is visible from the play surface, not only where
                    it was switched on. */}
                {state.autoplay.on && <span class="chip chip--armed">Autoplay</span>}
              </>
            )}
          </div>
        )}
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
                {/* "first" is a placing, not a duration — warm, not cyan. */}
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
