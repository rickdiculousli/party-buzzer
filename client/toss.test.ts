import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../shared/random.ts'
import { chipStack, dealSchedule, flop, turnUp, pitch, receive, scatter, slide, street, sweep, toss, wildCard, RECEIVE, REVEAL, TOSS, type Frame, type Pose } from './toss.ts'

const along = (frames: Frame[], dx: number, dy: number) => {
  const len = Math.hypot(dx, dy)
  return frames.map((f) => ((f.x - frames[0].x) * dx + (f.y - frames[0].y) * dy) / len)
}

test('a slide starts where it is thrown from and rests exactly on its spot', () => {
  const frames = slide({ x: 0, y: 0, rot: 40 }, { x: 300, y: 400, rot: 5 }, mulberry32(1))
  assert.deepEqual({ x: frames[0].x, y: frames[0].y, rot: frames[0].rot }, { x: 0, y: 0, rot: 40 })
  const last = frames[frames.length - 1]
  assert.deepEqual({ x: last.x, y: last.y, rot: last.rot, lift: last.lift }, { x: 300, y: 400, rot: 5, lift: 0 })
})

test('friction only ever slows a slide down', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 600, y: 0, rot: 0 }, mulberry32(2))
  const progress = along(frames, 600, 0)
  const steps = progress.slice(1).map((p, i) => p - progress[i])
  for (let i = 1; i < steps.length - 1; i++) assert.ok(steps[i] <= steps[i - 1] + 1e-6, `sped up at frame ${i}`)
  assert.ok(steps.every((s) => s >= -1e-6), 'went backwards')
})

test('a card flies fast, then the cloth slows it to a crawl', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 700, y: 0, rot: 0 }, mulberry32(3))
  const total = frames[frames.length - 1].t
  const at = (share: number) => frames.find((f) => f.t >= total * share)!.x
  assert.ok(at(0.4) > 700 * 0.7, `only ${at(0.4)} by 40% of the time`)
  assert.ok(700 - at(0.6) < 700 * 0.1, `still ${700 - at(0.6)} to go in the last 40%`)
  const near = slide({ x: 0, y: 0, rot: 0 }, { x: 200, y: 0, rot: 0 }, mulberry32(3))
  assert.ok(total > near[near.length - 1].t)
})

test('the path wanders sideways in flight but not at either end', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 0, y: 500, rot: 0 }, mulberry32(4))
  const side = frames.map((f) => Math.abs(f.x))
  assert.equal(side[0], 0)
  assert.equal(side[side.length - 1], 0)
  assert.ok(Math.max(...side) > 2, 'no wander at all')
  assert.ok(Math.max(...side) < 500 * 0.12, 'wanders off the path')
})

test('a card is lifted when it leaves the hand and lands before it stops', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 500, y: 0, rot: 0 }, mulberry32(5))
  assert.ok(frames[0].lift > 0)
  const landed = frames.findIndex((f) => f.lift === 0)
  assert.ok(landed > 0 && landed < frames.length * 0.6, 'lands too late to slide')
})

test('the same seed throws the same card', () => {
  const a = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(6))
  const b = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(6))
  assert.deepEqual(a, b)
})

test('a dealer pitch spins in the air and settles exactly on its spot', () => {
  for (let seed = 1; seed < 30; seed++) {
    const frames = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(seed))
    assert.ok(Math.abs(frames[0].rot - -4) >= 20, `barely spun: ${frames[0].rot}`)
    assert.deepEqual({ x: frames[0].x, y: frames[0].y }, { x: 500, y: -60 })
    assert.equal(frames[frames.length - 1].rot, -4)
  }
})

