import { useState } from 'preact/hooks'
import type { FlowBlock, HostAction, State } from '../shared/protocol.ts'
import { OptionField, defaultsOf } from './GameSettings.tsx'

/**
 * The setlist builder. Setup, so it lives folded away in the host's manage
 * details; the position the room is at lives unfolded, up beside the arm
 * controls, because a host who has to open a disclosure to learn what round it
 * is will not do it.
 *
 * Every edit sends the whole array. Add, move, remove and edit are all array
 * work the client can do, and one action means one undo step for one edit.
 */
export function FlowPanel({
  state,
  act,
  fire,
}: {
  state: State
  act: (action: HostAction) => void
  fire: (name: string, data?: unknown) => void
}) {
  const [saveAs, setSaveAs] = useState('')
  const blocks = state.flow?.blocks ?? []
  const idle = state.round.phase === 'IDLE'

  const write = (next: FlowBlock[]) => act({ a: 'setFlow', blocks: next })
  const edit = (i: number, patch: Partial<FlowBlock>) =>
    write(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const move = (i: number, by: number) => {
    const next = [...blocks]
    const to = i + by
    if (to < 0 || to >= next.length) return
    ;[next[i], next[to]] = [next[to], next[i]]
    write(next)
  }

  const add = () => {
    const game = state.games[0]
    if (!game) return
    write([
      ...blocks,
      {
        game: game.id,
        options: defaultsOf(game),
        count: 5,
      },
    ])
  }

  return (
    <section class="flow">
      <p class="eyebrow">Flow</p>

      <div class="flow__io">
        <select
          class="input"
          value=""
          disabled={!idle || state.flows.length === 0}
          onChange={(e) => {
            const name = (e.target as HTMLSelectElement).value
            if (name) fire('loadFlow', name)
            ;(e.target as HTMLSelectElement).value = ''
          }}
        >
          <option value="">Load a flow…</option>
          {state.flows.map((f) => (
            <option key={f} value={f}>{f.replace(/\.json$/, '')}</option>
          ))}
        </select>
        <input
          class="input"
          placeholder="Save as…"
          value={saveAs}
          onInput={(e) => setSaveAs((e.target as HTMLInputElement).value)}
        />
        <button
          class="btn"
          disabled={!saveAs.trim() || blocks.length === 0}
          onClick={() => {
            fire('saveFlow', saveAs.trim())
            setSaveAs('')
          }}
        >
          Save
        </button>
      </div>

      {blocks.length === 0 ? (
        <p class="muted">No flow. The host drives freehand — add a block to plan the night.</p>
      ) : (
        blocks.map((b, i) => {
          const info = state.games.find((g) => g.id === b.game)
          return (
            <div key={i} class={i === state.flow?.at ? 'flow__block is-here' : 'flow__block'}>
              <span class="flow__n">{i + 1}</span>
              <select
                class="input"
                value={b.game}
                disabled={!idle}
                onChange={(e) => {
                  const id = (e.target as HTMLSelectElement).value
                  const next = state.games.find((g) => g.id === id)
                  if (!next) return
                  edit(i, {
                    game: id,
                    options: defaultsOf(next),
                  })
                }}
              >
                {state.games.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>

              <label class="field">
                Questions
                <input
                  class="input input--num"
                  type="number"
                  min={1}
                  max={99}
                  value={b.count}
                  disabled={!idle}
                  onChange={(e) => edit(i, { count: Number((e.target as HTMLInputElement).value) })}
                />
              </label>

              <label class="field">
                Value
                <input
                  class="input input--num"
                  type="number"
                  step={100}
                  placeholder="—"
                  value={b.value ?? ''}
                  disabled={!idle}
                  onChange={(e) => {
                    const raw = (e.target as HTMLInputElement).value
                    edit(i, { value: raw === '' ? undefined : Number(raw) })
                  }}
                />
              </label>

              <label class="field">
                Duel
                <select
                  class="input"
                  value={b.duel ?? ''}
                  disabled={!idle}
                  onChange={(e) =>
                    edit(i, { duel: (e.target as HTMLSelectElement).value || undefined })
                  }
                >
                  <option value="">No duel</option>
                  {state.duelRules.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>

              {/* The mode's own options, rendered from the schema in the state
                  payload — the same property that lets GameSettings exist. */}
              {info?.options.map((spec) => (
                <OptionField
                  key={spec.key}
                  spec={spec}
                  value={b.options[spec.key]}
                  disabled={!idle}
                  onChange={(v) => edit(i, { options: { ...b.options, [spec.key]: v } })}
                />
              ))}

              <span class="flow__spacer" />
              <button class="btn btn--ghost" disabled={!idle || i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                class="btn btn--ghost"
                disabled={!idle || i === blocks.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                class="btn btn--ghost"
                disabled={!idle}
                onClick={() => write(blocks.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          )
        })
      )}

      <div class="host__minor">
        <button class="btn" disabled={!idle} onClick={add}>+ block</button>
        {blocks.length > 0 && (
          <button class="btn btn--ghost" disabled={!idle} onClick={() => act({ a: 'clearFlow' })}>
            Clear flow
          </button>
        )}
      </div>
      {!idle && <p class="muted">The flow unlocks between questions.</p>}
    </section>
  )
}
