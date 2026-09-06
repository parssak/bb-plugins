# Thread Nudger

Checks visible active BB threads every 30 seconds and sends at most three
check-ins during one uninterrupted active run:

- after 7 minutes: `how's it going`
- after another 15 minutes: `status update? don't stop if you're not done`
- after another 30 minutes: `you've been going for a while, everything ok?`

Check-ins are agent-only input, so they steer the active run without appearing
as user-authored messages in completed chat history.

Milestone state persists across plugin reloads and is discarded when a thread
is no longer active. A nudge never rearms the schedule, and an overdue sweep
skips directly to the latest due milestone instead of sending a catch-up burst.

While a thread is running, its composer shows a bell toggle for opting that
thread out. Turning nudging back on restarts the milestone clock from that
moment.
