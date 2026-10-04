# omp-usage-widget

An [Oh My Pi](https://omp.sh) extension that keeps your **provider plan usage** visible in narrow terminals.

## The problem

omp's status line is a single row (the input editor's top border). On overflow it drops segments — and the built-in `usage` segment is among the first to go. In a narrow split (tmux pane, herdr pane, half-screen terminal) your quota display silently disappears.

## What this does

The extension renders the active model's provider usage windows on a dedicated line below the editor. Which provider is shown follows the active model — switch models and the widget follows, matching whichever usage report's `provider` equals the active model's `provider`:

```
 5h 74% (↻ Fri 14:10) · 7d 7% (↻ Mon 01:00)
```

Supported providers and their windows (whatever the account's usage report exposes):

- **Anthropic** (Claude) — `5h` / `7d`.
- **OpenAI Codex** — `5h` / `7d` (primary/secondary rate-limit windows).
- **Cursor** — `mo` (monthly).
- **Google Antigravity** — `wk` (weekly); when the report splits the weekly quota by model family (Gemini vs. Claude/GPT), the bucket matching the active model wins.

- Same data source as the built-in `usage` status-line segment (auth-broker usage reports), cached 5 minutes.
- Same color thresholds: green < 50% ≤ yellow < 80% ≤ red.
- Auto-hides when the active model's provider has no usage report, or no window with a numeric percentage.
- Reset times are absolute local times — "↻ Fri 14:10" means the window resets Friday at 14:10.
- Re-renders on terminal resize, turn end, and every 30 seconds.

## Install

```bash
omp plugin install github:AnsCodeLab/omp-usage-widget
```

This fetches the package into `~/.omp/plugins/node_modules/omp-usage-widget` (a real copy, not a symlink to a local clone) and registers `usage-widget.ts` via this repo's `package.json` `omp.extensions` manifest. Restart the session for it to take effect.

For local development, clone the repo and link it instead — edits to `usage-widget.ts` take effect on the next session restart, no reinstall needed:

```bash
git clone https://github.com/AnsCodeLab/omp-usage-widget
cd omp-usage-widget
omp plugin link .
```

`omp plugin link` symlinks into `~/.omp/plugins/node_modules/omp-usage-widget`, so it still depends on the clone's path staying put — if you move or remount the clone, re-run `omp plugin link .` from the new location. `omp plugin list` / `omp plugin doctor` show its status.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `OMP_USAGE_WIDGET_COLS` | unset (always show) | If set, narrow-only mode: the widget shows only below this many columns, deferring to the built-in `usage` status-line segment when wide. |

## Pairing with the built-in segment (narrow-only mode)

If you prefer the status line to carry the usage info in wide terminals, set `OMP_USAGE_WIDGET_COLS=140` and enable the built-in `usage` segment (`~/.omp/agent/config.yml`):

```yaml
statusLine:
  preset: custom
  leftSegments: [pi, model, mode, collab, path, git, pr, context_pct, cost, usage]
  rightSegments: [session_name]
```

Keeping `usage` at the end of `leftSegments` (rather than in `rightSegments`) makes it survive longer as width shrinks — right-side segments are dropped first. The widget then covers the remaining gap when even the left side overflows. Note the built-in segment uses omp's own relative countdown format, not this widget's absolute times.

## License

MIT
