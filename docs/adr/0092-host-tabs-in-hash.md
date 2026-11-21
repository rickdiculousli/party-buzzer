# Host tabs live in the URL hash, written with `replaceState`

The host desk is three bounded pages (Play, Games, Players) rather than one scroll. The current tab is kept in `location.hash` so a reload returns to it, and switching writes it with `history.replaceState` rather than a hash assignment, so tab switches are not steps the back button walks through.

Where: `client/Host.tsx` (`TABS`, `tabFromHash`, `Host`)
