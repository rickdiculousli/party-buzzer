# The wall boundary — plan

Spec: `../specs/2026-08-18-wall-boundary-design.md`. Read it for *why*; this is
only the order of work. Each step ends green: `npm test && npm run typecheck`.
No behaviour change is intended at any step.

## 1. `shared/wall.ts` — done

- [x] `Moment` — 13 states, union written in priority order
- [x] `Local = { open: boolean; settled: boolean; retired: boolean }`
- [x] `momentOf(state, local)` — first match wins, ordered as the union
- [x] `idle:welcome` keys off `armedAt`, **not** `order.length` (redacted)
- [x] `Wall` type — 5 exclusive middle fields, 5 free
- [x] `wallOf(state, local)`
- [x] `Phone` + `Mood` + `Mine`; `phoneOf(moment, mine)`
- [x] Doc comment carries the two rules: content-not-appearance; no clock, no DOM
- [x] Typed family predicate `isFamily(m, 'verdict')`

```ts
type Verdict = Extract<Moment, `verdict:${string}`>
const isVerdict = (m: Moment): m is Verdict => m.startsWith('verdict:')
```

## 2. `shared/wall.test.ts` — done

- [x] `oneOf(w)` helper — fails on ≠ 1 middle-band occupant
- [x] Walk one question, asserting `moment` + `oneOf` at every step
- [x] Regression lines for this month's three
- [x] Duel walk; `idle:welcome` boundary; the phone's priority order

## 3. Redaction parity — `server/hub.test.ts` — done

- [x] Steps a real question through `Hub`, comparing `momentOf(hub.state)`
      against a buzzing phone's view and a never-buzzing phone's view

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
