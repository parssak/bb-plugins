Run a worktree's `./dev.sh` from the thread header and open its URL in one
click.

## What you get

- A **Run dev** button in the thread header of any checkout with `./dev.sh`.
- Live status: **Starting dev…** while services boot, then **Open app** with a
  green dot once the worktree is ready.
- The app opens in BB's browser beside the chat as soon as it is ready.
- The launcher's logs in BB's terminal panel, plus Copy URL, Restart, and Stop
  in the button's menu.

## How it works

Each run is a BB terminal scoped to the thread that started it. The worktree's
URL comes from the `.dev/environment.json` that usebogi.com's launcher saves,
so concurrent worktrees each open their own isolated hostname and port.
Nothing leaves your machine.
