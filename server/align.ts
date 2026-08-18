/**
 * Where the folds are in a question read as one breath.
 *
 * The reader used to call `say` once per fragment, which is why it sounded
 * chopped: "This Italian composer of The Four Seasons" got sentence-final
 * intonation while it was actually mid-sentence. Rendering the whole question
 * as one utterance fixes the prosody and loses the boundaries — the clip no
 * longer knows where a fragment ends, and the board must not print a word the
 * room has not heard.
 *
 * So the boundaries are measured back out of the audio. We hold the answer key
 * (the source text), so this is verification rather than recognition: cut the
 * clip at t, transcribe, and count how many source words came back whole. That
 * count is a monotonic oracle — a word appears only once it is essentially
 * finished, and partial audio yields a stub ("nut", "Nucker") rather than the
 * word — so a bisection over t finds every boundary.
 *
 * This file is the pure half: it decides which cut to ask for next and what the
 * answers mean. It never spawns anything. The probe executor lives in stt.ts,
 * which is what keeps the search testable against a fake oracle in Node.
 *
 * Everything here rounds the same direction. A fold placed late costs a beat of
 * lag; a fold placed early puts unheard words on the board, which is the bug
 * this exists to prevent.
 */

/**
 * A boundary in the joined text: `at` characters in, `ms` into the clip.
 *
 * `fragment` and `clause` mark where something begins; `end` is the close of
 * the question, which is a fold in its own right because the last fragment has
 * no following fragment to reveal it, and without one it would sit blank until
 * the clip ran out.
 */
export type Fold = { at: number; ms: number; kind: 'fragment' | 'clause' | 'end'; sure: boolean }

/** The joined prose plus where each fragment sits inside it. */
export type Joined = { text: string; fragmentAt: number[] }

/**
 * Fragments as one utterance. `parsePack` trimmed each fragment and split on
 * ` / `, so a single space rejoins them into exactly the prose the author
 * typed — which is what the synthesiser must see. No markers: an embedded
 * `[[...]]` is either spoken aloud or changes the prosody we are here to fix.
 */
export function join(fragments: string[]): Joined {
  const fragmentAt: number[] = []
  let at = 0
  for (const f of fragments) {
    fragmentAt.push(at)
    at += f.length + 1 // the joining space
  }
  return { text: fragments.join(' '), fragmentAt }
}

/**
 * Character offsets worth folding at: every fragment start, and every clause
 * break inside one. Clause breaks come from punctuation in the source, so the
 * candidates cost nothing to find — probing only ever supplies their times.
 *
 * Offset 0 is not a fold. Nothing precedes it, so there is nothing to reveal.
 */
export function candidates(j: Joined): { at: number; kind: Fold['kind'] }[] {
  const out: { at: number; kind: Fold['kind'] }[] = []
  const frag = new Set(j.fragmentAt)
  for (let i = 1; i < j.text.length; i++) {
    if (frag.has(i)) {
      out.push({ at: i, kind: 'fragment' })
      continue
    }
    // A break is punctuation followed by a space: the comma in "1,200" has no
    // space after it and is not a place to stop reading.
    if (j.text[i] === ' ' && /[,;:.!?]/.test(j.text[i - 1])) {
      const at = i + 1
      if (at < j.text.length && !frag.has(at)) out.push({ at, kind: 'clause' })
    }
  }
  // Closing the question is a fold too: a fragment reveals as its words finish,
  // and the last one has no successor whose start would finish it.
  if (j.text.length) out.push({ at: j.text.length, kind: 'end' })
  return out.sort((a, b) => a.at - b.at)
}

/**
 * Transcribes `[fromMs, toMs)` of the clip into words. The only impure part of
 * the search, injected so the bisection can be driven by a table in a test.
 */
export type Probe = (fromMs: number, toMs: number) => Promise<string[]>

/** Words of the joined text, with where each one starts. */
export function words(text: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ word: m[0], at: m.index })
  return out
}

/**
 * Lowercase alphanumerics. `Nutcracker` and `nutcracker.` are the same word.
 *
 * Accents are folded first, and the direction that matters is the surprising
 * one: the transcriber is the side that *adds* them. A pack typed as `Dvorak`
 * comes back as `Dvořák`, and stripping non-ASCII without decomposing would
 * leave `dvok` against `dvorak`.
 */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const NUMBER: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90',
}

/**
 * Two words match if they agree as written or as numbers. Both readings are
 * tried because they disagree: the transcriber writes "ten" as `10`, which the
 * numeric reading catches, but it also writes "for" as "four", which only the
 * written reading catches — normalising numbers first would turn that into `4`
 * and lose it.
 */
