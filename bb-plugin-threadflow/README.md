# Threadflow

A compact thread list for BB: Needs you, Snoozed, In review, and Working; nested child threads and wait dependencies; PR badges; archive history; drag to split; and keyboard focus controls.

Threadflow reads BB's live thread cache and host navigation APIs. It owns durable waits, the completion alert, and the focus scratchpad. Its backend returns only wait and scheduled-send metadata for the list. Archived threads use BB's paginated archive cache.

Journal, Chat tools, and Usage insights are independent sibling packages. Journal has its own rail entry. Review and TLDR shortcuts invoke Chat tools through BB's public RPC API; the thread list and waits work without it.

Shortcuts: Command-number opens visible threads; Command-Shift-A toggles archive; Command-Shift-E opens a review through Chat tools; Command-Shift-T toggles TLDR through Chat tools. BB owns the rail, compose navigation, panels, and terminal handling.

```sh
npm ci
npm run check
npm test
bb plugin build .
bb plugin reload threadflow
```

See the repository README for data migration from the combined plugin.
