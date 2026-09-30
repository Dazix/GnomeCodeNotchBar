import {ClaudeProvider} from './claude.js';
import {CodexProvider} from './codex.js';
import {CopilotProvider} from './copilot.js';
import {CursorProvider} from './cursor.js';

/** All known providers, in display order. */
export function createProviders() {
    return [
        new ClaudeProvider(),
        new CodexProvider(),
        new CopilotProvider(),
        new CursorProvider(),
    ];
}

/**
 * Keep only the providers whose agent is present on this machine.
 *
 * @param {import('./provider.js').Provider[]} providers
 */
export async function detectAvailable(providers) {
    const flags = await Promise.all(providers.map(p => p.isAvailable().catch(() => false)));
    return providers.filter((_p, i) => flags[i]);
}
