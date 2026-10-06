# Game-night engagement roadmap

Status: proposed roadmap for review; no implementation authorized by this document.

## Intent and scope

Make a trusted-LAN game night easier to host, easier to enter, and more memorable
for everyone in the room. Preserve the television-studio and timing-instrument
identity, the board as the shared focus, and phones as controllers.

The user selected a roadmap covering the seven engagement ideas, with a detailed
spec and implementation plan for the first slice. Bow and Tank battle visual
polish is explicitly excluded. Describing those games in an introduction does
not authorize changing their controls, physics, artwork, effects, or scoring.

## Projects and dependencies

| Project | Concrete outcome | Depends on | Planning boundary |
| --- | --- | --- | --- |
| 1. Arrival | Host opens a playable lobby; phones test their buzzers; a fresh setlist introduces its first block | Existing sockets, role projections, wall moments | Detailed spec and plan linked below |
| 2. Starter setlists | A few explained, usable night recipes with sensible defaults and available packs | Existing setlist loader/builder | Separate bounded design; validate pack supply and score balance, not just appealing names |
| 3. Practice by game | Players learn Bow, Tank battle, and Phantom Ink through one safe action before scored play | Arrival conventions; each game's runtime and role frames | Separate spec per game; mechanics and scoring isolation are essential; visual polish stays excluded |
| 4. Introductions between blocks | Brief instructions connect quiz, host-read, and minigame blocks without breaking autoplay | First introduction; explicit reader/minigame handoff design | Separate architectural spec; later visits need stable identities, including jumps back to the same block |
| 5. Duel predictions | Spectators privately back a seated player before arming; room sees the aggregate after resolution | Existing duel seating, public verdict facts | Separate spec; no points initially; preserve secrecy, rebound scope, ties, and cancellation |
| 6. Meaningful milestones | Sparse, factual recognition of a first correct answer or a change at the top of the standings | Applied scoring actions and deliberately defined session facts | Separate spec; define attribution, teams, manual score edits, undo, and restart before showing claims |
| 7. Night recap | Existing finale gains a small factual recap and a locally saved image | Session-fact ownership from project 6; minigame result semantics | Separate spec; retain names/identities appropriately, support ties, and avoid invented or embarrassing awards |

Project numbers identify scopes, not a mandatory single queue. Starter setlist
content and duel-prediction design can be investigated independently of Arrival.
Milestones and recap share facts and should settle that contract together before
their UI work splits. Full block transitions must settle reader handoffs before
practice or presentation work assumes autoplay crosses a minigame.

## Central coordinator and fanout

This is a development workflow, not a runtime feature or a new agent framework.
Do not add an event bus, task scheduler, plugin system, or an orchestration
dependency to the app.

For each project, the central coordinator:

1. Reads the approved spec, verifies the current call sites, and settles shared
   types, identities, action legality, redaction, snapshots, and ownership.
2. Implements and reviews the common foundation before workers consume it.
3. Dispatches only ready tasks with disjoint file ownership. Each brief contains
   the spec, exact interfaces, owned files, acceptance checks, and exclusions.
4. Integrates surface mount points and other shared files centrally; workers
   report a required contract change instead of silently editing those files.
5. Reviews each deliverable, resolves findings, and validates the assembled
   behavior. A final reviewer checks the whole change across boundaries.

Route work by its actual content:

| Content | Suitable worker scope | Central responsibility |
| --- | --- | --- |
| Rules, lifecycle, asynchronous work | One owning module plus its pure/fake-driven tests | Cross-module contracts and cancellation, serialized where files overlap |
| Board/phone/host presentation | One leaf component and its own scoped stylesheet | Shared moment selection, socket ownership, mount points, shared styles |
| Authored instructions or setlist recipes | Fixed content format plus its validation | Vocabulary, available assets/packs, runtime assumptions |
| Session facts or exports | Pure derivation after the source-of-truth contract exists | Attribution, undo/durable semantics, role projection |
| Review and integration | Fresh reviewer with the relevant diff and spec | No self-approved implementation; apply fixes before dependent work |

Use the existing four-agent concurrency limit: coordinator plus at most three
workers/reviewers. A dependency or shared file is a reason to serialize. Model
choice follows Superpowers' role guidance; do not hard-code a model into a
project API. Record completed tasks and rulings in the plan-specific SDD ledger
so a resumed session does not repeat work.

## First implementation slice

- Spec: [Arrival design](2026-10-05-arrival-design.md).
- Plan: [Arrival implementation plan](../plans/2026-10-05-arrival.md).
- Finish this slice before expanding its common contract for later features.

Success is observable at a real game night: first-time players can identify
their phone on the board, practice a press, understand the first game's goal,
and begin with fewer host explanations. Observe those behaviors with a small
group; no analytics service is required.
