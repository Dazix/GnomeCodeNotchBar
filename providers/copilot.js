import GLib from 'gi://GLib';

import {HttpError} from '../lib/http.js';
import {backoffSeconds} from '../lib/backoff.js';
import {readText} from '../lib/files.js';
import {run} from '../lib/subprocess.js';
import {ErrorKind, Provider, UsageError} from './provider.js';

const ENDPOINT = 'https://api.github.com/copilot_internal/user';
const HOSTS_PATH = '~/.config/gh/hosts.yml';
const ORDER = ['premium_interactions', 'chat', 'completions'];
const LABELS = {
    premium_interactions: 'Premium requests',
    chat: 'Chat requests',
    completions: 'Completions',
};

/**
 * Minimal reader for `gh`'s hosts.yml: the `oauth_token` under `github.com:`.
 *
 * @param {string|null} text
 * @returns {string|null}
 */
export function parseHostsToken(text) {
    if (!text)
        return null;
    let inHost = false;
    for (const line of text.split('\n')) {
        if (!/^\s/.test(line)) {
            inHost = line.trim() === 'github.com:';
            continue;
        }
        const match = inHost && line.trim().match(/^oauth_token:\s*["']?([^"'\s]+)["']?$/);
        if (match)
            return match[1];
    }
    return null;
}

function parseDate(value) {
    if (typeof value === 'number')
        return new Date(value > 1e10 ? value : value * 1000);
    if (typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

/**
 * @param {object} payload `copilot_internal/user` response
 * @returns {import('../model/types.js').LimitWindow[]}
 */
export function parseQuotas(payload) {
    const quotas = payload?.quota_snapshots;
    if (!quotas || typeof quotas !== 'object')
        return [];

    const keys = [
        ...ORDER,
        ...Object.keys(quotas).filter(k => !ORDER.includes(k)).sort(),
    ];
    const windows = [];
    for (const id of keys) {
        const quota = quotas[id];
        if (!quota || quota.unlimited === true)
            continue;
        const entitlement = quota.entitlement;
        if (typeof entitlement !== 'number' || entitlement <= 0)
            continue;
        const used = typeof quota.used === 'number'
            ? quota.used
            : Math.max(0, entitlement - (quota.remaining ?? entitlement));
        windows.push({
            id,
            label: LABELS[id] ?? id.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase()),
            usedFraction: used / entitlement,
            resetsAt: parseDate(quota.reset_date ?? quota.reset_at ?? quota.resets_at ??
                payload.quota_reset_date),
        });
    }
    return windows;
}

export class CopilotProvider extends Provider {
    constructor() {
        super({
            id: 'copilot',
            displayName: 'GitHub Copilot',
            iconFile: 'copilot.svg',
            signIn: 'Run `gh auth login`',
        });
        this._consecutiveRateLimits = 0;
        this._retryNoEarlierThan = 0;
    }

    async isAvailable() {
        return (await this._token()) !== null;
    }

    async _token() {
        const env = GLib.getenv('GH_TOKEN') ?? GLib.getenv('GITHUB_TOKEN');
        if (env)
            return env;
        const fromHosts = parseHostsToken(await readText(HOSTS_PATH));
        if (fromHosts)
            return fromHosts;
        return await run(['gh', 'auth', 'token', '--hostname', 'github.com']) || null;
    }

    async fetchSnapshot(http) {
        const now = Date.now();
        if (now < this._retryNoEarlierThan) {
            throw new UsageError(ErrorKind.RATE_LIMITED, 'Rate limited',
                (this._retryNoEarlierThan - now) / 1000);
        }
        const token = await this._token();
        if (!token)
            throw new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);

        let payload;
        try {
            payload = await http.getJson(ENDPOINT, {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'CodeNotchBar',
            });
        } catch (e) {
            throw this._translate(e);
        }
        this._consecutiveRateLimits = 0;

        const windows = parseQuotas(payload);
        if (windows.length === 0)
            throw new UsageError(ErrorKind.NOTHING_METERED, 'GitHub Copilot reported no metered quotas');

        const plan = payload.copilot_plan ?? payload.plan ?? null;
        return {
            id: this.id,
            displayName: this.displayName,
            windows,
            headlineId: windows.some(w => w.id === 'premium_interactions')
                ? 'premium_interactions' : windows[0].id,
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
            return new UsageError(ErrorKind.BAD_RESPONSE, `GitHub answered ${error.status}`);
        }
        return new UsageError(ErrorKind.BAD_RESPONSE, 'GitHub unreachable');
    }
}