function same(a: string, b: string): boolean {
  const [x, y] = [norm(a), norm(b)]
  if (!x || !y) return false
  if (x === y) return true
  if ((NUMBER[x] ?? x) === (NUMBER[y] ?? y)) return true
  // Inflection: the transcriber writes "returned" as "return" and "crowned" as
  // "crown". Only for words long enough that a shared opening means something —
  // at four letters "the" would swallow "there", and "son" would swallow "sons".
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 5 && long.length - short.length <= 3 && long.startsWith(short)
}

/** Consecutive matches that count as having found the thread again. */
const ANCHOR = 2
/** How far ahead to look for it, in words, on either side. */
const WINDOW = 6

/** Do `src` from `i` and `heard` from `k` agree for ANCHOR words running? */
function anchored(src: string[], i: number, heard: string[], k: number): boolean {
  if (i + ANCHOR > src.length || k + ANCHOR > heard.length) return false
  for (let a = 0; a < ANCHOR; a++) if (!same(src[i + a], heard[k + a])) return false
  return true
}

/**
 * The nearest place ahead where both sides agree again, or null. Nearest by
 * total distance, so a one-word hiccup is preferred over a plausible-looking
 * match six words away.
 */
function resync(
  src: string[],
  i: number,
  heard: string[],
  k: number,
): { i: number; k: number } | null {
  let best: { i: number; k: number } | null = null
  let bestCost = Infinity
  for (let di = 0; di <= WINDOW; di++) {
    for (let dk = 0; dk <= WINDOW; dk++) {
      if (di === 0 && dk === 0) continue
      if (di + dk >= bestCost) continue
      if (anchored(src, i + di, heard, k + dk)) {
        best = { i: i + di, k: k + dk }
        bestCost = di + dk
      }
    }
  }
  return best
}

/**
 * How many leading source words this transcript accounts for.
 *
 * Deliberately pessimistic: it stops at the first word it cannot place. A
 * transcript that mangles one word stops the count there rather than guessing
 * past it, and an undercount only ever places a fold later. Undercounting is a
 * beat of lag; overcounting is text on the board that nobody has heard.
 *
 * The one lookahead is a source word arriving split, as "1812" comes back as
 * "18" "12" — joining two transcript tokens is still evidence the word
 * finished, so it counts.
 */
export function completed(src: string[], heard: string[]): number {
  let i = 0
  let k = 0
  while (i < src.length && k < heard.length) {
    if (same(src[i], heard[k])) {
      i++
      k++
      continue
    }
    if (k + 1 < heard.length && same(src[i], heard[k] + heard[k + 1])) {
      i++
      k += 2
      continue
    }
    // One source word may be transcribed as a phrase ("Swan Lake" as a single
    // segment); allow the reverse pairing too before giving up.
    if (i + 1 < src.length && same(src[i] + src[i + 1], heard[k])) {
      i += 2
      k++
      continue
    }
    // A word heard wrong in the middle ("for" as "four") must not truncate the
    // count for the rest of the question — one mishearing would strand every
    // later fold at the end of the clip. Forgive it only when the words on both
    // sides line up again, which is evidence the transcript moved past it and
    // not that it stopped. At the tail there is no such evidence, so the last
    // unmatched word stays uncredited: it is the one most likely to be a stub
    // of a word still being spoken.
    if (i + 1 < src.length && k + 1 < heard.length && same(src[i + 1], heard[k + 1])) {
      i++
      k++
      continue
    }
    // A whole phrase can go wrong at once — "Saint-Saens each" comes back as
    // "San scenes he", three tokens for two words, none of them matching. A
    // single substitution cannot cross that, and without a way across, one
    // mangled proper noun pins every later fold to the end of the clip. So look
    // ahead for the thread: ANCHOR words agreeing in a row is strong enough
    // evidence that the transcript really did travel past the wreckage, and
    // everything skipped was therefore spoken.
    const to = resync(src, i, heard, k)
    if (to) {
      i = to.i
      k = to.k
      continue
    }
    break
  }
  return i
}

/** Below this the audio cannot say which of two words finished first. */
const EPS_MS = 50

/**
 * How much audio to take before an interval starts. Cutting exactly at `loT`
 * beheads whatever word was in progress, and a beheaded word is not recognised,
 * so the count comes back short and every fold after it drifts late. The run-up
 * carries the previous word — which we already know the identity of — so the
 * transcript opens on something the matcher can lock onto instead of on a stub.
 * Cost is linear in slice length and these slices are short, so this is a few
 * milliseconds to buy back the resolution.
 */
