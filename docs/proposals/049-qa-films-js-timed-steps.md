---
id: 049
title: adversarial-qa says how to film a ceremony whose steps JavaScript times
kind: token-cost
size: XS
judge: sonnet
status: proposed
lens: eng
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-03
from_feedback: party-buzzer-build-1 (party-buzzer-031) #4259
---

## Opportunity
`tools/qa/filmstrip.ts` pauses the CSS animations of one mount and seeks
them, so a moment whose steps a JavaScript clock advances (spec 031's
podium: 3rd, 2nd, then 1st) cannot be filmed as a sequence. 031's lead found
this mid-QA, added one motion scenario per step (`finale-third`,
`finale-second`) and filmed the real sequence with an ad hoc Playwright probe.
The next lead with a timed ceremony will rediscover it.

## Proposal
One line in the repository `adversarial-qa` skill's evidence section: a
JS-timed step gets one motion scenario per step, and the sequence is checked
in the walk on a disposable room, not the filmstrip. Shaped with
`skill-shaper`.
In: that line. Out: a real-time mode for the filmstrip.

Judge: sonnet, because the line is given.

## What you'll see
The skill names the per-step scenario path where a critic gathers evidence.

## Verification
`npm test` unaffected; the skill reads the line in its evidence section.

## Shown

## Risks and the alternative considered
Alternative: teach the filmstrip to walk a scenario in real time; rejected
for now as a tool for one ceremony.

## Needs from the operator
