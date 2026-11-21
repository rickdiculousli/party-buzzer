# Push-to-talk answering on the phone

The locked-in leader answers by holding a button while the judge listens. The design keeps every failure visible on the button, because a send that vanishes is indistinguishable from a broken mic.

- The mic's whole life is the `Talk` component's mount: it opens when the answer window mounts it and closes on unmount, so nothing outlives the window, including a pending cap timer.
- The pointer is captured on press, because the drag-down cancel leaves the button and its move/up events must still arrive. Dragging down cancels; holding again is the re-record, with no separate control.
- A hold shorter than a quarter second is not sent (it would transcribe to garbage and cost a neg); the button says it was too short instead, and the window stays open.
- A hold is capped at six seconds and then sends what it has, so a stuck finger cannot hold the round hostage.
- With no mic (denied, or a plain-http address, which is not a secure context) the phone shows a "Say it out loud" panel instead of a button that cannot record.
- The countdown ripples on each of its last three seconds so the end is felt, not read.

Where: `client/Talk.tsx` (`Talk`, `TalkCountdown`, `MAX_ANSWER_MS`)
