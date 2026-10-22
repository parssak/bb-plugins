# Threadflow

A compact thread list for BB: Needs you, Snoozed, In review, and Working; nested child threads and wait dependencies; PR badges; archive history; drag to split; and keyboard focus controls.

Review and side-chat threads that BB hides from its own list nest under the thread that owns them, and a thread stays in Working while any nested thread or background agent is still running.

Threadflow reads BB's live thread cache and host navigation APIs. It owns durable waits, the completion alert, and the focus scratchpad. Its backend returns wait, scheduled-send, and hidden child-thread metadata for the list, because BB's sidebar cache omits hidden threads. Archived threads use BB's paginated archive cache.

Journal, Chat tools, and Usage insights are independent sibling packages. Journal has its own rail entry. Review and TLDR shortcuts invoke Chat tools through BB's public RPC API; the thread list and waits work without it.

Hover or focus a thread row to reveal its archive button.

Shortcuts: Command-number opens visible threads; Command-Shift-A toggles archive for the focused row or active chat, including split panes; Command-Shift-E opens a review through Chat tools; Command-Shift-T toggles TLDR through Chat tools. BB owns the rail, compose navigation, panels, and terminal handling.

```sh
npm ci
npm run check
npm test
bb plugin build .
bb plugin reload threadflow
```

See the repository README for data migration from the combined plugin.
