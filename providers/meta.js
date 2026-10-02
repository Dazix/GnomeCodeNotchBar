/**
 * Static provider list for the preferences window, which must not import the
 * network / provider code. Keep in sync with providers/registry.js.
 */
export const PROVIDER_META = [
    {id: 'claude', displayName: 'Claude Code', iconFile: 'claude.svg'},
    {id: 'codex', displayName: 'Codex', iconFile: 'codex.svg'},
    {id: 'copilot', displayName: 'GitHub Copilot', iconFile: 'copilot.svg'},
    {id: 'cursor', displayName: 'Cursor', iconFile: 'cursor.svg'},
    {id: 'antigravity', displayName: 'Antigravity', iconFile: 'antigravity.svg'},
];
