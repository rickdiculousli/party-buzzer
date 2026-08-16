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
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { SCENARIOS, dialKey, recipeDials, type Dial } from './scenarios.tsx'
import { parseTune, play, prime, primeFile, unlock } from '../sound.ts'
import { RECIPES, addLayer, getPath, removeLayer, setPath } from '../cues.ts'
import { Layers } from './Layers.tsx'
import { SoundList, usePreview } from './SoundList.tsx'
import type { Recipe } from '../synth.ts'

/**
 * How long the lead-up frame is held before the moment happens.
 *
 * Not a blank screen: the board an instant earlier, with everything that was
 * already there sitting still and only the new thing missing. An entrance can
 * only be judged against the frame it actually interrupts, and on this board
 * that frame is never empty — the award lands on a stage that already has the
 * name and the timeline on it.
 */
const LEAD_MS = 500

/** Split "700ms" into 700, or "cubic-bezier(...)" into itself. */
const num = (v: string) => parseFloat(v)

/**
 * Where each dial starts. CSS dials read the stylesheet, recipe dials read the
 * committed table — both are "what is in the file", which is what an origin
 * marker has to mean for Reset to be honest.
 */
function readDefaults(dials: Dial[]): Record<string, string> {
  const root = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const d of dials) if ('var' in d) out[dialKey(d)] = root.getPropertyValue(d.var).trim()
  return out
}

