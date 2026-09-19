# Question Kinds (shown, choice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one pack mix read, shown and multiple-choice questions, with the reader driving each kind.

**Architecture:** A question carries its kind in the pack (`K:` / `C:` lines). The reader's per-question body splits into `speakQuestion` (read and shown differ by one flag) and `runChoice`. Choice questions get new `Round` fields, a player `pick` act, a `settleChoice` host action that scores every right pick, and a `choice` moment family. The board keeps its three bands: the question is the mid-band clue and the choice grid sits in the below band.

**Tech Stack:** Node (type-stripped TypeScript), Preact, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-19-question-kinds-design.md`

## Global Constraints

- Read `AGENTS.md` first. No TypeScript enums or parameter properties; relative imports end in `.ts`.
- `shared/` never imports from `server/`.
- `Hub.dispatch` stays the only commit path for host actions; refused or unchanged actions must not change state.
- `shared/wall.ts` stays pure: no DOM, clocks or colours. `momentOf` reads only fields every role receives (`kind`, `choices`, `correct`, `closesAt`), never `picks` or `order`.
- Use design tokens and existing interest-kit classes; no new keyframes.
- Comments describe the code as it is now, never its history.
- After each task: `npm test` and `npm run typecheck` pass.
- Choice limits: 2 to 6 choices. `choiceSec` default 20, clamped 5 to 120.

## File Map

| File | Change |
| --- | --- |
| `shared/pack.ts` | `K:` and `C:` lines; `Question.kind`, `choices`, `correct` |
| `shared/choice.ts` (new) | `pickers`, `allPicked`, `optionsText`, `LETTERS` |
| `shared/protocol.ts` | `Round` fields, `State.choiceSec`, `arm.kind`, `settleChoice`, `setChoiceTime` |
| `shared/legality.ts` | `no-choice` refusal and the two new actions |
| `server/state.ts` | arm/next/setMode clear the new fields; `settleChoice`; `setChoiceTime`; load default |
| `server/snapshot.ts` | persist `choiceSec` |
| `server/eligibility.ts` | buzz refused on choice; `pickBlockReason` |
| `server/hub.ts` | `pick`, `choices`, `closesAt`, `closeChoice` acts; `viewFor` redaction |
| `server/reader.ts` | `speakQuestion`, `runChoice`, `closeChoice`, options clip |
| `shared/wall.ts` | `choice:*` moments, `Wall.choices`, phone rows |
| `client/ui.ts` | refusal text |
| `client/Host.tsx`, `client/HostSetup.tsx` | desk notes, Close picking, choice time |
| `client/Board.tsx`, `client/Player.tsx`, `client/style.css` | grid, stamp, pick buttons |
| `tools/review/fixtures.ts` | two choice scenarios |
| Docs | `README.md`, `ARCHTECTURE.md`, `docs/design.md`, `docs/question-styles/` |

---

### Task 1: Pack format

**Files:**
- Modify: `shared/pack.ts`
- Test: `shared/pack.test.ts`

**Interfaces:**
- Produces: `Question.kind?: 'shown' | 'choice'` (absent = read), `Question.choices?: string[]`, `Question.correct?: number` (index into `choices`; set exactly when `choices` is).

- [ ] **Step 1: Write the failing tests** (append to `shared/pack.test.ts`)

```ts
test('K: shown marks a question shown; K: read is the default', () => {
  const { questions, errors } = parsePack(`K: shown
Shown question.
A: yes

K: read
Read question.
A: yes
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].kind, 'shown')
  assert.equal(questions[1].kind, undefined)
})

test('a C: line makes a choice question and records the right index', () => {
  const { questions, errors } = parsePack(`V: 200
C: Mars | Venus | Saturn | Jupiter
Which planet has the most moons?
A: saturn
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].kind, 'choice')
  assert.deepEqual(questions[0].choices, ['Mars', 'Venus', 'Saturn', 'Jupiter'])
  assert.equal(questions[0].correct, 2)
  assert.equal(questions[0].value, 200)
})

test('bad choice questions are skipped with a reason', () => {
  const { questions, errors } = parsePack(`C: Mars | Venus
Q one.
A: Pluto

C: Only
Q two.
A: Only

C: a | b | c | d | e | f | g
Q three.
A: a

K: shown
C: a | b
Q four.
A: a

K: choice
Q five.
A: a
`)
  assert.equal(questions.length, 0)
  assert.equal(errors.length, 5)
  assert.match(errors[0], /must equal one of the C: choices/)
  assert.match(errors[1], /2 to 6/)
  assert.match(errors[2], /2 to 6/)
  assert.match(errors[3], /K: shown/)
  assert.match(errors[4], /K: must be read or shown/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test shared/pack.test.ts`
Expected: the three new tests fail (`kind` undefined, `K:` and `C:` lines parsed as fragments).

- [ ] **Step 3: Implement in `shared/pack.ts`**

Extend the header comment:

```
 *   K: shown                        optional; shown on the board whole, still read aloud
 *   C: Mars | Venus | Saturn        optional; makes a multiple-choice question,
 *                                   and A: must equal one choice
```

Add to `Question`:

```ts
  /** Absent = read: revealed clause by clause as it is spoken. */
  kind?: 'shown' | 'choice'
  /** Choice questions only, in display order. */
  choices?: string[]
  /** Index into `choices` of the right one. Set exactly when `choices` is. */
  correct?: number
```

In `parsePack`, add state beside `image`:

```ts
  let kind: 'shown' | undefined
  let choices: string[] | undefined
  let kindError: string | undefined
```

Replace `flush` with:

```ts
  const flush = () => {
    if (value === undefined && fragments.length === 0 && !answer && !image && !kind && !choices && !kindError) return
    if (kindError) {
      errors.push(kindError)
    } else if (fragments.length === 0 || !answer) {
      errors.push(`line ${startLine}: a question needs at least one fragment and an A: line`)
    } else if (choices) {
      const correct = choices.findIndex((c) => c.toLowerCase() === answer.toLowerCase())
      if (kind === 'shown') {
        errors.push(`line ${startLine}: a C: line makes a choice question; drop K: shown`)
      } else if (choices.length < 2 || choices.length > 6) {
        errors.push(`line ${startLine}: a choice question needs 2 to 6 choices`)
      } else if (correct < 0) {
        errors.push(`line ${startLine}: A: must equal one of the C: choices`)
      } else {
        questions.push({ value, fragments, answer, answers: variants, kind: 'choice', choices, correct, ...(image && { image }) })
      }
    } else {
      questions.push({ value, fragments, answer, answers: variants, ...(kind && { kind }), ...(image && { image }) })
    }
    value = undefined
    fragments = []
    answer = ''
    variants = []
    image = undefined
    kind = undefined
    choices = undefined
    kindError = undefined
  }
```

Inside the line loop, before the `I:` branch:

```ts
    if (line.startsWith('K:')) {
      const k = line.slice(2).trim()
      if (k === 'shown') kind = 'shown'
      else if (k !== 'read') kindError = `line ${n}: K: must be read or shown; a C: line makes a choice question`
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('C:')) {
      choices = line.slice(2).split(' | ').map((s) => s.trim()).filter(Boolean)
      if (fragments.length === 0) startLine = n
      return
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test shared/pack.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add shared/pack.ts shared/pack.test.ts
git commit -m "feat: K: and C: lines give a question its kind"
```

---

### Task 2: Choice rules in state

**Files:**
- Create: `shared/choice.ts`
- Modify: `shared/protocol.ts`, `shared/legality.ts`, `server/state.ts`, `server/snapshot.ts`, `client/ui.ts`
- Test: `server/actions.test.ts`, `shared/legality.test.ts`

**Interfaces:**
- Produces on `Round`: `kind?: 'shown' | 'choice'`, `choices?: string[]`, `closesAt?: number`, `picks?: Record<PlayerId, number>`, `correct?: number`.
- Produces on `State`: `choiceSec: number`.
- Produces `HostAction`: `{ a: 'arm'; kind?: 'shown' | 'choice' }` (replacing `{ a: 'arm' }`), `{ a: 'settleChoice'; correct: number }`, `{ a: 'setChoiceTime'; sec: number }`.
- Produces `Refusal`: `'no-choice'`.
- Produces from `shared/choice.ts`: `pickers(state: State): PlayerId[]`, `allPicked(state: State): boolean`, `optionsText(choices: string[]): string`, `LETTERS: string`.

- [ ] **Step 1: Write the failing tests** (append to `server/actions.test.ts`)

```ts
function choiceRoom() {
  const state = newState()
  state.players = [
    { id: 'ada', name: 'Ada', connected: true },
    { id: 'bo', name: 'Bo', connected: true },
    { id: 'cy', name: 'Cy', connected: true },
  ]
  applyHostAction(state, { a: 'arm', kind: 'choice' })
  state.round.value = 300
  state.round.choices = ['Mars', 'Saturn', 'Venus']
  state.round.picks = { ada: 1, bo: 1, cy: 0 }
  return state
}

test('settleChoice pays each right pick the value and costs a wrong pick nothing', () => {
  const state = choiceRoom()
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 1 }), { status: 'applied' })
  assert.equal(state.scores.ada, 300)
  assert.equal(state.scores.bo, 300)
  assert.equal(state.scores.cy ?? 0, 0)
  assert.equal(state.round.correct, 1)
  assert.equal(state.round.phase, 'IDLE')
  assert.equal(state.round.award, undefined, 'no hero, no stamp')
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 1 }), { status: 'refused', reason: 'no-choice' })
})

