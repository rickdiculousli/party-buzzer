import { useState } from 'preact/hooks'
import { GameSettings, OptionField } from './GameSettings.tsx'
import { SetlistPanel } from './SetlistPanel.tsx'
import { REFUSAL_TEXT, colorForPlayer, packLabel, playerName, standings } from './ui.ts'
import { MINIGAME_INFO } from './minigame-info.ts'
import { refuses } from '../shared/legality.ts'
import { MINIGAME_OPTIONS } from '../shared/protocol.ts'
import type { HostAction, MinigameId, ScoreKey, State } from '../shared/protocol.ts'

type Act = (a: HostAction) => void
type Fire = (a: string, data?: unknown) => void

/**
 * The Games tab: every game the night can play, each folded to one line until
 * the host opens it. The quiz is one entry among the minigames, not the frame
 * around them. `name` makes the folds an accordion, so one game's settings are
 * on screen at a time.
 */
export function HostGames({ state, act, fire, play }: { state: State; act: Act; fire: Fire; play: () => void }) {
  const setlist = !!state.setlist

  // Both "how the night runs" buttons send `setSetlist`, and its legality does
  // not read the blocks — so one call answers for the pair, and the empty array
  // here is a placeholder rather than the payload either button will send.
  const howRefusal = refuses(state, { a: 'setSetlist', blocks: [] })

  // The pack picker's own, because the table cannot hold it — see the comment on
  // the control itself. The identity is restated here; the words are not.
  const packBlocked = state.round.phase !== 'IDLE'
  const mode = state.games.find((g) => g.id === state.game.id)?.name

  return (
    <>
      <section>
        <p class="eyebrow">How the night runs</p>
        <div class="host__pick">
          <button
            class={setlist ? 'btn' : 'btn btn--primary'}
            disabled={!!howRefusal}
            onClick={() => act({ a: 'setSetlist', blocks: [] })}
          >
            Direct play
          </button>
          <button
            class={setlist ? 'btn btn--primary' : 'btn'}
            disabled={!!howRefusal}
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
            ? 'Each block carries its own game, quiz or minigame. Switching to direct play discards the setlist.'
            : 'You pick each game and drive the night by hand.'}
        </p>
        {howRefusal && <p class="muted">{REFUSAL_TEXT[howRefusal]}</p>}
      </section>

      {setlist && <SetlistPanel state={state} act={act} fire={fire} />}

      <details name="game" class="host__manage host__game" open={!setlist && !state.minigame}>
        <summary>
          Quiz · {setlist ? 'reading' : `${mode} · ${state.reading?.pack ? packLabel(state, state.reading.pack) : 'no pack'}`}
        </summary>
        {!setlist && <GameSettings state={state} act={act} />}
        {!setlist && state.packs.length > 0 && (
          <section>
            <p class="eyebrow">Pack</p>
            {/* The one control on this panel the table cannot speak for.
                `selectPack` rides the `act` channel, not the host-action one,
                so there is no `HostAction` to hand `refuses` — and borrowing a
                neighbour's action to stand in for it would make the picker
                follow a rule it does not have. The authority is the hub's own
                guard (`server/hub.ts`, "refuse it the way setMode does"), and
                this restates it because it must. What it does not restate is
                the sentence: the reason is the same reason, so the line under
                it comes from the same place as every other one on this desk. */}
            <select
              class="input"
              value={state.reading?.pack ?? ''}
              disabled={packBlocked}
              onChange={(e) => {
                const name = (e.target as HTMLSelectElement).value
                if (name) fire('selectPack', name)
              }}
            >
              <option value="">Choose a pack…</option>
              {state.packs.map((p) => (
                <option key={p} value={p}>{packLabel(state, p)}</option>
              ))}
            </select>
            {packBlocked && <p class="muted">{REFUSAL_TEXT['not-idle']}</p>}
          </section>
        )}
        <Reading state={state} act={act} />
      </details>

      {/* Under a setlist the blocks name the minigames; launching one by hand
          here would step outside the plan the play strip is walking. */}
      {!setlist && (Object.keys(MINIGAME_INFO) as MinigameId[]).map((id) => (
        <details key={id} name="game" class="host__manage host__game" open={state.minigame?.id === id}>
          <summary>{MINIGAME_INFO[id].name}{state.minigame?.id === id && ` · ${state.minigame.phase}`}</summary>
          <Launcher state={state} id={id} act={act} play={play} />
        </details>
      ))}
    </>
  )
}

/** A minigame's options and the button that opens its lobby on every screen. */
function Launcher({ state, id, act, play }: { state: State; id: MinigameId; act: Act; play: () => void }) {
  const [options, setOptions] = useState<Record<string, unknown>>({})
  const refusal = refuses(state, { a: 'prepareMinigame', id, options })
  return (
    <section>
      <div class="host__toggles">
        {MINIGAME_INFO[id].timed || <p class="muted">No time limit — it ends on its own rules.</p>}
        {MINIGAME_OPTIONS[id].map((spec) => (
          <OptionField
            key={spec.key}
            spec={spec}
            value={options[spec.key]}
            disabled={false}
            onChange={(v) => setOptions({ ...options, [spec.key]: v })}
          />
        ))}
      </div>
      <button
        class="btn btn--primary"
        disabled={!!refusal}
        onClick={() => {
          act({ a: 'prepareMinigame', id, options })
          play()
        }}
      >
        {state.minigame?.id === id ? 'Restart' : 'Open'} {MINIGAME_INFO[id].name}
      </button>
      {refusal && <p class="muted">{REFUSAL_TEXT[refusal]}</p>}
    </section>
  )
}

