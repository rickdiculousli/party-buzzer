# The wall boundary — plan

Spec: `../specs/2026-08-18-wall-boundary-design.md`. Read it for *why*; this is
only the order of work. Each step ends green: `npm test && npm run typecheck`.
No behaviour change is intended at any step.

## 1. `shared/wall.ts`

- [ ] `Moment` — 13 states, union written in priority order (spec's table)
- [ ] `Local = { settled: boolean; retired: boolean }`
- [ ] `momentOf(state, local)` — first match wins, ordered as the union
- [ ] `idle:welcome` keys off `armedAt`, **not** `order.length` (redacted)
- [ ] `Wall` type — 5 exclusive middle fields, 5 free
- [ ] `wallOf(state, local)`
- [ ] `Phone` + `Mood` + `Mine`; `phoneOf(moment, mine)` — body lifted from `buzzerFace`
- [ ] Doc comment carries the two rules: content-not-appearance; no clock, no DOM
- [ ] Typed family predicates

```ts
type Verdict = Extract<Moment, `verdict:${string}`>
const isVerdict = (m: Moment): m is Verdict => m.startsWith('verdict:')
```

## 2. `shared/wall.test.ts`

- [ ] `oneOf(w)` helper — counts non-null among `hero/clue/nominations/faceoff/call`, fails on ≠ 1
- [ ] Walk one question, asserting `moment` + `oneOf` at every step:
      arm → open → buzz → lock → typing → settled → wrong → hold → rebound →
      clue resumes → second buzz → correct
- [ ] Regression lines for this month's three: transcript over resumed clue;
      transcript above the rebounder; clue flashing back during typing

## 3. Redaction parity — `server/hub.test.ts`

- [ ] Step a question through `Hub`; at each step assert
      `momentOf(hub.state, l) === momentOf(hub.viewFor(playerConn), l)`

## 4. `client/Player.tsx` + `client/ui.ts` + `client/style.css`

Smallest first; its existing tests are the canary.

- [ ] `buzzerFace` → `phoneOf`; delete `Face` and the 11-field bag
- [ ] `mood` returns semantic tokens, not CSS class names

```ts
type Mood = 'waiting' | 'open' | 'placed' | 'first' | 'barred'
```

- [ ] `style.css` maps the 5 tokens (`.player__btn--barred` etc.)
- [ ] `client/ui.test.ts` — existing two `buzzerFace` cases pass with new args

## 5. `client/Host.tsx`

- [ ] `judgeable` (`Host.tsx:64`) → `momentOf(...) === 'answer:locked'`
- [ ] Nothing else. Host takes `momentOf` only — no `Desk`

## 6. `client/Board.tsx`

Largest. Behaviour-preserving; `npm run build` required to see it.

- [ ] Board keeps its two timers, passes them as `local`
- [ ] Delete the derivation cluster (`Board.tsx:341-366`):
      `verdict` `showAward` `missing` `answering` `armed` `reading` `seating` `finalistNames`
- [ ] `board__above` / `board__mid` / `board__below` → flat reads off `Wall`
- [ ] No `&&` terms left in JSX beyond `{w.x && …}`

```tsx
const w = wallOf(state, { settled, retired })
{w.transcript && <Spoken … />}
{w.hero && <p class={`board__hero board__hero--${w.hero.tone}`}>{w.hero.name}</p>}
{w.clue && <Question {...w.clue} />}
```

- [ ] `style.css` maps `--answering / --scored / --penalised` (replaces `is-neg`)

## 7. Close out

- [ ] `npm run build`
- [ ] `CLAUDE.md` — one line under Architecture for `shared/wall.ts`
- [ ] Delete `willSeat`'s board caller if `wallOf` absorbs it; keep the host's

## Out of scope

CSS/State renaming, a permission table, a `Desk` projection, new `State` fields
or server timers. See `../specs/2026-08-18-canon-words-design.md`.
