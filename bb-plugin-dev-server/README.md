# Dev Server

Adds a dev-server button to the thread header for any thread whose checkout has
a `./dev.sh` launcher, built around usebogi.com's concurrent worktrees.

The button is one BB split button beside the workspace's Open button:

- **Run dev** starts `./dev.sh` in a terminal scoped to the thread and reveals
  its logs in the side panel.
- **Starting dev…** shows a spinner until the launcher prints its
  `Bogi is ready` banner or the site port starts listening. Clicking it shows
  the logs.
- **Open app** (green dot) opens the worktree's URL using your BB browser
  preference, such as BB's in-app browser.

Its menu adds Show logs, Copy URL, Restart dev, and Stop dev.

## How it works

- The URL comes from `.dev/environment.json`, which `./dev.sh` saves for each
  worktree (`http://bogi-<id>.localhost:<port>`, or the Portless URL). A
  launcher without that file still works when it prints `Open:`,
  `Development URL:`, or `Local:` with a URL.
- Status is per checkout. Every thread on the same worktree sees the same
  server, but only the thread that started it can reveal its terminal.
- Stop sends Ctrl-C so the launcher runs its own scoped cleanup. After 20
  seconds it closes the terminal. Closing the terminal tab also stops the
  server.
- A server started outside BB (by an agent or another terminal) is detected
  from its saved environment and listening port. Open works, logs come from
  `.dev/dev.log`, and Stop runs the checkout's `./kill-dev.sh`.
- Status is polled only for threads whose header is on screen, and changes are
  pushed to the header. Port checks run only for checkouts on the BB server's
  own machine.

## Settings

- **Extra ./dev.sh arguments**: appended to every run, for example
  `--portless`. Only plain flags are accepted.
- **Show logs when starting**: reveal the terminal after Run dev (default on).

## Development

```sh
npm ci
npm run check
npm test
bb plugin build .
bb plugin install .
```
