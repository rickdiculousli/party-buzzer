---
id: 044
title: The Games tab reads like a desk, not a terminal
kind: ux
size: M
judge: fable
status: proposed
lens: ux
proposed_by: f3e13ca3-5996-4d39-839c-6ee6289499ff
proposed_on: 2026-10-14
---

## Opportunity
The quiz fold on the Games tab is where a host sets up the night, and it is
eleven controls labelled in uppercase mono sentences.

![Games tab, quiz fold open](assets/044-host.png)
![the folds](assets/044-host-folds.png)

Measured at 1280×800: "POWER ENDS AFTER FRAGMENT (0 = POWERS OFF)",
"BOUNCEBACKS (WRONG ANSWERERS SIT OUT THE REBOUND)", "SEC · 0 = YOU END A
STALL BY HAND" are labels at `--t-xs` (11px) uppercase tracked mono, the
eyebrow style. The design guide §8: "Sentence case everywhere except
eyebrows, chips, and key hints, which are uppercase because they are labels
rather than sentences." These are sentences. The fold's three sections
(Mode, Pack, Reading) share one left edge with the labels so nothing groups,
and the checkbox controls sit at four different x positions. The Poker fold
has the same rule applied differently: labels in uppercase, inputs aligned
right at 500px.

## Proposal
One form grammar for every fold, in `client/style.css` and the three setup
components: the eyebrow stays uppercase for the section (Mode, Pack,
Reading, Poker); each control is a `.field` row with a sentence-case label
at `--t-sm` chalk on the left, the control at a fixed column, and the
explanation ("0 turns powers off") as a dim `--t-xs` line under the label,
not inside it. Checkboxes become the existing toggle style aligned to the
same column. Numbers use the `.stepper`. The quiz fold's three sections get
`--s5` between them.
In: the grammar, the labels rewritten, the Poker and other minigame folds.
Out: new options, the setlist builder, the Players tab.

Judge: fable, because the column rhythm and the rewritten sentences need an
eye, not a rule.

## What you'll see
"Power ends after fragment  [2]  0 turns powers off", "Bouncebacks  [on]
Wrong answerers sit out the rebound", every control in one column, every
reason under its label, the same in Poker's fold.

## Verification
`npm run build`. Re-shoot the Games tab at 1280×800 with each fold open and
check every label is sentence case and every control sits on the same x.
`npm test` is unaffected.

## Risks and the alternative considered
Longer sentence-case labels wrap at 1280; the two-line explanation slot
absorbs that. Alternative: shorten the labels and keep uppercase; rejected
because the guide's rule is about what a sentence is, not how long.

## Needs from Rick
