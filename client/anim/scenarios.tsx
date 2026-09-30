/**
 * What the harness can put on screen, and which numbers each one exposes.
 *
 * A scenario is markup plus a list of dials. The markup is the real component
 * in a stripped-down copy of its real container — a mark on an actual timeline
 * rail with neighbours, a name in the actual three-band stage — because a glow
 * against an empty void reads nothing like the same glow beside a cyan rail and
 * three other names. Tuning against the void is how you land a value that looks
 * wrong the moment it ships.
 *
 * Every scenario renders in two phases, and `render(lead)` is how it says what
 * each one holds. The lead-up frame is the board an instant before the moment
 * happens: everything that was already there, sitting still, with only the new
 * thing missing. Then the new thing arrives. That is the actual shape of these
 * moments — an award lands on a stage that already has the name and the
 * timeline on it — and it is the only frame against which an entrance can be
 * judged.
 *
 * The dials name custom properties from the `anim:tunables` block in style.css.
 * Nothing here restates a duration or a colour: the harness sets those
 * properties on a wrapper and the real rules pick them up, so a scenario cannot
 * drift from what the board actually does.
 */
import { COLLECT_MS } from '../../shared/protocol.ts'
import type { Cue } from '../sound.ts'
import { NUMERIC, type NumericField } from '../cues.ts'
import { Votes } from '../Votes.tsx'
import { Spoken } from '../Spoken.tsx'
import { Burst, CountUp, Glitch, Letters } from '../fx.tsx'
import { FaceOff, Finale } from '../Board.tsx'
import { Piece, PlayingCard } from '../PokerParts.tsx'
import { chain, flop, pitch, receive, scatter, street, toss, turnUp, FOLD, RECEIVE, REVEAL, TOSS } from '../toss.ts'
import { mulberry32 } from '../../shared/random.ts'
import type { BurstFrom } from '../fx.ts'
import type { Recipe } from '../synth.ts'

/**
 * A number the harness can move.
 *
 * Three kinds, told apart by which one they address: `var` is a CSS custom
 * property in the `anim:tunables` block, `recipe` is a field in a cue's recipe
 * written as `cue.layer.field`, and `motion` is a number in one of toss.ts's
 * constants written as `NAME.field`, or `NAME.field.i` for one end of a range.
 * Everything downstream — the slider, the origin marker, the dirty state,
 * Save — works the same on all three, which is the point of giving them one
 * type.
 */
export type Dial =
  | { var: string; label: string; min: number; max: number; step: number; unit: string }
  | { var: string; label: string; text: true }
  | { recipe: string; label: string; min: number; max: number; step: number; unit: string }
  | { motion: string; label: string; min: number; max: number; step: number; unit: string }

/** What a dial is stored under. The kinds never collide: a var has dashes, a motion key starts with a capital. */
export const dialKey = (d: Dial) => ('var' in d ? d.var : 'recipe' in d ? d.recipe : d.motion)

type Constants = Record<string, Record<string, unknown>>
/** The constants motion dials reach, live: the throws read them on every take. */
const MOTION = { TOSS, RECEIVE, REVEAL, FOLD } as unknown as Constants
/** The same constants as toss.ts holds them, for origins and for putting the live ones back. */
const COMMITTED = structuredClone(MOTION)

const cell = (table: Constants, key: string) => {
  const [name, field, i] = key.split('.')
  const holder = (i === undefined ? table[name] : table[name][field]) as Record<string, number>
  return { holder, at: i ?? field }
}
/** A motion dial's number as toss.ts holds it. */
export const committedMotion = (key: string) => {
  const { holder, at } = cell(COMMITTED, key)
  return holder[at]
}
/** Puts every constant back as committed, then moves the dialled ones. */
export function applyMotion(dialled: Record<string, string>) {
  for (const [name, fields] of Object.entries(COMMITTED)) Object.assign(MOTION[name], structuredClone(fields))
  for (const [key, value] of Object.entries(dialled)) {
    const { holder, at } = cell(MOTION, key)
    holder[at] = parseFloat(value)
  }
}
/** After a save, what was dialled is what toss.ts holds. */
export function commitMotion(saved: Record<string, string>) {
  for (const [key, value] of Object.entries(saved)) {
    const { holder, at } = cell(COMMITTED, key)
    holder[at] = parseFloat(value)
  }
}

export type Scenario = {
  id: string
  label: string
  /** Heading the harness list groups this under. Every scenario has one. */
  family?: string
  /** One line on what the moment is, shown above the stage. */
  note: string
  /**
   * What this scenario is actually about, as a selector.
   *
   * Everything else is context and is held still: on a scenario change the
   * whole scene mounts at once, and the harness cancels any animation outside
   * this selector so the context settles instead of going off together. Within
   * a take it mostly looks after itself — the context is never remounted, so it
   * has nothing to fire.
   *
   * Matching the subject itself or anything inside it counts, so naming
   * `.timeline__mark` also keeps its pin and its name.
   */
  subject: string
  dials: Dial[]
  /**
   * The sample this moment fires, if it has one. It plays on the same trigger
   * as the animation, which is the only way to judge whether the two are one
   * event or two. Several are layers of one moment, fired together.
   */
  sound?: Cue | Cue[]
  /**
   * A cue the panel should show but the trigger should not fire, because the
   * component fires it itself — `spoken` taps once per chunk as each lands,
   * so a cue on `sound` would be one extra tap on top of the line's own.
   */
  tune?: Cue | Cue[]
  /** `lead` is the frame before the moment: everything but the new thing. */
  render: (lead: boolean) => preact.JSX.Element
}

/**
 * Range and step per recipe field. One table, so every layer dials alike, and
 * keyed off `NUMERIC` so the fields the canvas may write are exactly the ones
 * the panel can show.
 */
