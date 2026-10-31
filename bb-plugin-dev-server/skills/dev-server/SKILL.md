---
name: dev-server
description: Start a checkout's ./dev.sh dev server with `bb dev-server`, get its worktree URL, and test the running app in BB's browser. Use whenever you need to run, open, or verify a web change in a repo that has ./dev.sh, such as usebogi.com.
---

Run the checkout's dev server through `bb dev-server`, not by calling `./dev.sh`
yourself. It runs in a BB terminal the user can see, the thread header shows its
state, and every thread on the same checkout shares the one server.

## Start it and get the URL

```sh
bb dev-server start --wait          # prints `url: …` once every service is ready
bb dev-server url                   # just the URL, or exit 1 if it is not ready
bb dev-server status                # state, URL, and where the logs are
```

`start` does nothing when the server is already running, so it is always safe
to call before testing. A worktree's first run copies the local database and
installs dependencies; give it `--timeout 10m`. If it fails, read the `logs:`
line it prints (`bb terminal output <id> --tail-bytes 20000` or `.dev/dev.log`),
fix the cause, and start again.

Leave the server running when you finish. Run `bb dev-server stop` only when
the user asks.

## Test it in BB's browser

Use the browser-automation skill with a **desktop** session. Desktop tabs use
the BB browser's signed-in cookies, while headless Chrome starts signed out. A
desktop tab works while it is hidden, so the user does not need to have it open.

```sh
host=$(bb status --json | node -pe 'JSON.parse(require("fs").readFileSync(0)).thread.environment.hostId')
bb browser instances --host "$host" --json
bb browser-automation open --backend desktop --machine "$host" --desktop <instance-id> --json
bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.goto("<url>"); await p.snapshot()' --json
bb browser-automation screenshot <session-id> --page main --json
```

- Use the exact URL `bb dev-server` prints, such as
  `http://bogi-<id>.localhost:<port>`. Never swap in `localhost` or another
  worktree's port: logins and data are separate per worktree.
- Desktop control lasts at most 30 minutes. Open a new session after it expires,
  and close sessions when you are done.
- If the app shows its login page, ask the user to sign in once in that BB
  browser tab, then continue.
- Prefer browser automation over computer use (`cua-*` tools) for web apps:
  computer use can only operate windows on screen, not a hidden BB tab.

## Safety

- Never run `./kill-all-dev.sh`: it stops every worktree's server.
- In usebogi.com, a checkout without `scripts/dev-environment.py` is on a branch
  older than concurrent worktrees. Its `./dev.sh` stops the other worktrees'
  servers. Ask the user before starting it there.
