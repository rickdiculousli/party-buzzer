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
import type { Recipe } from '../synth.ts'

/**
 * A number the harness can move.
 *
 * Two kinds, told apart by which one they address: `var` is a CSS custom
 * property in the `anim:tunables` block, `recipe` is a field in a cue's recipe
 * written as `cue.layer.field`. Everything downstream — the slider, the origin
 * marker, the dirty state, Save — works the same on both, which is the point of
 * giving them one type.
 */
export type Dial =
  | { var: string; label: string; min: number; max: number; step: number; unit: string }
  | { var: string; label: string; text: true }
  | { recipe: string; label: string; min: number; max: number; step: number; unit: string }

/** What a dial is stored under. The two kinds never collide: one has dashes. */
export const dialKey = (d: Dial) => ('var' in d ? d.var : d.recipe)

export type Scenario = {
  id: string
  label: string
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
  sustain: { max: 1, step: 0.05, unit: '' },
  hold: { max: 4000, step: 20, unit: 'ms' },
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
    <section class="board__stage">
      <div class="board__above">{above}</div>
      <div class="board__mid">{mid}</div>
      <div class="board__below">{below}</div>
    </section>
  )
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'mark',
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
    label: 'The award',
    note: 'The host scores it. The name and the timeline have been up for a while; only the points are new.',
    subject: '.board__award',
    dials: [
      { var: '--strike-dur', label: 'Strike', min: 80, max: 900, step: 10, unit: 'ms' },
      { var: '--strike-scale', label: 'From scale', min: 1, max: 3, step: 0.05, unit: '' },
      { var: '--strike-recoil', label: 'Recoil', min: 0.7, max: 1.1, step: 0.01, unit: '' },
    ],
    // No cue. The award is silent until there is a sample that belongs to it —
    // the third file turned out to be the welcome bed, which is music that runs
    // rather than a sound that fires, and has no business on a moment.
    render: (lead) => (
      <Stage
        above={!lead && <p class="board__award">+400</p>}
        mid={<p class="board__hero">Ada</p>}
        below={<Timeline />}
      />
    ),
  },
  {
    id: 'open',
    label: 'The buzzers open',
    note: 'Standing by, then live. The same element changes class here exactly as it does on the board, so the punch fires off the class and not a remount.',
    subject: '.board__call',
    dials: [
      { var: '--punch-dur', label: 'Punch', min: 30, max: 500, step: 10, unit: 'ms' },
      { var: '--punch-scale', label: 'From scale', min: 1, max: 1.6, step: 0.02, unit: '' },
    ],
    render: (lead) => (
      <Stage
        mid={lead ? <p class="board__idle">Stand by</p> : <p class="board__call">Buzz</p>}
        below={
          <>
            <div class="board__lead-in">
              <div class={lead ? 'filament' : 'filament is-hot'} style={{ '--lead': '900ms' }} />
            </div>
            <p class="board__value">400</p>
          </>
        }
      />
    ),
  },
  {
    id: 'press',
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
        <div class="player__lead-in" />
        <button class={lead ? 'buzzer is-open' : 'buzzer is-placed'}>
          {lead ? 'Buzz' : 'In'}
          {!lead && <span class="buzzer__sub">Counting the rest of the field</span>}
        </button>
      </main>
    ),
  },
]
