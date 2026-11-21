# Host edits of a compound setting send the whole value

- Every setlist add, move, remove and edit is computed on the client and sent as one `setSetlist` with the whole block array, as `setAutoplay` sends every field: one edit is one undo step, with no partial merge on the server.
- All setlist edit controls grey from a single `refuses(state, { a: 'setSetlist', blocks: [] })`: that action's legality does not read the blocks, so an empty array stands in for any edit. A local idle check would only agree with the server by coincidence. Loading a saved setlist rides the `act` channel but performs the same mutation, so it greys on the same refusal; `selectPack` has no host action with its effect and stays local.
- The refusal reason is one sentence under the panel, not `title` tooltips, because a disabled control never fires the pointer events a tooltip needs.
- Pack shortfall is counted across every block sharing a pack, since they share its questions.

Where: `client/SetlistPanel.tsx` (`SetlistPanel`), `shared/protocol.ts` (`HostAction`), `server/state.ts` (`setSetlist`, `setAutoplay`)