test('spin is quick in the air and the cloth drags it down', () => {
  const frames = pitch({ x: 500, y: -60 }, { x: 200, y: 700, rot: 0 }, mulberry32(5))
  const land = frames.findIndex((f) => f.lift === 0)
  const turn = (i: number) => Math.abs(frames[i + 1].rot - frames[i].rot)
  assert.ok(turn(land - 2) > 1.5 * turn(land + 1), `air ${turn(land - 2)} vs cloth ${turn(land + 1)}`)
  assert.ok(turn(frames.length - 3) < turn(land + 1), 'the cloth does not slow the spin')
})

test('a pushed card rides the hand before it is let go, then slows', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 400, y: 0, rot: 0 }, mulberry32(12), { hand: 0.35, lift: 0 })
  const steps = frames.slice(1).map((f, i) => f.x - frames[i].x)
  const peak = steps.indexOf(Math.max(...steps))
  assert.ok(peak > 1 && peak < steps.length - 2, 'no hand phase')
  for (let i = 1; i <= peak; i++) assert.ok(steps[i] >= steps[i - 1] - 1e-6, 'the hand slowed')
  for (let i = peak + 1; i < steps.length - 1; i++) assert.ok(steps[i] <= steps[i - 1] + 1e-6, 'sped up after release')
})

test('a harder flick throws further and spins more; a timeout only nudges the cards', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const aim = { x: 500, y: 300 }
  const hard = toss(from, aim, { dx: 0, dy: -1, speed: 1 }, mulberry32(8))
  const soft = toss(from, aim, { dx: 0, dy: -1, speed: 0.15 }, mulberry32(8))
  const limp = toss(from, aim, null, mulberry32(8))
  const dist = (r: { rest: { x: number; y: number } }) => Math.hypot(r.rest.x - from.x, r.rest.y - from.y)
  assert.ok(dist(hard) > dist(soft))
  assert.ok(dist(soft) > dist(limp))
  assert.ok(Math.abs(hard.rest.rot) > Math.abs(limp.rest.rot))
  assert.ok(limp.frames.every((f) => f.lift === 0), 'a timeout slides, it is not thrown')
  assert.ok(soft.frames.every((f) => f.lift === 0), 'a soft flick is a push along the cloth')
  assert.ok(hard.rest.y < from.y, 'goes toward the middle')
})

test('a flick to one side bends the toss that way', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const right = toss(from, { x: 500, y: 300 }, { dx: 0.7, dy: -0.7, speed: 0.8 }, mulberry32(9))
  assert.ok(right.rest.x > from.x)
})

test('the dealer sweeps without throwing', () => {
  const frames = sweep({ x: 500, y: 350, rot: 60 }, { x: 700, y: 300, rot: 0 })
  assert.ok(frames.every((f) => f.lift === 0))
  assert.deepEqual(frames[frames.length - 1], { ...frames[frames.length - 1], x: 700, y: 300, rot: 0 })
})

test('a bet stacks as the fewest chips, biggest at the bottom', () => {
  assert.deepEqual(chipStack(137), [100, 25, 5, 5, 1, 1])
  assert.deepEqual(chipStack(0), [])
  assert.ok(chipStack(99_999).length <= 10)
  assert.equal(chipStack(99_999)[0], 500)
})

test('a dealt card lands loose near the seat, not squared on it', () => {
  const neat = { x: 400, y: 600, rot: 3 }
  let moved = 0
  for (let seed = 1; seed < 40; seed++) {
    const land = scatter(neat, 60, mulberry32(seed))
    const off = Math.hypot(land.x - neat.x, land.y - neat.y)
    assert.ok(off <= 60 * RECEIVE.scatter + 1e-9, `landed ${off} away`)
    assert.ok(Math.abs(land.rot - neat.rot) <= RECEIVE.scatterRot + 1e-9)
    if (off > 6 || Math.abs(land.rot - neat.rot) > 4) moved++
  }
  assert.ok(moved > 30, 'most cards should land visibly off their place')
})

