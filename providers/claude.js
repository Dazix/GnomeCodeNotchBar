import GLib from 'gi://GLib';

import {HttpError} from '../lib/http.js';
import {backoffSeconds} from '../lib/backoff.js';
import {exists, readJson} from '../lib/files.js';
import {ErrorKind, Provider, UsageError} from './provider.js';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

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
        const resetsAt = toDate(limit.resets_at);
        if (!resetsAt || typeof limit.percent !== 'number')
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
        if (!resetsAt || typeof window.utilization !== 'number' ||
            windows.some(w => w.id === id))
            return;
        windows.push({id, label: labelForKind(id), usedFraction: window.utilization / 100, resetsAt});
    };
    merge(payload?.five_hour, 'session');
    merge(payload?.seven_day, 'weekly_all');

    return windows.sort((a, b) =>
        windowRank(a.id) - windowRank(b.id) || a.id.localeCompare(b.id));
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
    }

    async isAvailable() {
        return exists(credentialsPath());
    }

    async fetchSnapshot(http) {
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
        return new UsageError(ErrorKind.BAD_RESPONSE, 'Claude unreachable');
    }
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
