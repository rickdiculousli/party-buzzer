import { useState } from 'preact/hooks'
import type { SetlistBlock, HostAction, State } from '../shared/protocol.ts'
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
export function SetlistPanel({
  state,
  act,
  fire,
}: {
  state: State
  act: (action: HostAction) => void
  fire: (name: string, data?: unknown) => void
}) {
  const [saveAs, setSaveAs] = useState('')
  const blocks = state.setlist?.blocks ?? []
  const idle = state.round.phase === 'IDLE'

  /**
   * What a block asks for against what its pack can supply. Blocks sharing a
   * pack share its questions, so the demand is counted across all of them —
   * two blocks of five off an eight-question pack is short even though neither
   * is on its own.
   */
  const demand = new Map<string, number>()
  for (const b of blocks) {
    if (b.pack) demand.set(b.pack, (demand.get(b.pack) ?? 0) + b.count)
  }
  const shortfall = (pack: string): number =>
    Math.max(0, (demand.get(pack) ?? 0) - (state.packSizes[pack] ?? 0))

  const write = (next: SetlistBlock[]) => act({ a: 'setSetlist', blocks: next })
  const edit = (i: number, patch: Partial<SetlistBlock>) =>
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
    <section class="setlist">
      <p class="eyebrow">Setlist</p>


      <div class="setlist__io">
        <select
          class="input"
          value=""
          disabled={!idle || state.setlists.length === 0}
          onChange={(e) => {
            const name = (e.target as HTMLSelectElement).value
            if (name) fire('loadSetlist', name)
            ;(e.target as HTMLSelectElement).value = ''
          }}
        >
          <option value="">Load a setlist…</option>
          {state.setlists.map((f) => (
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
            fire('saveSetlist', saveAs.trim())
            setSaveAs('')
          }}
        >
          Save
        </button>
      </div>

      {blocks.length === 0 ? (
        <p class="muted">No setlist. The host drives freehand — add a block to plan the night.</p>
      ) : (
        blocks.map((b, i) => {
          const info = state.games.find((g) => g.id === b.game)
          return (
            <div key={i} class={i === state.setlist?.at ? 'setlist__block is-here' : 'setlist__block'}>
              <span class="setlist__n">{i + 1}</span>
              <label class="field">
                Mode
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
              </label>

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
                Pack
                <select
                  class="input"
                  value={b.pack ?? ''}
                  disabled={!idle}
                  onChange={(e) =>
                    edit(i, { pack: (e.target as HTMLSelectElement).value || undefined })
                  }
                >
                  <option value="">You read it</option>
                  {state.packs.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
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

              {b.pack && shortfall(b.pack) > 0 && (
                <span class="setlist__tally is-short">
                  {b.pack} has {state.packSizes[b.pack] ?? 0} — the setlist asks it for{' '}
                  {demand.get(b.pack)}. The reading stops when it runs out.
                </span>
              )}

              <span class="setlist__acts">
                <button
                  class="btn btn--ghost"
                  title="Move up"
                  disabled={!idle || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  class="btn btn--ghost"
                  title="Move down"
                  disabled={!idle || i === blocks.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  class="btn btn--ghost"
                  title="Remove block"
                  disabled={!idle}
                  onClick={() => write(blocks.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            </div>
          )
        })
      )}

      <div class="host__minor">
        <button class="btn" disabled={!idle} onClick={add}>+ block</button>
        {blocks.length > 0 && (
          <button class="btn btn--ghost" disabled={!idle} onClick={() => act({ a: 'clearSetlist' })}>
            Clear setlist
          </button>
        )}
      </div>
      {!idle && <p class="muted">The setlist unlocks between questions.</p>}
    </section>
  )
}