test('the player collects the pair after the second card is down, then taps it square from above', () => {
  const neat = { x: 400, y: 600, rot: 3 }
  const land = scatter(neat, 60, mulberry32(4))
  const flight = pitch({ x: 400, y: -80 }, land, mulberry32(5))
  const landedAt = flight[flight.length - 1].t
  const collectAt = landedAt + 700
  const frames = receive(flight, neat, collectAt, mulberry32(6))
  for (const f of frames.filter((f) => f.t >= landedAt && f.t <= collectAt)) {
    assert.deepEqual({ x: f.x, y: f.y, rot: f.rot }, { x: land.x, y: land.y, rot: land.rot })
  }
  const last = frames[frames.length - 1]
  assert.deepEqual({ x: last.x, y: last.y, rot: last.rot, lift: last.lift }, { ...neat, lift: 0 })
  // Two taps, each a press down into the cloth: the pair dips, then comes back up.
  const after = frames.filter((f) => f.t > collectAt)
  const presses = after.filter((f) => f.lift < 0)
  assert.equal(presses.length, 2, 'expected two taps')
  // A tap from above never shoves the cards sideways: during the taps they only close on their place.
  const tapping = after.filter((f) => f.t >= presses[0].t - RECEIVE.tapMs[1])
  const gap = tapping.map((f) => Math.hypot(f.x - neat.x, f.y - neat.y))
  for (let i = 1; i < gap.length; i++) assert.ok(gap[i] <= gap[i - 1] + 1e-9, 'a tap moved the cards away')
  // Each tap straightens them further.
  const off = (f: Frame) => Math.abs(f.rot - neat.rot)
  assert.ok(off(presses[1]) < off(presses[0]))
})

test('no two players tap alike', () => {
  const neat = { x: 400, y: 600, rot: 3 }
  const flight = pitch({ x: 400, y: -80 }, scatter(neat, 60, mulberry32(4)), mulberry32(5))
  const taps = (seed: number) => receive(flight, neat, 2_000, mulberry32(seed)).filter((f) => f.lift < 0).map((f) => [Math.round(f.t), f.lift.toFixed(4)].join())
  assert.notDeepEqual(taps(1), taps(2))
})

test('the dealer keeps no metronome: gaps vary but the deal fits its window', () => {
  const starts = dealSchedule(12, 1_300, 150, mulberry32(3))
  assert.equal(starts.length, 12)
  assert.equal(starts[0], 0)
  const gaps = starts.slice(1).map((s, i) => s - starts[i])
  assert.ok(gaps.every((g) => g > 0))
  assert.ok(new Set(gaps.map((g) => Math.round(g))).size > 6, 'gaps are too even')
  assert.ok(starts[starts.length - 1] <= 1_300)
})

test('each pitch leaves the fingers at its own speed', () => {
  const time = (seed: number) => { const f = pitch({ x: 0, y: -80 }, { x: 0, y: 600, rot: 0 }, mulberry32(seed)); return Math.round(f[f.length - 1].t) }
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(time)).size >= 4, 'every pitch takes the same time')
})

test('a fold is a light toss: short, low and barely turning', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const aim = { x: 500, y: 300 }
  for (let seed = 1; seed < 40; seed++) {
    const hard = toss(from, aim, { dx: 0.4, dy: -1, speed: 1 }, mulberry32(seed))
    assert.ok(Math.hypot(hard.rest.x - from.x, hard.rest.y - from.y) <= 400 * 0.78125, 'thrown too far')
    assert.ok(Math.hypot(hard.rest.x - from.x, hard.rest.y - from.y) > 400 * 0.2, 'a hard flick barely moves')
    assert.ok(Math.abs(hard.rest.rot) <= 60, `turned ${hard.rest.rot}`)
    assert.ok(Math.max(...hard.frames.map((f) => f.lift)) <= 0.03, 'thrown too high')
  }
})