const FIELD: Record<NumericField, { max: number; step: number; unit: string }> = {
  freq: { max: 4000, step: 10, unit: 'Hz' },
  freqTo: { max: 4000, step: 10, unit: 'Hz' },
  attack: { max: 400, step: 1, unit: 'ms' },
  decay: { max: 2000, step: 5, unit: 'ms' },
  level: { max: 1, step: 0.05, unit: '' },
  sustain: { max: 4000, step: 20, unit: 'ms' },
  release: { max: 2000, step: 5, unit: 'ms' },
  gain: { max: 1.5, step: 0.05, unit: '' },
  delay: { max: 600, step: 5, unit: 'ms' },
  head: { max: 1000, step: 5, unit: 'ms' },
}

/**
 * Every numeric field actually present in a cue's recipe, as dials.
 *
 * Driven off the recipe passed in rather than off the committed table, because
 * the harness now edits a draft: a layer you added a moment ago has to get its
 * dials without a reload, and a layer you removed has to lose them.
 */
export function recipeDials(cue: string, recipe: Recipe): Dial[] {
  return recipe.flatMap((layer, i) =>
    NUMERIC.filter((f) => typeof layer[f] === 'number').map((f) => ({
      recipe: `${cue}.${i}.${f}`,
      label: `${cue} L${i + 1} ${f}`,
      min: 0,
      ...FIELD[f],
    })),
  )
}

// --- shared dial groups ------------------------------------------------------

const STAMP: Dial[] = [
  { var: '--stamp-dur', label: 'Stamp', min: 40, max: 600, step: 10, unit: 'ms' },
  { var: '--stamp-scale', label: 'From scale', min: 1, max: 2.5, step: 0.05, unit: '' },
]

const BLOOM: Dial[] = [
  { var: '--bloom-dur', label: 'Bloom', min: 100, max: 2000, step: 20, unit: 'ms' },
  { var: '--bloom-rise', label: 'Rise ease', text: true },
  { var: '--bloom-core', label: 'Core blur', min: 0, max: 60, step: 1, unit: 'px' },
  { var: '--bloom-core-spread', label: 'Core spread', min: 0, max: 30, step: 1, unit: 'px' },
  { var: '--bloom-halo', label: 'Halo blur', min: 0, max: 160, step: 2, unit: 'px' },
  { var: '--bloom-halo-spread', label: 'Halo spread', min: 0, max: 60, step: 1, unit: 'px' },
  { var: '--bloom-name-core', label: 'Name core', min: 0, max: 60, step: 1, unit: 'px' },
  { var: '--bloom-name-halo', label: 'Name halo', min: 0, max: 160, step: 2, unit: 'px' },
]

// --- the marks ---------------------------------------------------------------

/** Four buzzes with the spread a real question produces. */
const MARKS = [
  { name: 'Ada', ms: 0, id: 'var(--id-1)' },
  { name: 'Bo', ms: 180, id: 'var(--id-3)' },
  { name: 'Cy', ms: 430, id: 'var(--id-6)' },
  { name: 'Dee', ms: 720, id: 'var(--id-4)' },
]

/**
 * `held` marks are left out. Keyed by name, so the ones already on screen keep
 * their DOM when the last one appears and therefore do not re-stamp — the same
 * reason the board only animates the mark that just arrived.
 */
