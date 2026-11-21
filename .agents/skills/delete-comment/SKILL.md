---
name: delete-comment
description: Audits party-buzzer's remaining code comments, moves each decision into an ADR, files an issue for each excused hack, deletes them all and tightens the comment ratchet. Use when asked to delete comments or run /delete-comment.
disable-model-invocation: true
---

# Delete comments

The repo bans code comments, and `tools/comments.baseline.json` lists the files still allowed some. A plain delete loses the decisions a comment held and hides the hack it excused, so classify every comment before anything is stripped.

Invoking this skill authorises writing ADRs, filing issues labelled `comment-audit` on `rickdiculousli/party-buzzer`, and stripping comments in the files in scope. Committing and pushing follow the repo's usual rules.

## Scope

The files the user names, or else every file in `tools/comments.baseline.json`. `npm run comments -- list <files>` prints each comment as `file:line<TAB>text`; with no files it covers the whole repo (TS, TSX, CSS, HTML, Swift). `npm run comments -- estimate <files>` says how many lines a strip would shed. Pragmas (`/// <reference`, `@ts-expect-error`, ...) and the bare `/* anim:tunables */` and `/* cue:recipes */` markers are kept: the motion harness and `vite.config.ts` find their blocks by them.

## Classify

Read the code around each comment, then give it exactly one category:

- **tautology**: repeats what the code, names or types already say, including banners and labels.
- **stale**: describes code, behaviour or history that no longer holds (check with grep).
- **excuse**: justifies a hack or known limit: a workaround, TODO, `ponytail:`/`shortcut:` note, a guard for a state that should be impossible, a value kept in sync by hand.
- **decision**: a non-obvious why that a competent editor would otherwise "fix" wrongly: an invariant, an external constraint, a rejected alternative.

Torn between decision and tautology? If the comment vanished, would a competent editor plausibly make a wrong change? A long doc comment that paraphrases a signature is still a tautology.

For more than a few hundred comments, split the list into batches and give each to a fresh agent with these categories and the output rules below; each writes drafts outside the repo, and you merge them.

## Where each one goes

- **decision**: if `ARCHTECTURE.md`, `docs/design.md`, `README.md` or an existing `docs/adr/` file already says it, nothing new. Otherwise extend the ADR that covers it, or add `docs/adr/NNNN-slug.md` with the next free number in the format `docs/adr/README.md` gives, and list it there under its area. Present tense, files and symbols named, no line numbers.
- **excuse**: an issue. Check `gh issue list --label comment-audit --state all` first and add to a matching one instead of duplicating it. The body says what the hack is, where (file and symbol), why it is a hack and what the fix looks like. Merge excuses with one root cause into one issue.
- **tool usage** in a header comment under `tools/`: into `tools/README.md`.
- **tautology, stale**: nothing to keep. Note a stale comment's mismatch only if it points at a real bug.

Append one row per comment to `docs/audits/comments/ledger.tsv`: `file:line`, category, a reason of at most 15 words, and where it went (ADR path, doc section or issue number).

## Strip and ratchet

1. Check nothing reads a comment's text: grep for code that writes comments (a generator like `tools/poker-prints.ts`) or reads source files as text (`server/lifetimes.test.ts` reads `shared/protocol.ts`, `client/tunables.test.ts` reads `client/style.css`).
2. `npm run comments -- strip <files>`, then read the diff for what the strip leaves behind: an empty CSS rule, a `catch { }`, a stray blank line.
3. `npm run comments -- baseline` and commit the tighter `tools/comments.baseline.json`. The baseline only shrinks: the test fails when a file has more comments than it allows, and also when it allows more than a file has.
4. `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:review` if a client file changed.

Report the counts per category, the ADRs and issues added, and the lines shed.