test('a fold never slides into the middle of the table', () => {
  const aim = { x: 500, y: 300 }
  for (let seed = 1; seed < 40; seed++) {
    const from = { x: 500 + Math.cos(seed) * 260, y: 300 + Math.sin(seed) * 260, rot: 0 }
    const thrown = toss(from, aim, { dx: 0, dy: -1, speed: 1 }, mulberry32(seed), 180)
    for (const f of thrown.frames) assert.ok(Math.hypot(f.x - aim.x, f.y - aim.y) >= 180 - 1, `into the middle at seed ${seed}`)
  }
})

test('a quiet fold card spins anywhere from barely to a little', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const turns = Array.from({ length: 60 }, (_, seed) =>
    Math.abs(toss(from, { x: 500, y: 300 }, { dx: 0.3, dy: -1, speed: 0.8 }, mulberry32(seed)).rest.rot))
  assert.ok(Math.min(...turns) < 8, 'never barely turns')
  assert.ok(Math.max(...turns) > 25, 'never turns much')
})

test('a wild fold card spins hard', () => {
  const from = { x: 500, y: 700, rot: 0 }
  for (let seed = 1; seed < 20; seed++) {
    const wild = toss(from, { x: 500, y: 300 }, { dx: 0.3, dy: -1, speed: 0.8 }, mulberry32(seed), 0, true)
    assert.ok(Math.abs(wild.rest.rot) >= 90, `wild card turned only ${wild.rest.rot}`)
  }
})

test('at most one card of a fold spins wild, and usually neither', () => {
  const picks = Array.from({ length: 400 }, (_, seed) => wildCard(mulberry32(seed)))
  assert.ok(picks.every((p) => p === -1 || p === 0 || p === 1))
  const none = picks.filter((p) => p === -1).length
  assert.ok(none > 400 * 0.5 && none < 400 * 0.8, `${none} of 400 folds had no wild card`)
  assert.ok(picks.includes(0) && picks.includes(1))
})

test('a fold with no room to slide stays where it is and stays a number', () => {
  const from = { x: 500, y: 450, rot: 2 }
  const thrown = toss(from, { x: 500, y: 300 }, { dx: 0, dy: -1, speed: 1 }, mulberry32(1), 400)
  assert.ok(thrown.frames.every((f) => [f.x, f.y, f.rot, f.lift].every(Number.isFinite)), 'a frame is not a number')
  assert.equal(Math.round(thrown.rest.x), 500)
  assert.equal(Math.round(thrown.rest.y), 450)
})

test('the two cards of a fold part ways a little, not stuck together', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const aim = { x: 500, y: 300 }
  const heading = (r: { rest: { x: number; y: number } }) => Math.atan2(r.rest.x - from.x, from.y - r.rest.y) * (180 / Math.PI)
  const spread = Array.from({ length: 40 }, (_, seed) => {
    const flick = { dx: 0.2, dy: -1, speed: 0.8 }
    const a = toss(from, aim, flick, mulberry32(seed * 2 + 1))
    const b = toss(from, aim, flick, mulberry32(seed * 2 + 2))
    return { angle: Math.abs(heading(a) - heading(b)), reach: Math.abs(Math.hypot(a.rest.x - from.x, a.rest.y - from.y) - Math.hypot(b.rest.x - from.x, b.rest.y - from.y)) }
  })
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  assert.ok(mean(spread.map((s) => s.angle)) > 6, 'the pair heads the same way every time')
  assert.ok(Math.max(...spread.map((s) => s.angle)) <= 30, 'the pair splits apart')
  assert.ok(mean(spread.map((s) => s.reach)) > 12, 'the pair travels the same distance every time')
})

