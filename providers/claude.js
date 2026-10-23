import GLib from 'gi://GLib';

import {HttpError} from '../lib/http.js';
import {backoffSeconds} from '../lib/backoff.js';
import {exists, readJson} from '../lib/files.js';
import {ErrorKind, Provider, UsageError} from './provider.js';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const SOURCE = `API ${ENDPOINT}`;

const KIND_LABELS = {
    session: 'Current session',
    weekly_all: 'All models',
    weekly_opus: 'Opus',
    weekly_sonnet: 'Sonnet',
};

function configDir() {
    return GLib.getenv('CLAUDE_CONFIG_DIR') ?? '~/.claude';
}

function credentialsPath() {
    return `${configDir()}/.credentials.json`;
}

function labelForKind(kind) {
    if (KIND_LABELS[kind])
        return KIND_LABELS[kind];
    if (kind === 'weekly_scoped' || kind === 'scoped')
        return 'Scoped';
    return kind.replace(/^weekly_/, '').replaceAll('_', ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function windowRank(id) {
    if (id === 'session')
        return 0;
    if (id === 'weekly_all')
        return 1;
    return 2;
}

function toDate(value) {
    if (!value)
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turn `GET /api/oauth/usage` into limit windows. `limits[]` is the
 * forward-compatible shape; the named `five_hour` / `seven_day` windows are
 * merged in because a window that just rolled over disappears from `limits`
 * while the named one still carries it.
 *
 * @param {object} payload
 * @returns {import('../model/types.js').LimitWindow[]}
 */
export function parseUsage(payload) {
    const windows = [];

    for (const limit of payload?.limits ?? []) {
        // An idle window (0 %, nothing started) has no reset time: keep it.
        const resetsAt = toDate(limit.resets_at);
        if (typeof limit.percent !== 'number')
            continue;
        const model = limit.scope?.model?.display_name?.trim();
        windows.push({
            id: limit.kind,
            label: model || labelForKind(limit.kind),
            usedFraction: limit.percent / 100,
            resetsAt,
        });
    }

    const merge = (window, id) => {
        const resetsAt = toDate(window?.resets_at);
        if (typeof window?.utilization !== 'number' || windows.some(w => w.id === id))
            return;
        windows.push({id, label: labelForKind(id), usedFraction: window.utilization / 100, resetsAt});
    };
    merge(payload?.five_hour, 'session');
    merge(payload?.seven_day, 'weekly_all');

    return windows.sort((a, b) =>
        windowRank(a.id) - windowRank(b.id) || a.id.localeCompare(b.id));
}

const HOOK_FILE = '~/.cache/code-notch-bar/claude-rate-limits.json';
const HOOK_KINDS = {five_hour: 'session', seven_day: 'weekly_all'};
const HOOK_FRESH_MS = 2 * 60 * 1000;
const HOOK_USABLE_MS = 30 * 60 * 1000;

/**
 * Turn the file written by the `notch-bar-usage` Claude Code mod (the rate
 * limits of Claude's own API responses) into limit windows.
 *
 * @param {object} payload
 * @returns {{windows: import('../model/types.js').LimitWindow[], fetchedAt: Date}|null}
 */
export function parseHookFile(payload) {
    const fetchedAt = toDate(payload?.fetchedAt);
    if (!fetchedAt || !Array.isArray(payload.windows))
        return null;
    const windows = [];
    for (const w of payload.windows) {
        const id = HOOK_KINDS[w?.kind];
        if (!id || typeof w.percentUsed !== 'number')
            continue;
        windows.push({id, label: labelForKind(id), usedFraction: w.percentUsed / 100, resetsAt: toDate(w.resetsAt)});
    }
    if (windows.length === 0)
        return null;
    return {
        windows: windows.sort((a, b) => windowRank(a.id) - windowRank(b.id)),
        fetchedAt,
    };
}

/**
 * Combine two readings of the same windows without ever going backwards: the
 * file written by the mod only knows what Claude Code saw, the usage endpoint
 * also counts other sessions, so either one can be the lower. Usage only grows
 * inside a window and a later reset means a later window. Mirrors `isNewer`
 * of the mod.
 *
 * @param {import('../model/types.js').LimitWindow[]} older
 * @param {import('../model/types.js').LimitWindow[]} newer  wins when nothing else decides
 * @param {number} now
 * @returns {import('../model/types.js').LimitWindow[]}
 */
export function mergeWindows(older, newer, now) {
    const merged = newer.map(next => {
        const old = older.find(w => w.id === next.id);
        if (!old)
            return next;
        const oldReset = old.resetsAt?.getTime();
        if (oldReset === undefined || oldReset <= now)
            return next;
        const nextReset = next.resetsAt?.getTime();
        if (nextReset === undefined)
            return old;
        if (nextReset !== oldReset)
            return nextReset > oldReset ? next : old;
        return next.usedFraction >= old.usedFraction ? next : old;
    });
    for (const old of older) {
        if (!merged.some(w => w.id === old.id))
            merged.push(old);
    }
    return merged.sort((a, b) => windowRank(a.id) - windowRank(b.id) || a.id.localeCompare(b.id));
}

function mergeSnapshots(a, b) {
    if (!a || !b)
        return a ?? b;
    const [older, newer] = a.fetchedAt <= b.fetchedAt ? [a, b] : [b, a];
    const windows = mergeWindows(older.windows, newer.windows, Date.now());
    return {
        ...newer,
        windows,
        headlineId: windows.some(w => w.id === 'session') ? 'session' : windows[0].id,
        source: `${newer.source} + ${older.source}`,
    };
}

export class ClaudeProvider extends Provider {
    constructor() {
        super({
            id: 'claude',
            displayName: 'Claude Code',
            iconFile: 'claude.svg',
            signIn: 'Run `claude auth login`',
        });
        this._consecutiveRateLimits = 0;
        this._retryNoEarlierThan = 0;
        /** Last reading from the usage endpoint, to merge with a fresh mod file. */
        this._lastApi = null;
    }

    async isAvailable() {
        return exists(credentialsPath());
    }

    /**
     * A reading from Claude Code itself is free of the usage endpoint's rate
     * limit: skip the endpoint while it is fresh, and use it when the endpoint
     * fails. The two sources disagree, so a reading never replaces a higher
     * one of the same window; otherwise the ring would flip between them.
     */
    async fetchSnapshot(http) {
        const hook = await this._readHookFile();
        const age = hook ? Date.now() - hook.fetchedAt.getTime() : Infinity;
        const usable = hook && age < HOOK_USABLE_MS ? await this._hookSnapshot(hook) : null;
        if (usable && age < HOOK_FRESH_MS)
            return mergeSnapshots(usable, this._lastApi);

        try {
            this._lastApi = await this._fetchFromApi(http);
        } catch (e) {
            if (usable)
                return mergeSnapshots(usable, this._lastApi);
            throw e;
        }
        return mergeSnapshots(this._lastApi, usable);
    }

    watchedFiles() {
        return [HOOK_FILE];
    }

    async _readHookFile() {
        return parseHookFile(await readJson(HOOK_FILE));
    }

    async _hookSnapshot(hook) {
        const oauth = await this._loadCredentials().catch(() => null);
        return {
            id: this.id,
            displayName: this.displayName,
            windows: hook.windows,
            headlineId: hook.windows.some(w => w.id === 'session') ? 'session' : hook.windows[0].id,
            plan: oauth?.subscriptionType ? capitalize(oauth.subscriptionType) : null,
            fetchedAt: hook.fetchedAt,
            source: `Claude Code mod (${HOOK_FILE})`,
        };
    }

    async _fetchFromApi(http) {
        const now = Date.now();
        if (now < this._retryNoEarlierThan) {
            throw new UsageError(ErrorKind.RATE_LIMITED, 'Rate limited',
                (this._retryNoEarlierThan - now) / 1000);
        }

        const oauth = await this._loadCredentials();
        let payload;
        try {
            payload = await http.getJson(ENDPOINT, {
                'Authorization': `Bearer ${oauth.accessToken}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'Accept': 'application/json',
            });
        } catch (e) {
            throw this._translate(e);
        }
        this._consecutiveRateLimits = 0;

        const windows = parseUsage(payload);
        if (windows.length === 0) {
            throw new UsageError(ErrorKind.NOTHING_METERED,
                'Claude listed no usage limits for this account');
        }
        return {
            id: this.id,
            displayName: this.displayName,
            windows,
            headlineId: windows.some(w => w.id === 'session') ? 'session' : windows[0].id,
            plan: oauth.subscriptionType ? capitalize(oauth.subscriptionType) : null,
            fetchedAt: new Date(),
            source: SOURCE,
        };
    }

    /**
     * Claude Code rotates this token whenever it runs; this extension never
     * refreshes it. Expired is not signed out, so the store keeps showing the
     * last reading.
     */
    async _loadCredentials() {
        const json = await readJson(credentialsPath());
        const oauth = json?.claudeAiOauth;
        if (!oauth?.accessToken)
            throw new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);
        if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now())
            throw new UsageError(ErrorKind.CREDENTIAL_EXPIRED, 'Token expired, use Claude Code to refresh');
        return oauth;
    }

    _translate(error) {
        if (error instanceof UsageError)
            return error;
        if (error instanceof HttpError) {
            if (error.status === 401 || error.status === 403)
                return new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);
            if (error.status === 429) {
                const wait = backoffSeconds(this._consecutiveRateLimits++, error.retryAfter);
                this._retryNoEarlierThan = Date.now() + wait * 1000;
                return new UsageError(ErrorKind.RATE_LIMITED, 'Rate limited', wait);
            }
            return new UsageError(ErrorKind.BAD_RESPONSE, `Claude answered ${error.status}`);
        }
        console.error(`CodeNotchBar claude: request failed: ${error?.message ?? error}`);
        return new UsageError(ErrorKind.BAD_RESPONSE, 'Claude unreachable');
    }
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
