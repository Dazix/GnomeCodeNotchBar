# Contributing

Thanks for helping. Bug reports, fixes and support for new agents are all welcome.

## Before you start

- For a bug, open an issue with the bug report template. For a security problem, follow [SECURITY.md](SECURITY.md)
  instead and do not open a public issue.
- For a new agent or a larger change, open an issue first so we can agree on the approach before you write code.

## Development

See [Development](README.md#development) in the README: run the extension in a nested shell and run the unit tests
with `gjs -m tests/run.js` (no dependencies besides `gjs`).

## Pull requests

- `main` is protected. Every change goes through a pull request, and the CI `test` job (GSettings schema validation
  and unit tests) must pass.
- New logic in `lib/`, `model/` or `providers/provider.js` comes with a test in `tests/*.test.js`.
- Keep the [Privacy](README.md#privacy-what-it-reads-runs-and-sends) section true. A change that reads a new file,
  starts a new program or talks to a new host updates that section in the same pull request.
- Follow the GNOME Shell extension review guidelines: create everything in `enable()`, remove it in `disable()`,
  nothing at import time, no synchronous I/O or subprocesses on the shell's main loop.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:` …).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
