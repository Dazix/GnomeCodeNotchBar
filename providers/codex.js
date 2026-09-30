import GLib from 'gi://GLib';

import {HttpError} from '../lib/http.js';
import {backoffSeconds} from '../lib/backoff.js';
import {exists, readJson} from '../lib/files.js';
import {jwtClaims} from '../lib/jwt.js';
import {ErrorKind, Provider, UsageError} from './provider.js';

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';
const WINDOWS = [
    ['primary', 'primary_window', 'Current session'],
    ['secondary', 'secondary_window', 'Weekly'],
];

function authPath() {
    return `${GLib.getenv('CODEX_HOME') ?? '~/.codex'}/auth.json`;
}

function windowOf(id, label, raw, now) {
    if (!raw || typeof raw.used_percent !== 'number')
        return null;
    let resetsAt = null;
    if (typeof raw.reset_at === 'number')
        resetsAt = new Date(raw.reset_at * 1000);
    else if (typeof raw.reset_after_seconds === 'number')
        resetsAt = new Date(now + raw.reset_after_seconds * 1000);
    return {id, label, usedFraction: raw.used_percent / 100, resetsAt};
}

/**
 * Main account windows only (5 h "primary", weekly "secondary"). A credit
 * seat with no rolling windows falls back to its spend cap.
 *
 * @param {object} payload `wham/usage` response
 * @param {number} [now] ms since epoch
 * @returns {import('../model/types.js').LimitWindow[]}
 */
export function parseUsage(payload, now = Date.now()) {
    const windows = [];
    for (const [id, key, label] of WINDOWS) {
        const item = windowOf(id, label, payload?.rate_limit?.[key], now);
        if (item)
            windows.push(item);
    }
    if (windows.length === 0) {
        const credit = payload?.spend_control?.individual_limit;
        const percentUsed = Number(credit?.used_percent);
        if (Number.isFinite(percentUsed)) {
            windows.push({
                id: 'credits',
                label: 'Credits',
                usedFraction: Math.min(Math.max(percentUsed / 100, 0), 1),
                resetsAt: typeof credit.reset_at === 'number' ? new Date(credit.reset_at * 1000) : null,
            });
        }
    }
    return windows;
}

export class CodexProvider extends Provider {
    constructor() {
        super({
            id: 'codex',
            displayName: 'Codex',
            iconFile: 'codex.svg',
            signIn: 'Run `codex login`',
        });
        this._consecutiveRateLimits = 0;
        this._retryNoEarlierThan = 0;
    }

    async isAvailable() {
        return exists(authPath());
    }

    async fetchSnapshot(http) {
        const now = Date.now();
        if (now < this._retryNoEarlierThan) {
            throw new UsageError(ErrorKind.RATE_LIMITED, 'Rate limited',
                (this._retryNoEarlierThan - now) / 1000);
        }

        const tokens = (await readJson(authPath()))?.tokens;
        if (!tokens?.access_token || !tokens?.account_id)
            throw new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);
        const expiry = jwtClaims(tokens.access_token)?.exp;
        if (typeof expiry === 'number' && expiry * 1000 <= now)
            throw new UsageError(ErrorKind.CREDENTIAL_EXPIRED, 'Token expired, use Codex to refresh');

        let payload;
        try {
            payload = await http.getJson(ENDPOINT, {
                'Authorization': `Bearer ${tokens.access_token}`,
                'ChatGPT-Account-Id': tokens.account_id,
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store',
            });
        } catch (e) {
            throw this._translate(e);
        }
        this._consecutiveRateLimits = 0;

        const windows = parseUsage(payload, now);
        if (windows.length === 0)
            throw new UsageError(ErrorKind.NOTHING_METERED, 'Codex reported no usage windows');

        const plan = payload.plan_type;
        return {
            id: this.id,
            displayName: this.displayName,
            windows,
            headlineId: windows[0].id,
            plan: plan ? String(plan).replace(/^\w/, c => c.toUpperCase()) : null,
            fetchedAt: new Date(),
        };
    }

    _translate(error) {
        if (error instanceof HttpError) {
            if (error.status === 401 || error.status === 403)
                return new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);
            if (error.status === 429) {
                const wait = backoffSeconds(this._consecutiveRateLimits++, error.retryAfter);
                this._retryNoEarlierThan = Date.now() + wait * 1000;
                return new UsageError(ErrorKind.RATE_LIMITED, 'Rate limited', wait);
            }
            return new UsageError(ErrorKind.BAD_RESPONSE, `Codex answered ${error.status}`);
        }
        return new UsageError(ErrorKind.BAD_RESPONSE, 'Codex unreachable');
    }
}