const DEALER = { x: 500, y: -60 }
const CARD_W = 60
const slotsAt = (y = 400): Pose[] => [0, 1, 2].map((i) => ({ x: 380 + i * 68, y: y + (i - 1) * 2, rot: i - 1 }))
/** When a card's frames stop changing after `from`: the end of the move that follows. */
const settledAt = (frames: Frame[], from: number) => {
  const end = frames[frames.length - 1]
  const moving = frames.filter((f) => f.t >= from && (f.x !== end.x || f.y !== end.y || f.rot !== end.rot))
  return moving.length ? moving[moving.length - 1].t : from
}
const still = (frames: Frame[], from: number, to: number) => {
  const held = frames.filter((f) => f.t >= from && f.t <= to)
  return held.every((f) => f.x === held[0].x && f.y === held[0].y && f.rot === held[0].rot)
}

test('every flop card comes to rest exactly on its slot', () => {
  for (let seed = 1; seed < 20; seed++) {
    const slots = slotsAt()
    flop(DEALER, slots, CARD_W, mulberry32(seed)).frames.forEach((frames, k) => {
      const last = frames[frames.length - 1]
      assert.deepEqual({ x: last.x, y: last.y, rot: last.rot, lift: last.lift }, { ...slots[k], lift: 0 })
    })
  }
})

test('the flop flies as one stack, each card of it showing', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    // Face down, the first card dealt is on top: each card sits on the one after it.
    for (const k of [0, 1]) {
      const [below, card] = [frames[k + 1], frames[k]]
      const gap = (i: number) => ({ x: card[i].x - below[i].x, y: card[i].y - below[i].y, rot: card[i].rot - below[i].rot })
      const first = gap(0)
      const off = Math.hypot(first.x, first.y)
      assert.ok(off >= CARD_W * 0.04 && off <= CARD_W * 0.15, `card ${k} sits ${off.toFixed(1)}px off the one under it`)
      assert.ok(Math.abs(first.rot) <= 5, `card ${k} is twisted ${first.rot.toFixed(1)}° off the one under it`)
      below.forEach((f, i) => {
        if (f.lift <= 0) return
        assert.equal(card[i].t, f.t)
        const now = gap(i)
        assert.ok(Math.hypot(now.x - first.x, now.y - first.y) < 0.01 && Math.abs(now.rot - first.rot) < 0.01, `stack shifted in the air at ${f.t}ms`)
      })
    }
  }
})

test('as the stack skids, each card rides further on the one under it, then it all lies still until turned over', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames, turnAt } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    const down = frames[0].findIndex((f, i) => i > 0 && f.lift <= 0)
    const travel = { x: frames[0][down].x - frames[0][0].x, y: frames[0][down].y - frames[0][0].y }
    const len = Math.hypot(travel.x, travel.y)
    for (const k of [0, 1]) {
      const [below, card] = [frames[k + 1], frames[k]]
      // How far this card is ahead of the one under it, along the way the stack was thrown.
      const ahead = (i: number) => ((card[i].x - below[i].x) * travel.x + (card[i].y - below[i].y) * travel.y) / len
      let last = ahead(down)
      for (let i = down + 1; below[i].t <= turnAt + REVEAL.turnMs; i++) {
        assert.ok(ahead(i) >= last - 1e-6, `card ${k} slid back on the one under it at ${below[i].t}ms`)
        last = ahead(i)
      }
      assert.ok(last - ahead(down) >= CARD_W * 0.05, `card ${k} only rode ${(last - ahead(down)).toFixed(1)}px further`)
      assert.ok(last <= CARD_W * 0.4, `card ${k} rode ${last.toFixed(1)}px clear of the one under it`)
      const rest = frames[k].findIndex((f) => f.t >= turnAt)
      assert.ok(still(frames[k], frames[k][rest].t - REVEAL.beatMs[0] + 16, turnAt + REVEAL.turnMs), `card ${k} moved while lying still`)
    }
  }
})

test('the flop lands, lies still for a beat, and only turns over once it is down', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames, turnAt } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    const down = frames[0].find((f, i) => i > 0 && f.t < turnAt && still(frames[0], f.t, turnAt))!
    assert.ok(turnAt - down.t >= REVEAL.beatMs[0] - 16, `turned ${turnAt - down.t}ms after landing`)
    assert.ok(still(frames[0], down.t, turnAt + REVEAL.turnMs), 'moved while turning over')
  }
})

