# Chat tools

Chat tools adds TLDR summaries, automatic and manual review side chats, handoffs to source threads, prompt suggestions, timestamps, and compact chat styling. It owns its own state and supports existing Threadflow-attributed chats after migration. Summaries and automatic reviews can run additional agent turns using the configured BB provider. Cosmetic DOM enhancements are isolated from the other plugins.

```sh
npm ci
npm run check
npm test
bb plugin build .
bb plugin install .
```

See the repository README for the one-time storage import.
