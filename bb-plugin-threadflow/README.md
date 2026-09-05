# Threadflow

A compact replacement for BB's native thread list. It groups source threads into
Needs you, Waiting, In review, and Working; nests hidden side chats under their source;
shows pull requests, CI, and worktree diffs; and supports dialog-based rename,
safe archive, drag-to-split, numbered shortcuts, and arrow-key navigation.
Waiting follows BB's queued-work state, so scheduled sends and plugin-held waits
share one section regardless of what condition will release them.
Leading `[bb]` and `[bogi]` title tags render as their matching brand marks.
The usage footer tracks local-time samples and highlights the portion of the
weekly Codex allowance consumed since the user's midnight when history exists.

Native BB chats gain stable thread accents and side-chat panels,
one-click side-chat handoffs, auto-merge controls, and Luna-generated summaries
for unread replies of at least 400 characters. Handoffs ask the side chat for a
terse fenced summary and relay only that summary to its source thread. Summaries
keep the native composer usable and offer up to three terse follow-up actions.
Native steer labels and action buttons below user messages are hidden.
User bubbles use compact borderless padding and the Bogi tail only on the last
message in each consecutive user-message run.
Thread Nudger check-ins stay in the agent's working context but are omitted from
completed chat history, prompt suggestions, and the user message shown in TLDR.
When running work settles to zero and an unread thread still needs attention,
Threadflow plays one configurable macOS completion alert instead of repeating it
for every finished thread.
When a new pull request appears, its review side chat starts automatically in the
background.

Keyboard commands:

- Command-1 through Command-9 open numbered visible threads.
- Command-E is left to BB's native terminal handling.
- Command-Shift-E opens a review side chat.
- Command-Shift-L asks what Linus Torvalds would think.
- Command-Shift-T toggles an existing TLDR or generates one when none exists.
- Command-Shift-M merges an eligible pull request.
- Command-Shift-A archives or unarchives the current thread.
- Escape closes an open TLDR before returning to the thread list; arrow keys navigate the list, and typing returns to the chat composer.

Archiving a managed-worktree source archives its environment's threads so BB can
clean up the worktree, and is refused while the source or a child chat is running.

```sh
bb plugin build
bb plugin install .
```
