import { useState } from 'preact/hooks'
import { ChoiceField, GameSettings, NumberField, OptionField, ToggleField } from './GameSettings.tsx'
import { SetlistPanel } from './SetlistPanel.tsx'
import { REFUSAL_TEXT, colorForPlayer, packLabel, playerName, standings } from './ui.ts'
import { MINIGAME_INFO } from './minigame-info.ts'
import { refuses } from '../shared/legality.ts'
import { MINIGAME_OPTIONS } from '../shared/protocol.ts'
import type { HostAction, MinigameId, ScoreKey, State } from '../shared/protocol.ts'

type Act = (a: HostAction) => void
type Fire = (a: string, data?: unknown) => void

export function HostGames({ state, act, fire, play }: { state: State; act: Act; fire: Fire; play: () => void }) {
  const setlist = !!state.setlist

  const howRefusal = refuses(state, { a: 'setSetlist', blocks: [] })

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
            <ChoiceField
              label="Pack"
              value={state.reading?.pack ?? ''}
              choices={[
                { value: '', label: 'Choose a pack…' },
                ...state.packs.map((p) => ({ value: p, label: packLabel(state, p) })),
              ]}
              disabled={packBlocked}
              onChange={(name) => name && fire('selectPack', name)}
            />
            {packBlocked && <p class="muted">{REFUSAL_TEXT['not-idle']}</p>}
          </section>
        )}
        <Reading state={state} act={act} />
      </details>

      {!setlist && (Object.keys(MINIGAME_INFO) as MinigameId[]).map((id) => (
        <details key={id} name="game" class="host__manage host__game" open={state.minigame?.id === id}>
          <summary>{MINIGAME_INFO[id].name}{state.minigame?.id === id && ` · ${state.minigame.phase}`}</summary>
          <Launcher state={state} id={id} act={act} play={play} />
        </details>
      ))}
    </>
  )
}

function Launcher({ state, id, act, play }: { state: State; id: MinigameId; act: Act; play: () => void }) {
  const [options, setOptions] = useState<Record<string, unknown>>({})
  const refusal = refuses(state, { a: 'prepareMinigame', id, options })
  return (
    <section>
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

function Reading({ state, act }: { state: State; act: Act }) {
  const autoplay = (patch: Partial<typeof state.autoplay>) => act({ ...state.autoplay, ...patch, a: 'setAutoplay' })
  return (
    <section>
      <p class="eyebrow">Reading</p>
      <ToggleField
        label="Mirror question text to phones"
        hint="Phones see the words as they are read"
        checked={state.mirrorFragments}
        onChange={(on) => act({ a: 'setMirror', on })}
      />

      {state.packs.length > 0 && (
        <>
          <NumberField
            label="Answer window"
            hint="Seconds; 0 means you end a stall by hand"
            value={state.answerWindowSec}
            min={0}
            max={120}
            onChange={(sec) => act({ a: 'setAnswerWindow', sec })}
          />
          <NumberField
            label="Choice time"
            hint="Seconds after the options are read, or a closest question"
            value={state.choiceSec}
            min={5}
            max={120}
            onChange={(sec) => act({ a: 'setChoiceTime', sec })}
          />
          <NumberField
            label="Reveal time"
            hint="Seconds for a picture to sharpen; an early buzz pays up to double"
            value={state.revealSec}
            min={3}
            max={60}
            onChange={(sec) => act({ a: 'setRevealTime', sec })}
          />
          <ToggleField
            label="Autoplay"
            hint="The reader presses N for you"
            checked={state.autoplay.on}
            onChange={(on) => autoplay({ on })}
          />

          {state.autoplay.on && (
            <>
              <NumberField
                label="Answer sits for"
                hint="Seconds, then the next question arms"
                value={state.autoplay.nextSec}
                min={0}
                max={60}
                step={0.5}
                onChange={(nextSec) => autoplay({ nextSec })}
              />
              <NumberField
                label="Buzzers stay open"
                hint="Seconds after the read, then the answer shows"
                value={state.autoplay.buzzSec}
                min={0}
                max={60}
                step={0.5}
                onChange={(buzzSec) => autoplay({ buzzSec })}
              />
              <NumberField
                label="Rebound pause"
                hint="Seconds after a wrong answer, before the clue resumes"
                value={state.autoplay.reboundSec}
                min={0}
                max={60}
                step={0.5}
                onChange={(reboundSec) => autoplay({ reboundSec })}
              />
              <NumberField
                label="Introductions last"
                hint="Seconds between blocks, then the next block begins"
                value={state.autoplay.introSec}
                min={0}
                max={60}
                step={0.5}
                onChange={(introSec) => autoplay({ introSec })}
              />
            </>
          )}
        </>
      )}
    </section>
  )
}

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
