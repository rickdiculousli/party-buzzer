---
id: 042
title: Minigame phones keep the status bar
kind: ux
size: S
judge: sonnet
status: done
lens: ux
proposed_by: f3e13ca3-5996-4d39-839c-6ee6289499ff
proposed_on: 2026-10-14
---

## Opportunity
The design guide §7 says of the phone: "The buzzer fills everything below a
single status bar. The player's name is rendered in their identity colour,
so you can tell whose phone you picked up." Bow and Tank throw the bar away.

![Bow phone](assets/042-phone-bow.png)
![Tank phone](assets/042-phone-tank.png)
![Sketch phone keeps it](assets/042-phone-sketch.png)

Measured at 390×844: the Bow phone is "Drag down and release · 0 points" and
a bow, no name, no colour, no connection lamp, no score; Tank is sideways
with "Driver" and prints "Point where you want to go" twice (once in the
header line, once on the left edge). Sketch keeps the bar with name, lamp and
score; Poker has its own felt header with the name. Four minigames, three
conventions. At a party phones get put down and picked up; the bar is how
you know it is yours, and the lamp is how you know it is still connected.

## Proposal
`Player.tsx` renders the status bar above every minigame player view, as it
does for the quiz and Sketch; the Bow and Tank views give up their own title
line for it, so the instruction becomes the sub-line under the bar. Tank's
sideways layout rotates the bar with it (it already rotates the rest through
`useSideways`), and its duplicate instruction goes. Poker keeps its felt but
gets the same lamp beside the name.
In: the bar on four views, two deleted lines. Out: the controls, the
sideways compensation, Poker's layout.

Judge: sonnet, because the bar exists and the change is where it is
rendered.

## What you'll see
Every phone, all night, starts with "DEE · connected · 0" in Dee's colour;
below it the bow, the tank dial, the sketch canvas or the felt.

## Verification
`npm run build`. `npm run sim-bow -- 1 20` and `sim-tank -- 1 30` with a real
phone joined; the bar is there and rotates with Tank. `npm run review` phone
scenarios for each minigame.

## Shown
- Bow phone has the bar: real browser phone at 390x844 beside `sim-bow -- 1 30`, `.player__bar` text -> `DeeConnected0`
- Tank phone has the bar, rotated with the view: same run with `sim-tank`, `.player__bar` text -> `DeeConnected0`; the 390x844 screenshot shows it on the rotated top edge, with the duplicate "Point where you want to go" line gone
- Poker gets the lamp: `sim-poker -- solo`, `.poker-phone__top` text -> `DeeConnectedStack 1,490Pot 30`
- Easy to miss: the Bow and Tank instruction stays as the sub-line under the bar: Bow keeps "Drag down and release" in `client/BowPlayer.tsx`
- `npm run build` -> `built in 1.03s`; `npm run test:review` -> `302 passed (1.3m)`
- Not shown: `npm run review` phone scenarios for each minigame: the review deck has no Bow, Tank or Poker phone scenario (only a Tank intro), so the layout fit check does not reach them; the real-phone screenshots stand in

## Risks and the alternative considered
Tank's sideways view is height-tight at 390×844 rotated; the bar costs about
60px of the long axis, which the buttons can give. Alternative: a name only,
no lamp; rejected because connection is what the guide puts in the bar.

## Needs from Rick
