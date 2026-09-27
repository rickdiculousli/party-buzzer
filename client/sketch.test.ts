import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_SLIDE_MS, chatSlideMs, chatStarts, fmtSeconds, pushChat, wipeCut, type ChatLine, ordinal, sketchCues, type SketchView } from './sketch.ts'

const view = (over: Partial<SketchView> = {}): SketchView => ({
  matchId: 'm', tick: 10, serverTime: 10_000, step: 'drawing', drawer: 'd', turn: 0, turns: 3,
  blanks: '______', live: null, endsAt: 60_000, misses: [], correct: [], end: null, scores: {}, word: null, ...over,
})
const cues = (prev: SketchView | null, next: SketchView, who = 'board') => sketchCues(prev, next, who).map((c) => c.cue)

test('a first frame and a frame from another match play nothing', () => {
  assert.deepEqual(cues(null, view({ step: 'choosing', tick: 1 })), [])
  assert.deepEqual(cues(view({ matchId: 'old', step: 'choosing', tick: 0 }), view({ step: 'choosing', tick: 1 })), [])
})

test('a new turn calls the room on the board and only the drawer on phones', () => {
  const countdown = view({ step: 'choosing', tick: 0, blanks: '' })
  const started = view({ step: 'choosing', tick: 1, blanks: '' })
  assert.deepEqual(cues(countdown, started), ['sketch-turn'])
  assert.deepEqual(cues(countdown, started, 'd'), ['sketch-yours'])
  assert.deepEqual(cues(countdown, started, 'g'), [])
  const reveal = view({ step: 'reveal', end: 'timeup' })
  const next = view({ step: 'choosing', turn: 1, drawer: 'g', blanks: '' })
  assert.deepEqual(cues(reveal, next), ['sketch-turn'])
  assert.deepEqual(cues(reveal, next, 'g'), ['sketch-yours'])
})

test('the drawing starts on the board only', () => {
  const choosing = view({ step: 'choosing', blanks: '' })
  assert.deepEqual(cues(choosing, view()), ['sketch-go'])
  assert.deepEqual(cues(choosing, view(), 'd'), [])
})

test('a new wrong guess cues once, even when the feed is full and trimmed', () => {
  const full = Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, player: 'g', text: `w${i + 1}` }))
  const trimmed = [...full.slice(1), { seq: 9, player: 'g', text: 'w9' }]
  assert.deepEqual(cues(view({ misses: full }), view({ misses: trimmed })), ['sketch-miss'])
  assert.deepEqual(cues(view({ misses: full }), view({ misses: full })), [])
  assert.deepEqual(cues(view({ misses: full }), view({ misses: trimmed }), 'g'), [])
})

test('a right guess cues the board, the drawer and that guesser, rising with place', () => {
  const one = [{ seq: 3, player: 'g', ms: 1200 }]
  const two = [...one, { seq: 5, player: 'h', ms: 2400 }]
  assert.deepEqual(cues(view(), view({ correct: one })), ['sketch-got'])
  assert.deepEqual(cues(view(), view({ correct: one }), 'd'), ['sketch-got'])
  assert.deepEqual(cues(view(), view({ correct: one }), 'g'), ['sketch-right'])
  assert.deepEqual(cues(view(), view({ correct: one }), 'h'), [])
  const [first] = sketchCues(view(), view({ correct: one }), 'board')
  const [second] = sketchCues(view({ correct: one }), view({ correct: two }), 'board')
  assert.ok((second.rateScale ?? 1) > (first.rateScale ?? 1))
})

test('hints, the last five seconds, the way a turn ends, and the end of the match', () => {
  assert.deepEqual(cues(view({ blanks: '______' }), view({ blanks: 'b_____' })), ['sketch-hint'])
  assert.deepEqual(cues(view({ serverTime: 54_100 }), view({ serverTime: 55_100 })), ['sketch-tick'])
  assert.deepEqual(cues(view({ serverTime: 40_000 }), view({ serverTime: 41_000 })), [])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'all' })), ['sketch-all'])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'timeup' })), ['sketch-timeup'])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'pass' })), ['sketch-pass'])
  assert.deepEqual(cues(view({ step: 'reveal', end: 'pass' }), view({ step: 'over' })), ['sketch-over'])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'all' }), 'd'), [])
})

test('a close guess cues only the phone that made it', () => {
  assert.deepEqual(cues(view({ close: 0 }), view({ close: 1 }), 'g'), ['sketch-close'])
  assert.deepEqual(cues(view({ close: 1 }), view({ close: 1 }), 'g'), [])
})

test('places and times read the way the board shows them', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
  assert.equal(fmtSeconds(410), '+0.41s')
})

test('the chat drops its oldest wrong guess past the cap and keeps every right one in place', () => {
  const miss = (seq: number) => ({ seq, player: 'g', text: `w${seq}` })
  const got = (seq: number) => ({ seq, player: 'h', text: null, ms: seq })
  let chat = pushChat([], [miss(1), got(2), miss(3)], 3)
  assert.deepEqual(chat.lines.map((l) => l.seq), [1, 2, 3])
  chat = pushChat(chat.lines, [miss(4)], 3)
  assert.deepEqual(chat.lines.map((l) => l.seq), [2, 3, 4])
  assert.deepEqual(chat.evicted.map((l) => l.seq), [1])
  // 5 arrives: 3 is the oldest miss, so it goes and the right guess at 2 stays on top.
  chat = pushChat(chat.lines, [miss(5), got(6)], 3)
  assert.deepEqual(chat.lines.map((l) => l.seq), [2, 5, 6])
  assert.deepEqual(chat.evicted.map((l) => l.seq), [3, 4])
  chat = pushChat(chat.lines, [got(7)], 3)
  assert.deepEqual(chat.lines.map((l) => l.seq), [2, 6, 7])
  // All right guesses: the oldest finally goes.
  chat = pushChat(chat.lines, [got(8)], 3)
  assert.deepEqual(chat.lines.map((l) => l.seq), [6, 7, 8])
})

