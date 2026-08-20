import type { GameInfo, HostAction, OptionSpec, State } from '../shared/protocol.ts'
import { modeSurfaces } from './modes/index.ts'

export function OptionField({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: OptionSpec
  value: unknown
  disabled: boolean
  onChange: (v: unknown) => void
}) {
  if (spec.kind === 'int') {
    return (
      <label class="field">
        {spec.label}
        <input
          class="input input--num"
          type="number"
          min={spec.min}
          max={spec.max}
          value={Number(value ?? spec.default)}
          disabled={disabled}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        />
      </label>
    )
  }
  if (spec.kind === 'bool') {
    return (
      <label class="field">
        {spec.label}
        <input
          type="checkbox"
          checked={Boolean(value ?? spec.default)}
          disabled={disabled}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
      </label>
    )
  }
  return (
    <label class="field">
      {spec.label}
      <select
        class="input"
        value={String(value ?? spec.default)}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {spec.choices.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  )
}

export function defaultsOf(info: GameInfo): Record<string, unknown> {
  return Object.fromEntries(info.options.map((o) => [o.key, o.default]))
}

/**
 * The one settings form every mode gets for free: it renders itself from the
 * option schema in the state payload. Modes are fixed per session, so the
 * server refuses changes mid-question — the form disables itself to match.
 */
export function GameSettings({
  state,
  act,
}: {
  state: State
  act: (action: HostAction) => void
}) {
  const idle = state.round.phase === 'IDLE'
  const current = state.games.find((g) => g.id === state.game.id)
  const Override = modeSurfaces[state.game.id]?.Settings
  if (Override) return <Override state={state} act={act} />
  if (!current) return null

  const pick = (id: string) => {
    if (id === state.game.id) return
    const next = state.games.find((g) => g.id === id)
    if (!next) return
    const dirty = Object.values(state.scores).some((s) => s !== 0)
    if (dirty && !confirm(`Switch to ${next.name}? Scores and the round reset.`)) return
    act({ a: 'setMode', id, options: defaultsOf(next) })
  }

  return (
    <section>
      <p class="eyebrow">Game</p>
      <label class="field">
        Mode
        <select
          class="input"
          value={state.game.id}
          disabled={!idle}
          onChange={(e) => pick((e.target as HTMLSelectElement).value)}
        >
          {state.games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      {current.options.map((spec) => (
        <OptionField
          key={spec.key}
          spec={spec}
          value={state.game.options[spec.key]}
          disabled={!idle}
          onChange={(v) =>
            act({ a: 'setMode', id: state.game.id, options: { ...state.game.options, [spec.key]: v } })
          }
        />
      ))}
      {!idle && <p class="muted">Game settings unlock between questions.</p>}
    </section>
  )
}
