# BB plugins

Independent plugins for BB 0.46 and Plugin SDK 0.6.37 or later.

| Plugin | Owns |
| --- | --- |
| Threadflow | Attention groups, nested thread dependencies, waits, history, and focus controls |
| Journal | Daily Markdown notes, appearance, and a persistent chat per day; its own rail page |
| Chat tools | TLDR summaries, review side chats, handoffs, prompt suggestions, and chat decoration |
| Usage insights | Codex and Claude Code quotas, separate daily history, and optional Codex reset forecasts |
| Thread Nudger | Existing idle-thread check-ins |
| Dev Server | A thread-header button that runs a checkout's `./dev.sh` and opens its worktree URL (BB 0.48+) |

Each directory is an independent package with its own backend, frontend, storage, tests, and build. Journal, Chat tools, and Usage insights work with Threadflow disabled. Threadflow reads BB's live sidebar cache; only its wait dependencies and scheduled-send metadata come from its backend.

Personal BB appearance settings are tracked in [themes](themes/README.md), including instant sidebar toggles and hidden navigation rail.

Build and install a package:

```sh
cd bb-plugin-journal
npm ci
npm run check
npm test
bb plugin build .
bb plugin install .
```

The collection in `.bb/plugins.json` also supports installing a named package from this repository with `--plugin journal` (or another entry name).

## Migrating from the combined Threadflow plugin

Build and reload Threadflow first, then install the other packages. Each extracted package provides `migrate_from_threadflow`, which copies only its own old storage keys. Use an empty JSON input file:

```sh
printf '{}' > /tmp/bb-plugin-migration-input.json
bb plugin rpc call journal migrate_from_threadflow --input-file /tmp/bb-plugin-migration-input.json
bb plugin rpc call chat-tools migrate_from_threadflow --input-file /tmp/bb-plugin-migration-input.json
bb plugin rpc call usage-insights migrate_from_threadflow --input-file /tmp/bb-plugin-migration-input.json
```

Imports are repeatable, preserve destination edits, and retain the original Threadflow data. Once imported, the packages use their own storage and no longer need Threadflow running. Journal retains the existing daily chat IDs; Chat tools continues to recognize older Threadflow-attributed review chats. Threadflow keeps its own durable waits, GitHub credential, alert setting, and focus scratchpad.

Usage insights' manual reset forecast calls `codex-reset.com`. BB's bundled Provider usage plugin remains available separately for standard quota/account displays.
