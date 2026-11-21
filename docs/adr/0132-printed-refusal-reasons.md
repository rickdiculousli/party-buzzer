# A disabled control's reason is printed, never a `title`

Every host control that greys out says why in a printed line next to it, because a disabled button suppresses the pointer events a `title` tooltip needs, so a reason hung on one is never shown. Duel close reasons and judge/arm notes are a `p.muted` under their panel or keys; the Skip block and Replay finale refusal in the setlist strip is a `span.muted`, because that strip is one flex row of chips.

Where: `client/DuelPanel.tsx` (`DuelPanel`), `client/Host.tsx` (`QuizDesk`: `host__notes`, the `jump` refusal), `client/SetlistPanel.tsx`
