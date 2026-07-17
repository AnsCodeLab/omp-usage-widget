# omp-usage-widget

An [Oh My Pi](https://omp.sh) extension that keeps your **Claude plan usage (5h / 7d windows)** visible in narrow terminals.

## The problem

omp's status line is a single row (the input editor's top border). On overflow it drops segments — and the built-in `usage` segment is among the first to go. In a narrow split (tmux pane, herdr pane, half-screen terminal) your Claude quota display silently disappears.

## What this does

When the terminal is narrower than a threshold (default **140 columns**) and the active model's provider is **Anthropic**, the extension renders the usage windows on a dedicated line below the editor:

```
 5h 74% (↻ Fri 14:10) · 7d 7% (↻ Mon 01:00)
```

- Same data source as the built-in `usage` status-line segment (auth-broker usage reports), cached 5 minutes.
- Same color thresholds: green < 50% ≤ yellow < 80% ≤ red.
- Auto-hides when the terminal is wide (the status-line segment fits again), when a non-Anthropic model is active, or when no usage report is available.
- Reset times are absolute local times — "↻ Fri 14:10" means the window resets Friday at 14:10.
- Re-renders on terminal resize, turn end, and every 30 seconds.

## Install

```bash
git clone https://github.com/AnsCodeLab/omp-usage-widget
ln -s "$(pwd)/omp-usage-widget/usage-widget.ts" ~/.omp/agent/extensions/usage-widget.ts
```

Or just copy `usage-widget.ts` into `~/.omp/agent/extensions/`.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `OMP_USAGE_WIDGET_COLS` | `140` | Below this many columns the widget shows; at/above it hides. |

## Pairing with the built-in segment

For wide terminals, enable the built-in `usage` segment so the info lives in the status line itself (`~/.omp/agent/config.yml`):

```yaml
statusLine:
  preset: custom
  leftSegments: [pi, model, mode, collab, path, git, pr, context_pct, cost, usage]
  rightSegments: [session_name]
```

Keeping `usage` at the end of `leftSegments` (rather than in `rightSegments`) makes it survive longer as width shrinks — right-side segments are dropped first. This widget covers the remaining gap when even the left side overflows.

## License

MIT
