# CodeNotchBar

GNOME Shell extension that shows AI coding agent usage limits (session and weekly quotas) at a glance, as a notch at the top of the screen.

## Features

- Live usage limits for **Claude**, **GitHub Copilot**, **Codex**, **Cursor** and **Antigravity** (read from `agy --print /usage`, so `agy` must be signed in). Agents that are not installed are hidden.
- Several display styles: notch, circular progress, sidebar, detail popout and floating widget.
- Ring colour by usage (green / amber / red), configurable thresholds.
- Text colours adapt to the chosen background (WCAG AA contrast).
- Read-only: credentials written by each agent's own tooling are only read, never refreshed or modified.
- Rate-limit aware polling with exponential backoff.
- Claude limits update instantly when the Claude Code mod writes a new reading (file monitor); polling stays as the fallback.

## Requirements

- GNOME Shell 50
- `glib-compile-schemas` (package `libglib2.0-bin` / `glib2`)
- Optional, per agent: `gh` (GitHub Copilot, only when no token is in the environment or in gh's config), `sqlite3` (Cursor), `agy` (Antigravity)

## Install

```sh
git clone git@github.com:Dazix/GnomeCodeNotchBar.git \
  ~/.local/share/gnome-shell/extensions/codenotchbar@dazix.github.io
cd ~/.local/share/gnome-shell/extensions/codenotchbar@dazix.github.io
glib-compile-schemas schemas/
gnome-extensions enable codenotchbar@dazix.github.io
```

On Wayland, log out and back in so the shell picks up a new extension. Settings: `gnome-extensions prefs codenotchbar@dazix.github.io`.

## Privacy: what it reads, runs and sends

The extension exists to show the usage limits of the agents you already use, so it has to read their sign-in tokens.
Everything it does with them:

| Agent | Reads | Sends the token to |
| --- | --- | --- |
| Claude | `$CLAUDE_CONFIG_DIR` or `~/.claude/.credentials.json`; the reading file of the Claude Code mod `~/.cache/code-notch-bar/claude-rate-limits.json` | `api.anthropic.com` |
| GitHub Copilot | `GH_TOKEN` / `GITHUB_TOKEN`, `~/.config/gh/hosts.yml`, else runs `gh auth token` | `api.github.com` |
| Codex | `$CODEX_HOME` or `~/.codex/auth.json` | `chatgpt.com` |
| Cursor | `~/.cursor/cli-config.json`, else its state database `~/.config/Cursor/User/globalStorage/state.vscdb` (read-only, through `sqlite3`) | `cursor.com` |
| Antigravity | nothing: runs `agy --print /usage` in a sandbox, in an empty directory of its own under `~/.cache` | (the `agy` CLI talks to Google itself) |

- A token goes only to the host in its row, over HTTPS, with a plain GET request for the usage numbers. It is never
  stored, logged or sent anywhere else, and there is no telemetry.
- Tokens are only read, never refreshed or changed. An expired token shows "use the agent to refresh".
- The endpoints are the ones each agent's own app uses for its usage display; they are not public APIs and may change.
- Turn an agent off in the settings and it is no longer polled (no requests). Agents that are not installed are not shown.
- Programs are started only for the reasons in the table, always asynchronously and with a timeout.
- Files written by the extension: nothing but two directories under `~/.cache`: `code-notch-bar/` (created so the file
  the Claude Code mod writes can be watched) and `codenotchbar/agy-work/` (the empty working directory for `agy`).
  Nothing is created at import time; everything made in `enable()` is removed in `disable()`.

## Development

Run the extension in a nested shell:

```sh
dbus-run-session gnome-shell --nested --wayland
```

Run the unit tests (no dependencies besides `gjs`):

```sh
gjs -m tests/run.js
```

Tests live in `tests/*.test.js` and are picked up automatically. They cover the pure-logic modules (`lib/`, `model/`, `providers/provider.js`); UI code needs a running shell and is checked manually.

Pack the extension for extensions.gnome.org (only what it needs at run time: no tests or CI files):

```sh
gnome-extensions pack --force \
  --extra-source=lib --extra-source=model --extra-source=providers --extra-source=ui \
  --extra-source=icons --extra-source=LICENSE
```

## Contributing / CI

`main` is protected: changes go through a pull request and the GitHub Actions `test` job (GSettings schema validation and unit tests) must pass before merge.

## Icons

`claude`, `copilot` (GitHub Copilot), `codex` (OpenAI), `cursor` are from
[Simple Icons](https://simpleicons.org) (CC0 files), with `fill="#ffffff"` added
for the dark notch. The logos themselves are trademarks of Anthropic, GitHub,
OpenAI and Anysphere respectively; they are used only to identify each agent.
`antigravity.svg` is Google's Antigravity mark, taken from the favicon of
[antigravity.google](https://antigravity.google) (full colour, background circle
removed). The logo is a trademark of Google; it is used only to identify the agent.
`generic.svg` is the fallback for unknown providers.

## License

The code is under the [MIT License](LICENSE).
