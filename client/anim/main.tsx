/**
 * The motion harness. A dev-only page for dialling in the anchor animations
 * against the real stylesheet.
 *
 *   npm run dev   →   http://localhost:5173/anim.html
 *
 * Three things make it useful, and all three are things a real round cannot
 * give you:
 *
 *   - **Retrigger on demand.** The board shows you a landing once a minute if
 *     you script it. Here it is a button, or a loop.
 *   - **Slow motion.** A 110ms stamp is eleven frames. At 0.1x it is a hundred
 *     and ten, which is the difference between judging a feeling and seeing
 *     where the light actually sits relative to the movement.
 *   - **Live dials on the real rules.** The values come from the `anim:tunables`
 *     block in style.css and are written straight back to it, so there is no
 *     transcription step where a number quietly changes on its way home.
 *
 * It is not in the production bundle: vite.config.ts leaves anim.html out of
 * the build inputs, so `npm run build` never emits it and the game ships
 * without it.
 */
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { SCENARIOS, type Dial } from './scenarios.tsx'

/** Split "700ms" into 700, or "cubic-bezier(...)" into itself. */
const num = (v: string) => parseFloat(v)

function readDefaults(dials: Dial[]): Record<string, string> {
  const root = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const d of dials) out[d.var] = root.getPropertyValue(d.var).trim()
  return out
}

function Harness() {
  const [id, setId] = useState(SCENARIOS[0].id)
  const scenario = SCENARIOS.find((s) => s.id === id)!

  const [values, setValues] = useState<Record<string, string>>(() =>
    readDefaults(scenario.dials),
  )
  // Bumping this remounts the preview subtree, which is exactly how the board
  // fires these: a fresh element, a fresh animation. Nothing here reaches into
  // the Web Animations API to restart anything.
  const [take, setTake] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [every, setEvery] = useState(2000)
  const [saved, setSaved] = useState('')
  const stage = useRef<HTMLDivElement>(null)

  // A new scenario brings its own dials, so re-read their defaults from the
  // stylesheet rather than carrying the previous scenario's numbers across.
  useEffect(() => {
    setValues(readDefaults(scenario.dials))
    setTake((t) => t + 1)
  }, [id])

  useEffect(() => {
    if (!looping) return
    const t = setInterval(() => setTake((n) => n + 1), Math.max(200, every))
    return () => clearInterval(t)
  }, [looping, every])

  // Slow motion. The animations are already running by the time this fires, so
  // rewind each one to the start before rescaling it — otherwise the first
  // frames play at full speed and the slow part begins mid-gesture.
  useEffect(() => {
    if (!stage.current) return
    for (const a of stage.current.getAnimations({ subtree: true })) {
      a.currentTime = 0
      a.playbackRate = speed
    }
  }, [take, speed, id])

  const css =
    ':root {\n' +
    Object.entries(values)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n') +
    '\n}'

  const save = async () => {
    setSaved('saving')
    try {
      const res = await fetch('/__anim/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      })
      const body = await res.json()
      setSaved(res.ok ? `saved ${body.written} to style.css` : `failed: ${body.error}`)
    } catch (err) {
      setSaved(`failed: ${(err as Error).message}`)
    }
    setTimeout(() => setSaved(''), 4000)
  }

  return (
    <main class="harness">
      <aside class="harness__panel">
        <h1 class="harness__title">Motion</h1>

        <div class="harness__scenarios">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              class={s.id === id ? 'btn btn--primary' : 'btn'}
              onClick={() => setId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <p class="eyebrow">Trigger</p>
        <div class="harness__row">
          <button class="btn btn--go" onClick={() => setTake((t) => t + 1)}>
            Retrigger
          </button>
          <label class="harness__check">
            <input
              type="checkbox"
              checked={looping}
              onChange={(e) => setLooping((e.target as HTMLInputElement).checked)}
            />
            Loop
          </label>
          <input
            class="input input--num"
            type="number"
            step={100}
            min={200}
            value={every}
            onInput={(e) => setEvery(num((e.target as HTMLInputElement).value))}
          />
          <span class="harness__unit">ms</span>
        </div>

        <div class="harness__dial">
          <label>
            Speed
            <span class="readout harness__value">{speed}×</span>
          </label>
          <input
            type="range"
            min={0.05}
            max={2}
            step={0.05}
            value={speed}
            onInput={(e) => setSpeed(num((e.target as HTMLInputElement).value))}
          />
        </div>

        <p class="eyebrow">{scenario.label}</p>
        {scenario.dials.map((d) =>
          'text' in d ? (
            <div class="harness__dial" key={d.var}>
              <label>{d.label}</label>
              <input
                class="input"
                value={values[d.var] ?? ''}
                onInput={(e) =>
                  setValues((v) => ({ ...v, [d.var]: (e.target as HTMLInputElement).value }))
                }
              />
            </div>
          ) : (
            <div class="harness__dial" key={d.var}>
              <label>
                {d.label}
                <span class="readout harness__value">
                  {num(values[d.var] ?? '0')}
                  {d.unit}
                </span>
              </label>
              <input
                type="range"
                min={d.min}
                max={d.max}
                step={d.step}
                value={num(values[d.var] ?? '0')}
                onInput={(e) =>
                  setValues((v) => ({
                    ...v,
                    [d.var]: `${(e.target as HTMLInputElement).value}${d.unit}`,
                  }))
                }
              />
            </div>
          ),
        )}

        <p class="eyebrow">Write back</p>
        <div class="harness__row">
          <button class="btn btn--primary" onClick={save}>
            Save to style.css
          </button>
          <button
            class="btn btn--ghost"
            onClick={() => {
              setValues(readDefaults(scenario.dials))
              setTake((t) => t + 1)
            }}
          >
            Revert
          </button>
        </div>
        {saved && <p class="harness__saved">{saved}</p>}
        <pre class="harness__css">{css}</pre>
      </aside>

      <div class="harness__stage" style={values}>
        <p class="harness__note">{scenario.note}</p>
        {/* The key is the trigger: a new key is a new element, which is the
            same thing that happens on the board when a mark or a name mounts. */}
        <div class="harness__preview" key={take} ref={stage}>
          {scenario.render()}
        </div>
      </div>
    </main>
  )
}

render(<Harness />, document.getElementById('app')!)
