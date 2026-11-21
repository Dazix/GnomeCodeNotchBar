# Security policy

CodeNotchBar reads the sign-in tokens of your AI coding agents and sends each one to its own agent's usage
endpoint (see [Privacy](README.md#privacy-what-it-reads-runs-and-sends)). A bug that could leak a token, send it to
another host, log it, or let another program on the machine get at it is a security issue.

## Supported versions

Only the latest commit on `main` and the latest release on extensions.gnome.org are supported. Fixes are not
backported.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/Dazix/GnomeCodeNotchBar/security/advisories/new).

Include what you can of:

- the GNOME Shell version and the extension version or commit,
- which agent (Claude, GitHub Copilot, Codex, Cursor, Antigravity) is involved,
- the steps to reproduce and what an attacker gains.

Never paste a real token into the report; redact it.

This is a project maintained in spare time. You can expect a first reply within a week. Once a fix is released,
the advisory is published and you are credited unless you ask not to be.

## In scope

- A token sent to any host other than the one listed for its agent, sent over plain HTTP, or written to disk or the
  journal.
- Programs started by the extension (`gh`, `sqlite3`, `agy`) with arguments or a working directory an attacker can
  influence.
- Files or directories created by the extension with permissions that let another user read them.

## Out of scope

- The agents' own credential files and how the agents store them.
- Changes to the vendors' unofficial usage endpoints that break the display (open a normal issue).
- Attacks that already require running code as your user.