test('the spread lays the cards out left to right, the top card going furthest', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames, turnAt } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    const from = turnAt + REVEAL.turnMs
    const spreadStart = frames.map((c) => c.find((f) => f.t >= from)!)
    const travel = frames.map((c, k) => Math.hypot(c[c.length - 1].x - spreadStart[k].x, c[c.length - 1].y - spreadStart[k].y))
    assert.ok(travel[0] < travel[1] && travel[1] < travel[2], `travel ${travel.map(Math.round)}`)
    const ends = frames.map((c) => settledAt(c, from))
    assert.ok(ends[0] <= ends[1] && ends[1] <= ends[2], `settled at ${ends.map(Math.round)}`)
    assert.ok(spreadStart[0].x < frames[0][frames[0].length - 1].x + CARD_W * 0.5, 'the stack landed right of the first slot')
  }
})

test('no two flops are dealt alike', () => {
  const rest = (seed: number) => {
    const { frames, turnAt } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    return frames[0].find((f) => f.t >= turnAt)!
  }
  const poses = [1, 2, 3, 4].map(rest)
  assert.equal(new Set(poses.map((p) => `${p.x.toFixed(1)},${p.rot.toFixed(1)}`)).size, 4)
})

test('a turn or river card lands off its slot, turns over, then is pushed into line', () => {
  for (let seed = 1; seed < 20; seed++) {
    const slot = { x: 600, y: 400, rot: 1 }
    const { frames, turnAt } = street(DEALER, slot, CARD_W, mulberry32(seed))
    const at = frames.find((f) => f.t >= turnAt)!
    const off = Math.hypot(at.x - slot.x, at.y - slot.y)
    assert.ok(off >= CARD_W * 0.1 && off <= CARD_W * 0.5, `landed ${off}px off its slot`)
    assert.ok(still(frames, turnAt - REVEAL.beatMs[0] + 16, turnAt + REVEAL.turnMs), 'moved while turning over')
    const last = frames[frames.length - 1]
    assert.deepEqual({ x: last.x, y: last.y, rot: last.rot, lift: last.lift }, { ...slot, lift: 0 })
  }
})

/** Checks a card's turn: face down (±180) until `turnAt`, face up (0) once the turn is done, only ever turning one way between, and sampled finely enough to see. */
const turnsOnce = (frames: Frame[], turnAt: number, down: number) => {
  assert.ok(frames.every((f) => f.turn !== undefined), 'a frame has no turn')
  for (const f of frames) {
    if (f.t <= turnAt) assert.equal(f.turn, down, `turned early at ${f.t}ms`)
    if (f.t >= turnAt + REVEAL.turnMs) assert.equal(f.turn, 0, `still turning at ${f.t}ms`)
  }
  const turning = frames.filter((f) => f.t > turnAt && f.t < turnAt + REVEAL.turnMs)
  assert.ok(turning.length >= 8, `only ${turning.length} frames of turning`)
  frames.forEach((f, i) => i && assert.ok(Math.abs(f.turn!) <= Math.abs(frames[i - 1].turn!) + 1e-9, `turned back at ${f.t}ms`))
}

test('the flop turns over as one on a hinge by its left edge, toward the spread', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames, turnAt, hinge } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    assert.equal(hinge, 1 - REVEAL.hinge)
    for (const card of frames) turnsOnce(card, turnAt, -180)
    const window = (card: Frame[]) => card.filter((f) => f.t > turnAt && f.t < turnAt + REVEAL.turnMs).map((f) => [f.t, f.turn])
    assert.deepEqual(window(frames[1]), window(frames[0]))
    assert.deepEqual(window(frames[2]), window(frames[0]))
  }
})

