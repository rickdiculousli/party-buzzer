# Manual checklist

Automated tests cover buzz ordering, the timestamp clamp, and reconnection.
These need real hardware — run them once before a real game night.

## Per phone (test at least one iPhone and one Android)

- [ ] Scanning the QR from the camera app opens the join page
- [ ] Scanning the QR shown on `/board` works from across the room
- [ ] After joining, the buzzer fills the screen with no scroll or bounce
- [ ] Pressing the buzzer vibrates
- [ ] Pressing the buzzer makes a sound — **the iOS case**: audio must work on
      the first buzz of the night, proving the join tap unlocked the audio
      context
- [ ] The screen does not dim or sleep while the buzzer page is open
- [ ] Locking and unlocking the phone returns to a working buzzer within a
      second or two
- [ ] Walking out of WiFi range and back reconnects automatically, keeping the
      same name and score
- [ ] Reloading the page keeps the same identity
- [ ] "Add to Home Screen" produces a working full-screen app

## Room

- [ ] `/board` is readable from the far side of the room
- [ ] Ten or more phones joined at once, all appearing on the host panel
- [ ] Two players buzzing near-simultaneously produce a plausible winner and a
      believable millisecond gap
- [ ] Host laptop sleeping and waking does not lose scores
