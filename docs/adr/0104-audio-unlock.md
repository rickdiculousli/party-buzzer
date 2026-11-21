# Audio contexts are unlocked by a user gesture, and borrowed rather than minted

Browsers start an `AudioContext` created outside a user gesture `suspended`, and a suspended context plays nothing and never runs a worklet. So `unlock` creates or resumes the cue context inside a tap. The board is the only surface with a speaker the room hears: its first `pointerdown` anywhere unlocks the context and decodes the anchor cues' files (`prime`), the first moment there is a context to decode into, and until then a "Click for sound" chip says why it is silent. The host, which has no other sound path, unlocks in `Spoken`'s first-pointerdown listener. A context suspended by a locked screen or a backgrounded tab is resumed, never replaced.

The phone's recording context is created in the join tap; `Recorder` borrows it and the join-time mic stream from its caller instead of building its own in an effect (where no gesture could unlock it), and on stop only disconnects its node, never closing the context, because it belongs to the page.

Where: `client/sound.ts` (`unlock`, `prime`), `client/Board.tsx` (`Board`: `audible`), `client/recorder.ts` (`Recorder.start`, `Recorder.stop`), `client/Spoken.tsx` (`Spoken`), `client/Player.tsx`, `client/Talk.tsx`