test('settleChoice pays a team once per right member', () => {
  const state = choiceRoom()
  state.grouping = 'teams'
  state.teams = [{ id: 'red', name: 'Red', color: '#f00' }, { id: 'blue', name: 'Blue', color: '#00f' }]
  state.players[0].teamId = 'red'
  state.players[1].teamId = 'red'
  state.players[2].teamId = 'blue'
  applyHostAction(state, { a: 'settleChoice', correct: 1 })
  assert.equal(state.scores.red, 600)
  assert.equal(state.scores.blue ?? 0, 0)
})

test('settleChoice is refused on a buzz question, before choices, and out of range', () => {
  const state = newState()
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 0 }), { status: 'refused', reason: 'no-choice' })
  applyHostAction(state, { a: 'arm', kind: 'choice' })
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 0 }), { status: 'refused', reason: 'no-choice' })
  state.round.choices = ['a', 'b']
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 2 }), { status: 'refused', reason: 'no-choice' })
})

test('arm and next sweep the choice fields', () => {
  const state = choiceRoom()
  state.round.closesAt = 5
  applyHostAction(state, { a: 'settleChoice', correct: 1 })
  applyHostAction(state, { a: 'next' })
  for (const k of ['kind', 'choices', 'picks', 'closesAt', 'correct'] as const) {
    assert.equal(state.round[k], undefined, k)
  }
  applyHostAction(state, { a: 'arm', kind: 'shown' })
  assert.equal(state.round.kind, 'shown')
  applyHostAction(state, { a: 'arm' })
  assert.equal(state.round.kind, undefined)
})

test('undo takes back a settled choice question', () => {
  const { state, hub } = rig()
  Object.assign(state, choiceRoom())
  hub.dispatch({ a: 'settleChoice', correct: 1 })
  assert.equal(state.scores.ada, 300)
  hub.dispatch({ a: 'undo' })
  assert.equal(state.scores.ada ?? 0, 0)
  assert.equal(state.round.correct, undefined)
  assert.deepEqual(state.round.picks, { ada: 1, bo: 1, cy: 0 })
})

