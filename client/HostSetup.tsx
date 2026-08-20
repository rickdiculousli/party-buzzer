import { GameSettings } from './GameSettings.tsx'
import { SetlistPanel } from './SetlistPanel.tsx'
import type { HostAction, State } from '../shared/protocol.ts'

/**
 * Setup, not play. Folded away so the controls on the host's main panel stay
 * the whole screen. How the night runs comes first, because it decides what
 * the rest of this panel is even allowed to show.
 */
export function HostSetup({
  state,
  act,
  fire,
}: {
  state: State
  act: (a: HostAction) => void
  fire: (a: string, data?: unknown) => void
}) {
  const { round } = state
  const setlist = !!state.setlist

  return (
    <details class="host__manage">
      <summary>
        Setup · {setlist ? 'Setlist' : 'Direct play'} ·{' '}
        {setlist
          ? `${state.setlist!.blocks.length} block${state.setlist!.blocks.length === 1 ? '' : 's'}`
          : state.games.find((g) => g.id === state.game.id)?.name}{' '}
        · {state.players.length} joined
      </summary>

      <section>
        <p class="eyebrow">How the night runs</p>
        <div class="host__pick">
          <button
            class={setlist ? 'btn' : 'btn btn--primary'}
            disabled={round.phase !== 'IDLE'}
            onClick={() => act({ a: 'setSetlist', blocks: [] })}
          >
            Direct play
          </button>
          <button
            class={setlist ? 'btn btn--primary' : 'btn'}
            disabled={round.phase !== 'IDLE'}
            onClick={() =>
              setlist ||
              act({
                a: 'setSetlist',
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
        <SetlistPanel state={state} act={act} fire={fire} />
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
        {/* The teams grouping and its Add team belong to each other; the mirror toggle
            used to sit between them. */}
        <div class="host__toggles">
          <label class="field">
            Teams
            <input
              type="checkbox"
              checked={state.grouping === 'teams'}
              onChange={(e) =>
                act({
                  a: 'setGrouping',
                  grouping: (e.target as HTMLInputElement).checked ? 'teams' : 'solo',
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

        {state.grouping === 'teams' && (
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
              {state.grouping === 'teams' && (
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
  )
}
