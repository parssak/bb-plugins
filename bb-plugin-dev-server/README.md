# Dev Server

Adds a dev-server button to the thread header for any thread whose checkout has
a `./dev.sh` launcher, built around usebogi.com's concurrent worktrees.

The button is one BB split button beside the workspace's Open button:

- **Run dev** starts `./dev.sh` in a terminal scoped to the thread and reveals
  its logs in the side panel.
- **Starting dev…** shows a spinner until the launcher prints its
  `Bogi is ready` banner or the site port starts listening. Clicking it shows
  the logs.
- **Open app** (green dot) shows the worktree in BB's browser in the thread's
  side panel. A run started from the button opens there by itself as soon as
  it is ready.

Its menu adds Show logs, Copy URL, Restart dev, and Stop dev.

## How it works

- The URL comes from `.dev/environment.json`, which `./dev.sh` saves for each
  worktree (`http://bogi-<id>.localhost:<port>`, or the Portless URL). A
  launcher without that file still works when it prints `Open:`,
  `Development URL:`, or `Local:` with a URL.
- The browser tab belongs to the thread. Open app reuses a tab already on the
  worktree's address. After a restart, the auto-open replaces that tab at the
  same page so it is not left on an error page. Without a BB desktop window,
  Open app falls back to your BB link preference.
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

## For agents

`bb dev-server` runs the same server as the header button, for the calling
thread (or `--thread <id>`):

```sh
bb dev-server start --wait   # start unless running, print the URL once ready
bb dev-server url            # the URL, or exit 1 if it is not ready
bb dev-server status         # state, URL, and where the logs are
bb dev-server stop
```

The bundled `dev-server` skill tells agents to start the server this way and
then test it with BB's Browser Automation plugin in a desktop session, which
uses the BB browser's signed-in cookies and works while the tab is hidden.

## Settings

- **Extra ./dev.sh arguments**: appended to every run, for example
  `--portless`. Only plain flags are accepted.
- **Show logs when starting**: reveal the terminal after Run dev (default on).
- **Open the app when ready**: show the worktree in BB's side browser once a
  run started from the button is ready (default on).

## Development

```sh
npm ci
npm run check
npm test
bb plugin build .
bb plugin install .
```
