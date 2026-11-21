# A surface's half-made picks reset when their context ends

Components that stay mounted across rounds clear their local selections when the server-side thing they belong to ends: the host's hand-picked duel pair clears when the duel goes away, and an Ink phone's prompt picks clear when the step leaves `offer`. Otherwise a stale pair sits pre-selected and one tap seats players, or votes for prompts, nobody chose this time.

Where: `client/DuelPanel.tsx` (`DuelPanel`), `client/InkPlayer.tsx` (`InkPlayer`)
