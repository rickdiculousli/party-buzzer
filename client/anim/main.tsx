/// <reference types="vite/client" />
import { Fragment, render } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { SCENARIOS, applyMotion, commitMotion, committedMotion, dialKey, recipeDials, type Dial } from './scenarios.tsx'
import { play, prime, primeFile, setDialled, unlock } from '../sound.ts'
import { RECIPES, addLayer, getPath, removeLayer, setPath } from '../cues.ts'
import { Layers } from './Layers.tsx'
import { SoundList, usePreview } from './SoundList.tsx'
import type { Recipe } from '../synth.ts'

const LEAD_MS = 500

const num = (v: string) => parseFloat(v)

function readDefaults(dials: Dial[]): Record<string, string> {
  const root = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const d of dials) if ('var' in d) out[dialKey(d)] = root.getPropertyValue(d.var).trim()
  return out
}
function readMotion(dials: Dial[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of dials) if ('motion' in d) out[d.motion] = String(committedMotion(d.motion))
  return out
}

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

const kept = (key: string) => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
const keep = (key: string, value: string | null) => {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {}
}

function Harness() {
  const [id, setId] = useState(() => SCENARIOS.find((s) => s.id === kept('anim:scenario'))?.id ?? SCENARIOS[0].id)
  const scenario = SCENARIOS.find((s) => s.id === id)!

  const [values, setValues] = useState<Record<string, string>>(() =>
    readDefaults(scenario.dials),
  )
  const [origin, setOrigin] = useState<Record<string, string>>(() =>
    readDefaults(scenario.dials),
  )
  const [draft, setDraft] = useState<Record<string, Recipe>>(() => structuredClone(RECIPES))
  const [motion, setMotion] = useState<Record<string, string>>(() => readMotion(scenario.dials))
  const [motionOrigin, setMotionOrigin] = useState<Record<string, string>>(() => readMotion(scenario.dials))
  applyMotion(motion)
  const [lead, setLead] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [every, setEvery] = useState(2000)
  const [saved, setSaved] = useState(() => kept('anim:saved') ?? '')
  useEffect(() => keep('anim:scenario', id), [id])
  useEffect(() => {
    keep('anim:saved', null)
    if (saved) setTimeout(() => setSaved(''), 4000)
  }, [])
  const [muted, setMuted] = useState(false)
  const [follow, setFollow] = useState(true)
  const stage = useRef<HTMLDivElement>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const trigger = () => {
    clearTimeout(timer.current)
    setLead(true)
    timer.current = setTimeout(() => setLead(false), LEAD_MS)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    const fresh = readDefaults(scenario.dials)
    setValues(fresh)
    setOrigin(fresh)
    const freshMotion = readMotion(scenario.dials)
    setMotion(freshMotion)
    setMotionOrigin(freshMotion)
    trigger()
  }, [id])

  useEffect(() => {
    if (!looping) return
    const t = setInterval(trigger, Math.max(LEAD_MS + 300, every))
    return () => clearInterval(t)
  }, [looping, every])

  const handled = useRef(new WeakSet<Animation>())

  useLayoutEffect(() => {
    if (!stage.current) return
    for (const a of stage.current.getAnimations({ subtree: true })) {
      if (handled.current.has(a)) {
        a.playbackRate = speed
        continue
      }
      handled.current.add(a)

      const el = a.effect && 'target' in a.effect ? (a.effect.target as Element | null) : null
      if (!el || !(el.matches(scenario.subject) || el.closest(scenario.subject))) {
        a.cancel()
        continue
      }
      a.currentTime = 0
      a.playbackRate = speed
    }
  }, [lead, speed, id])

  const cues = [scenario.sound ?? [], scenario.tune ?? []].flat()

  useEffect(() => setDialled(draft), [draft])

  useEffect(() => {
    if (lead || muted || !scenario.sound) return
    for (const cue of [scenario.sound].flat())
      play(cue, { rateScale: follow ? speed : 1, recipe: draft[cue] })
  }, [lead])

  useEffect(() => {
    if (scenario.sound && !muted) prime(...[scenario.sound].flat())
  }, [id, muted])

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

  const cssDirty = scenario.dials.some(
    (d) => 'var' in d && values[dialKey(d)] !== origin[dialKey(d)],
  )
  const movedMotion = Object.fromEntries(Object.entries(motion).filter(([k, v]) => v !== motionOrigin[k]))
  const recipesDirty = JSON.stringify(draft) !== JSON.stringify(RECIPES)
  const dirty = cssDirty || Object.keys(movedMotion).length > 0 || recipesDirty

  const save = async () => {
    setSaved('saving')
    try {
      const res = await fetch('/__anim/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ css: values, recipes: recipesDirty ? draft : undefined, motion: movedMotion }),
      })
      const body = await res.json()
      if (res.ok) {
        setOrigin({ ...values })
        setMotionOrigin({ ...motion })
        commitMotion(movedMotion)
      }
      const message =
        res.ok
          ? `wrote ${body.written} ${body.written === 1 ? 'value' : 'values'} to style.css and ` +
            `${body.cues} ${body.cues === 1 ? 'cue' : 'cues'} to cues.ts` +
            (body.motion ? `, and ${body.motion} ${body.motion === 1 ? 'number' : 'numbers'} to toss.ts` : '')
          : `failed: ${body.error}`
      setSaved(message)
      if (res.ok && body.motion) keep('anim:saved', message)
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

  const preview = usePreview()
  const [selected, setSelected] = useState('')
  const [trim, setTrim] = useState({ head: 0, cut: 0, rate: 1 })
  const noTrim = trim.head === 0 && trim.cut === 0 && trim.rate === 1

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
        const t0 = ac.currentTime
        src.start(t0, head)
        const cut = trim.cut / 1000
        if (cut > 0)
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
      if (res.ok) setTrim({ head: 0, cut: 0, rate: 1 })
    } catch (err) {
      setAdopting(`failed: ${(err as Error).message}`)
    }
  }

  const dials = [...scenario.dials, ...cues.flatMap((c) => recipeDials(c, draft[c] ?? []))]

  return (
    <main class="harness">
      <aside class="harness__panel">
        <h1 class="harness__title">Motion</h1>

        <div class="harness__scenarios">
          {SCENARIOS.map((s, i) => (
            <Fragment key={s.id}>
              {s.family && s.family !== SCENARIOS[i - 1]?.family && <p class="eyebrow">{s.family}</p>}
              <button class={s.id === id ? 'btn btn--primary' : 'btn'} onClick={() => setId(s.id)}>
                {s.label}
              </button>
            </Fragment>
          ))}
        </div>

        <p class="eyebrow">Trigger</p>
        <div class="harness__row">
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
          const committed = recipe ? getPath(RECIPES, d.recipe) : undefined
          const was = recipe ? (committed === undefined ? '' : String(committed)) : 'motion' in d ? motionOrigin[k] ?? '' : origin[k] ?? ''
          const now = recipe ? String(getPath(draft, d.recipe) ?? 0) : 'motion' in d ? motion[k] ?? '' : values[k] ?? ''
          const moved = recipe ? committed !== undefined && now !== was : now !== was
          const back = () =>
            recipe
              ? setDraft((t) => setPath(t, d.recipe, parseFloat(was)))
              : 'motion' in d
                ? setMotion((v) => ({ ...v, [k]: was }))
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
                    else if ('motion' in d) setMotion((v) => ({ ...v, [k]: raw }))
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
        <p class="harness__hint">
          {dirty
            ? 'Writes the moved dials into the anim:tunables block in style.css, every recipe into the cue:recipes block in cues.ts, and each moved motion number into its own line in toss.ts.'
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
              setMotion({ ...motionOrigin })
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
        <div class="harness__preview" key={id} ref={stage}>
          {scenario.render(lead)}
        </div>
      </div>
    </main>
  )
}

render(<Harness />, document.getElementById('app')!)

import.meta.hot?.on('vite:ws:disconnect', () => {
  fetch(location.href, { method: 'HEAD' }).catch(() => window.close())
})