function Harness() {
  const [id, setId] = useState(SCENARIOS[0].id)
  const scenario = SCENARIOS.find((s) => s.id === id)!

  const [values, setValues] = useState<Record<string, string>>(() =>
    readDefaults(scenario.dials),
  )
  /**
   * Where each dial started, so a slider can show you how far you have moved it
   * and Reset has something to go back to. "Started" means what is in
   * style.css, so a successful save re-captures it: once a value is committed
   * to the file it *is* the original, and a marker still pointing at the number
   * you replaced would be showing you history rather than a baseline.
   */
  const [origin, setOrigin] = useState<Record<string, string>>(() =>
    readDefaults(scenario.dials),
  )
  /**
   * The recipes as they are being edited, seeded from what is committed.
   *
   * A tree rather than the flat `cue.index.field` overrides it replaces,
   * because add and remove are structural: override keys name a layer by
   * position, so removing layer 0 silently retargets every key naming layer 1.
   * Stable per-layer ids would fix that at the cost of writing UI bookkeeping
   * into committed data. Nothing here is written to disk until Save, which is
   * what makes Reset able to bring a deleted layer back.
   */
  const [draft, setDraft] = useState<Record<string, Recipe>>(() => structuredClone(RECIPES))
  /**
   * `lead` is the frame before the moment; clearing it is the moment.
   *
   * The scene is never remounted to fire a take — that is the whole trick. The
   * context stays mounted across the change, so it has nothing to animate, and
   * only the newly rendered subject does. Which is exactly how the board
   * behaves: a mark stamps because it is new, and the three beside it do not
   * because they are not.
   */
  const [lead, setLead] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [every, setEvery] = useState(2000)
  const [saved, setSaved] = useState('')
  const [muted, setMuted] = useState(false)
  /**
   * Whether the sample slows with the picture.
   *
   * On by default, because alignment is the thing you came here to judge and at
   * 1× an attack and a stamp are the same instant to the ear. Off when you want
   * to hear the sound as the room will actually hear it — at 0.1× a slowed
   * sample is a subsonic groan and tells you nothing about how it sounds.
   */
  const [follow, setFollow] = useState(true)
  const stage = useRef<HTMLDivElement>(null)

  /**
   * Back to the lead-up frame, hold it, then let the moment happen.
   *
   * The timer is owned here rather than by an effect watching `lead`. That
   * version wedged: the effect only re-runs when `lead` changes, so any path
   * that left it true without a re-run — a trigger arriving while it was
   * already true, an effect flush that did not happen — left no timer pending
   * and the harness sat in the lead-up frame forever, with nothing to fire and
   * no way back. Setting it imperatively means every trigger schedules its own
   * way out, whatever state it found.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const trigger = () => {
    clearTimeout(timer.current)
    setLead(true)
    timer.current = setTimeout(() => setLead(false), LEAD_MS)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  // A new scenario brings its own dials, so re-read their defaults from the
  // stylesheet rather than carrying the previous scenario's numbers across.
  useEffect(() => {
    const fresh = readDefaults(scenario.dials)
    setValues(fresh)
    setOrigin(fresh)
    trigger()
  }, [id])

  useEffect(() => {
    if (!looping) return
    const t = setInterval(trigger, Math.max(LEAD_MS + 300, every))
    return () => clearInterval(t)
  }, [looping, every])

  /**
   * Animations this effect has already dealt with.
   *
   * Rewinding is only ever right for an animation that has just been created.
   * Doing it to one already in flight restarts it, which at 0.1x — where a
   * 700ms bloom runs for seven seconds — silently re-fired the settled marks
   * every time the effect ran and made the context look like it was animating
   * along with the subject.
   */
  const handled = useRef(new WeakSet<Animation>())

  // Runs before paint, so the context never shows a frame of movement on its
  // way to being held still.
  useLayoutEffect(() => {
    if (!stage.current) return
    for (const a of stage.current.getAnimations({ subtree: true })) {
      if (handled.current.has(a)) {
        // Already placed. A speed change still applies, but from where it is.
        a.playbackRate = speed
        continue
      }
      handled.current.add(a)

      const el = a.effect && 'target' in a.effect ? (a.effect.target as Element | null) : null
      // Only matters when the whole scene mounts at once — switching scenario,
      // or the first paint. Within a take the context is not remounted and has
      // nothing to fire. Cancelling leaves it settled, which is where the board
      // would have it by the time this moment happens anyway.
      if (!el || !(el.matches(scenario.subject) || el.closest(scenario.subject))) {
        a.cancel()
        continue
      }
      // Slow motion. A new animation is already running by the time this sees
      // it, so rewind before rescaling — otherwise the opening frames play at
      // full speed and the slow part starts mid-gesture.
      a.currentTime = 0
      a.playbackRate = speed
    }
  }, [lead, speed, id])

  // Every cue this scenario fires. The draft, not the committed table, is what
  // the harness plays and draws — a sound tuned against the file while you
  // watch the slider would be tuning nothing.
  const cues = [scenario.sound ?? []].flat()

  /**
   * The cue, on the same edge as the animation.
   *
   * The dialled recipe is handed over directly rather than read from anywhere:
   * a cue's sound is its recipe now, so the draft *is* the tuning. There is no
   * scope to pass, because there is no longer a stylesheet holding a second
   * copy of these numbers to be read from the wrong element.
   */
  useEffect(() => {
    if (lead || muted || !scenario.sound) return
    for (const cue of [scenario.sound].flat())
      play(cue, { rateScale: follow ? speed : 1, recipe: draft[cue] })
  }, [lead])

  // Decode before the first take rather than during it, so the opening trigger
  // of a scenario is not the one that plays silently.
  useEffect(() => {
    if (scenario.sound && !muted) prime(...[scenario.sound].flat())
  }, [id, muted])

  // `prime` above covers the *committed* recipe's files; this covers the live
  // one, which is what the harness actually plays. Adopting a sound onto a
  // layer changes the URL without changing the cue, so the decode has to follow
  // the dialled values or the first take after an adopt is the silent one.
  useEffect(() => {
    for (const cue of [scenario.sound ?? []].flat())
      for (const l of draft[cue] ?? [])
        if (typeof l.source === 'object') void primeFile(l.source.file)
  }, [id, draft])

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
        body: JSON.stringify({ css: values, recipes: draft }),
      })
      const body = await res.json()
      // Saved values are the new baseline — see the note on `origin`.
      if (res.ok) setOrigin({ ...values })
      // The recipe baseline re-seeds on reload rather than here: Save has just
      // rewritten cues.ts, and the module's RECIPES in this page's memory is the
      // pre-save one. Reset before a reload therefore goes back to what the file
      // held when the page opened, which is the honest thing for it to mean.
      setSaved(res.ok ? `saved ${body.written} to style.css, ${body.cues} cues` : `failed: ${body.error}`)
    } catch (err) {
      setSaved(`failed: ${(err as Error).message}`)
    }
    setTimeout(() => setSaved(''), 4000)
  }

  const [library, setLibrary] = useState<{ name: string; size: number }[]>([])
  useEffect(() => {
    fetch('/__snd/library')
      .then((r) => r.json())
      .then((b) => setLibrary(b.files))
      .catch(() => {})
  }, [])

  /**
   * Audition a raw download through whatever is dialled in right now.
   *
   * Through the dials, not raw: the question you are asking a download is "does
   * this work trimmed and pitched the way I need it", and a raw preview answers a
   * different question.
   */
  const preview = usePreview()
  const [selected, setSelected] = useState('')
  /**
   * A dialled tunable, in ms (or as-is for the unitless ones).
   *
   * `parseTune` rather than `parseFloat` for the reason sound.ts spells out: a
   * value that reads `1s` is a thousand milliseconds, and a bare parseFloat
   * makes it one.
   */
  const tune = (key: string, fallback: number) => parseTune(values[key] ?? '', fallback)

  /**
   * The decoded raw file, kept so a second press starts instantly.
   *
   * A download is fetched and decoded once per session rather than per press.
   * These are the biggest files in the panel and re-decoding one on every
   * audition made comparing two of them a waiting game.
   */
  const raw = useRef(new Map<string, AudioBuffer>())

  const audition = (name: string) => {
    preview.toggle(name, (done) => {
      const ac = unlock()
      let src: AudioBufferSourceNode | null = null
      let cancelled = false

      const begin = (buf: AudioBuffer) => {
        if (cancelled) return
        src = ac.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = Math.max(0.05, tune('--audition-rate', 1))
        src.connect(ac.destination)
        const head = tune('--audition-head', 0) / 1000
        // Both ends against the same instant on the context clock. `stop` takes
        // an absolute time, so a bare `stop(cut)` is always in the past by the
        // time anyone clicks ▶ — which stops the source immediately, i.e.
        // silence.
        const t0 = ac.currentTime
        src.start(t0, head)
        // `cut` is wall-clock output length, the same convention `play()` gives
        // it — not a length of the file, so a rate change does not change how
        // long the audition runs.
        const cut = tune('--audition-cut', 0) / 1000
        if (cut > 0)
          // ponytail: no release ramp here, unlike the bed's RELEASE_MS fade —
          // this is a preview, not a baked file, and a hard stop is fine to
          // judge a trim by.
          src.stop(t0 + cut)
        src.onended = done
      }

      const held = raw.current.get(name)
      if (held) begin(held)
      else
        void fetch(`/__snd/raw/${encodeURIComponent(name)}`)
          .then((r) => r.arrayBuffer())
          .then((b) => ac.decodeAudioData(b))
          .then((buf) => {
            raw.current.set(name, buf)
            begin(buf)
          })
          .catch(done)

      return () => {
        // Covers the press that lands while the first decode is still in
        // flight: there is no node to stop yet, and starting one afterwards
        // would be a sound nobody asked for any more.
        cancelled = true
        try {
          src?.stop()
        } catch {}
      }
    })
  }

  const [adopting, setAdopting] = useState('')
  const [outName, setOutName] = useState('')
  const [role, setRole] = useState('')

  const adopt = async (name: string, preset: 'one-shot' | 'bed') => {
    setAdopting('running ffmpeg…')
    try {
      const res = await fetch('/__snd/adopt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          out: outName,
          role,
          preset,
          headMs: tune('--audition-head', 0),
          cutMs: tune('--audition-cut', 0),
          rate: tune('--audition-rate', 1),
        }),
      })
      const body = await res.json()
      setAdopting(res.ok ? body.command : `failed: ${body.error}`)
      // The dials reset because what was dialled in is now baked into the file —
      // the convention CREDITS.md already states.
      if (res.ok)
        setValues((v) => ({
          ...v,
          '--audition-head': '0ms',
          '--audition-cut': '0ms',
          '--audition-rate': '1',
        }))
    } catch (err) {
      setAdopting(`failed: ${(err as Error).message}`)
    }
  }

  // CSS dials come from the scenario; recipe dials come from the draft, so a
  // layer added a moment ago has its dials without a reload.
  const dials = [...scenario.dials, ...cues.flatMap((c) => recipeDials(c, draft[c] ?? []))]

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
          {/* A real click, which is the only thing that can bring the audio
              context up. Every later trigger — including the loop's — rides on
              this one having happened. */}
          <button
            class="btn btn--go"
            onClick={() => {
              unlock()
              trigger()
            }}
          >
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

        {scenario.sound && (
          <div class="harness__row">
            <label class="harness__check">
              <input
                type="checkbox"
                checked={!muted}
                onChange={(e) => setMuted(!(e.target as HTMLInputElement).checked)}
              />
              Sound
            </label>
            <label class="harness__check">
              <input
                type="checkbox"
                checked={follow}
                disabled={muted}
                onChange={(e) => setFollow((e.target as HTMLInputElement).checked)}
              />
              Follow speed
            </label>
          </div>
        )}

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
        {cues.map((cue) => (
          <Layers
            key={cue}
            cue={cue}
            recipe={draft[cue] ?? []}
            onChange={(i, field, value) =>
              setDraft((t) => setPath(t, `${cue}.${i}.${field}`, value))
            }
            onRemove={(i) =>
              setDraft((t) => ({ ...t, [cue]: removeLayer(t[cue] ?? [], i) }))
            }
            onAdd={(source, durationMs) =>
              setDraft((t) => ({ ...t, [cue]: addLayer(t[cue] ?? [], source, durationMs) }))
            }
          />
        ))}
        {dials.map((d) => {
          const k = dialKey(d)
          const recipe = 'recipe' in d
          // A layer added this session has no entry in the committed RECIPES —
          // `getPath` returns undefined rather than a real number. Treating that
          // as 0 would give every dial on a new layer a "was 0 — reset" button,
          // and clicking it on `hold` would zero out the whole-duration default
          // `addLayer` set specifically to keep the layer audible. There is
          // nothing committed to go back to, so the dial is simply not "moved".
          const committed = recipe ? getPath(RECIPES, d.recipe) : undefined
          const was = recipe ? (committed === undefined ? '' : String(committed)) : origin[k] ?? ''
          const now = recipe ? String(getPath(draft, d.recipe) ?? 0) : values[k] ?? ''
          const moved = recipe ? committed !== undefined && now !== was : now !== was
          const back = () =>
            recipe
              ? setDraft((t) => setPath(t, d.recipe, parseFloat(was)))
              : setValues((v) => ({ ...v, [k]: was }))

          if ('text' in d) {
            return (
              <div class="harness__dial" key={k}>
                <label>
                  {d.label}
                  {moved && (
                    <button class="harness__origin-btn" onClick={back} title={was}>
                      reset
                    </button>
                  )}
                </label>
                <input
                  class="input"
                  value={now}
                  onInput={(e) =>
                    setValues((v) => ({ ...v, [k]: (e.target as HTMLInputElement).value }))
                  }
                />
                {moved && <span class="harness__was">was {was}</span>}
              </div>
            )
          }

          // Where the original sits along this slider, 0–1. The track inset is
          // half a thumb at each end, so the tick is placed the same way the
          // browser places the thumb — otherwise it drifts at the extremes and
          // reads as a wrong number rather than a misaligned one.
          const at = was === '' ? 0 : (num(was) - d.min) / (d.max - d.min)

          return (
            <div class="harness__dial" key={k}>
              <label>
                {d.label}
                <span class={moved ? 'readout harness__value is-moved' : 'readout harness__value'}>
                  {num(now)}
                  {d.unit}
                </span>
              </label>
              <div class="harness__track">
                <input
                  type="range"
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={num(now)}
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value
                    if ('recipe' in d) setDraft((t) => setPath(t, d.recipe, parseFloat(raw)))
                    else setValues((v) => ({ ...v, [k]: `${raw}${d.unit}` }))
                  }}
                />
                <span
                  class="harness__origin"
                  style={{ left: `calc(0.5rem + ${at} * (100% - 1rem))` }}
                  aria-hidden="true"
                />
              </div>
              {moved && (
                <button class="harness__was" onClick={back}>
                  was {num(was)}
                  {d.unit} — reset
                </button>
              )}
            </div>
          )
        })}

        <p class="eyebrow">Write back</p>
        <div class="harness__row">
          <button class="btn btn--primary" onClick={save}>
            Save to style.css
          </button>
          <button
            class="btn btn--ghost"
            disabled={
              !scenario.dials.some((d) => values[dialKey(d)] !== origin[dialKey(d)]) &&
              JSON.stringify(draft) === JSON.stringify(RECIPES)
            }
            onClick={() => {
              setValues({ ...origin })
              setDraft(structuredClone(RECIPES))
              trigger()
            }}
          >
            Reset all
          </button>
        </div>
        {saved && <p class="harness__saved">{saved}</p>}
        <pre class="harness__css">{css}</pre>

        <p class="eyebrow">Library</p>
        <SoundList
          rows={library.map((f) => ({
            id: f.name,
            name: f.name,
            meta: `${Math.round(f.size / 1024)}k`,
          }))}
          selected={selected}
          onSelect={setSelected}
          playing={preview.playing}
          onPreview={audition}
          empty="Nothing in sounds/raw/ yet. Drop a download in, or run npm run demo-sounds."
        />
        {/* Auditions run through these three, so what you hear is the trim you
            are about to bake in rather than the raw download. */}
        <div class="harness__row">
          <input
            class="input"
            placeholder="stamp.wav"
            value={outName}
            onInput={(e) => setOutName((e.target as HTMLInputElement).value)}
          />
          <input
            class="input"
            placeholder="what it is for"
            value={role}
            onInput={(e) => setRole((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="harness__row">
          <button class="btn" disabled={!selected || !outName} onClick={() => adopt(selected, 'one-shot')}>
            Adopt as one-shot
          </button>
          <button class="btn" disabled={!selected || !outName} onClick={() => adopt(selected, 'bed')}>
            Adopt as bed
          </button>
        </div>
        {selected && <p class="harness__note">Adopting {selected}</p>}
        {adopting && <pre class="harness__css">{adopting}</pre>}
      </aside>

      <div class="harness__stage" style={values}>
        <p class="harness__note">{scenario.note}</p>
        {/* Keyed on the scenario, not on the take: a take must not remount
            this, or the context would animate alongside the subject and the
            whole point would be lost. Only the scenario's own markup changes
            between the lead-up frame and the moment. */}
        <div class="harness__preview" key={id} ref={stage}>
          {scenario.render(lead)}
        </div>
      </div>
    </main>
  )
}

render(<Harness />, document.getElementById('app')!)
