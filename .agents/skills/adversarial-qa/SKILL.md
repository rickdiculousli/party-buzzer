---
name: adversarial-qa
description: Adversarial review of party-buzzer motion, visuals and sound before calling them done. Gathers real evidence (kinematics from the actual path code, filmstrip contact sheets of the motion harness, a spectrum/loudness report per cue), then sends fresh critic agents per module (physics, aesthetics, sound, readability, timing, consistency) to find what a demanding player would notice, verifies their findings, fixes the confirmed ones and attacks again. Use this whenever you have changed an animation, a trajectory, CSS that moves or lights things, a card/chip/table visual, a sound cue or its timing, and before telling Rick it is finished, and whenever Rick asks to QA, critique, review, sanity-check or "be adversarial" about how something looks, moves or sounds, even if he does not name this skill.
---

# Adversarial QA

Rick has repeatedly been told an animation or sound was good when it had
glaring problems: whooshes that sounded like TV static, a thud like a wooden ruler, sounds on
events that make no sound in reality, shadows that bent wrong. Those calls
were made by the same agent that built the thing, from reading its own code. The
builder sees what they meant. A critic who did not build it, and who has to
argue from evidence, sees what is there.

So this skill does three things the builder cannot do alone: it turns motion
and sound into evidence a model can inspect, it hands that evidence to fresh
critics whose only job is to find faults, and it makes you verify their
findings instead of defending your work.

## When it runs

- **As a gate**: after you change motion, visuals or sound in this repo, run
  it before you say the work is done. Report its surviving findings in the
  same handover.
- **On request**: when Rick asks to QA, critique or pressure-test something.

Scale it to the change. A one-number tweak of a tuned value needs one critic
and one round; a new move or a new cue family needs every module it touches.

## 1. Scope: what changed, which modules

Read the diff (`git diff`, plus uncommitted work) and name each changed moment
in player terms ("the flop is laid out", "a fold is thrown", "chips land in the
pot"). Pick modules by what the change touches:

| Change touches | Modules |
|---|---|
| Path code (`client/toss.ts`, frame lists, `Piece`), keyframes, transforms | physics, timing, aesthetics |
| Lighting, shadows, materials, colours, type, layout | aesthetics, readability, consistency |
| A cue recipe, when a cue plays, loudness | sound, timing |
| A new effect or component | consistency, plus whatever it moves or sounds like |
| Board-facing text or state changes | readability |

Each module's brief is in `references/<module>.md`. Read `references/rulings.md`
yourself before anything else: it lists decisions Rick has already made, which
no critic may overturn.

## 2. Evidence

Critics are only as good as what they can see. Generate evidence for every
changed moment into `.qa/` (ignored by git):

```sh
npm run qa:motion -- deal fold         # speeds, spin, air time, contacts, physics flags (card widths, seconds)
npm run qa:sound -- poker-deal         # loudness vs tier, onset/attack/length/held, bands, centroid, flatness, phone share
npm run qa:film -- --list              # motion-harness scenario ids
npm run qa:film -- poker-flop --frames 12 --out .qa/flop   # sheet.png + timing.json
npm run loudness                        # every cue against the loudness standard
```

- The filmstrip drives a headless browser over the motion harness only. That is
  allowed here even though Rick otherwise tests UI himself: it captures frames
  and does not try to test gestures or feel.
- If a changed moment has no harness scenario or kinematics preset, add one
  (a scenario in `client/anim/scenarios.tsx`, a preset in
  `tools/qa/kinematics.ts`) rather than reviewing it blind. Say that you did.
- Rebuild `dist/` after changes (`npm run build`). Rick has been served a stale
  build before.

Note what the evidence cannot show: real speakers, the room's acoustics, touch
feel, a 65-inch TV at three metres, multiple devices. Critics must say so instead of guessing.

## 3. Attack

Spawn one critic per selected module **in the same turn**, so they run in
parallel and cannot anchor on each other. Use the Agent tool with
`general-purpose` agents and a fresh context. Each gets:

- the module brief path (`.agents/skills/adversarial-qa/references/<module>.md`)
  and `references/rulings.md`;
- the changed moments, in player terms, and the files involved;
- the evidence paths (sheets, timing.json, report output saved to a file);
- **not** your opinion of the work. Tell them only that the builder thinks it
  is finished.

If you cannot spawn agents (you are yourself a subagent), play each critic in
turn: write the critique from the brief and the evidence alone, before you
reopen the implementation, and keep it written down so you cannot quietly
soften it later. It is weaker than fresh eyes, so say in the report that this happened.

Use this brief, filled in:

```
You are the <module> critic in an adversarial QA pass on party-buzzer, a party game
played on a TV board and phones. The builder believes the change below is finished.
Your job is to find what a demanding player would notice, and to prove it.
Work read-only: do not edit files. You may run the evidence tools in tools/qa/.

Read first: <brief path>, .agents/skills/adversarial-qa/references/rulings.md
Changed moments: <list>
Files: <list>
Evidence: <paths>

Return at most 8 findings, most severe first, each as:
- severity: glaring (a casual player notices in one viewing) | noticeable (a careful watcher notices) | nit
- moment and where: frame #/time, metric and value, or file:line
- what is wrong, and what reality or the design guide does instead
- the smallest fix you would try
- confidence, and what evidence would settle it if you are unsure
Then list what you checked and found sound, so silence is not mistaken for approval.
Do not soften findings to be polite, and do not pad with nits to look thorough.
```

## 4. Verify

You are the judge now, not the defence. For each finding:

- **Confirmed**: the evidence shows it. Reproduce it yourself (look at the
  frame, rerun the number, read the line).
- **Plausible**: consistent with the evidence but not proven by it. Keep it,
  and say what would prove it (often: "Rick should look at X on the phone").
- **Rejected**: contradicts a ruling, misreads the evidence, or is a matter of
  taste the design guide does not settle. Write down why in one line.

The failure this skill exists to prevent is the builder waving findings away.
Rejecting a finding needs a reason that points at evidence or a ruling, not
"it's intended" from memory.

## 5. Fix, then attack again

Fix confirmed findings that are within the change's scope, using the repo's
own rules (tunables in their homes, recipes in `client/cues.ts`, the interest
kit before a new keyframe). Regenerate the evidence, rebuild, and send **new**
critics (fresh agents, not the previous ones resumed) at the result, with the
previous round's confirmed findings listed so they can check the fixes held.

Stop when a round returns nothing above nit, after three rounds, or when what
remains is taste that only Rick can decide. Out-of-scope problems the critics
found go in the report, unfixed.

## 6. Report

In the handover to Rick, briefly:

- rounds run and modules covered;
- fixed: each confirmed finding, one line, with the evidence it came from;
- still open: plausible findings and taste calls, as questions for Rick;
- rejected: one line each, so he can overrule;
- what the evidence could not cover, and what he should check by eye or ear
  (once; do not repeat a list he has already seen).

When Rick then overrules something or makes a new call, add it to
`references/rulings.md` so the next critics respect it.