const RUNUP_MS = 400

/** The most words a run-up that long could plausibly have swept up. */
const RUNUP_WORDS = 3

/**
 * Times for every word boundary in the clip, by bisection on the oracle.
 *
 * `done[k]` is the moment the first k words are all finished — so it is both
 * the end of word k and the fold before word k+1, which is the boundary the
 * board actually needs.
 *
 * Two things make this cheap enough to run over a whole pack.
 *
 * Each interval is transcribed from its OWN start rather than from zero,
 * against the words not yet accounted for. Probe cost is linear in the length
 * of the slice and indifferent to where it begins — a 2s slice costs the same
 * at 18s as at 0s, while a 20s slice costs seven times either — so probing
 * from zero made every late probe re-read the whole question. Starting at
 * `loT` can clip the onset of a word already in progress, which loses it from
 * the transcript and places the fold later: the safe direction, so no margin
 * is added to buy it back.
 *
 * And the search runs level by level rather than depth-first. Splitting an
 * interval yields two that share nothing, so a whole level can be probed at
 * once; a caller that supplies a `probe` backed by several helpers gets the
 * depth of the search (~log2 of the clip over epsMs, so nine or ten rounds)
 * instead of the count of its probes. That is what makes warming one question
 * before the game starts worth doing — a pack can parallelise across
 * questions, but the question the host is waiting on cannot.
 */
export async function locate(
  j: Joined,
  durationMs: number,
  probe: Probe,
  epsMs = EPS_MS,
): Promise<Fold[]> {
  const src = words(j.text).map((w) => w.word)
  const done = new Array<number>(src.length + 1).fill(durationMs)
  const exact = new Array<boolean>(src.length + 1).fill(false)
  done[0] = 0
  exact[0] = true

  type Span = { loT: number; hiT: number; loK: number; hiK: number }
  let level: Span[] = [{ loT: 0, hiT: durationMs, loK: 0, hiK: src.length }]

  while (level.length) {
    const open: Span[] = []
    for (const s of level) {
      if (s.hiK <= s.loK) continue // no boundary in here to find
      if (s.hiT - s.loT <= epsMs) {
        // Cannot separate them further. They all finish by hiT, the late end of
        // the bracket and therefore the safe one.
        for (let k = s.loK + 1; k <= s.hiK; k++) {
          done[k] = s.hiT
          exact[k] = s.hiK - s.loK === 1
        }
        continue
      }
      open.push(s)
    }
    if (!open.length) break

    const mids = open.map((s) => Math.round((s.loT + s.hiT) / 2))
    const counts = await Promise.all(
      open.map(async (s, i) => {
        // Back up far enough to catch the word already in progress, so the
        // transcript opens on a whole word rather than a half-syllable.
        const from = Math.max(0, s.loT - RUNUP_MS)
        const heard = await probe(from, mids[i])
        // How far back the run-up actually reached depends on how fast the
        // reader was going, so rather than assume it caught exactly one word,
        // read the transcript from each plausible starting word and keep the
        // reading that accounts for the most. They are all counts over the same
        // transcript, so none can credit a word the audio did not contain.
        let c = s.loK
        for (let base = Math.max(0, s.loK - RUNUP_WORDS); base <= s.loK; base++) {
          c = Math.max(c, base + completed(src.slice(base), heard))
        }
        // The oracle is monotonic in principle and approximately so in practice
        // — endpointing can hold a short word back until its neighbour resolves
        // — and clamping into the bracket keeps one odd answer from corrupting
        // a range two other probes already agreed on.
        return Math.min(s.hiK, Math.max(s.loK, c))
      }),
    )

    level = open.flatMap((s, i) => [
      { loT: s.loT, hiT: mids[i], loK: s.loK, hiK: counts[i] },
      { loT: mids[i], hiT: s.hiT, loK: counts[i], hiK: s.hiK },
    ])
  }

  // A fold at `at` reveals every word starting before it — so its time is when
  // that many words have finished. Both lists are ascending, so this walks once
  // rather than rescanning the text per candidate.
  const starts = words(j.text).map((w) => w.at)
  const folds: Fold[] = []
  let k = 0
  for (const { at, kind } of candidates(j)) {
    while (k < starts.length && starts[k] < at) k++
    folds.push({ at, ms: done[k], kind, sure: exact[k] })
  }
  return folds
}