test('setChoiceTime clamps to 5..120', () => {
  const state = newState()
  assert.equal(state.choiceSec, 20)
  applyHostAction(state, { a: 'setChoiceTime', sec: 1 })
  assert.equal(state.choiceSec, 5)
  applyHostAction(state, { a: 'setChoiceTime', sec: 500 })
  assert.equal(state.choiceSec, 120)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/actions.test.ts`
Expected: FAIL. `settleChoice` and `setChoiceTime` are unknown, and `choiceSec` is undefined.

- [ ] **Step 3: Protocol** (`shared/protocol.ts`)

Add to `Round`, after `answer`:

```ts
  /** How the question is put to the room. Absent = read aloud and revealed as it is spoken. */
  kind?: 'shown' | 'choice'
  /** A choice question's options, published once the question has been read. Every role sees them. */
  choices?: string[]
  /** Server-time end of picking, set when the voice finishes reading the options. */
  closesAt?: number
  /** Each player's pick, by index. Host and board see all; a phone sees its own. */
  picks?: Record<PlayerId, number>
  /** The right option, set when picking closes. Its presence is what "revealed" means. */
  correct?: number
```

Add to `State`, after `answerWindowSec`:

```ts
  /** Seconds of picking after the voice has read a choice question's options. */
  choiceSec: number
```

In `HostAction`, replace `| { a: 'arm' }` with `| { a: 'arm'; kind?: 'shown' | 'choice' }` and add:

```ts
  | { a: 'settleChoice'; correct: number }
  | { a: 'setChoiceTime'; sec: number }
```

- [ ] **Step 4: `shared/choice.ts`**

```ts
/**
 * Multiple-choice questions: who may pick, and what the voice reads after the
 * question. Shared so the board's "6 of 9 in" and the reader's "everyone has
 * picked" count the same players.
 */
import type { PlayerId, State } from './protocol.ts'

export const LETTERS = 'ABCDEF'

/** Connected, seated if a duel set a pair, and not frozen for this attempt. */
export function pickers(state: State): PlayerId[] {
  const r = state.round
  return state.players
    .filter((p) => p.connected)
    .filter((p) => !r.buzzable || r.buzzable.includes(p.id))
    .filter((p) => !state.effects.some((e) => e.kind === 'frozen' && e.playerId === p.id && e.attemptId === r.attemptId))
    .map((p) => p.id)
}

/** False with nobody eligible, so an empty room waits for the timer. */
export function allPicked(state: State): boolean {
  const who = pickers(state)
  return who.length > 0 && who.every((id) => state.round.picks?.[id] !== undefined)
}

/** "A, Mars. B, Venus." */
export function optionsText(choices: string[]): string {
  return choices.map((c, i) => `${LETTERS[i]}, ${c}.`).join(' ')
}
```

- [ ] **Step 5: Legality** (`shared/legality.ts`)

Add `| 'no-choice'` to `Refusal`. Add cases to `refuses`:

```ts
    // Only while a choice question's options are up and nothing has been revealed.
    case 'settleChoice':
      return r.kind === 'choice' && r.choices && r.correct === undefined &&
        Number.isInteger(a.correct) && a.correct >= 0 && a.correct < r.choices.length
        ? null
        : 'no-choice'
```

Add `case 'setChoiceTime':` to the settings group that returns `null` (beside `setAnswerWindow`).

In `client/ui.ts` `REFUSAL_TEXT`, add:

```ts
  'no-choice': 'No choice question is taking picks.',
```

- [ ] **Step 6: State** (`server/state.ts`)

Add a sweep helper above `applyHostAction` and use it to replace the duplicated `delete round.fragments` … `delete round.answer` runs in `arm`, `next`/`resetRound` and `setMode`:

```ts
/** Everything a question put on the round. Cleared whenever a question ends or starts. */
function clearQuestion(round: State['round']): void {
  delete round.award
  delete round.held
  delete round.fragments
  delete round.whole
  delete round.image
  delete round.answer
  delete round.kind
  delete round.choices
  delete round.closesAt
  delete round.picks
  delete round.correct
}
```

In `arm` and `next`/`resetRound`, keep the separate `delete round.judge`, `delete round.spoken` and `delete round.buzzable` lines. At the end of the `arm` field resets, after `clearQuestion(round)`, add:

```ts
      if (action.kind) round.kind = action.kind
```

Add cases:

```ts
    case 'settleChoice':
      for (const [playerId, pick] of Object.entries(round.picks ?? {})) {
        if (pick === action.correct) bump(state, scoreKey(state, playerId), round.value)
      }
      round.correct = action.correct
      round.phase = 'IDLE'
      return

    case 'setChoiceTime':
      state.choiceSec = Math.min(120, Math.max(5, Math.round(action.sec) || 20))
      return
```

In `newState()`, after `answerWindowSec: 10,`:

```ts
    choiceSec: 20,
```

In `loadState`, after the `answerWindowSec` default:

```ts
    if (typeof loaded.choiceSec !== 'number') loaded.choiceSec = 20
```

In `server/snapshot.ts` `persistedSnapshot`, after `answerWindowSec`:

```ts
      choiceSec: state.choiceSec,
```

Every `State` object literal must now have `choiceSec`. Find them with `grep -rn "answerWindowSec: " server shared client tools`, and add `choiceSec: 20,` beside each (for example `room()` in `shared/wall.test.ts`).

- [ ] **Step 7: Run to verify pass**

Run: `node --test server/actions.test.ts shared/legality.test.ts && npm run typecheck`
Expected: PASS. If `shared/legality.test.ts` enumerates every action, add `settleChoice` and `setChoiceTime` rows matching the rules above.

- [ ] **Step 8: Commit**

```bash
git add shared/choice.ts shared/protocol.ts shared/legality.ts server/state.ts server/snapshot.ts client/ui.ts server/actions.test.ts shared/legality.test.ts shared/wall.test.ts
git commit -m "feat: choice questions settle by paying every right pick"
```

---

### Task 3: Picks, acts and redaction in the hub

**Files:**
- Modify: `server/eligibility.ts`, `server/hub.ts`
- Test: `server/hub.test.ts`

**Interfaces:**
- Consumes: `pickers` from `shared/choice.ts`; the Task 2 `Round` fields.
- Produces: `pickBlockReason(state: State, playerId: PlayerId, at?: number): string | null`; player act `pick` (data: option index); host acts `choices` (data: `string[]`), `closesAt` (data: `number`), `closeChoice`; `ReaderControls.closeChoice(): void`.

- [ ] **Step 1: Write the failing tests** (append to `server/hub.test.ts`, adding imports if absent: `Hub`, `Conn` from `./hub.ts`, `newState` from `./state.ts`)

```ts
function pickRig() {
  const state = newState()
  const hub = new Hub(state, { collectMs: 30, revealMs: 10 })
  const host: Conn = { id: 'h', role: 'host', send() {} }
  const phone = (id: string): Conn => {
    const conn: Conn = { id, playerId: id, role: 'player', send() {} }
    hub.handle(conn, { t: 'hello', role: 'player', name: id, playerId: id })
    return conn
  }
  const ada = phone('ada')
  const bo = phone('bo')
  hub.dispatch({ a: 'arm', kind: 'choice' })
  state.round.armedAt = Date.now() - 10
  return { state, hub, host, ada, bo }
}

test('a pick is taken once, only while picking is open, and a buzz is refused', () => {
  const { state, hub, host, ada, bo } = pickRig()
  hub.handle(ada, { t: 'act', act: 'pick', data: 0 })
  assert.equal(state.round.picks, undefined, 'no pick before the choices are up')
  hub.handle(host, { t: 'act', act: 'choices', data: ['Mars', 'Saturn'] })
  hub.handle(ada, { t: 'act', act: 'pick', data: 1 })
  hub.handle(ada, { t: 'act', act: 'pick', data: 0 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 7 })
  assert.deepEqual(state.round.picks, { ada: 1 }, 'locked in; out of range ignored')
  hub.handle(bo, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'nobody buzzes a choice question')
  hub.handle(host, { t: 'act', act: 'closesAt', data: Date.now() - 1 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 0 })
  assert.deepEqual(state.round.picks, { ada: 1 }, 'late pick ignored')
})

test('a phone sees only its own pick, and the text of a choice question without the mirror', () => {
  const { state, hub, host, ada, bo } = pickRig()
  hub.handle(host, { t: 'act', act: 'fragment', data: 'Which planet?' })
  hub.handle(host, { t: 'act', act: 'choices', data: ['Mars', 'Saturn'] })
  hub.handle(ada, { t: 'act', act: 'pick', data: 1 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 0 })
  assert.equal(state.mirrorFragments, false)
  const view = hub.viewFor(ada)
  assert.deepEqual(view.round.picks, { ada: 1 })
  assert.deepEqual(view.round.fragments, ['Which planet?'])
  assert.deepEqual(view.round.choices, ['Mars', 'Saturn'])
  assert.deepEqual(hub.viewFor(host).round.picks, { ada: 1, bo: 0 })
})

test('a phone may not publish choices', () => {
  const { state, hub, ada } = pickRig()
  hub.handle(ada, { t: 'act', act: 'choices', data: ['x', 'y'] })
  assert.equal(state.round.choices, undefined)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/hub.test.ts`
Expected: the new tests fail. `pick` is ignored, and the buzz moves the phase to `COLLECTING`.

- [ ] **Step 3: Eligibility** (`server/eligibility.ts`)

```ts
import type { PlayerId, State } from '../shared/protocol.ts'
import { pickers } from '../shared/choice.ts'
import { moduleFor } from './modes/index.ts'

/** Effects and mode restrictions; score-key lockouts are resolved separately. */
export function buzzBlockReason(state: State, playerId: PlayerId): string | null {
  // The whole room answers a choice question on its phones; there is no buzz to win.
  if (state.round.kind === 'choice') return 'choice'
  const frozen = state.effects.some((e) =>
    e.kind === 'frozen' && e.playerId === playerId && e.attemptId === state.round.attemptId,
  )
  if (frozen) return 'frozen'
  return moduleFor(state.game.id).canBuzz?.(state, playerId) ?? null
}

/** Why this player may not pick right now, or null. A pick is final. */
export function pickBlockReason(state: State, playerId: PlayerId, at = Date.now()): string | null {
  const r = state.round
  if (r.kind !== 'choice' || !r.choices || r.correct !== undefined) return 'not-picking'
  if (r.closesAt !== undefined && at >= r.closesAt) return 'closed'
  if (r.picks?.[playerId] !== undefined) return 'picked'
  if (!pickers(state).includes(playerId)) return 'not-eligible'
  return null
}
```

- [ ] **Step 4: Hub** (`server/hub.ts`)

Import `pickBlockReason` from `./eligibility.ts`. Add `closeChoice(): void` to `ReaderControls`.

In `act`, after the duel branch and before `if (conn.role !== 'host') return`:

```ts
    // A pick belongs to a player, like an item.
    if (name === 'pick') {
      const round = this.state.round
      if (!conn.playerId || typeof data !== 'number' || !Number.isInteger(data)) return
      if (data < 0 || data >= (round.choices?.length ?? 0)) return
      if (pickBlockReason(this.state, conn.playerId)) return
      round.picks = { ...round.picks, [conn.playerId]: data }
      this.changed('pick')
      return
    }
```

In the host-scoped chain, after the `image` branch:

```ts
    } else if (name === 'choices' && Array.isArray(data)) {
      round.choices = data.filter((c): c is string => typeof c === 'string')
    } else if (name === 'closesAt' && typeof data === 'number') {
      round.closesAt = data
    } else if (name === 'closeChoice') {
      this.reader?.closeChoice()
```

In `viewFor`, replace the player `round` projection with:

```ts
    const round = this.state.round
    // Shown and choice questions are on the board whole from the arm, so the
    // phone may have the same text; the mirror only governs read questions.
    const mirror = this.state.mirrorFragments || !!round.kind
    const mine = conn.playerId !== undefined ? round.picks?.[conn.playerId] : undefined
    return {
      ...this.state,
      game,
      round: {
        ...round,
        order: round.order.filter((b) => b.playerId === conn.playerId),
        fragments: mirror ? round.fragments : undefined,
        // Unconditional, mirror or not: this is the unspoken remainder.
        whole: undefined,
        image: mirror ? round.image : undefined,
        answer: this.state.mirrorFragments ? round.answer : undefined,
        picks: mine === undefined ? undefined : { [conn.playerId!]: mine },
      },
      reading: undefined,
    }
```

Any other object that implements `ReaderControls` must add `closeChoice`. Find them with `grep -rn "ReaderControls\|rewind()" server tools`, and add `closeChoice() {}` to each fake.

- [ ] **Step 5: Run to verify pass**

Run: `node --test server/hub.test.ts && npm run typecheck`
Expected: PASS. `Reader` does not implement `closeChoice` until Task 5. If typecheck flags `hub.setReader(reader)` in `server/index.ts`, add a stub `closeChoice(): void {}` to `Reader` now; Task 5 fills it in.

- [ ] **Step 6: Commit**

```bash
git add server/eligibility.ts server/hub.ts server/hub.test.ts server/reader.ts
git commit -m "feat: phones pick on choice questions and see only their own pick"
```

---

### Task 4: Reader, `speakQuestion` and shown questions

**Files:**
- Modify: `server/reader.ts`
- Test: `server/reader.test.ts`

**Interfaces:**
- Consumes: `Question.kind` (Task 1), `arm.kind` (Task 2).
- Produces: `private speakQuestion(q: Question, questionId: string, stillMine: () => boolean, sig: AbortSignal): Promise<void>`, which Task 5 calls.

- [ ] **Step 1: Write the failing tests** (append to `server/reader.test.ts`)

```ts
const tick = () => new Promise((r) => setTimeout(r, 5))

test('a shown question is on the board whole before the voice starts, and is still read', async () => {
  const { state, reader, speech } = rig('K: shown\nFirst fragment. / Second fragment.\nA: gold\n')
  let atFirstClip: string[] | undefined
  const play = speech.play
  speech.play = (path, at) => {
    atFirstClip ??= [...(state.round.fragments ?? [])]
    return play(path, at)
  }
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 2) await tick()
  reader.stop()
  await reader.settled()
  assert.equal(state.round.kind, 'shown')
  assert.deepEqual(atFirstClip, ['First fragment.', 'Second fragment.'])
  assert.deepEqual(speech.spoken, ['First fragment.', 'Second fragment.'])
})

test('a shown question still closes quizbowl power as the voice passes the fragment', async () => {
  const { hub, state, reader } = rig('K: shown\nFirst fragment. / Second fragment.\nA: gold\n')
  hub.dispatch({ a: 'setMode', id: 'quizbowl', options: { powerAfterFragment: 1 } })
  await reader.select('one.txt')
  reader.start()
  while ((state.game.moduleState as { powerEndsAt?: number }).powerEndsAt === undefined) await tick()
  reader.stop()
  await reader.settled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/reader.test.ts`
Expected: the first new test fails. `kind` is undefined and `atFirstClip` is `['First fragment.']`.

- [ ] **Step 3: Implement**

In `run()`, replace `this.hub.dispatch({ a: 'arm' })` with:

```ts
        this.hub.dispatch({ a: 'arm', ...(q.kind && { kind: q.kind }) })
```

Move the block starting at `const j = joinFragments(q.fragments)` and ending at the close of the per-fragment `else { … }` loop into a new method. In `run()`, replace that block with:

```ts
        await this.speakQuestion(q, questionId, stillMine, sig)
```

The new method keeps the moved code and its comments, with the `revealAll` changes marked below:

```ts
  /**
   * Put the question on the board and read it. A read question is revealed as
   * the voice reaches each clause; a shown or choice question is up whole from
   * the arm. Either way the mode hears each fragment end as the voice passes it.
   */
  private async speakQuestion(
    q: Question,
    questionId: string,
    stillMine: () => boolean,
    sig: AbortSignal,
  ): Promise<void> {
    const revealAll = !!q.kind
    const j = joinFragments(q.fragments)
    // (moved comment about the board needing the whole shape)
    this.hub.send(this.conn, { t: 'act', act: 'whole', data: j.text })
    if (q.image) {
      this.hub.send(this.conn, { t: 'act', act: 'image', data: `/pack-media/${encodeURI(q.image)}` })
    }
    if (revealAll) {
      for (const f of q.fragments) this.hub.send(this.conn, { t: 'act', act: 'fragment', data: f })
      this.fragIndex = q.fragments.length
      this.publish({})
    }
    const whole = this.aligned.get(j.text)

    if (whole) {
      let shown = 0
      let frags = 0
      let completed = 0
      const revealTo = (upto: number) => {
        if (upto <= shown) return
        shown = upto
        if (!revealAll) {
          for (let i = 0; i < q.fragments.length; i++) {
            // (the existing fragment/extend loop, unchanged)
          }
        }
        const complete = q.fragments.filter((f, i) => upto >= j.fragmentAt[i] + f.length).length
        if (complete > completed) {
          completed = complete
          this.hub.fragmentEnded(questionId, completed)
        }
      }
      const live = () => !sig.aborted && stillMine()
      const finished = await this.speakWhole(whole, j, revealTo, live, sig)
      if (finished) revealTo(j.text.length)
    } else {
      for (let f = 0; f < q.fragments.length; f++) {
        const text = q.fragments[f]
        if (!revealAll) {
          this.fragIndex = f + 1
          this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
          this.publish({})
        }
        const finished = await this.speak(text, sig)
        if (!finished) break
        this.hub.fragmentEnded(questionId, f + 1)
      }
    }
  }
```

`frags` is used only inside the `!revealAll` loop. Keep its declaration there so typecheck doesn't flag it as unused.

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/reader.test.ts server/reader.joined.test.ts`
Expected: PASS, including every existing test (the refactor must not change read questions).

- [ ] **Step 5: Commit**

```bash
git add server/reader.ts server/reader.test.ts
git commit -m "feat: the reader shows a shown question whole and reads it"
```

---

### Task 5: Reader, choice questions

**Files:**
- Modify: `server/reader.ts`
- Test: `server/reader.test.ts`

**Interfaces:**
- Consumes: `speakQuestion` (Task 4); `allPicked` and `optionsText` from `shared/choice.ts`; `settleChoice` (Task 2); `choices`/`closesAt` acts (Task 3).
- Produces: `Reader.closeChoice(): void`.

- [ ] **Step 1: Write the failing tests** (append to `server/reader.test.ts`; `tick` comes from Task 4)

```ts
const CHOICE = 'V: 200\nC: Mars | Venus | Saturn\nWhich planet has the most moons?\nA: Saturn\n'

function withPhones(hub: Hub, ids: string[]) {
  return ids.map((id) => {
    const conn = { id, playerId: id, role: 'player' as const, send() {} }
    hub.handle(conn, { t: 'hello', role: 'player', name: id, playerId: id })
    return conn
  })
}

test('choices go up after the question, the options are read, and it settles when everyone has picked', async () => {
  const { hub, state, reader, speech } = rig(CHOICE)
  const [ada, bo] = withPhones(hub, ['ada', 'bo'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.choices) await tick()
  assert.equal(state.round.kind, 'choice')
  assert.deepEqual(speech.spoken, ['Which planet has the most moons?'], 'choices wait for the question')
  hub.handle(ada, { t: 'act', act: 'pick', data: 2 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 0 })
  while (state.round.correct === undefined) await tick()
  assert.equal(state.round.correct, 2)
  assert.equal(state.scores.ada, 200)
  assert.equal(state.scores.bo ?? 0, 0)
  assert.ok(speech.spoken.includes('A, Mars. B, Venus. C, Saturn.'))
  reader.stop()
  await reader.settled()
})

test('a choice question settles when the timer runs out after the options are read', async () => {
  const { hub, state, reader } = rig(CHOICE)
  withPhones(hub, ['ada'])
  state.choiceSec = 0.05
  await reader.select('one.txt')
  reader.start()
  while (state.round.correct === undefined) await tick()
  assert.ok(state.round.closesAt, 'the countdown was published')
  reader.stop()
  await reader.settled()
})

test('the host closes picking early', async () => {
  const { hub, state, reader } = rig(CHOICE)
  withPhones(hub, ['ada'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.choices) await tick()
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'act', act: 'closeChoice' })
  while (state.round.correct === undefined) await tick()
  reader.stop()
  await reader.settled()
})

test('autoplay moves on from a settled choice question', async () => {
  const { hub, state, reader } = rig(CHOICE + '\nV: 100\nNext.\nA: x\n')
  const [ada] = withPhones(hub, ['ada'])
  hub.dispatch({ a: 'setAutoplay', on: true, nextSec: 0.01, reboundSec: 0.01 })
  await reader.select('one.txt')
  reader.start()
  while (!state.round.choices) await tick()
  hub.handle(ada, { t: 'act', act: 'pick', data: 2 })
  while (state.round.kind === 'choice' || !state.round.fragments?.length) await tick()
  assert.deepEqual(state.round.fragments, ['Next.'])
  reader.stop()
  await reader.settled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/reader.test.ts`
Expected: the new tests fail or time out. The choice question goes through the buzz path and nothing ever publishes `choices`.

- [ ] **Step 3: Implement**

Import `allPicked` and `optionsText` from `../shared/choice.ts`. Add a field beside `paused`:

```ts
  /** The host's Close on the choice question being read. Reset per question. */
  private closeNow = false
```

Add the public method beside `resume()`:

```ts
  closeChoice(): void {
    this.closeNow = true
    this.wake()
  }
```

Include the options clip in synthesis. Replace `textsFor`:

```ts
  private textsFor(q: Question): string[] {
    const question = this.opts.align ? [joinFragments(q.fragments).text] : q.fragments
    return q.choices ? [...question, optionsText(q.choices)] : question
  }
```

In `run()`, only read and shown questions prime the judge:

```ts
        if (q.kind !== 'choice') this.opts.judge?.prime(q.answers)
```

Right after `await this.speakQuestion(q, questionId, stillMine, sig)`, add:

```ts
        if (q.kind === 'choice') {
          await this.runChoice(q, stillMine, sig)
          // The grid stays up with its answer; the host's N, or the autoplay
          // dwell, moves on.
          await this.until((s) => !stillMine(), this.dwellMs(), this.session.signal)
          if (!stillMine() && this.hub.state.round.questionId) {
            throw new DOMException('Question replaced', 'AbortError')
          }
          if (stillMine()) this.hub.dispatch({ a: 'next' })
          this.qIndex += 1
          continue
        }
```

Add the method after `speakQuestion`:

```ts
  /**
   * The choices go up once the question has been read, and the phones take
   * picks from then on. The voice reads the options meanwhile, and the
   * countdown starts when it finishes, so the read-out does not use up the
   * room's time. Picking ends on the last eligible pick, the deadline, or the
   * host's Close.
   */
  private async runChoice(q: Question, stillMine: () => boolean, sig: AbortSignal): Promise<void> {
    const choices = q.choices!
    this.closeNow = false
    this.hub.send(this.conn, { t: 'act', act: 'choices', data: choices })
    let done = false
    let deadline: number | undefined
    let timer: NodeJS.Timeout | undefined
    const options = this.speak(optionsText(choices), sig).then(
      () => {
        if (done || sig.aborted || !stillMine()) return
        deadline = Date.now() + this.hub.state.choiceSec * 1000
        this.hub.send(this.conn, { t: 'act', act: 'closesAt', data: deadline })
        timer = setTimeout(() => this.wake(), deadline - Date.now())
        timer.unref?.()
      },
      () => {},
    )
    try {
      await this.until(
        (s) => this.closeNow || allPicked(s) || (deadline !== undefined && Date.now() >= deadline),
        undefined,
        sig,
      )
    } finally {
      done = true
      clearTimeout(timer)
    }
    // Everyone is in; the rest of the options would be read to nobody.
    this.playback?.stop()
    await options
    if (stillMine()) this.hub.dispatch({ a: 'settleChoice', correct: q.correct! })
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/reader.test.ts server/reader.joined.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/reader.ts server/reader.test.ts
git commit -m "feat: the reader runs choice questions: read, pick, settle"
```

---

### Task 6: Wall moments and projections

**Files:**
- Modify: `shared/wall.ts`, `client/Host.tsx` (only `notesFor`, which must compile)
- Test: `shared/wall.test.ts`

**Interfaces:**
- Consumes: `pickers` from `shared/choice.ts`; the Task 2 `Round` fields.
- Produces: `Moment` members `'choice:listening' | 'choice:picking' | 'choice:reveal'`; `Family` gains `'choice'`; `Wall.choices: ChoiceWall | null` with `ChoiceWall = { options: string[]; points: number; in: number; of: number; closesAt?: number; correct?: number; tally?: number[]; winners?: string[] }`; `Mine` gains `pick?: number`, `choices?: string[]`, `correct?: number`, `value?: number`.

- [ ] **Step 1: Write the failing tests** (append to `shared/wall.test.ts`, which has `room()` and `LOCAL`)

```ts
function choiceRoom(): State {
  const s = room()
  s.round = {
    ...s.round, questionId: 'q', attemptId: 'a1', phase: 'ARMED', armedAt: 1, kind: 'choice',
    fragments: ['Which planet has the most moons?'], whole: 'Which planet has the most moons?',
  }
  s.readingActive = true
  return s
}

test('a choice question: listening, picking, reveal, with the clue in the middle throughout', () => {
  const s = choiceRoom()
  assert.equal(momentOf(s, LOCAL), 'choice:listening')
  let w = wallOf(s, LOCAL)
  assert.equal(w.choices, null)
  assert.equal(w.clue?.shown, 'Which planet has the most moons?')
  assert.equal(w.hero, null)

  s.round.choices = ['Mars', 'Saturn']
  s.round.picks = { a: 1 }
  assert.equal(momentOf(s, LOCAL), 'choice:picking')
  w = wallOf(s, LOCAL)
  assert.deepEqual(w.choices, { options: ['Mars', 'Saturn'], points: 200, in: 1, of: 2, closesAt: undefined })
  assert.ok(w.clue)

  s.round.picks = { a: 1, b: 0 }
  s.round.correct = 1
  s.round.phase = 'IDLE'
  assert.equal(momentOf(s, LOCAL), 'choice:reveal')
  w = wallOf(s, LOCAL)
  assert.deepEqual(w.choices?.tally, [1, 1])
  assert.deepEqual(w.choices?.winners, ['Ada'])
  assert.equal(w.award, null)
  assert.equal(w.hero, null)
  assert.ok(w.clue)
  assert.equal(w.value, 200)
})

test('the phone during a choice question', () => {
  const base = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: true, open: true, judging: false }
  assert.equal(phoneOf('choice:listening', base).label, 'Listen')
  assert.equal(phoneOf('choice:picking', base).label, 'Pick')
  assert.deepEqual(phoneOf('choice:picking', { ...base, pick: 1, choices: ['Mars', 'Saturn'] }).sub, 'Saturn')
  const right = phoneOf('choice:reveal', { ...base, armed: false, pick: 1, correct: 1, choices: ['Mars', 'Saturn'], value: 200 })
  assert.deepEqual([right.label, right.sub, right.mood], ['Right', '+200', 'first'])
  const wrong = phoneOf('choice:reveal', { ...base, armed: false, pick: 0, correct: 1, choices: ['Mars', 'Saturn'], value: 200 })
  assert.deepEqual([wrong.label, wrong.sub], ['Wrong', 'It was Saturn'])
  assert.equal(phoneOf('choice:reveal', { ...base, armed: false, correct: 1, choices: ['Mars', 'Saturn'] }).label, 'No pick')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test shared/wall.test.ts`
Expected: FAIL. The `choice:*` moments don't exist.

- [ ] **Step 3: Implement in `shared/wall.ts`**

Import `pickers` from `./choice.ts`. Update the header comment's moment count and the `Moment` doc to say choice moments rank first while a choice question is up. Add the three members at the top of `Moment`:

```ts
  | 'choice:listening'
  | 'choice:picking'
  | 'choice:reveal'
```

Change `Family` to include `'choice'`.

At the top of `momentOf`, after `const r = state.round`:

```ts
  // The whole room answers a choice question at once: there is no leader, no
  // transcript and no verdict, so none of the moments below apply to it.
  if (r.kind === 'choice' && r.questionId) {
    if (r.correct !== undefined) return 'choice:reveal'
    return r.choices ? 'choice:picking' : 'choice:listening'
  }
```

Add the type and field to `Wall` after `value`:

```ts
  /**
   * A choice question's grid, in the band below the clue. Null outside
   * `choice:picking` and `choice:reveal`. Built from `picks`, which only the
   * host and board receive; phones never call `wallOf`.
   */
  choices: ChoiceWall | null
```

```ts
export type ChoiceWall = {
  options: string[]
  points: number
  in: number
  of: number
  closesAt?: number
  correct?: number
  tally?: number[]
  winners?: string[]
}
```

Add a row to `middleOf`'s switch:

```ts
    // The question holds the middle through the reveal; the grid below is the answer.
    case 'choice:listening':
    case 'choice:picking':
    case 'choice:reveal':
      return or(clue)
```

Add a builder and use it in `wallOf`:

```ts
function choiceWall(state: State, m: Moment): ChoiceWall | null {
  const r = state.round
  if (!isFamily(m, 'choice') || !r.choices) return null
  const picks = Object.entries(r.picks ?? {})
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  return {
    options: r.choices,
    points: r.value,
    in: picks.length,
    of: pickers(state).length,
    closesAt: r.closesAt,
    ...(r.correct !== undefined && {
      correct: r.correct,
      tally: r.choices.map((_, i) => picks.filter(([, p]) => p === i).length),
      winners: picks.filter(([, p]) => p === r.correct).map(([id]) => nameOf(id)),
    }),
  }
}
```

In `wallOf`'s return, add `choices: choiceWall(state, m),` and extend the `value` condition with `|| isFamily(m, 'choice')`.

Add to `Mine`:

```ts
  /** This phone's pick on a choice question. */
  pick?: number
  choices?: string[]
  correct?: number
  /** The round value, for the reveal's "+200". */
  value?: number
```

In `phoneOf`, directly after the `f.spectator` branch:

```ts
  if (m === 'choice:listening') {
    return { label: 'Listen', sub: 'The choices come after the question', mood: 'waiting', talk: false }
  }
  if (m === 'choice:picking') {
    return f.pick === undefined
      ? { label: 'Pick', sub: '', mood: 'open', talk: false }
      : { label: 'Locked', sub: f.choices?.[f.pick] ?? '', mood: 'placed', talk: false }
  }
  if (m === 'choice:reveal') {
    if (f.pick !== undefined && f.pick === f.correct) {
      return { label: 'Right', sub: `+${f.value ?? 0}`, mood: 'first', talk: false }
    }
    const answer = f.correct === undefined ? '' : f.choices?.[f.correct] ?? ''
    return { label: f.pick === undefined ? 'No pick' : 'Wrong', sub: `It was ${answer}`, mood: 'barred', talk: false }
  }
```

In `client/Host.tsx` `notesFor`, add rows so it compiles:

```ts
    case 'choice:listening':
      return { judge: 'Everyone picks on their phone once the question is read.', arm: null }
    case 'choice:picking':
      return { judge: 'Close picking to settle it now.', arm: null }
    case 'choice:reveal':
      return { judge: null, arm: played }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test shared/wall.test.ts && npm run typecheck`
Expected: PASS. If some other `Wall` literal fails to typecheck, add `choices: null` to it.

- [ ] **Step 5: Commit**

```bash
git add shared/wall.ts shared/wall.test.ts client/Host.tsx
git commit -m "feat: choice moments, and the choice grid on the wall"
```

---

### Task 7: Surfaces: board, phone, host, and review scenarios

**Files:**
- Modify: `client/Board.tsx`, `client/Player.tsx`, `client/Host.tsx`, `client/HostSetup.tsx`, `client/style.css`, `tools/review/fixtures.ts`
- Test: `tools/review.test.ts` (existing scenario checks cover the new fixtures), `npm run build`

**Interfaces:**
- Consumes: `Wall.choices`, `Mine.pick/choices/correct/value`, the `pick` and `closeChoice` acts, `setChoiceTime`, `LETTERS`.

- [ ] **Step 1: Board** (`client/Board.tsx`)

Import `LETTERS` from `../shared/choice.ts` and `type ChoiceWall` from `../shared/wall.ts`. Add a component above `Question`:

```tsx
/**
 * A choice question's options, in the band below the clue. The same grid
 * stays up for the reveal: the right cell lights, the rest dim with their
 * counts, and the room's winners sit under it.
 */
function Choices({ c, now }: { c: ChoiceWall; now: () => number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (c.closesAt === undefined || c.correct !== undefined) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [c.closesAt, c.correct])
  const left = c.closesAt === undefined ? null : Math.max(0, Math.ceil((c.closesAt - now()) / 1000))
  const revealed = c.correct !== undefined
  return (
    <div class="board__choices" data-review-id="board:choices">
      <ol class={c.options.length > 4 ? 'board__grid is-six' : 'board__grid'}>
        {c.options.map((o, i) => (
          <li
            key={i}
            class={!revealed ? 'board__choice' : i === c.correct ? 'board__choice is-right fx-tada' : 'board__choice is-dim'}
          >
            <span class="board__letter">{LETTERS[i]}</span>
            <span class="board__option">{o}</span>
            {revealed && <span class="readout board__tally">{c.tally?.[i] ?? 0}</span>}
          </li>
        ))}
      </ol>
      {revealed ? (
        !!c.winners?.length && (
          <p class="board__winners">
            {c.winners.map((n) => <span key={n} class="chip fx-pop">{n}</span>)}
          </p>
        )
      ) : (
        <p class="readout board__picking">
          {c.in} of {c.of} in{left !== null && ` · ${left}s`}
        </p>
      )}
    </div>
  )
}
```

Use the Preact hooks import the file already has. If `useState` or `useEffect` isn't imported yet, add it to that same import.

In the above band, replace `{(w.transcript || w.award) && (` with `{(w.transcript || w.award) ? (`, and after that fragment's closing `)` add the choice stamp as the alternative branch:

```tsx
          ) : w.choices?.correct !== undefined ? (
            <p data-review-id="board:award" class="board__award fx-anchor">
              {w.choices.winners?.length ? `+${w.choices.points} · ${w.choices.winners.length} right` : 'Nobody'}
              {!!w.choices.winners?.length && <Burst kind="dust" from={['left', 'bottom', 'right']} />}
            </p>
          ) : null}
```

In the below band, before the timeline:

```tsx
          {w.choices && <Choices c={w.choices} now={now} />}
```

- [ ] **Step 2: Styles** (`client/style.css`, next to the other `.board__` rules)

```css
/* A choice question's grid, in the band below the clue. Two columns, three
   rows at most; option text clamps to two lines so a long one cannot push the
   band. */
.board__choices { display: grid; gap: var(--s4); justify-items: center; width: min(100%, 60rem); margin-top: var(--s6); }
.board__grid { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); }
.board__choice { display: flex; align-items: center; gap: var(--s4); padding: var(--s4) var(--s5); border: 2px solid var(--dim); border-radius: var(--s2); text-align: left; font-size: var(--t-lg); color: var(--chalk); transition: opacity 300ms; }
.board__letter { font-weight: 700; color: var(--dim); }
.board__option { flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.board__choice.is-right { border-color: var(--brass); color: var(--brass); }
.board__choice.is-right .board__letter { color: var(--brass); }
.board__choice.is-dim { opacity: 0.35; }
.board__tally { color: var(--dim); }
.board__winners { display: flex; flex-wrap: wrap; gap: var(--s2); justify-content: center; margin: 0; }
.board__picking { color: var(--dim); margin: 0; }

.player__choices { display: grid; gap: var(--s3); padding: var(--s4); }
.player__choice { display: flex; gap: var(--s3); align-items: center; min-height: 4rem; font-size: var(--t-lg); text-align: left; }
.player__letter { font-weight: 700; color: var(--dim); }
```

If `--t-lg` is not a board-appropriate size once you look at it in review, use the next token up. Don't hard-code sizes.

- [ ] **Step 3: Phone** (`client/Player.tsx`)

Import `LETTERS` from `../shared/choice.ts`. Before the `phoneOf` call:

```tsx
  const choice = round?.kind === 'choice'
  const myPick = playerId !== undefined ? round?.picks?.[playerId] : undefined
  const pick = (i: number) => {
    if (preview) return
    send({ t: 'act', act: 'pick', data: i })
    navigator.vibrate?.(30)
  }
```

In `buzz`, add `|| choice` to the early-return guard. Pass these to `phoneOf`:

```tsx
    pick: myPick,
    choices: round?.choices,
    correct: round?.correct,
    value: round?.value,
```

Replace the `{talk ? (<Talk …/>) : (<button …buzzer…/>)}` block's opening with a pick grid branch:

```tsx
      {moment === 'choice:picking' && myPick === undefined && !frozen && !spectator ? (
        <div class="player__choices" data-review-id="phone:choices">
          {round!.choices!.map((c, i) => (
            <button key={i} class="btn player__choice" onClick={() => pick(i)}>
              <span class="player__letter">{LETTERS[i]}</span>
              {c}
            </button>
          ))}
        </div>
      ) : talk ? (
```

Leave the rest of that ternary unchanged, and add `|| choice` to the buzzer's `disabled` expression.

- [ ] **Step 4: Host** (`client/Host.tsx`, `client/HostSetup.tsx`)

In `Host.tsx` `host__minor`, after Next question:

```tsx
          {moment === 'choice:picking' && (
            <button class="btn" onClick={() => fire('closeChoice')}>
              Close picking
            </button>
          )}
```

In `HostSetup.tsx`, after the Answer window `<label>`:

```tsx
            <label class="field">
              Choice time
              <input
                class="input input--num"
                type="number"
                min={5}
                max={120}
                value={state.choiceSec}
                onInput={(e) =>
                  act({ a: 'setChoiceTime', sec: Number((e.target as HTMLInputElement).value) })
                }
              />
              <span class="muted">sec after the options are read</span>
            </label>
```

- [ ] **Step 5: Review scenarios** (`tools/review/fixtures.ts`)

After `spent`:

```ts
  const picking = question()
  picking.round.kind = 'choice'
  picking.round.fragments = ['Which planet has the most known moons?']
  picking.round.whole = 'Which planet has the most known moons?'
  picking.round.choices = ['Mars', 'Venus', 'Saturn', 'Jupiter']
  picking.round.picks = { ada: 2, bo: 3 }
  picking.round.closesAt = NOW + 12_000

  const revealed = structuredClone(picking)
  revealed.round.picks = { ada: 2, bo: 3, cy: 2 }
  revealed.round.correct = 2
  revealed.round.phase = 'IDLE'
  revealed.scores = { ada: 1000, bo: 400, cy: 600 }
```

In the returned list, after `setlist-complete`:

```ts
    build('choice-picking', 'Choice question, picking', picking, at({ open: true })),
    build('choice-reveal', 'Choice question, revealed', revealed, at()),
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

Run `npm run review`, open `choice-picking` and `choice-reveal`, and check:
- Board: the question sits in the middle band, the grid is below it, and nothing shifts between the two scenarios except the highlight, counts, winners and the stamp above.
- Phones: Ada's phone shows "Locked · Saturn" while picking. Cy's shows the four pick buttons. On reveal, Ada shows Right +400 and Bo shows Wrong.

- [ ] **Step 7: Commit**

```bash
git add client/Board.tsx client/Player.tsx client/Host.tsx client/HostSetup.tsx client/style.css tools/review/fixtures.ts
git commit -m "feat: choice grid on the board, pick buttons on phones, Close picking on the desk"
```

---

### Task 8: Docs and a sample pack

**Files:**
- Modify: `README.md`, `ARCHTECTURE.md`, `docs/design.md`, `docs/question-styles/README.md`
- Create: `docs/question-styles/choice.md`, `packs/mixed.txt`

- [ ] **Step 1: `packs/mixed.txt`**

```
V: 100
This thing always shows Earth the same face. / Name this body that pulls on the ocean tides.
A: The Moon | Moon

V: 200
K: shown
What country is home to the city of Timbuktu?
A: Mali

V: 300
C: Mars | Venus | Saturn | Jupiter
Which planet has the most known moons?
A: Saturn
```

Check that it parses with no errors: `node --input-type=module -e "import {readFileSync} from 'node:fs'; import {parsePack} from './shared/pack.ts'; console.log(parsePack(readFileSync('packs/mixed.txt','utf8')).errors)"`. Expected: `[]`.

- [ ] **Step 2: Docs**

- `README.md` pack format paragraph: add `K: shown` (shown on the board whole and read aloud) and `C: a | b | c` (a multiple-choice question: phones pick once the question has been read, and every right pick scores the round value; `A:` must equal one choice). Mention the Choice time setting and point to `packs/mixed.txt`.
- `ARCHTECTURE.md` "Reading and judging": the reader's per-question body is `speakQuestion` (read vs shown is one flag) plus `runChoice`; `settleChoice` is the choice question's commit; `picks` are redacted to a phone's own in `viewFor`, and shown/choice text reaches phones regardless of the mirror. In the "Round lifecycle" table, note that a choice question stays `ARMED` while picking and goes to `IDLE` on `settleChoice` without `COLLECTING` or `LOCKED`.
- `docs/design.md`: add the choice grid (below band, `is-right` with `fx-tada`, `is-dim`), the choice stamp in the above band, and the three `choice:*` moments wherever the moment list lives. Add "pick" to §9 canon words: a player's answer on a choice question, distinct from a buzz.
- `docs/question-styles/choice.md`:

```markdown
# Multiple choice

Every player answers on their phone; each right pick scores the round value.
Reference: [packs/mixed.txt](../../packs/mixed.txt).

- Write the question so it reads well aloud once, then stands on its own; the
  choices come after it.
- Two to six choices, one of them unambiguously right. Four is the default.
- Distractors should be plausible to someone who half-knows the answer, and
  the same kind of thing as the answer (all planets, all years).
- Keep each choice to a few words; the board clamps them to two lines.
- `A:` must be one of the `C:` choices, spelled the same way.
```

- `docs/question-styles/README.md`: add a table row `| Multiple choice | [choice.md](choice.md) |` and note that accepted-answer rules don't apply to choice questions.

- [ ] **Step 3: Verify**

Run: `git diff --check && npm test`
Expected: no whitespace errors; tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md ARCHTECTURE.md docs/design.md docs/question-styles/README.md docs/question-styles/choice.md packs/mixed.txt
git commit -m "docs: question kinds, the choice style guide, and a mixed sample pack"
```

`README.md` has your uncommitted edits. Stage only the hunks this task added (`git add -p README.md`) so those edits stay yours to commit.
