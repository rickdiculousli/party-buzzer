import { useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { GameInfo, HostAction, OptionSpec, State } from '../shared/protocol.ts'
import { REFUSAL_TEXT } from './ui.ts'
import { refuses } from '../shared/legality.ts'

/**
 * The desk grammar: one row per control. The label is a sentence, the control
 * sits in the same column on every fold, and the reason (or the unit) is the
 * dim line beneath. A `<div>` rather than a `<label>` around the whole row,
 * because a label's click lands on its first button — the stepper's minus.
 */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ComponentChildren }) {
  return (
    <div class="field">
      <label class="field__label" for={id}>{label}</label>
      {children}
      {hint && <span class="field__hint">{hint}</span>}
    </div>
  )
}

export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <span class="stepper">
        <button class="btn btn--ghost" disabled={disabled || value - step < min} onClick={() => onChange(value - step)}>
          −
        </button>
        <input
          id={id}
          class="input input--num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        />
        <button class="btn btn--ghost" disabled={disabled || value + step > max} onClick={() => onChange(value + step)}>
          +
        </button>
      </span>
    </Field>
  )
}

export function ToggleField({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <input
        id={id}
        class="toggle"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
    </Field>
  )
}

export function ChoiceField({
  label,
  hint,
  value,
  choices,
  disabled = false,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  choices: { value: string; label: string }[]
  disabled?: boolean
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <select
        id={id}
        class="input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </Field>
  )
}

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
      <NumberField
        label={spec.label}
        hint={spec.hint}
        value={Number(value ?? spec.default)}
        min={spec.min}
        max={spec.max}
        disabled={disabled}
        onChange={onChange}
      />
    )
  }
  if (spec.kind === 'bool') {
    return (
      <ToggleField
        label={spec.label}
        hint={spec.hint}
        checked={Boolean(value ?? spec.default)}
        disabled={disabled}
        onChange={onChange}
      />
    )
  }
  return (
    <ChoiceField
      label={spec.label}
      hint={spec.hint}
      value={String(value ?? spec.default)}
      choices={spec.choices.map((c) => ({ value: c, label: c }))}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

export function defaultsOf(info: Pick<GameInfo, 'options'>): Record<string, unknown> {
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
  // Every control here sends a `setMode`, and its legality reads the id only to
  // check the catalog knows it — which a `<select>` built from that same catalog
  // cannot get wrong. So the current mode stands in, one call answers for the
  // picker and every option under it, and this form stops holding an opinion
  // about the round that the server also holds.
  const refusal = refuses(state, { a: 'setMode', id: state.game.id, options: state.game.options })
  const current = state.games.find((g) => g.id === state.game.id)
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
      <p class="eyebrow">Mode</p>
      <ChoiceField
        label="Mode"
        value={state.game.id}
        choices={state.games.map((g) => ({ value: g.id, label: g.name }))}
        disabled={!!refusal}
        onChange={pick}
      />
      {current.options.map((spec) => (
        <OptionField
          key={spec.key}
          spec={spec}
          value={state.game.options[spec.key]}
          disabled={!!refusal}
          onChange={(v) =>
            act({ a: 'setMode', id: state.game.id, options: { ...state.game.options, [spec.key]: v } })
          }
        />
      ))}
      {refusal && <p class="muted">{REFUSAL_TEXT[refusal]}</p>}
    </section>
  )
}
