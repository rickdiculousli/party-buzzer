# Host play desk details

- The "Answering" line names who the judging keys act on, large enough to read from across the desk; the leader shows as soon as they are in, dimmed until judging opens.
- Next question is hidden in a scoreless mode unless a setlist is running: Arm already starts a fresh question, so Next only matters where it advances something.
- The judge's transcript under the controls is the evidence for an undo; the verdict itself is the award.
- The play strip's reader controls are the transport only (play, pause, position); which pack and how reading behaves live with setup on the Games tab.
- While a hand-picked pack is still rendering, Read is not offered, because its switch is still landing. Under a setlist it is, since the reader waits for each question's audio.
- An Autoplay chip shows on the play strip whenever autoplay is on, because it changes what the room does without anyone touching it.
- Under a setlist the Games tab hides the minigame launchers: the blocks name the minigames, and launching one by hand would step outside the plan the play strip is walking.

Where: `client/Host.tsx` (`QuizDesk`), `client/HostSetup.tsx` (`HostGames`)
