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
import { play, prime, primeFile, unlock } from '../sound.ts'
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

/**
 * A number with a label and a readout, and nothing else.
 *
 * Deliberately not a `Dial`: a dial carries an origin marker, a "was" readout
 * and a place in Save, because a dial edits a value committed to a file. The
 * trim on a download you have not kept yet is committed to nothing, so all of
 * that machinery would be describing a baseline that does not exist.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div class="harness__dial">
      <label>
        {label}
        <span class="readout harness__value">
          {value}
          {unit}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(num((e.target as HTMLInputElement).value))}
      />
    </div>
  )
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

  /**
   * Whether anything is actually waiting to be written.
   *
   * Both halves, because Save writes both: a moved CSS dial, or any edit to the
   * recipe tree — a dragged handle, an added layer, a removed one. Recipes are
   * compared against the committed table wholesale rather than tracked as they
   * change, which is the cheap way to be right about structural edits.
   */
  const cssDirty = scenario.dials.some(
    (d) => 'var' in d && values[dialKey(d)] !== origin[dialKey(d)],
  )
  const dirty = cssDirty || JSON.stringify(draft) !== JSON.stringify(RECIPES)

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
      setSaved(
        res.ok
          ? `wrote ${body.written} ${body.written === 1 ? 'value' : 'values'} to style.css and ` +
            `${body.cues} ${body.cues === 1 ? 'cue' : 'cues'} to cues.ts`
          : `failed: ${body.error}`,
      )
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
   * The trim an audition plays through, and a cue sound bakes in.
   *
   * Plain state, and it lives beside the Library because it belongs to the
   * Library. It used to be three custom properties in the `anim:tunables`
   * block, which put its sliders up among the animation dials — a screen away
   * from the list they act on, absent entirely from any scenario without a
   * sound, and quietly reading zero when you adopted from one of those. None of
   * that bought anything: a scratch trim on a download you are deciding about
   * is not a value anyone wants written back to a stylesheet.
   */
  const [trim, setTrim] = useState({ head: 0, cut: 0, rate: 1 })
  const noTrim = trim.head === 0 && trim.cut === 0 && trim.rate === 1

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
        src.playbackRate.value = Math.max(0.05, trim.rate)
        src.connect(ac.destination)
        const head = trim.head / 1000
        // Both ends against the same instant on the context clock. `stop` takes
        // an absolute time, so a bare `stop(cut)` is always in the past by the
        // time anyone clicks ▶ — which stops the source immediately, i.e.
        // silence.
        const t0 = ac.currentTime
        src.start(t0, head)
        // `cut` is wall-clock output length, the same convention `play()` gives
        // it — not a length of the file, so a rate change does not change how
        // long the audition runs.
        const cut = trim.cut / 1000
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

  /**
   * The file a preset produces, whatever you typed.
   *
   * The two presets encode to different things — PCM for a one-shot, Opus for a
   * bed — and ffmpeg picks its encoder from the extension, so a bed written to
   * `.wav` is a container that cannot hold what is being put in it. Rather than
   * refuse the name, correct it: the extension is a consequence of the button
   * you pressed, not a decision anyone wants to make twice.
   */
  const outFor = (preset: 'one-shot' | 'bed') =>
    outName.trim().replace(/\.(wav|ogg)$/i, '') + (preset === 'bed' ? '.ogg' : '.wav')

  const adopt = async (name: string, preset: 'one-shot' | 'bed') => {
    setAdopting('running ffmpeg…')
    try {
      const res = await fetch('/__snd/adopt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          out: outFor(preset),
          role,
          preset,
          headMs: trim.head,
          cutMs: trim.cut,
          rate: trim.rate,
        }),
      })
      const body = await res.json()
      setAdopting(res.ok ? body.command : `failed: ${body.error}`)
      // The trim resets because what was dialled in is now baked into the file —
      // the convention CREDITS.md already states.
      if (res.ok) setTrim({ head: 0, cut: 0, rate: 1 })
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
        {/* The button used to say "Save to style.css", which was true when the
            only thing here was CSS. It writes two files now, and since a cue's
            sound moved into its recipe, cues.ts is the half that carries the
            audio — a label naming only the stylesheet would send you looking in
            the wrong file for a change you just made. */}
        <p class="harness__hint">
          {dirty
            ? 'Writes the moved dials into the anim:tunables block in style.css, and every recipe into the cue:recipes block in cues.ts. Both blocks are regenerated in place.'
            : 'Nothing has moved yet. Drag a dial or edit a layer and this writes it back to the file it came from.'}
        </p>
        <div class="harness__row">
          <button class="btn btn--primary" disabled={!dirty} onClick={save}>
            Save
          </button>
          <button
            class="btn btn--ghost"
            disabled={!dirty}
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
        <p class="harness__hint">The style.css half, as it will be written:</p>
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
        {/* The trim and the keep controls only mean anything against a chosen
            download, so they arrive with one rather than sitting there greyed
            out asking to be understood in the abstract. */}
        {!selected && library.length > 0 && (
          <p class="harness__hint">Pick a sound above to trim it and keep it.</p>
        )}
        {selected && (
          <>
            <p class="eyebrow">Trim it</p>
            <p class="harness__hint">
              These act on <code>{selected}</code>. Play it again after each change —
              the preview runs through them, so you are hearing the cut you are
              about to make.
            </p>
            <Slider
              label="Start at"
              value={trim.head}
              min={0}
              max={4000}
              step={10}
              unit="ms"
              onChange={(head) => setTrim({ ...trim, head })}
            />
            <Slider
              label={trim.cut === 0 ? 'Play for (all of it)' : 'Play for'}
              value={trim.cut}
              min={0}
              max={20000}
              step={100}
              unit="ms"
              onChange={(cut) => setTrim({ ...trim, cut })}
            />
            <Slider
              label="Speed and pitch"
              value={trim.rate}
              min={0.25}
              max={4}
              step={0.05}
              unit="×"
              onChange={(rate) => setTrim({ ...trim, rate })}
            />
            {!noTrim && (
              <button class="btn btn--ghost" onClick={() => setTrim({ head: 0, cut: 0, rate: 1 })}>
                Back to the whole file
              </button>
            )}

            <p class="eyebrow">Keep it</p>
            <p class="harness__hint">
              Keeping it copies the download into <code>client/public/sounds/</code>{' '}
              under a name you choose — that folder is the only one the board can
              serve from, and the only one a layer may point at. The ffmpeg command
              goes into CREDITS.md so the licence trail survives.
            </p>
            <div class="harness__dial">
              <label for="snd-name">Name it</label>
              <input
                id="snd-name"
                class="input"
                placeholder="big-buzzer"
                value={outName}
                onInput={(e) => setOutName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="harness__dial">
              <label for="snd-role">What it is for, in CREDITS.md</label>
              <input
                id="snd-role"
                class="input"
                placeholder="the buzzer under the leader's name"
                value={role}
                onInput={(e) => setRole((e.target as HTMLInputElement).value)}
              />
            </div>

            <div class="harness__row">
              <button class="btn" disabled={!outName} onClick={() => adopt(selected, 'one-shot')}>
                Keep as a cue sound
              </button>
              <button class="btn" disabled={!outName} onClick={() => adopt(selected, 'bed')}>
                Keep as looping music
              </button>
            </div>
            {/* The difference worth stating out loud: the trim is the whole point
                of the sliders above, and the music preset throws it away. */}
            <p class="harness__hint">
              A <strong>cue sound</strong> fires once — a buzz, a stamp. The trim above
              is baked in, with a 40ms fade at the cut, and it is saved uncompressed
              as <code>{outName ? outFor('one-shot') : 'name.wav'}</code>.
            </p>
            <p class="harness__hint">
              <strong>Looping music</strong> runs under a screen, like the lobby bed.
              The whole file is kept and compressed to{' '}
              <code>{outName ? outFor('bed') : 'name.ogg'}</code> — <em>the trim is
              ignored</em>, because a bed loops on its own loop points rather than
              being cut.
            </p>
          </>
        )}
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
