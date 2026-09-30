# CodeNotchBar

GNOME Shell extension that shows AI coding agent usage limits (session and weekly quotas) at a glance, as a notch at the top of the screen.

## Features

- Live usage limits for **Claude**, **GitHub Copilot**, **Codex** and **Cursor**. Agents that are not installed are hidden.
- Several display styles: notch, circular progress, sidebar, detail popout and floating widget.
- Ring colour by usage (green / amber / red), configurable thresholds.
- Text colours adapt to the chosen background (WCAG AA contrast).
- Read-only: credentials written by each agent's own tooling are only read, never refreshed or modified.
- Rate-limit aware polling with exponential backoff.

## Requirements

- GNOME Shell 50
- `glib-compile-schemas` (package `libglib2.0-bin` / `glib2`)

## Install

```sh
git clone git@github.com:Dazix/GnomeCodeNotchBar.git \
  ~/.local/share/gnome-shell/extensions/dazix.development@gmail.com
cd ~/.local/share/gnome-shell/extensions/dazix.development@gmail.com
glib-compile-schemas schemas/
gnome-extensions enable dazix.development@gmail.com
```

On Wayland, log out and back in so the shell picks up a new extension. Settings: `gnome-extensions prefs dazix.development@gmail.com`.

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

## Contributing / CI

`main` is protected: changes go through a pull request and the GitHub Actions `test` job (GSettings schema validation and unit tests) must pass before merge.

## License

TBD