test('a chat slide started mid-slide ends about when the last one would, and never runs long', () => {
  assert.equal(chatSlideMs(1000, 1000), 90)
  assert.equal(chatSlideMs(1000, 1100), 165)
  assert.equal(chatSlideMs(1000, 1250), 260)
  assert.ok([0, 50, 150, 250, 400].every((left) => chatSlideMs(0, left) <= 260))
})

/** The stylesheet's --ease, cubic-bezier(0.2, 0.8, 0.3, 1), solved for y at time x. */
function ease(x: number): number {
  const [x1, y1, x2, y2] = [0.2, 0.8, 0.3, 1]
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(mid, x1, x2) < x) lo = mid; else hi = mid }
  return at((lo + hi) / 2, y1, y2)
}

test('the chat moves like a train through random bursts: lines never touch, new ones join right behind, dropped ones are wiped before the next arrives', () => {
  const H = 36, GAP = 4, FOOT = 520, MAX = 10
  // A slide as the browser runs it: from `start` px off its rest to rest, on --ease.
  type Slide = { rest: number; start: number; t0: number; ms: number }
  const offset = (s: Slide, t: number) => s.start * (1 - ease(Math.min(1, Math.max(0, (t - s.t0) / s.ms))))
  const restOf = (i: number, n: number) => FOOT - (n - i) * H - (n - 1 - i) * GAP
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31

  let lines: ChatLine[] = []
  const slides = new Map<number, Slide>()
  const ghosts = new Map<number, Slide & { until: number }>()
  let settles = 0, seq = 0, t = 0, checks = 0

  const check = (at: number) => {
    const flow = lines.map((l) => ({ seq: l.seq, top: slides.get(l.seq)!.rest + offset(slides.get(l.seq)!, at) }))
    for (let i = 1; i < flow.length; i++) {
      assert.ok(flow[i].top - (flow[i - 1].top + H) >= GAP - 0.5, `lines ${flow[i - 1].seq} and ${flow[i].seq} touch at ${at}ms`)
    }
    for (const [g, slide] of ghosts) {
      if (at >= slide.until) continue
      const top = slide.rest + offset(slide, at)
      const next = flow.find((f) => f.seq > g)
      const shown = top + H - wipeCut(top, top + H, next ? next.top : null, GAP)
      if (next && shown > top) assert.ok(next.top - shown >= GAP - 0.5, `dropped ${g} overlaps ${next.seq} at ${at}ms`)
      const above = flow.findLast((f) => f.seq < g)
      if (above && shown > top) assert.ok(top - (above.top + H) >= GAP - 0.5, `dropped ${g} overlaps ${above.seq} at ${at}ms`)
    }
    checks++
  }

  for (let event = 0; event < 400; event++) {
    const wait = rand() < 0.3 ? 10 + rand() * 60 : 80 + rand() * 300
    for (let at = t; at < t + wait; at += 5) check(at)
    t += wait
    const burst = rand() < 0.2 ? 2 + Math.floor(rand() * 2) : 1
    const incoming: ChatLine[] = Array.from({ length: burst }, () => (++seq, rand() < 0.15
      ? { seq, player: 'p', text: null, ms: seq }
      : { seq, player: 'p', text: `w${seq}` }))
    const { lines: next, evicted } = pushChat(lines, incoming, MAX)
    const ms = settles > t ? chatSlideMs(t, settles) : CHAT_SLIDE_MS
    settles = t + ms
    for (const gone of evicted) {
      const was = slides.get(gone.seq)
      if (!was) continue
      ghosts.set(gone.seq, { rest: was.rest, start: offset(was, t), t0: t, ms, until: t + ms })
      slides.delete(gone.seq)
    }
    const starts = chatStarts(next.map((l, i) => {
      const was = slides.get(l.seq)
      return { key: String(l.seq), before: was?.rest, now: restOf(i, next.length), carried: was ? offset(was, t) : 0, height: H }
    }), GAP)
    next.forEach((l, i) => {
      const start = starts.get(String(l.seq))!
      const was = slides.get(l.seq)
      // A line with nothing to cover keeps the slide it is in, as the component leaves it.
      if (start === 0 && was) slides.set(l.seq, { ...was, rest: restOf(i, next.length) })
      else slides.set(l.seq, { rest: restOf(i, next.length), start, t0: t, ms })
    })
    lines = next
    assert.ok(lines.length <= MAX)
    // Carriages, not stragglers: a new line starts right behind the one it follows.
    lines.forEach((l, i) => {
      if (i === 0 || !incoming.some((c) => c.seq === l.seq)) return
      const ahead = slides.get(lines[i - 1].seq)!, mine = slides.get(l.seq)!
      const gap = mine.rest + offset(mine, t) - (ahead.rest + offset(ahead, t) + H)
      assert.ok(Math.abs(gap - GAP) < 0.5, `line ${l.seq} starts ${gap}px behind ${lines[i - 1].seq}`)
    })
  }
  for (let at = t; at < t + 400; at += 5) check(at)
  for (const l of lines) assert.ok(Math.abs(offset(slides.get(l.seq)!, t + 400)) < 0.01, 'every line comes to rest')
  assert.ok(checks > 10_000)
})
