import { useEffect, useRef } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { colorForPlayer, standings } from './ui.ts'
import { GameSettings } from './GameSettings.tsx'
import { DuelPanel } from './DuelPanel.tsx'
import { FlowPanel } from './FlowPanel.tsx'
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

export function Host() {
  const { state, connected, send, now } = useSocket('host')
  const act = (action: HostAction) => send({ t: 'host', action })
  const fire = (a: string, data?: unknown) => send({ t: 'act', act: a, data })
  const { open } = useOpen(state?.round, now)

  // The handler is bound once but needs the live round to judge against.
  const value = useRef(0)
  value.current = state?.round.value ?? 0
  const judgeableRef = useRef(false)

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
      const hit = KEYS[key]
      if (!hit) return
      e.preventDefault()
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
  const judgeable = round.phase === 'LOCKED' && !!leader && !round.award
  judgeableRef.current = judgeable

  // The night is run one of two ways, and the panel only ever offers one of
  // them: freehand, where the host picks the game and the pack; or a setlist,
  // where each block carries its own and the pickers would only fight it.
  const setlist = !!state.flow
  const block = state.flow?.blocks[state.flow.at]
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
        {state.flow && (() => {
          const at = state.flow.at
          const block = state.flow.blocks[at]
          const name = state.games.find((g) => g.id === block?.game)?.name
          return (
            <div class="host__flow">
              {block ? (
                <>
                  <span class="chip chip--data">Block {at + 1} of {state.flow.blocks.length}</span>
                  <span class="row__label">{name}</span>
                  <span class="chip">Q{state.flow.done + 1} of {block.count}</span>
                  {block.duel && <span class="chip chip--armed">duel</span>}
                </>
              ) : (
                <span class="chip chip--data">Flow complete</span>
              )}
              <span class="host__spacer" />
              <button
                class="btn btn--ghost"
                disabled={round.phase !== 'IDLE' || at >= state.flow.blocks.length}
                onClick={() => act({ a: 'flowJump', at: at + 1 })}
              >
                Skip block
              </button>
            </div>
          )
        })()}
        <div class="host__controls">
          <button class="btn btn--major btn--primary" onClick={() => act({ a: 'arm' })} disabled={open}>
            {open ? 'Buzzers open' : 'Arm'}<span class="key">Space</span>
          </button>
          <button class="btn btn--major btn--go" onClick={() => act({ a: 'correct' })} disabled={!judgeable}>
            Correct +{round.value}<span class="key">C</span>
          </button>
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

        {/* What the locked-in player said, as the judge heard it. The verdict
            itself is the award above; this is the evidence for the undo. */}
        {round.spoken && (
          <p class={round.spoken.hit ? 'host__spoken is-hit' : 'host__spoken is-miss'}>
            “{round.spoken.transcript || 'no answer'}” — {round.spoken.name}
          </p>
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

      {/* Setup, not play. Folded away so the controls above stay the whole
          screen. How the night runs comes first, because it decides what the
          rest of this panel is even allowed to show. */}
      <details class="host__manage">
        <summary>
          Setup · {setlist ? 'Setlist' : 'Direct play'} ·{' '}
          {setlist
            ? `${state.flow!.blocks.length} block${state.flow!.blocks.length === 1 ? '' : 's'}`
            : state.games.find((g) => g.id === state.game.id)?.name}{' '}
          · {state.players.length} joined
        </summary>

        <section>
          <p class="eyebrow">How the night runs</p>
          <div class="host__pick">
            <button
              class={setlist ? 'btn' : 'btn btn--primary'}
              disabled={round.phase !== 'IDLE'}
              onClick={() => act({ a: 'setFlow', blocks: [] })}
            >
              Direct play
            </button>
            <button
              class={setlist ? 'btn btn--primary' : 'btn'}
              disabled={round.phase !== 'IDLE'}
              onClick={() =>
                setlist ||
                act({
                  a: 'setFlow',
                  blocks: [
                    {
                      game: state.game.id,
                      options: state.game.options,
                      count: 5,
                      pack: state.reading?.pack ?? state.packs[0],
                    },
                  ],
                })
              }
            >
              Setlist
            </button>
          </div>
          <p class="muted">
            {setlist
              ? 'Each block carries its own game and pack. Switching to direct play discards the setlist.'
              : 'You pick the game and the pack, and drive the night by hand.'}
          </p>
        </section>

        {setlist ? (
          <FlowPanel state={state} act={act} fire={fire} />
        ) : (
          <>
            <GameSettings state={state} act={act} />
            {state.packs.length > 0 && (
              <section>
                <p class="eyebrow">Pack</p>
                <select
                  class="input"
                  value={state.reading?.pack ?? ''}
                  disabled={round.phase !== 'IDLE'}
                  onChange={(e) => {
                    const name = (e.target as HTMLSelectElement).value
                    if (name) fire('selectPack', name)
                  }}
                >
                  <option value="">Choose a pack…</option>
                  {state.packs.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </section>
            )}
          </>
        )}

        {/* Reading behaviour, not the reading itself — true of whichever way
            the night is running, so it sits outside the choice above. */}
        {state.packs.length > 0 && (
          <section>
            <p class="eyebrow">Reading</p>
            <div class="host__toggles">
              <label class="field">
                Answer window
                <input
                  class="input input--num"
                  type="number"
                  min={0}
                  max={120}
                  value={state.answerWindowSec}
                  onInput={(e) =>
                    act({ a: 'setAnswerWindow', sec: Number((e.target as HTMLInputElement).value) })
                  }
                />
                <span class="muted">sec · 0 = you end a stall by hand</span>
              </label>

              <label class="field">
                Autoplay
                <input
                  type="checkbox"
                  checked={state.autoplay.on}
                  onChange={(e) =>
                    act({ ...state.autoplay, a: 'setAutoplay', on: (e.target as HTMLInputElement).checked })
                  }
                />
                <span class="muted">the reader presses N for you</span>
              </label>

              {state.autoplay.on && (
                <>
                  <label class="field">
                    Answer sits for
                    <input
                      class="input input--num"
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={state.autoplay.nextSec}
                      onInput={(e) =>
                        act({
                          ...state.autoplay,
                          a: 'setAutoplay',
                          nextSec: Number((e.target as HTMLInputElement).value),
                        })
                      }
                    />
                    <span class="muted">sec, then the next question arms</span>
                  </label>
                  <label class="field">
                    Rebound pause
                    <input
                      class="input input--num"
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={state.autoplay.reboundSec}
                      onInput={(e) =>
                        act({
                          ...state.autoplay,
                          a: 'setAutoplay',
                          reboundSec: Number((e.target as HTMLInputElement).value),
                        })
                      }
                    />
                    <span class="muted">sec after a wrong answer, before the clue resumes</span>
                  </label>
                </>
              )}
            </div>
          </section>
        )}

        <section>
          <p class="eyebrow">Room</p>
          {/* Teams mode and its Add team belong to each other; the mirror toggle
              used to sit between them. */}
          <div class="host__toggles">
            <label class="field">
              Teams mode
              <input
                type="checkbox"
                checked={state.mode === 'teams'}
                onChange={(e) =>
                  act({
                    a: 'setMode',
                    mode: (e.target as HTMLInputElement).checked ? 'teams' : 'solo',
                  })
                }
              />
            </label>
            <label class="field">
              Mirror question text to phones
              <input
                type="checkbox"
                checked={state.mirrorFragments}
                onChange={(e) => act({ a: 'setMirror', on: (e.target as HTMLInputElement).checked })}
              />
            </label>
          </div>

          {state.mode === 'teams' && (
            <div class="host__minor">
              {state.teams.map((t) => (
                <span key={t.id} class="chip" style={{ borderLeft: `3px solid ${t.color}` }}>
                  {t.name}
                </span>
              ))}
              <button
                class="btn"
                onClick={() =>
                  act({
                    a: 'addTeam',
                    name: `Team ${state.teams.length + 1}`,
                    color: `var(--id-${(state.teams.length % 6) + 1})`,
                  })
                }
              >
                Add team
              </button>
            </div>
          )}
        </section>

        <section>
          <p class="eyebrow">Players</p>
          {state.players.length === 0 ? (
            <p class="muted">Nobody has joined yet. The QR on the board is how they get in.</p>
          ) : (
            state.players.map((p) => (
              <div key={p.id} class="host__player">
                <span class={p.connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
                <input
                  class="input"
                  value={p.name}
                  onChange={(e) =>
                    act({ a: 'rename', playerId: p.id, name: (e.target as HTMLInputElement).value })
                  }
                />
                {state.mode === 'teams' && (
                  <select
                    class="input"
                    value={p.teamId ?? ''}
                    onChange={(e) =>
                      act({
                        a: 'assign',
                        playerId: p.id,
                        teamId: (e.target as HTMLSelectElement).value || undefined,
                      })
                    }
                  >
                    <option value="">No team</option>
                    {state.teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                <button class="btn btn--ghost" onClick={() => act({ a: 'kick', playerId: p.id })}>
                  Remove
                </button>
              </div>
            ))
          )}
        </section>
      </details>
    </main>
  )
}
