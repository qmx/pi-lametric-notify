# pi-lametric-notify

A pi package that sends a LaMetric Time notification when pi finishes a task and is waiting for input.

## What it shows

- success: icon `a8813` + `done`
- error: icon `a423` + `error`
- next frame: hostname
- next frame: current tmux pane via `#S:#I.#P`, if available

## Config

Set these environment variables before starting pi:

```bash
export LAMETRIC_TIME_HOST=192.168.1.100
export LAMETRIC_TIME_API_KEY=your-api-key
```

`LAMETRIC_TIME_HOST` can be either:
- a host or IP like `192.168.1.100`
- a full base URL like `http://192.168.1.100:8080`

If either variable is missing, the extension does nothing.
If LaMetric is unreachable or the request fails, the extension stays silent and does not crash pi.

## Install

From this repo:

```bash
pi install .
```

Once published:

```bash
pi install npm:@qmxme/pi-lametric-notify
```

Or load it directly for a single run:

```bash
pi -e .
```

## Notes

- notifications are sent to the local LaMetric notifications API
- the message repeats for 3 cycles
- tmux info is only shown when pi is running inside tmux
- the extension sends notifications on `agent_end`