test('a turn or river card turns over toward the board, on a hinge by its right edge, lifting its left side', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames, turnAt, hinge } = street(DEALER, { x: 600, y: 400, rot: 1 }, CARD_W, mulberry32(seed))
    // Face down it lies out past the board's end, clear of the card beside it.
    assert.equal(hinge, REVEAL.hinge)
    // rotateY lifts the side left of a right-hand hinge for a positive turn.
    turnsOnce(frames, turnAt, 180)
  }
})

test('turning the stack over turns its order over too: the first card is on top face down, the last face up', () => {
  for (let seed = 1; seed < 20; seed++) {
    const { frames } = flop(DEALER, slotsAt(), CARD_W, mulberry32(seed))
    frames[0].forEach((f, i) => {
      const zs = frames.map((card) => card[i].z!)
      assert.ok(zs.every((z) => z !== undefined), 'a frame has no stacking order')
      const faceDown = Math.abs(f.turn!) > 90
      assert.deepEqual([...zs].sort((a, b) => a - b), faceDown ? [...zs].reverse() : zs, `wrong card on top at ${f.t}ms`)
    })
  }
})

test('a player shows their pair by turning it over as one, toward the middle, from exactly where it lay face down', () => {
  const middle = { x: 500, y: 300 }
  for (const pair of [
    [{ x: 192, y: 300, rot: 3 }, { x: 208, y: 302, rot: 8 }],
    [{ x: 792, y: 300, rot: -7 }, { x: 808, y: 302, rot: -2 }],
    [{ x: 492, y: 600, rot: 178 }, { x: 508, y: 602, rot: 183 }],
  ]) {
    const shown = turnUp(pair, middle, CARD_W)
    const a = ((pair[0].rot + pair[1].rot) / 2) * (Math.PI / 180)
    const across = { x: Math.cos(a), y: Math.sin(a) }
    const pivots = shown.map((card, k) => {
      const r = (card.rest.rot * Math.PI) / 180
      // Face down, a hinged card lies the hinge's swing from its pose; that has to be where it already was.
      const swing = (2 * card.hinge - 1) * CARD_W
      assert.ok(Math.hypot(card.rest.x + Math.cos(r) * swing - pair[k].x, card.rest.y + Math.sin(r) * swing - pair[k].y) < 1e-6, `card ${k} jumped when it started turning`)
      // A card can only come down across its own width, so it goes whichever way along that is nearer the middle; a pair square to the middle may go either.
      const toMiddle = { x: middle.x - pair[k].x, y: middle.y - pair[k].y }
      const square = Math.abs(toMiddle.x * across.x + toMiddle.y * across.y) < 0.3 * Math.hypot(toMiddle.x, toMiddle.y)
      if (!square) assert.ok((card.rest.x - pair[k].x) * toMiddle.x + (card.rest.y - pair[k].y) * toMiddle.y > 0, `card ${k} turned away from the middle`)
      turnsOnce(card.frames, 0, card.hinge > 0.5 ? 180 : -180)
      // Where it turns about: halfway between where it lay and where it comes down.
      return ((card.rest.x + pair[k].x) / 2) * across.x + ((card.rest.y + pair[k].y) / 2) * across.y
    })
    assert.ok(Math.abs(pivots[0] - pivots[1]) < 1.5, `the two cards turn about lines ${(pivots[0] - pivots[1]).toFixed(1)}px apart`)
    assert.deepEqual(shown[0].frames.map((f) => [f.t, f.turn]), shown[1].frames.map((f) => [f.t, f.turn]), 'the two cards turn at different times')
    // Face down the second card is on top; turned over as one, the first is.
    shown[0].frames.forEach((f, i) => {
      const [z0, z1] = [f.z!, shown[1].frames[i].z!]
      assert.ok(Math.abs(f.turn!) > 90 ? z1 > z0 : z0 > z1, `wrong card on top at ${f.t}ms`)
    })
  }
})
