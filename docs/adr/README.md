# Architecture decision records

These records hold the decisions that would otherwise live in code comments, which this repo does not allow; `npm test` fails on a comment in the code. To add one, take the next free number and write `NNNN-slug.md` as a `# Title`, one to three sentences of context, decision and why (a short bullet list for a cluster of small decisions in one module), and a `Where:` line naming files and symbols, then list it below.

## Architecture and server core

- [0001 Host-action legality is one shared table](0001-host-legality-table.md): `refuses` is the one answer to "may the host do this now", for server and surfaces alike
- [0002 The legality table and the server are held to parity by a sweep](0002-legality-parity-test.md): a sweep holds every host action to "allowed changes state, refused does not"
- [0003 Display moments come only from facts every role receives](0003-moments-from-public-facts.md): board and phones compute the same moment from differently redacted state; clocks arrive as `Local`
- [0004 The moment ladder's order is the behaviour](0004-moment-ladder-order.md): `momentOf` returns the first match, so its order is the behaviour
- [0005 The wall's middle band has exactly one occupant, chosen by moment](0005-wall-middle-occupant.md): `middleOf` picks exactly one middle-band occupant per moment, never ranking
- [0006 Times on the wire are server-clock milliseconds](0006-wire-times-are-server-clock.md): every timestamp in `State` and frames is server `Date.now()`
- [0007 Arming opens the buzzers at a scheduled instant](0007-scheduled-arm-delay.md): `armedAt` sits `ARM_DELAY_MS` ahead so every surface opens together
- [0008 What each per-question `Round` field means and when it goes](0008-round-field-lifetimes.md): presence and lifetime of `judge`, `spoken`, `held`, `whole`, `closesAt`
- [0009 The State field lifetime table and its codes](0009-state-field-lifetimes-table.md): one row per `State` field decides undo, disk and phone exposure
- [0010 Saved state: coalesced writes, and any snapshot boots](0010-saved-state.md): saves throttle rather than debounce; loading defaults rather than rejects
- [0011 Room defaults and autoplay dwells](0011-state-defaults.md): autoplay off by default, a 4 s rebound dwell, dwells clamped on the server
- [0012 Undo: deep history, restored in place, published once](0012-hub-undo.md): undo restores into the same object and publishes one frame
- [0013 Player identity across reconnects and repeated hellos](0013-hub-connections.md): away only when the last connection leaves; a repeat hello renames
- [0014 Hub `act` messages: who may send them, and what each publication means](0014-hub-act-messages.md): players own items, duel entry, picks and guesses; everything else is host-scoped
- [0015 Why phone views drop reading progress and checkpoint data](0015-phone-view-redaction.md): phones never get reader progress or checkpoint data
- [0016 A lobby yields to play; an introduction holds it](0016-lobby-yields-introduction-holds.md): a practice lobby never refuses play; a block introduction holds it
- [0017 What the night's ledger records](0017-ledger-facts.md): reaction times, closest hits and standings facts the recap trusts
- [0018 Night recap rules and the keepsake file](0018-night-recap.md): positive-only cards, competition rank, one keepsake file per night
- [0019 Browser clock sync, scheduled opening and reconnection](0019-client-clock-and-reconnect.md): monotonic offset clock, timer-driven opening, no queued sends
- [0020 HTTP and socket choices in the composition root](0020-server-transport.md): caching, body cap, `beat` heartbeat, forced connection close
- [0021 LAN TLS from the published local-ip.sh wildcard](0021-lan-tls-via-local-ip.md): a published wildcard certificate buys phones a secure context for the mic
- [0022 The join address skips virtual interfaces and prefers 192.168.x.x](0022-lan-address-choice.md): virtual interfaces are skipped; `192.168.` wins
- [0023 `npm start` opens and closes its own browser tabs](0023-launcher-tabs.md): direct launch opens board and host and closes Chrome tabs by url on Ctrl-C
- [0024 Pack reads: a missing directory is quiet, other failures warn, names cannot traverse](0024-pack-directory-reads.md): `ENOENT` is quiet, other errors warn, a pack name is untrusted
- [0025 Player names have no length limit](0025-names-have-no-length-limit.md): every surface must lay out names of any length

## Reading and judging

- [0026 One buzz collection window, ordered by press time](0026-buzz-collection-window.md): press-stamp order over the whole window; the 150 ms reveal is not a cut-off
- [0027 A miss is marked by `award.penalty`, never by the sign of `points`](0027-award-penalty-flag.md): `isPenalty`, because `-0` does not survive JSON
- [0028 A verdict leaves its result on the wall until the room moves on](0028-verdict-leaves-result-up.md): order, transcript and award stay up until something replaces them
- [0029 Autoplay presses the keys around the verdict, never the verdict](0029-autoplay-around-the-verdict.md): autoplay holds a miss, then the reader opens the rebound; the host still judges
- [0030 The reader's waits are scoped by abort signals, not flags](0030-reader-cancellation-scopes.md): every await takes an `AbortSignal`, so stale questions never wake up
- [0031 The reader calls a question over only when its round is idle](0031-reader-resolution-gates-on-phase.md): an award alone does not end a question; the round must be `IDLE`
- [0032 The reader speaks a whole question in one breath and reveals it at measured folds](0032-joined-read-and-fold-search.md): one clip per question, folds found by bisecting a transcription oracle
- [0033 Matching transcribed words against the source text](0033-align-word-matching.md): `completed` undercounts rather than guesses, and resyncs on anchors
- [0034 ElevenLabs takes: paid once, timed per character, opt-in by voice](0034-elevenlabs-takes.md): takes render once, the voice is the opt-in, folds come from character times
- [0035 Question audio and asides play in separate slots](0035-reader-voice-slots.md): `playback` stops on a buzz; `quipback` plays over the payoff
- [0036 Speech renders behind the game through one deduplicated queue](0036-reader-render-queue.md): `ensure` resolves on the first question; `textsOf` is shared with `npm run voice`
- [0037 The reader keeps a position per pack and stops at a spent one](0037-reader-pack-positions.md): positions persist per pack; a spent pack stops rather than wraps
- [0038 Choice and closest windows close on a timer flag and settle after a beat](0038-reader-choice-and-closest-windows.md): the timer sets a flag, Close stamps now, settling waits a beat
- [0039 Choice and closest questions never give an answer away early](0039-choice-and-closest-questions.md): nobody sees picks before the reveal; empty rooms wait; distances round
- [0040 Speech is pre-rendered to cached files and stopped by killing the player](0040-speech-playback.md): `say` renders to cache up front; stop and pause are `SIGKILL`
- [0041 Transcription is a native Swift helper, built on demand and warmed at boot](0041-stt-native-helper.md): on-device `swiftc`-built helper, warmed at boot, loud about permissions
- [0042 The alignment session keeps one helper open per clip](0042-stt-session-protocol.md): one serial line-protocol session per clip, flushed unbuffered
- [0043 Spoken answer matching rules](0043-answer-matcher-rules.md): edit-distance per content token, article-only variants never match
- [0044 Verdict quips: one take per line, sparse, never repeated back to back](0044-verdict-quip-pools.md): about half the verdicts get a quip, sincere ones weighted down; the pools file format

## Modes

- [0045 Mode hook contracts](0045-mode-hook-contracts.md): `onWrong` neg 0, `onArm` only on arm, `onFragmentEnd` counts, `viewModuleState` default

## Duels, items and setlists

- [0046 Duels are a framework module with data-driven rules](0046-duels-framework.md): duel rules are data; votes stay inside a team; the pool is public
- [0047 What survives around a duel](0047-duel-transitions.md): an unseated pool dies with a mode or grouping change; a seated pair survives
- [0048 Item rules and how effects find their question](0048-items-and-effect-stamps.md): freeze only between questions, passive shield, steal via a stamped effect
- [0049 A setlist advises the room; it never plays](0049-setlist-block-setup.md): entering a block applies setup and stops; the reader stays the only arm
- [0050 Editing a setlist keeps the night's position](0050-setlist-edit-keeps-position.md): `setSetlist` keeps the current block when the new list still reaches it
- [0051 Next advances the setlist only past a played question](0051-next-advances-only-played-question.md): only a question with `armedAt > 0` spends a setlist question
- [0052 Jumping to the end clears the question for the finale](0052-finale-jump-drops-question.md): `setlistJump` to the end clears the question before the ceremony
- [0053 Saved setlists are whole JSON files named by a slug](0053-setlist-files.md): slug-named whole-file JSON; bad files read as empty

## Minigames

- [0054 The minigame runtime owns lifecycle; definitions are pure game rules behind a fixed hook contract](0054-minigame-runtime-contract.md): the runtime owns clocks, queues and acks; definitions are pure hooks
- [0055 Minigame frame conventions](0055-minigame-frame-conventions.md): secrets stay out of frames; heavy fields resend once a second
- [0056 The ready fallback latches once it has run out](0056-night-ready-fallback-latches.md): a refused start at the fallback starts the match as soon as it becomes legal
- [0057 The minigame Ready bar reserves its own height](0057-minigame-ready-bar.md): the minigame stage subtracts the Ready bar's height
- [0058 Bow resolves contacts exactly, deterministically, and from the shape at contact time](0058-bow-collision-model.md): exact, deterministic first contact with fixed tie-breaks
- [0059 Bow phone draw feedback](0059-bow-player-draw.md): display-only rest angle and a debounced full-draw haptic
- [0060 Phantom Ink: wire shapes and the phone's optimistic draft](0060-ink-wire-and-phone-draft.md): wire types are view types; the phone's draft waits on `inkOps`
- [0061 Poker follows tournament Hold'em rules, with a few deliberate table choices](0061-poker-table-rules.md): tournament Hold'em with split pots, short all-ins and a hidden deck seed
- [0062 Poker surfaces derive the same motion from the same facts, and a reload replays nothing](0062-poker-surfaces-share-facts.md): shared deal times and turn directions; the first frame is a baseline
- [0063 Poker board table motion rules](0063-poker-board-table-motion.md): one sound per moving group, queued streets, pot pushed as stacks
- [0064 Poker phone hand handling and bet sizing](0064-poker-phone-hand.md): deal-timed peeks, held WAAPI throws, raises sized against the pot
- [0065 Poker layout never moves under a thumb](0065-poker-layout-stability.md): five slots, fixed rows and overlays keep the table still
- [0066 Poker phone gestures and the peek are tuned on a real phone](0066-poker-phone-gestures.md): `GESTURE` and `PEEK` are calibration knobs set on real phones
- [0067 Poker card motion: frame conventions](0067-toss-frame-conventions.md): turn sign, hinges and `simplifyFrames` contacts for card motion
- [0068 Sketch judges guesses so the room never sees the answer early](0068-sketch-guess-rules.md): clamped press stamps, one-edit "close", contained words never shown as misses
- [0069 Sketch's board and phone screens](0069-sketch-surfaces.md): quiz blocking, sideways drawing, the keyboard below the field
- [0070 Tank world conventions and fairness choices](0070-tank-conventions.md): headings, symmetric spawns, tolerances, cover resync, speaker-left controller
- [0071 Tug of war pulls with fatigue-weighted taps averaged per connected member](0071-tug-pull-model.md): fatigue-weighted taps averaged per connected member
- [0072 Tug of war: the drawn flag, not the server frame, calls the moment](0072-tug-drawn-flag.md): a damped drawn flag calls crossings, wins and cues
- [0136 Phantom Ink surface details](0136-ink-surface-details.md): padded lobby seats, one-word buttons, the always-laid-out Stop alert

## Board

- [0073 Arrival surfaces claim only what the server saw](0073-arrival-surfaces.md): board names from the roster, "Buzzer tested" only from a receipt
- [0074 The board wall is three bands around a fixed centre lane](0074-board-wall-layout.md): equal outer rows pin a fixed-height centre lane
- [0075 The choice grid never grows or crops the band](0075-board-choice-grid.md): two-line clamp and viewport-bounded type keep the grid in its band
- [0076 The board lays out the whole question from the first frame](0076-question-laid-out-whole.md): unsaid text is `visibility: hidden` so lines never reflow
- [0077 The spoken line types out dim and shows its verdict only once it has landed](0077-spoken-line.md): neutral while typing, verdict colour after `--verdict-hold`
- [0078 The wall reveals at the speed a room reads](0078-reveal-waits-for-the-room.md): `useReveal` holds the award for the sentence and retires a penalty
- [0079 The board's hero: keyed on the name, toned in CSS](0079-board-hero.md): keyed on the name so arrivals slam; glow keyed on the tone
- [0080 Timeline marks queue for landing slots](0080-mark-landing-queue.md): marks land at least `markGap` apart; sounds spaced on the audio clock
- [0081 The board's scales: the closest line and timeline labels](0081-board-scales.md): wild guesses park, labels pick clear lanes, reveals hold their secret
- [0082 Nominations show the seating the close will produce](0082-board-nominations.md): lit names come from `willSeat`; teams get equal columns
- [0083 Reaction pills: columns, overflow and motion](0083-reaction-pills.md): lowest free column or only the "+N" chip, never promoted
- [0084 The finale is one schedule shared by every surface, staged on the board by translates](0084-finale.md): `finaleStep` on synced clocks; the sidebar hides by translate
- [0085 Picture-reveal mosaic timing and drawing](0085-reveal-mosaic-timing.md): cell counts for a room, grace before going whole, cached images
- [0086 The welcome bed plays once a night and follows the latest request](0086-welcome-bed.md): plays until the first arm or minigame, idempotent, fades from current gain
- [0134 Board stage layout details](0134-board-stage-details.md): scale above the rail, blank first delta, held lanes, scheme in the join address

## Host

- [0087 Host desk layout rules](0087-host-desk-layout.md): dim "up" strip, reserved note lines, tungsten shortfall
- [0088 What the host keys do](0088-host-desk-keys.md): Space and C follow the slot; Reopen is safe because `rebound` is inert
- [0089 When the host desk may judge](0089-host-judging-gate.md): `judgeable` waits for `LOCKED`, a leader, and no non-penalty award
- [0090 Host desk notes are a lookup against the moment](0090-host-desk-notes.md): `notesFor` is an exhaustive lookup on the moment, not on `refuses`
- [0091 The legality table says what the host may press; surfaces keep hints and payload checks](0091-legality-vs-surface-hints.md): payload checks and seating hints stay in the surface, not the table
- [0092 Host tabs live in the URL hash, written with `replaceState`](0092-host-tabs-in-hash.md): `location.hash` with `replaceState`, so tabs are not back-button steps
- [0093 A surface's half-made picks reset when their context ends](0093-local-picks-reset.md): a stale duel pair or prompt pick clears when its context ends
- [0094 Host edits of a compound setting send the whole value](0094-setlist-builder-edits.md): `setSetlist` and `setAutoplay` send the whole value; edits grey from one refusal
- [0132 A disabled control's reason is printed, never a `title`](0132-printed-refusal-reasons.md): a disabled button never shows its tooltip, so the reason is a printed line
- [0133 Host play desk details](0133-host-desk-details.md): the Answering line, when Next and Read show, the Autoplay chip, hidden launchers under a setlist

## Phone

- [0095 The phone's join tap is mandatory](0095-phone-join-tap.md): the tap unlocks audio, asks for the mic, and sends the first hello
- [0096 Phone buzzer and vote rules](0096-phone-buzzer-and-votes.md): stamp first, cooldown margin, mood selectors, voter-keyed tallies
- [0097 The phone card answers "may I press", with its own priorities](0097-phone-card-priorities.md): `phoneOf` answers "may I press", with its own priority order
- [0098 Push-to-talk answering on the phone](0098-push-to-talk-answer.md): the mic lives with `Talk`; short holds are refused, long ones capped
- [0099 Answer audio is buffered from lock-in and sent as mono WAV](0099-answer-audio.md): the worklet rings from lock-in; WAV because browsers disagree on codecs
- [0100 Closest guesses use an in-app number pad](0100-guess-pad.md): an in-app pad, since a numeric keyboard is missing or covers half the screen
- [0135 Phone control details](0135-phone-control-details.md): practice buzzer on pointerdown, Lock in beside the number, the duel Heads-up panel

## Sound and motion

- [0101 Motion tunables live once in CSS; cue numbers live in recipes](0101-tunables-live-once.md): `anim:tunables` is the one home, `TUNE` the one fallback, recipes own cue numbers
- [0102 Anchor cues wrap the hand-tuned WAVs in no-op file layers](0102-anchor-cues-wrap-tuned-wavs.md): anchor WAVs sit in no-op `{ file }` layers at full level
- [0103 Browser sound loads lazily and fails silent](0103-sound-fails-silent.md): a missing sound is silence, never an exception; files load on first use
- [0104 Audio contexts are unlocked by a user gesture, and borrowed rather than minted](0104-audio-unlock.md): `unlock` inside a tap; contexts are resumed, borrowed, never closed
- [0105 Spaced cues are slotted by when they are heard, on the audio clock](0105-cue-spacing-on-audio-clock.md): `playSpaced` slots cues by when they are heard on the audio clock
- [0106 Cue rate is one resampling knob](0106-cue-rate-resamples.md): `rate` resamples pitch and time together; `head` and `cut` stay outside it
- [0107 Synthesis splits into pure scheduling and a WebAudio walker](0107-synth-schedule-render-split.md): `schedule` is pure and tested; `render` only walks its steps
- [0108 Signature motion shapes](0108-signature-motion-shapes.md): marks land as a run, glows start at full power, emoji glow via `drop-shadow`
- [0109 How `<Glitch>` drives its hit cycle](0109-fx-glitch-cycle.md): the base layer drives the cycle; a hit's repeat count is fixed at its start
- [0110 Local fonts load with font-display: block](0110-fonts-display-block.md): `font-display: block`, since local fonts arrive at once
- [0111 The motion harness tunes the real stylesheet against the frame a moment interrupts](0111-motion-harness-real-frame.md): the real stylesheet, a lead frame, one new subject per take
- [0112 Motion harness dials, origins and Save](0112-motion-harness-dials-and-save.md): three dial kinds, file-true origins, draft recipe trees
- [0113 Motion harness audio: what plays, and when it is decoded](0113-motion-harness-audio.md): the draft recipe plays, sound fires on the animation's edge, files decode first
- [0114 Cue layer editor: one shared axis, delta drags](0114-cue-layer-editor.md): one shared time axis, delta drags, one `zoneAt` for hover and press
- [0137 Motion harness panels do not jump](0137-harness-panel-layout.md): hint lines reserved, trim controls only once a download is chosen

## Tooling and review

- [0115 Tools and simulation bots are real clients over real sockets](0115-tools-are-real-clients.md): real sockets, stable ids, sims that cheat only to be watchable
- [0116 The Ink sim plays for borrowed phones but leaves their guesses to the person](0116-sim-ink-borrowed-phones.md): borrowed phones keep their team's guess until they stall
- [0117 Probe parks the room on an exact moment, through the game's own paths](0117-probe-scripted-rounds.md): scripted steps through real paths; `clear` undoes only what the run did
- [0118 The e2e harness relies on the server's message ordering](0118-e2e-harness-ordering.md): `FakeClient` waits on the Hub's ordering guarantees, not timers
- [0119 Time-driven server tests run on Node's mock timers, stepped in small increments](0119-server-tests-mock-clock.md): `mock.timers` stepped 5 ms at a time
- [0120 Walkthrough packs are checked against the answers their scripts speak](0120-walkthrough-packs-checked.md): unit tests check walkthrough packs against the words their scripts speak
- [0121 Trace invariants are a table of plain predicates](0121-trace-rules-table.md): `RULES` is a table of named predicates built by small factories
- [0122 The trace sees server facts only, not the board's animation clocks](0122-trace-sees-server-facts.md): trace rules see server facts; dwell bugs belong to the harness
- [0123 QA probes report physical, device-relevant numbers as leads for critics](0123-qa-probes-are-critic-evidence.md): card widths, phone-band energy and held share are leads, not gates
- [0124 Filmstrips step every stage animation on one shared clock](0124-filmstrip-capture.md): every animation paused and set to each sample time
- [0125 How the loudness check measures and rescales cues](0125-loudness-measurement.md): 100 ms K-weighted windows, seeded medians, exempt anchors
- [0126 Demo sounds are synthesized, gitignored throwaways named `demo-`](0126-demo-sounds-throwaways.md): `demo-` files are gitignored stand-ins swept by `clean`
- [0127 Sound adoption bakes exactly what was auditioned, through validated names](0127-sound-adoption-pipeline.md): pure `sndlib.ts`, strict names, ffmpeg args that match the audition
- [0128 Workbench save endpoints are dev-only and refuse rather than guess](0128-workbench-save-endpoints.md): dev-only endpoints that check everything before writing anything
- [0129 The review workbench shows surfaces at the size a real browser lays them out](0129-review-workbench-real-size.md): full-window board frame, phones at real CSS-pixel viewports
- [0130 Review capture and fit checks measure the real frame, one page at a time](0130-review-capture-and-fit-checks.md): re-found targets, attribute readiness, one page per scenario
- [0131 Minigame review fixtures drive the real rules and refuse loudly](0131-minigame-review-fixtures.md): Ink and Sketch fixtures play through the real definitions and throw on refusal
