# Verdict quips: one take per line, sparse, never repeated back to back

Every verdict (`correct`, `wrong`, `nobody`) gets a line. About half get a quip from that verdict's pool; a quip never repeats the line just said, and sincere quips are weighted down so a straight reaction still lands as one. The rest get a plain line ("Correct.", "No.") in rotation, so none comes round again until the others have. Each line is its own take, played whole: a laugh or groan before the first word is part of the line, and editing one line re-renders only that line.

The hand-authored pools file (`packs/quips/pools.txt`): `# correct`, `# wrong` and `# nobody` open a quip pool; `# plain correct` (and so on) opens that verdict's plain lines; a leading `★` or `*` marks a sincere quip. Any other `#` line is a comment and also ends the pool above it. Example:

    # correct
    [sarcastic] Wow. You read a book once.
    ★ [impressed] Well, shit. That was actually good.
    # plain correct
    Correct.

Where: `server/quips.ts` (`parsePools`, `Picker`)