function Timeline({ held = 0 }: { held?: number }) {
  const shown = MARKS.slice(0, MARKS.length - held)
  return (
    <div class="timeline">
      <div class="timeline__scale">
        <span>0 ms</span>
        <span>{COLLECT_MS} ms</span>
      </div>
      <div class="timeline__rail" />
      <ol class="timeline__marks" style={{ '--lanes': 1 }}>
        {shown.map((m) => (
          <li
            key={m.name}
            class="timeline__mark"
            style={{ '--at': `${(m.ms / COLLECT_MS) * 100}%`, '--lane': 0, '--id': m.id }}
          >
            <span class="timeline__pin" />
            <span class="timeline__name">{m.name}</span>
            <span class="timeline__ms readout">{m.ms === 0 ? '' : `+${m.ms}`}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Voter ids for the nomination pool. Stable, so slicing one more off the
    front mounts exactly one new figure — which is what the flare fires on. */
const VOTERS = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']

/** The stage's three bands, so a scenario sits where it really sits. */
function Stage({
  above,
  mid,
  below,
}: {
  above?: preact.JSX.Element | false
  mid?: preact.JSX.Element | false
  below?: preact.JSX.Element | false
}) {
  return (
    <section class="board__wall">
      <div class="board__above">{above}</div>
      <div class="board__mid">{mid}</div>
      <div class="board__below">{below}</div>
    </section>
  )
}

/*
 * The interest kit, one scenario per effect.
 *
 * Dial names are written out in full on purpose: tunables.test.ts scans this
 * file for `--fx-*` names to check each one is declared in anim:tunables, and a
 * name built from a template would slip past it.
 */
const ms = (v: string, max: number, label = 'Duration'): Dial => ({ var: v, label, min: 0, max, step: 5, unit: 'ms' })
const amount = (v: string, min: number, max: number, step: number, unit: string, label = 'Amount'): Dial => ({
  var: v,
  label,
  min,
  max,
  step,
  unit,
})
const STAGGER: Dial = { var: '--fx-stagger', label: 'Stagger', min: 0, max: 200, step: 5, unit: 'ms' }
const BURST_DIALS = [ms('--fx-burst-dur', 3000), amount('--fx-burst-amp', 0, 12, 0.1, 'em')]

type El = (cls: string) => preact.JSX.Element
const word = (text = 'Ada'): El => (cls) => <p class={`fx-demo ${cls}`}>{text}</p>
const glitchWord: El = (cls) => <p class="fx-demo">{cls ? <Glitch text="Ada" /> : 'Ada'}</p>
const letters = (text: string): El => (cls) => (
  <p class="fx-demo">
    <Letters text={text} class={cls} />
  </p>
)
const tile: El = (cls) => <div class={`fx-tile ${cls}`} />
const chip: El = (cls) => <span class={`chip chip--won ${cls}`}>Winner</span>

/**
 * `enter`: the lead frame holds the element's space, hidden, and the take
 * mounts it with the class. `class`: the element is there all along and the
 * take adds the class, which is how a loop or a hit starts in the game.
 */
function fx(
  family: string,
  name: string,
  label: string,
  note: string,
  dials: Dial[],
  show: 'enter' | 'class',
  el: El,
): Scenario {
  return {
    id: `fx-${name}`,
    label,
    family,
    note,
    subject: `.fx-${name}`,
    dials,
    render: (lead) => (
      <div class="fx-stage">
        {!lead ? el(`fx-${name}`) : show === 'enter' ? <div style="visibility:hidden">{el('')}</div> : el('')}
      </div>
    ),
  }
}

function burst(
  kind: 'sparkle' | 'dust' | 'confetti' | 'embers' | 'stars' | 'emoji',
  label: string,
  note: string,
  aim: { from?: BurstFrom; angle?: number; spread?: number } = {},
): Scenario {
  return {
    id: `fx-burst-${kind}${aim.from ? `-${[aim.from].flat().join('-')}` : ''}`,
    label,
    family: 'Particles',
    note,
    subject: '.fx-burst',
    dials: BURST_DIALS,
    render: (lead) => (
      <div class="fx-stage">
        <p class="fx-demo fx-anchor">
          {/* A long name for an edge burst, so the outline is visibly long. */}
          {aim.from ? 'Alexander' : 'Ada'}
          {!lead && <Burst kind={kind} glyph="🦆" {...aim} />}
        </p>
      </div>
    ),
  }
}

const FX: Scenario[] = [
  {
    id: 'fx-palette',
    label: 'Palette',
    family: 'Palette',
    note: 'The effect palette, --fx-1 to --fx-8. Matte, warm-tinted, no cyan. Three knobs move all eight.',
    subject: '.fx-swatches',
    dials: [
      amount('--fx-light', 0.4, 0.95, 0.01, '', 'Lightness'),
      amount('--fx-chroma', 0, 0.25, 0.005, '', 'Chroma'),
      amount('--fx-tint', 0, 60, 1, '%', 'Tungsten tint'),
    ],
    render: () => (
      <div class="fx-stage">
        <div class="fx-swatches">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div class="fx-swatch" style={`background:var(--fx-${n})`}>
              {n}
            </div>
          ))}
        </div>
      </div>
    ),
  },

  fx('Entrances', 'fade', 'Fade', 'fx-fade — the quietest arrival.', [ms('--fx-fade-dur', 1000)], 'enter', word()),
  fx('Entrances', 'pop', 'Pop', 'fx-pop — scales past full size and settles. Amount is the overshoot.', [ms('--fx-pop-dur', 1000), amount('--fx-pop-amp', 1, 1.6, 0.01, '')], 'enter', word()),
  fx('Entrances', 'drop', 'Drop', 'fx-drop — falls in and squashes on landing. Amount is the fall.', [ms('--fx-drop-dur', 1200), amount('--fx-drop-amp', 0, 4, 0.1, 'em')], 'enter', word()),
  fx('Entrances', 'rise', 'Rise', 'fx-rise — floats up into place. Amount is the distance.', [ms('--fx-rise-dur', 1200), amount('--fx-rise-amp', 0, 3, 0.1, 'em')], 'enter', word()),
  fx('Entrances', 'slide', 'Slide', 'fx-slide — slides in from --fx-from (-1 left, 1 right) at the glide rate, fast then slow. Amount is the distance.', [ms('--fx-slide-dur', 1200), amount('--fx-slide-amp', 0, 6, 0.1, 'em')], 'enter', word()),
  ...(['charge', 'even'] as const).map((rate): Scenario => ({
    id: `fx-slide-${rate}`,
    label: `Slide (${rate})`,
    family: 'Entrances',
    note: `fx-slide fx-slide--${rate} — ${rate === 'charge' ? 'slow then fast, for things that hit something at the end' : 'eases both ends, for moving between two places'}.`,
    subject: '.fx-slide',
    dials: [ms('--fx-slide-dur', 1200), amount('--fx-slide-amp', 0, 6, 0.1, 'em')],
    render: (lead) => (
      <div class="fx-stage">
        {lead ? <p class="fx-demo" style="visibility:hidden">Ada</p> : <p class={`fx-demo fx-slide fx-slide--${rate}`}>Ada</p>}
      </div>
    ),
  })),
  fx('Entrances', 'flip', 'Flip', 'fx-flip — turns over like a card.', [ms('--fx-flip-dur', 1200)], 'enter', chip),
  fx('Entrances', 'zoom', 'Zoom', 'fx-zoom — scales in from large with a blur clearing. Amount is the start scale.', [ms('--fx-zoom-dur', 1200), amount('--fx-zoom-amp', 1, 4, 0.05, '')], 'enter', word()),
  fx('Entrances', 'shrink', 'Shrink out', 'fx-shrink — shrinks and fades out.', [ms('--fx-shrink-dur', 1000)], 'class', word()),
  {
    id: 'fx-poof',
    label: 'Poof out',
    family: 'Entrances',
    note: 'fx-poof with <Burst kind="dust">: gone in a puff.',
    subject: '.fx-poof, .fx-burst',
    dials: [ms('--fx-poof-dur', 1000), ...BURST_DIALS],
    render: (lead) => (
      // The burst sits beside the word, not inside it: inside, it would
      // shrink away with the word it is covering for.
      <div class="fx-stage">
        <p class="fx-demo fx-anchor">
          <span class={lead ? '' : 'fx-poof'} style="display:inline-block">
            Ada
          </span>
          {!lead && <Burst kind="dust" />}
        </p>
      </div>
    ),
  },

  fx('Loops', 'bob', 'Bob', 'fx-bob — up and down. Amount is the height.', [ms('--fx-bob-dur', 4000), amount('--fx-bob-amp', 0, 1, 0.01, 'em')], 'class', word()),
  fx('Loops', 'float', 'Float', 'fx-float — slow drift. Amount is the reach.', [ms('--fx-float-dur', 8000), amount('--fx-float-amp', 0, 1, 0.01, 'em')], 'class', tile),
  fx('Loops', 'breathe', 'Breathe', 'fx-breathe — gentle scale pulse. Amount is the peak scale.', [ms('--fx-breathe-dur', 6000), amount('--fx-breathe-amp', 1, 1.3, 0.01, '')], 'class', tile),
  fx('Loops', 'heartbeat', 'Heartbeat', 'fx-heartbeat — double pulse, then rest. Amount is the peak scale.', [ms('--fx-heartbeat-dur', 4000), amount('--fx-heartbeat-amp', 1, 1.4, 0.01, '')], 'class', tile),
  fx('Loops', 'sway', 'Sway', 'fx-sway — tilts back and forth. Amount is the angle.', [ms('--fx-sway-dur', 6000), amount('--fx-sway-amp', 0, 20, 0.5, 'deg')], 'class', chip),
  fx('Loops', 'wiggle', 'Wiggle', 'fx-wiggle — a quick shake, then rest. Amount is the angle.', [ms('--fx-wiggle-dur', 4000), amount('--fx-wiggle-amp', 0, 30, 0.5, 'deg')], 'class', chip),
  fx('Loops', 'glow-pulse', 'Glow pulse', 'fx-glow-pulse — a glow swells and fades. Amount is the radius.', [ms('--fx-glow-pulse-dur', 6000), amount('--fx-glow-pulse-amp', 0, 60, 1, 'px')], 'class', word()),
  fx('Loops', 'spin', 'Spin', 'fx-spin — slow rotation.', [ms('--fx-spin-dur', 20000)], 'class', tile),

  fx('Hits', 'shake', 'Shake', 'fx-shake — no. Amount is the distance.', [ms('--fx-shake-dur', 1200), amount('--fx-shake-amp', 0, 1, 0.01, 'em')], 'class', word()),
  fx('Hits', 'squash', 'Squash', 'fx-squash — squash and stretch. Amount is the squash.', [ms('--fx-squash-dur', 1200), amount('--fx-squash-amp', 0, 0.6, 0.01, '')], 'class', tile),
  fx('Hits', 'flash', 'Flash', 'fx-flash — a flash of brightness.', [ms('--fx-flash-dur', 1200)], 'class', word()),
  {
    id: 'fx-flash-tint',
    label: 'Flash (tint)',
    family: 'Hits',
    note: 'fx-flash fx-flash--tint — brightens and flashes the text to --fx-color (brass here).',
    subject: '.fx-flash',
    dials: [ms('--fx-flash-dur', 1200)],
    render: (lead) => (
      <div class="fx-stage">
        <p class={lead ? 'fx-demo' : 'fx-demo fx-flash fx-flash--tint'} style="--fx-color: var(--brass)">400</p>
      </div>
    ),
  },
  fx('Hits', 'ripple', 'Ripple', 'fx-ripple — a ring spreads out. Amount is the end scale.', [ms('--fx-ripple-dur', 2000), amount('--fx-ripple-amp', 1, 4, 0.05, '')], 'class', tile),
  fx('Hits', 'nudge', 'Nudge', 'fx-nudge — a small recoil. Amount is the distance.', [ms('--fx-nudge-dur', 1000), amount('--fx-nudge-amp', 0, 1, 0.01, 'em')], 'class', chip),
  fx('Hits', 'wobble', 'Wobble', 'fx-wobble — jelly. Amount is the skew.', [ms('--fx-wobble-dur', 2000), amount('--fx-wobble-amp', 0, 40, 0.5, 'deg')], 'class', tile),
  fx('Hits', 'tada', 'Tada', 'fx-tada — grow, tilt, settle. Amount is the scale.', [ms('--fx-tada-dur', 2000), amount('--fx-tada-amp', 1, 1.5, 0.01, '')], 'class', word()),

  fx('Text', 'wave', 'Wave', 'fx-wave on <Letters>. Amount is the height.', [ms('--fx-wave-dur', 4000), amount('--fx-wave-amp', 0, 1, 0.01, 'em'), STAGGER], 'class', letters('Ada wins')),
  fx('Text', 'rainbow', 'Rainbow', 'fx-rainbow on <Letters> — cycles the effect palette.', [ms('--fx-rainbow-dur', 8000)], 'class', letters('Ada wins')),
  fx('Text', 'cascade', 'Cascade', 'fx-cascade on <Letters> — letters pop in one by one.', [ms('--fx-cascade-dur', 1000), STAGGER], 'enter', letters('Ada wins')),
  fx('Text', 'jitter', 'Jitter', 'fx-jitter on <Letters> — nervous letters. Amount is the twitch.', [ms('--fx-jitter-dur', 4000), amount('--fx-jitter-amp', 0, 0.05, 0.001, 'em')], 'class', letters('Ada wins')),
  fx('Text', 'type', 'Type', 'fx-type on <Letters> — types itself out.', [ms('--fx-type-dur', 300, 'Per letter')], 'enter', letters('Ada wins the round')),
  fx('Text', 'shine', 'Shine', 'fx-shine — a highlight sweeps across.', [ms('--fx-shine-dur', 6000)], 'class', word('Winner')),
  fx('Text', 'glitch', 'Glitch', '<Glitch text> — CMY channels through quadrant windows, and a torn band. Bursts of stutter, then a breather; a new cut every burst. Amount is the shove.', [ms('--fx-glitch-dur', 1000, 'Burst'), ms('--fx-glitch-rest', 6000, 'Breather'), ms('--fx-glitch-flash', 300, 'Flash'), amount('--fx-glitch-amp', 0, 0.3, 0.01, 'em')], 'class', glitchWord),
  fx('Text', 'neon', 'Neon', 'fx-neon — flickers on and holds a glow.', [ms('--fx-neon-dur', 3000)], 'enter', word()),
  {
    id: 'fx-count',
    label: 'Count up',
    family: 'Text',
    note: '<CountUp to={400} /> — rolls up to its value. Not for measurements.',
    subject: '.fx-count',
    dials: [],
    render: (lead) => (
      <div class="fx-stage">
        <p class="fx-demo">{lead ? 0 : <CountUp to={400} />}</p>
      </div>
    ),
  },

  burst('sparkle', 'Sparkle', '<Burst kind="sparkle"> — warm glints around the element.'),
  burst('dust', 'Dust', '<Burst kind="dust"> — a puff to either side.'),
  burst('confetti', 'Confetti', '<Burst kind="confetti"> — the effect palette, thrown up and falling. Runs twice the duration.'),
  burst('embers', 'Embers', '<Burst kind="embers"> — sparks drifting up. Runs 1.5× the duration.'),
  burst('stars', 'Stars', '<Burst kind="stars"> — brass stars flung out.'),
  burst('emoji', 'Emoji', '<Burst kind="emoji" glyph="🦆"> — any glyph, flung up.'),
  burst('sparkle', 'Sparkle (edge)', '<Burst kind="sparkle" from="edge"> — along the whole outline, out from each side.', { from: 'edge' }),
  burst('dust', 'Dust (bottom)', '<Burst kind="dust" from="bottom"> — along the bottom edge, spreading sideways: something heavy landing.', { from: 'bottom' }),
  burst('dust', 'Dust (sides and bottom)', '<Burst kind="dust" from={[\'left\', \'bottom\', \'right\']}> — out of both sides and the bottom: the points stamp landing.', { from: ['left', 'bottom', 'right'] }),
  burst('confetti', 'Confetti (top)', '<Burst kind="confetti" from="top"> — off the whole top edge of a wide word.', { from: 'top' }),
]

/** The stage for Poker's motion: a patch of felt 576 × 320 px with a dealer off its top edge. */
const PATCH = { w: 576, h: 320 }
const pokerStage = (children: preact.ComponentChildren) => (
  <div class="fx-stage">
    <div class="felt felt--board poker-patch" style={{ width: `${PATCH.w}px`, height: `${PATCH.h}px`, '--card-w': '56px' }}>
      <div class="felt__lamp felt__lamp--centre" />
      <div class="poker-layer" style={{ '--lamp-x': PATCH.w / 2, '--lamp-y': PATCH.h / 2, '--lamp-reach': Math.hypot(PATCH.w, PATCH.h) / 2 }}>{children}</div>
    </div>
  </div>
)

/** Both ends of a range in toss.ts, as two dials. */
const range = (key: string, label: string, min: number, max: number, step: number, unit = ''): Dial[] => [
  { motion: `${key}.0`, label: `${label}, least`, min, max, step, unit },
  { motion: `${key}.1`, label: `${label}, most`, min, max, step, unit },
]
/** The lamp's shadow, on every card. Fractions of a card's width. */
const SHADOW: Dial[] = [
  { var: '--card-shadow-rest', label: 'Shadow at rest', min: 0, max: 0.1, step: 0.005, unit: '' },
  { var: '--card-shadow-drop', label: 'Shadow drop in the air', min: 0, max: 0.4, step: 0.01, unit: '' },
  { var: '--card-shadow-spread', label: 'Shadow spread in the air', min: 0, max: 0.3, step: 0.01, unit: '' },
  { var: '--card-shadow-dark', label: 'Shadow darkness in the air', min: 0, max: 0.5, step: 0.01, unit: '' },
]
/** Turning a card over, and how dark its face goes while it stands on its edge. */
const TURN: Dial[] = [
  { motion: 'REVEAL.hinge', label: 'Hinge, in from the lifted side', min: 0.5, max: 1, step: 0.01, unit: '' },
  { motion: 'REVEAL.turnMs', label: 'Turn over', min: 120, max: 900, step: 10, unit: 'ms' },
  { var: '--card-turn-shade', label: 'Face darkens on its edge', min: 0, max: 0.9, step: 0.01, unit: '' },
]
const FOLD_DIALS: Dial[] = [
  { motion: 'FOLD.reachThrown', label: 'Throw reach', min: 0, max: 0.8, step: 0.01, unit: '' },
  { motion: 'FOLD.reachFlick', label: 'Extra reach, full flick', min: 0, max: 0.8, step: 0.01, unit: '' },
  { motion: 'FOLD.reachSoft', label: 'Soft flick reach', min: 0, max: 0.8, step: 0.01, unit: '' },
  { motion: 'FOLD.reachTimeout', label: 'Timeout reach', min: 0, max: 0.6, step: 0.01, unit: '' },
  { motion: 'FOLD.reachVary', label: 'Reach varies ±', min: 0, max: 0.6, step: 0.01, unit: '' },
  { motion: 'FOLD.heading', label: 'Heading varies ±', min: 0, max: 30, step: 1, unit: '°' },
  { motion: 'FOLD.bend', label: 'Bend with the flick', min: 0, max: 45, step: 1, unit: '°' },
  { motion: 'FOLD.spinQuiet', label: 'Quiet spin', min: 0, max: 1.5, step: 0.05, unit: '°/ms' },
  ...range('FOLD.spinWild', 'Wild spin', 0, 4, 0.05, '°/ms'),
  { motion: 'TOSS.skidTau', label: 'Cloth drag', min: 50, max: 600, step: 10, unit: 'ms' },
  { motion: 'TOSS.spinTau', label: 'Spin drag', min: 20, max: 300, step: 5, unit: 'ms' },
  ...SHADOW,
]

/** A fold thrown into the middle, left to lie for a beat, then popped away. Physics tunables are `TOSS` in client/toss.ts. */
function foldScenario(id: string, label: string, flick: { dx: number; dy: number; speed: number } | null, wild: -1 | 0 | 1 = -1): Scenario {
  const from = { x: PATCH.w / 2, y: PATCH.h * 0.86, rot: -4 }
  const aim = { x: PATCH.w / 2, y: PATCH.h * 0.45 }
  return {
    id,
    label,
    family: 'Poker',
    note: `${label}: thrown with friction and spin, left to lie for a beat, then popped away. Tune FOLD and TOSS in client/toss.ts.`,
    subject: '.poker-piece',
    dials: FOLD_DIALS,
    render: (lead) => pokerStage(([0, 1] as const).map((k) => {
      const thrown = toss({ ...from, x: from.x + (k ? 16 : -16) }, aim, flick, mulberry32(k + 3), 0, k === wild)
      return <Piece key={`${k}-${lead}`} pose={lead ? from : thrown.rest} frames={lead ? null : chain(thrown.frames, 800 + k * 60, [thrown.frames[thrown.frames.length - 1]])}>
        <PlayingCard card={null} up={false} />
      </Piece>
    })),
  }
}

/** Two cards dealt to one seat: pitched loose from off the top edge, then gathered and tapped square. */
const dealScenario: Scenario = {
  id: 'poker-deal',
  label: 'Deal',
  family: 'Poker',
  note: 'Two cards pitched from the dealer land loose; the player gathers the pair and taps it square. Tune TOSS and RECEIVE in client/toss.ts.',
  subject: '.poker-piece',
  dials: [
    { motion: 'RECEIVE.scatter', label: 'Lands off its place', min: 0, max: 1, step: 0.01, unit: '' },
    { motion: 'RECEIVE.scatterRot', label: 'Lands off square', min: 0, max: 45, step: 1, unit: '°' },
    ...range('RECEIVE.reactMs', 'Reach for the pair', 0, 1000, 10, 'ms'),
    { motion: 'RECEIVE.squareRot', label: 'Askew once gathered', min: 0, max: 15, step: 0.5, unit: '°' },
    ...range('RECEIVE.tapDepth', 'Tap depth', 0, 0.08, 0.002),
    ...range('RECEIVE.tapMs', 'Each half of a tap', 20, 200, 5, 'ms'),
    ...range('RECEIVE.tapGap', 'Between taps', 20, 400, 10, 'ms'),
    { motion: 'TOSS.skidTau', label: 'Cloth drag', min: 50, max: 600, step: 10, unit: 'ms' },
    ...SHADOW,
  ],
  render: (lead) => {
    const neat = ([0, 1] as const).map((k) => ({ x: PATCH.w / 2 + (k ? 8 : -8), y: PATCH.h * 0.72, rot: k ? 3 : -2 }))
    const flights = neat.map((spot, k) => pitch({ x: PATCH.w / 2, y: -90 }, scatter(spot, 56, mulberry32(k + 21)), mulberry32(k + 11)))
    const collect = 150 + flights[1][flights[1].length - 1].t + 300
    return pokerStage(neat.map((spot, k) =>
      <Piece key={`${k}-${lead}`} pose={spot} frames={lead ? null : receive(flights[k], spot, collect - k * 150, mulberry32(31))} delay={k * 150}>
        <PlayingCard card={null} up={false} />
      </Piece>))
  },
}

const BOARD_SLOTS = [0, 1, 2, 3].map((i) => ({ x: PATCH.w / 2 + (i - 1.5) * 64 + (i % 2 ? 2 : -2), y: PATCH.h * 0.5 + (i === 1 ? 2 : -1), rot: [-1, 1.5, 0.5, -1.5][i] }))

/** The flop as the dealer lays it out: one face-down stack, a beat, turned over, spread left to right. */
const flopScenario: Scenario = {
  id: 'poker-flop',
  label: 'Flop',
  family: 'Poker',
  note: 'The flop lands as one face-down stack, is turned over, and spread left to right with one push. Tune REVEAL in client/toss.ts.',
  subject: '.poker-piece',
  dials: [
    ...range('REVEAL.stackIn', 'Stack lands right of slot 1', 0, 0.8, 0.01),
    ...range('REVEAL.stackRot', 'Stack lands off square', 0, 20, 0.5, '°'),
    ...range('REVEAL.stackStep', 'Each card ahead', 0, 0.2, 0.005),
    ...range('REVEAL.stackFan', 'Each card rides on', 0, 0.3, 0.005),
    ...range('REVEAL.stackTwist', 'Each card twisted', 0, 8, 0.25, '°'),
    ...range('REVEAL.beatMs', 'Lies face down', 0, 800, 10, 'ms'),
    ...range('REVEAL.afterTurnMs', 'Pause after turning', 0, 400, 10, 'ms'),
    { motion: 'REVEAL.spreadLag', label: 'Spread lag, up to', min: 0, max: 120, step: 5, unit: 'ms' },
    ...TURN,
    ...SHADOW,
  ],
  render: (lead) => {
    const laid = flop({ x: PATCH.w / 2, y: -90 }, BOARD_SLOTS.slice(0, 3), 56, mulberry32(41))
    return pokerStage(['Ah', 'Kd', '7c'].map((card, k) =>
      <Piece key={`${k}-${lead}`} pose={BOARD_SLOTS[k]} frames={lead ? null : laid.frames[k]}>
        <PlayingCard card={card} up hinge={lead ? undefined : laid.hinge} />
      </Piece>))
  },
}

/** The turn beside a flop that is already down: pitched a little off its slot, turned over, drawn into line. */
const streetScenario: Scenario = {
  id: 'poker-street',
  label: 'Turn card',
  family: 'Poker',
  note: 'A turn or river card lands face down off its slot, is turned over, and drawn into line. Tune REVEAL in client/toss.ts.',
  subject: '.poker-piece',
  dials: [
    ...range('REVEAL.offSlot', 'Lands off its slot', 0, 0.8, 0.01),
    ...range('REVEAL.offRot', 'Lands off square', 0, 25, 0.5, '°'),
    ...range('REVEAL.beatMs', 'Lies face down', 0, 800, 10, 'ms'),
    ...range('REVEAL.afterTurnMs', 'Pause after turning', 0, 400, 10, 'ms'),
    ...TURN,
    ...SHADOW,
  ],
  render: (lead) => {
    const laid = street({ x: PATCH.w / 2, y: -90 }, BOARD_SLOTS[3], 56, mulberry32(43))
    return pokerStage(['Ah', 'Kd', '7c', 'Qs'].map((card, i) => i < 3
      ? <Piece key={i} pose={BOARD_SLOTS[i]}><PlayingCard card={card} up /></Piece>
      : lead ? null : <Piece key={i} pose={BOARD_SLOTS[i]} frames={laid.frames}><PlayingCard card={card} up hinge={laid.hinge} /></Piece>))
  },
}

/** A player on the left of the table shows their pair at showdown, turning it over as one toward the middle. */
const showdownScenario: Scenario = {
  id: 'poker-showdown',
  label: 'Showdown',
  family: 'Poker',
  note: 'A player shows their pair: it turns over as one on the edge nearer the middle and comes down mirrored there. Tune REVEAL in client/toss.ts.',
  subject: '.poker-piece',
  dials: [...TURN, ...SHADOW],
  render: (lead) => {
    const middle = { x: PATCH.w / 2, y: PATCH.h / 2 }
    const pair = ([0, 1] as const).map((k) => ({ x: PATCH.w * 0.2 + (k ? 8 : -8), y: PATCH.h * 0.5 + (k ? 2 : 0), rot: 8 + (k ? 3 : -2) }))
    const shown = turnUp(pair, middle, 56)
    return pokerStage(pair.map((faceDown, k) => {
      return lead
        ? <Piece key={`${k}-down`} pose={faceDown}><PlayingCard card={null} up={false} /></Piece>
        : <Piece key={`${k}-up`} pose={shown[k].rest} frames={shown[k].frames}><PlayingCard card={k ? 'Kh' : 'Ks'} up hinge={shown[k].hinge} /></Piece>
    }))
  },
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'mark',
    family: 'Signature',
    label: 'A mark lands',
    note: 'Three marks are already down. The fourth arrives — which is what the board does all through the collection window, one packet at a time.',
    subject: '.timeline__mark',
    dials: [...STAMP, ...BLOOM],
    sound: 'stamp',
    render: (lead) => (
      <Stage mid={<p class="board__hero">Ada</p>} below={<Timeline held={lead ? 1 : 0} />} />
    ),
  },
  {
    id: 'leader',
    family: 'Signature',
    label: "The leader's name",
    note: 'The round resolves onto a stage whose timeline is already filling in.',
    subject: '.board__hero',
    dials: [
      { var: '--slam-dur', label: 'Slam', min: 60, max: 800, step: 10, unit: 'ms' },
      { var: '--slam-scale', label: 'From scale', min: 1, max: 2, step: 0.05, unit: '' },
      { var: '--flare-dur', label: 'Flare', min: 200, max: 3000, step: 20, unit: 'ms' },
      { var: '--flare-fall', label: 'Cool ease', text: true },
      { var: '--flare-core', label: 'Core', min: 0, max: 100, step: 2, unit: 'px' },
      { var: '--flare-body', label: 'Body', min: 0, max: 200, step: 4, unit: 'px' },
      { var: '--flare-throw', label: 'Throw', min: 0, max: 400, step: 5, unit: 'px' },
    ],
    sound: 'leader',
    // The ghost keeps the middle band open while the name is held back. An
    // empty band collapses, and the timeline underneath would step up and back
    // down on every take — motion the board does not have, in the exact place
    // you are trying to judge some.
    render: (lead) => (
      <Stage
        mid={lead ? <div class="harness__ghost" /> : <p class="board__hero">Alexander</p>}
        below={<Timeline />}
      />
    ),
  },
  {
    id: 'award',
    family: 'Signature',
    label: 'The award',
    note: 'The host scores it. The name and the timeline have been up for a while; only the points are new.',
    subject: '.board__award',
    dials: [
      { var: '--strike-dur', label: 'Strike', min: 80, max: 900, step: 10, unit: 'ms' },
      { var: '--strike-scale', label: 'From scale', min: 1, max: 3, step: 0.05, unit: '' },
      { var: '--strike-recoil', label: 'Recoil', min: 0.7, max: 1.1, step: 0.01, unit: '' },
    ],
    sound: 'award',
    render: (lead) => (
      <Stage
        above={!lead && <p class="board__award">+400</p>}
        mid={<p class="board__hero">Ada</p>}
        below={<Timeline />}
      />
    ),
  },
  {
    id: 'penalty',
    family: 'Signature',
    label: 'The penalty',
    note: 'A wrong answer that costs. Same stamp as the award, tally-red, and the room is already buzzing again below it.',
    subject: '.board__award',
    dials: [
      { var: '--strike-dur', label: 'Strike', min: 80, max: 900, step: 10, unit: 'ms' },
      { var: '--strike-scale', label: 'From scale', min: 1, max: 3, step: 0.05, unit: '' },
      { var: '--strike-recoil', label: 'Recoil', min: 0.7, max: 1.1, step: 0.01, unit: '' },
    ],
    sound: 'penalty',
    render: (lead) => (
      // The frame the penalty belongs to: somebody answered. The board clears
      // the name in the same broadcast that stamps the −400, but this is the
      // stage the room reads the moment against.
      <Stage
        above={!lead && <p class="board__award is-neg">−400</p>}
        mid={<p class="board__hero">Ada</p>}
        below={<Timeline />}
      />
    ),
  },
  {
    id: 'open',
    family: 'Signature',
    label: 'The buzzers open',
    note: 'Waiting, then live. The same element changes class here exactly as it does on the board, so the punch fires off the class and not a remount.',
    subject: '.board__call',
    dials: [
      { var: '--punch-dur', label: 'Punch', min: 30, max: 500, step: 10, unit: 'ms' },
      { var: '--punch-scale', label: 'From scale', min: 1, max: 1.6, step: 0.02, unit: '' },
    ],
    render: (lead) => (
      <Stage
        mid={lead ? <p class="board__idle">Ready</p> : <p class="board__call">Buzz</p>}
      />
    ),
  },
  {
    id: 'press',
    family: 'Signature',
    label: 'Your press registers',
    note: 'The buzzer is open under your thumb, then the press lands. A class change on the same button, as on the phone.',
    subject: '.buzzer',
    dials: [{ var: '--land-dur', label: 'Land', min: 60, max: 900, step: 10, unit: 'ms' }],
    render: (lead) => (
      <main class="player" style={{ height: '30rem', maxWidth: '22rem', margin: '0 auto' }}>
        <div class="player__bar">
          <span class="player__name" style={{ '--id': 'var(--id-1)' }}>Ada</span>
          <span class="lamp">
            <span class="lamp-dot is-on" />
            Connected
          </span>
          <span class="player__score readout">400</span>
        </div>
        <button class={lead ? 'buzzer is-open' : 'buzzer is-placed'}>
          {lead ? 'Buzz' : 'In'}
          {!lead && <span class="buzzer__sub">Counting the rest of the field</span>}
        </button>
      </main>
    ),
  },
  {
    id: 'vote',
    family: 'Signature',
    label: 'A vote lands',
    // The pool below carries a duel mid-vote, because a single figure arriving
    // beside an empty name reads nothing like the same figure joining a row
    // that already has three — and the second is what a real window looks like
    // for all but its first second.
    note: 'The nomination window is open and the room is voting. Bo picks up one more, which is what this board does every second or two while the window is up.',
    subject: '.vote',
    dials: [
      { var: '--cast-dur', label: 'Cast', min: 60, max: 800, step: 10, unit: 'ms' },
      { var: '--cast-scale', label: 'From scale', min: 1, max: 4, step: 0.05, unit: '' },
      { var: '--cast-rise', label: 'Drop from', min: 0, max: 2, step: 0.05, unit: 'em' },
      { var: '--cast-flare-dur', label: 'Flare', min: 100, max: 2000, step: 20, unit: 'ms' },
      { var: '--cast-glow', label: 'Glow', min: 0, max: 60, step: 1, unit: 'px' },
    ],
    render: (lead) => (
      <Stage
        mid={
          <div class="board__noms">
            <p class="board__idle">Who plays?</p>
            <ol class="board__pool">
              {[
                { name: 'Bo', votes: lead ? 3 : 4 },
                { name: 'Ada', votes: 3 },
                { name: 'Cy', votes: 1 },
              ].map((n, i) => (
                <li key={n.name} class={i < 2 ? 'nom is-lead' : 'nom'}>
                  <span class="nom__name">{n.name}</span>
                  <Votes voters={VOTERS.slice(0, n.votes)} />
                </li>
              ))}
            </ol>
          </div>
        }
      />
    ),
  },
  {
    id: 'spoken',
    family: 'Signature',
    label: 'The spoken verdict',
    note: 'The judge has heard the leader and the transcript types itself out, a word or two a tap, in the colour it was said in. It holds, and only then turns brass or red — on the board the award stamp lands on that same instant. The name and timeline are already up; only the line is new.',
    subject: '.board__spoken',
    dials: [
      { var: '--type-chunk', label: 'Chunk pace', min: 60, max: 600, step: 10, unit: 'ms' },
      { var: '--verdict-hold', label: 'Verdict hold', min: 0, max: 1500, step: 50, unit: 'ms' },
    ],
    // Not `sound`: the taps are not one cue fired on the trigger but one per
    // chunk, and Spoken fires them itself as each lands. `tune` puts the `type`
    // recipe's layers and dials in the panel without a tap on the trigger.
    tune: 'type',
    render: (lead) => (
      <Stage
        above={
          !lead && <Spoken prefix="board" transcript="the hundred years war" hit />
        }
        mid={<p class="board__hero">Ada</p>}
        below={<Timeline />}
      />
    ),
  },
  ...FX,
  {
    id: 'finale',
    label: 'The finale',
    family: 'Quiz',
    note: 'The last block of the setlist is done. A brass spotlight comes up, a white flash, then the winner takes the stage in the effect palette.',
    subject: '.board__finale-flash, .board__finale',
    dials: [ms('--fx-rainbow-dur', 6000), ms('--fx-burst-dur', 2000, 'Confetti')],
    render: (lead) => <Stage mid={lead ? <div class="harness__ghost" /> : <Finale names={['Ada']} />} />,
  },
  {
    id: 'faceoff',
    label: 'The face-off',
    family: 'Quiz',
    note: 'The host seats the pair. Each name charges in from its side and the dust goes up where they stop.',
    subject: '.board__faceoff',
    dials: [ms('--faceoff-slide-dur', 1500, 'Charge'), amount('--faceoff-dust-amp', 0, 20, 0.5, 'em', 'Dust')],
    render: (lead) => <Stage mid={lead ? <div class="harness__ghost" /> : <FaceOff pair={['Ada', 'Bo']} />} />,
  },
  dealScenario,
  flopScenario,
  streetScenario,
  showdownScenario,
  foldScenario('poker-fold-hard', 'Fold, hard flick, one card gets away', { dx: 0.2, dy: -0.98, speed: 1 }, 1),
  foldScenario('poker-fold-soft', 'Fold, soft flick', { dx: -0.3, dy: -0.95, speed: 0.2 }),
  foldScenario('poker-fold-timeout', 'Fold, timed out', null),
]