/** Reading behaviour, not the reading itself — true of whichever way the night runs. */
function Reading({ state, act }: { state: State; act: Act }) {
  return (
    <section>
      <p class="eyebrow">Reading</p>
      <div class="host__toggles">
        <label class="field">
          Mirror question text to phones
          <input
            type="checkbox"
            checked={state.mirrorFragments}
            onChange={(e) => act({ a: 'setMirror', on: (e.target as HTMLInputElement).checked })}
          />
        </label>

        {state.packs.length > 0 && (
          <>
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
              Choice time
              <input
                class="input input--num"
                type="number"
                min={5}
                max={120}
                value={state.choiceSec}
                onInput={(e) =>
                  act({ a: 'setChoiceTime', sec: Number((e.target as HTMLInputElement).value) })
                }
              />
              <span class="muted">sec after the options are read, or a closest question</span>
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
                  Buzzers stay open
                  <input
                    class="input input--num"
                    type="number"
                    min={0}
                    max={60}
                    step={0.5}
                    value={state.autoplay.buzzSec}
                    onInput={(e) =>
                      act({
                        ...state.autoplay,
                        a: 'setAutoplay',
                        buzzSec: Number((e.target as HTMLInputElement).value),
                      })
                    }
                  />
                  <span class="muted">sec after the read, then the answer shows</span>
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
                <label class="field">
                  Introductions last
                  <input
                    class="input input--num"
                    type="number"
                    min={0}
                    max={60}
                    step={0.5}
                    value={state.autoplay.introSec}
                    onInput={(e) =>
                      act({
                        ...state.autoplay,
                        a: 'setAutoplay',
                        introSec: Number((e.target as HTMLInputElement).value),
                      })
                    }
                  />
                  <span class="muted">sec between blocks, then the next block begins</span>
                </label>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/**
 * The Players tab: who is here, what they are called, which side they are on
 * and what they have. Reachable from every game, because a rename or a score
 * fix does not wait for the quiz to come back.
 */
export function HostPlayers({ state, act }: { state: State; act: Act }) {
  const step = state.round.value
  return (
    <>
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

      <LobbyTeams state={state} />

      <section>
        <p class="eyebrow">Teams</p>
        {/* The teams grouping and its Add team belong to each other: nothing
            goes between them. */}
        <div class="host__toggles">
          <label class="field">
            Play as teams
            <input
              type="checkbox"
              checked={state.grouping === 'teams'}
              disabled={!!state.minigame}
              onChange={(e) =>
                act({
                  a: 'setGrouping',
                  grouping: (e.target as HTMLInputElement).checked ? 'teams' : 'solo',
                })
              }
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
        <p class="eyebrow">Scores</p>
        <div class="host__scores">
          {standings(state, false).map((r) => (
            <div key={r.key} class="host__score-row" style={{ borderLeftColor: r.color }}>
              <span class="row__label">{r.label}</span>
              <span class="stepper">
                <button class="btn btn--ghost" onClick={() => act({ a: 'setScore', key: r.key, score: r.score - step })}>
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
                <button class="btn btn--ghost" onClick={() => act({ a: 'setScore', key: r.key, score: r.score + step })}>
                  +
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p class="eyebrow">Night</p>
        <p class="muted">The recap remembers every verdict since the room was last cleared.</p>
        <button
          class="btn btn--ghost"
          disabled={!!refuses(state, { a: 'clearNight' })}
          onClick={() => act({ a: 'clearNight' })}
        >
          Clear night
        </button>
      </section>
    </>
  )
}

/**
 * The sides a minigame's lobby has picked on the phones, and who has not
 * picked — the reason Start refuses with `unpicked`. Read-only: the phones own
 * the pick.
 */
export function LobbyTeams({ state }: { state: State }) {
  const session = state.minigame
  if (!session?.lobby || session.phase !== 'ready' || !MINIGAME_INFO[session.id].picksTeams) return null
  const { teams } = session.lobby
  const connected = state.players.filter((p) => p.connected)
  const side = (team: string | undefined) => connected.filter((p) => teams[p.id] === team)
  const rows: [string, typeof connected][] = [
    ['Sun', side('sun')],
    ['Moon', side('moon')],
    ['Not picked', side(undefined)],
  ]
  return (
    <section>
      <p class="eyebrow">{MINIGAME_INFO[session.id].name} sides</p>
      {rows.map(([label, people]) => (
        <div key={label} class="host__minor host__side">
          <span class="row__label">{label}</span>
          {people.length === 0 ? (
            <span class="muted">—</span>
          ) : (
            people.map((p) => (
              <span key={p.id} class="chip" style={{ borderLeft: `3px solid ${colorForPlayer(state, p.id)}` }}>
                {playerName(state, p.id)}
              </span>
            ))
          )}
        </div>
      ))}
    </section>
  )
}
