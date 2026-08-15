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
 * The dials name custom properties from the `anim:tunables` block in style.css.
 * Nothing here restates a duration or a colour: the harness sets those
 * properties on a wrapper and the real rules pick them up, so a scenario cannot
 * drift from what the board actually does.
 *
 * Adding one is markup plus the dials you want to reach. There is no
 * registration step beyond this array.
 */
import { COLLECT_MS } from '../../shared/protocol.ts'

export type Dial =
  | { var: string; label: string; min: number; max: number; step: number; unit: string }
  | { var: string; label: string; text: true }

export type Scenario = {
  id: string
  label: string
  /** One line on what the moment is, shown above the stage. */
  note: string
  dials: Dial[]
  render: () => preact.JSX.Element
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
  { name: 'Ada', ms: 0, lane: 0, id: 'var(--id-1)' },
  { name: 'Bo', ms: 180, lane: 0, id: 'var(--id-3)' },
  { name: 'Cy', ms: 430, lane: 0, id: 'var(--id-6)' },
  { name: 'Dee', ms: 720, lane: 0, id: 'var(--id-4)' },
]

function Timeline() {
  return (
    <div class="timeline">
      <div class="timeline__scale">
        <span>0 ms</span>
        <span>{COLLECT_MS} ms</span>
      </div>
      <div class="timeline__rail" />
      <ol class="timeline__marks" style={{ '--lanes': 1 }}>
        {MARKS.map((m) => (
          <li
            key={m.name}
            class="timeline__mark"
            style={{
              '--at': `${(m.ms / COLLECT_MS) * 100}%`,
              '--lane': m.lane,
              '--id': m.id,
            }}
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
  mid: preact.JSX.Element
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
    note: 'Four marks mount at once here. On the board they arrive one at a time as packets land, so watch a single pin — the stagger is real, the simultaneity is not.',
    dials: [...STAMP, ...BLOOM],
    render: () => <Stage mid={<p class="board__hero">Ada</p>} below={<Timeline />} />,
  },
  {
    id: 'leader',
    label: "The leader's name",
    note: 'Mounts when the round resolves, with its timeline assembling underneath.',
    dials: [
      { var: '--slam-dur', label: 'Slam', min: 60, max: 800, step: 10, unit: 'ms' },
      { var: '--slam-scale', label: 'From scale', min: 1, max: 2, step: 0.05, unit: '' },
      { var: '--flare-dur', label: 'Flare', min: 200, max: 3000, step: 20, unit: 'ms' },
      { var: '--bloom-rise', label: 'Rise ease', text: true },
      { var: '--flare-core', label: 'Core', min: 0, max: 100, step: 2, unit: 'px' },
      { var: '--flare-body', label: 'Body', min: 0, max: 200, step: 4, unit: 'px' },
      { var: '--flare-throw', label: 'Throw', min: 0, max: 400, step: 5, unit: 'px' },
    ],
    render: () => <Stage mid={<p class="board__hero">Alexander</p>} below={<Timeline />} />,
  },
  {
    id: 'award',
    label: 'The award',
    note: 'The only moment the score actually changes, so it carries the heaviest stamp.',
    dials: [
      { var: '--strike-dur', label: 'Strike', min: 80, max: 900, step: 10, unit: 'ms' },
      { var: '--strike-scale', label: 'From scale', min: 1, max: 3, step: 0.05, unit: '' },
      { var: '--strike-recoil', label: 'Recoil', min: 0.7, max: 1.1, step: 0.01, unit: '' },
    ],
    render: () => (
      <Stage
        above={<p class="board__award">+400</p>}
        mid={<p class="board__hero">Ada</p>}
        below={<Timeline />}
      />
    ),
  },
  {
    id: 'open',
    label: 'The buzzers open',
    note: 'The loudest instant of the round, and the only one every surface shares. The filament is held hot here rather than warming up.',
    dials: [
      { var: '--punch-dur', label: 'Punch', min: 30, max: 500, step: 10, unit: 'ms' },
      { var: '--punch-scale', label: 'From scale', min: 1, max: 1.6, step: 0.02, unit: '' },
    ],
    render: () => (
      <Stage
        mid={<p class="board__call">Buzz</p>}
        below={
          <>
            <div class="board__lead-in">
              <div class="filament is-hot" />
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
    note: 'On the phone, in the second between the press and the result.',
    dials: [{ var: '--land-dur', label: 'Land', min: 60, max: 900, step: 10, unit: 'ms' }],
    render: () => (
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
        <button class="buzzer is-placed">
          In
          <span class="buzzer__sub">Counting the rest of the field</span>
        </button>
      </main>
    ),
  },
]
