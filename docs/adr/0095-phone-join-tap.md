# The phone's join tap is mandatory

Every phone, including one the room already knows, starts behind the join tap, because browsers (iOS in particular) unlock audio only inside a user gesture; skipping the tap means a silent phone all night.

- The tap creates and resumes the `AudioContext` and asks for microphone permission (then stops the stream), so the first spoken answer is not spent on the permission dialog. The answer stream itself opens on lock-in.
- iOS suspends the audio context when the phone locks, so `blip` resumes it first and the surface resumes it whenever the page becomes visible again. The quiz phone's cues are synthesized oscillator blips rather than sound files.
- A new phone's first `hello` waits for a connected socket, because the tap may land while the socket is down and a reopening socket only says hello for a phone with a stored id. A returning phone's tap sends `hello` with the typed name, which renames it.

Where: `client/Player.tsx` (`Player`, `join`, `blip`)
