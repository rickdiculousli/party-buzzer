import { useEffect, useRef } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { REFUSAL_TEXT, colorForPlayer, standings } from './ui.ts'
import { refuses } from '../shared/legality.ts'
import { DuelPanel } from './DuelPanel.tsx'
import { HostSetup } from './HostSetup.tsx'
import { Spoken } from './Spoken.tsx'
import { momentOf, type Moment } from '../shared/wall.ts'
import { isPenalty } from '../shared/protocol.ts'
import type { HostAction, ScoreKey } from '../shared/protocol.ts'

/**
 * The host runs the game from a laptop and presses the same five controls all
 * night. Reaching for the mouse between every question is the single biggest
 * drag on pace, so each control has a key and each key is shown on the control.
 */
const KEYS: Record<string, HostAction> = {
  ' ': { a: 'arm' },
  c: { a: 'correct' },
  n: { a: 'next' },
  z: { a: 'undo' },
}

/**
 * What the desk says, as a lookup against the moment.
 *
 * One row per `Moment`, no `default`, so a fourteenth moment does not compile
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
  f: { leader: boolean; scored: boolean; setlist: boolean },
): { judge: string | null; arm: string | null } {
  // `advanceSetlist` runs off `next` and nothing else, so any other way out of a
  // played round leaves the block a question short. The only consequence here
  // the wall does not show, which is why it is the one that always speaks.
  const skips = f.setlist ? 'Arming skips this one — the block will not count it.' : null

  switch (m) {
    // The desk passes `settled: true`, so this moment does not reach it.
    case 'answer:judging':
      return { judge: null, arm: skips }

    case 'answer:locked':
      return {
        // `judgeable`'s remaining two terms, and the only null judge that means
        // "the buttons are live": everywhere else null means "nothing to add".
        judge: !f.leader ? 'The lock caught no buzz.' : f.scored ? REFUSAL_TEXT['already-scored'] : null,
        arm: skips,
      }

    case 'verdict:hold':
      return {
        judge: 'Reopen puts the question back to the room.',
        arm: 'Arming drops the rebound.',
      }

    case 'verdict:award':
      return { judge: REFUSAL_TEXT['already-scored'], arm: skips }

    // A penalty survives into the rebound it caused: the question is still live
    // and the retake is what the buttons are waiting for.
    case 'verdict:penalty':
      return { judge: null, arm: skips }

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

    case 'idle:ready':
    case 'idle:welcome':
      return { judge: null, arm: null }
  }
}

export function Host() {
  const { state, connected, send, now } = useSocket('host')
  const act = (action: HostAction) => send({ t: 'host', action })
  const fire = (a: string, data?: unknown) => send({ t: 'act', act: a, data })
  const { open } = useOpen(state?.round, now)

  // The handler is bound once but needs the live round to judge against.
  const value = useRef(0)
  value.current = state?.round.value ?? 0
  const judgeableRef = useRef(false)
  const reopenableRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Never steal a keystroke from something the host is typing into.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

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
  const reopenable = !refuses(state, { a: 'rebound' })
  reopenableRef.current = reopenable

  // Both notes come from the moment, and neither asks `refuses`: `judgeable` is
  // strictly narrower than the table, which may not read `settled` or `retired`,
  // so a sentence driven off the table would come back null inside the gap
  // between them. Sentences that are `REFUSAL_TEXT`'s are the ones that really
  // are those codes; the rest are facts about the moment, which the table cannot
  // read and must not claim to.
  const notes = notesFor(moment, { leader: !!leader, scored, setlist: !!state.setlist })
  const judgeReason = judgeable ? null : notes.judge
  const armNote = notes.arm

  // The night is run one of two ways, and the panel only ever offers one of
  // them: freehand, where the host picks the game and the pack; or a setlist,
  // where each block carries its own and the pickers would only fight it.
  const setlist = !!state.setlist
  const block = state.setlist?.blocks[state.setlist.at]
  // Something to read: the block's pack under a setlist, the chosen one without.
  const readable = setlist ? !!block?.pack : !!state.reading?.pack

  return (
    <main class="host">
      <div class="host__bar">
        <span class="host__title">Host</span>
        <span class="lamp">
          <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span class="chip">{round.phase}</span>

        {state.game.id === 'quizbowl' &&
          Number(state.game.options.powerAfterFragment ?? 0) > 0 &&
          (() => {
            const ms = state.game.moduleState as { powerEndsAt?: number } | undefined
            const ended = ms?.powerEndsAt !== undefined
            return (
              <span class={ended ? 'chip chip--barred' : 'chip chip--data'}>
                {ended ? 'Power ended' : 'Power open'}
              </span>
            )
          })()}

        <label class="field">
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
        </label>

        <span class="host__spacer" />

        <button class="btn btn--ghost" onClick={() => act({ a: 'undo' })}>
          Undo<span class="key">Z</span>
        </button>
      </div>

      <section>
        {state.setlist && (() => {
          const at = state.setlist.at
          const block = state.setlist.blocks[at]
          const name = state.games.find((g) => g.id === block?.game)?.name
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
                  <span class="chip">Q{state.setlist.done + 1} of {block.count}</span>
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
        <div class="host__controls">
          <button class="btn btn--major btn--primary" onClick={() => act({ a: 'arm' })} disabled={open}>
            {open ? 'Buzzers open' : 'Arm'}<span class="key">Space</span>
          </button>
          {reopenable ? (
            <button class="btn btn--major btn--go" onClick={() => act({ a: 'rebound' })}>
              Reopen now<span class="key">R</span>
            </button>
          ) : (
            <button class="btn btn--major btn--go" onClick={() => act({ a: 'correct' })} disabled={!judgeable}>
              Correct +{round.value}<span class="key">C</span>
            </button>
          )}
          <button
            class="btn btn--major btn--no"
            onClick={() => act({ a: 'wrong', neg: round.value })}
            disabled={!judgeable}
          >
            Wrong −{round.value}<span class="key">W</span>
          </button>
        </div>
        <div class="host__minor" style={{ marginTop: 'var(--s3)' }}>
          <button class="btn" onClick={() => act({ a: 'wrong', neg: 0 })} disabled={!judgeable}>
            Wrong, no penalty
          </button>
          <button class="btn" onClick={() => act({ a: 'next' })}>
            Next question<span class="key">N</span>
          </button>
        </div>
        {/* Under the row rather than on the buttons: these three are the most
            pressed controls on the desk, and a `title` on a disabled button is
            never shown — the control suppresses the pointer events that would
            trigger it. */}
        {judgeReason && <p class="muted">{judgeReason}</p>}
        {armNote && <p class="muted">{armNote}</p>}

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
        {state.packs.length > 0 && (
          <div class="host__reader">
            {state.reading?.rendering ? (
              <span class="chip chip--data">
                Rendering {state.reading.rendering.done}/{state.reading.rendering.total}
              </span>
            ) : (
              <>
                {state.reading?.running ? (
                  <button class="btn" onClick={() => fire(state.reading!.paused ? 'resumeRead' : 'pauseRead')}>
                    {state.reading.paused ? 'Resume' : 'Pause'}
                  </button>
                ) : (
                  <button class="btn btn--primary" disabled={!readable} onClick={() => fire('read')}>
                    Read
                  </button>
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
      </section>

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

      <DuelPanel state={state} act={act} />

      <section>
        <p class="eyebrow">Scores</p>
        <div class="host__scores">
          {standings(state, false).map((r) => (
            <div key={r.key} class="host__score-row" style={{ borderLeftColor: r.color }}>
              <span class="row__label">{r.label}</span>
              <span class="stepper">
                <button
                  class="btn btn--ghost"
                  onClick={() => act({ a: 'setScore', key: r.key, score: r.score - round.value })}
                >
                  −
                </button>
                <input
                  class="input input--num"
                  type="number"
                  value={r.score}
                  onChange={(e) =>
                    act({
                      a: 'setScore',
                      key: r.key as ScoreKey,
                      score: Number((e.target as HTMLInputElement).value),
                    })
                  }
                />
                <button
                  class="btn btn--ghost"
                  onClick={() => act({ a: 'setScore', key: r.key, score: r.score + round.value })}
                >
                  +
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <HostSetup state={state} act={act} fire={fire} />
    </main>
  )
}
