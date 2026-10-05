import GLib from 'gi://GLib';

import {HttpError} from '../lib/http.js';
import {backoffSeconds} from '../lib/backoff.js';
import {exists, readJson} from '../lib/files.js';
import {hasProgram, run} from '../lib/subprocess.js';
import {jwtClaims} from '../lib/jwt.js';
import {ErrorKind, Provider, UsageError} from './provider.js';

const ENDPOINT = 'https://cursor.com/api/usage-summary';
const SOURCE = `API ${ENDPOINT}`;
const STORE_PATH = '~/.config/Cursor/User/globalStorage/state.vscdb';
const AGENT_CONFIG_PATH = '~/.cursor/cli-config.json';

function parseDate(value) {
    if (typeof value !== 'string')
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function spendWindow(bucket, id, label, resetsAt) {
    if (bucket?.enabled !== true || !(bucket.limit > 0) || typeof bucket.used !== 'number')
        return null;
    return {id, label, usedFraction: bucket.used / bucket.limit, resetsAt};
}

/**
 * @param {object} root `usage-summary` response
 * @returns {import('../model/types.js').LimitWindow[]}
 */
export function parseUsage(root) {
    const resetsAt = parseDate(root?.billingCycleEnd);
    const usage = root?.individualUsage ?? {};
    const plan = usage.plan ?? {};
    const windows = [];

    // Zero is a reading, not an absence: a fresh month is 0 % on this bar.
    if (typeof plan.autoPercentUsed === 'number') {
        windows.push({id: 'auto', label: 'Auto usage',
            usedFraction: plan.autoPercentUsed / 100, resetsAt});
    }
    if (typeof plan.apiPercentUsed === 'number' && plan.apiPercentUsed > 0) {
        windows.push({id: 'api', label: 'API usage',
            usedFraction: plan.apiPercentUsed / 100, resetsAt});
    }
    const onDemand = spendWindow(usage.onDemand, 'on_demand', 'On demand', resetsAt);
    if (onDemand)
        windows.push(onDemand);

    // Team / enterprise plans omit `plan` and meter an `overall` ceiling.
    if (windows.length === 0) {
        const overall = spendWindow(usage.overall, 'included', 'Included usage', resetsAt);
        if (overall)
            windows.push(overall);
    }
    const team = spendWindow(root?.teamUsage?.onDemand, 'team_on_demand', 'Team on demand', resetsAt);
    if (team && team.usedFraction > 0)
        windows.push(team);
    return windows;
}

function headlineOf(windows) {
    for (const id of ['auto', 'included', 'api']) {
        if (windows.some(w => w.id === id))
            return id;
    }
    return windows[0].id;
}

export class CursorProvider extends Provider {
    constructor() {
        super({
            id: 'cursor',
            displayName: 'Cursor',
            iconFile: 'cursor.svg',
            signIn: 'Sign in to the Cursor editor or run `cursor-agent login`',
        });
        this._consecutiveRateLimits = 0;
        this._retryNoEarlierThan = 0;
    }

    async isAvailable() {
        return exists(STORE_PATH) || exists(AGENT_CONFIG_PATH);
    }

    /** Value from Cursor's VS Code style key/value store, via the sqlite3 CLI. */
    async _storeValue(key) {
        if (!hasProgram('sqlite3') || !exists(STORE_PATH))
            return null;
        const path = STORE_PATH.replace(/^~/, GLib.get_home_dir());
        const out = await run(['sqlite3', '-readonly', path,
            `SELECT value FROM ItemTable WHERE key = '${key}'`]);
        return out || null;
    }

    async _credentials() {
        const token = await this._storeValue('cursorAuth/accessToken');
        if (token) {
            const id = await this._storeValue('cursorAuth/stripeMembershipAuthId') ||
                jwtClaims(token)?.sub;
            if (id)
                return {id, token};
        }
        const info = (await readJson(AGENT_CONFIG_PATH))?.authInfo;
        if (info?.accessToken && (info.authId || info.userId)) {
            return {id: info.authId ?? String(info.userId), token: info.accessToken};
        }
        throw new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);
    }

    async fetchSnapshot(http) {
        const now = Date.now();
        if (now < this._retryNoEarlierThan) {
            throw new UsageError(ErrorKind.RATE_LIMITED, 'Rate limited',
                (this._retryNoEarlierThan - now) / 1000);
        }
        const {id, token} = await this._credentials();
        const exp = jwtClaims(token)?.exp;
        if (typeof exp === 'number' && exp * 1000 <= now)
            throw new UsageError(ErrorKind.CREDENTIAL_EXPIRED, 'Token expired, open Cursor to refresh');

        let payload;
        try {
            payload = await http.getJson(ENDPOINT, {
                'Cookie': `WorkosCursorSessionToken=${id}::${token}`,
                'Accept': 'application/json',
            });
        } catch (e) {
            throw this._translate(e);
        }
        this._consecutiveRateLimits = 0;

        const windows = parseUsage(payload);
        if (windows.length === 0) {
            throw new UsageError(ErrorKind.NOTHING_METERED,
                payload?.isUnlimited ? 'Unlimited plan, nothing to meter'
                    : 'This Cursor plan has nothing to meter yet');
        }
        const plan = payload.membershipType;
        return {
            id: this.id,
            displayName: this.displayName,
            windows,
            headlineId: headlineOf(windows),
            plan: plan ? String(plan).replace(/^\w/, c => c.toUpperCase()) : null,
            fetchedAt: new Date(),
            source: SOURCE,
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
            return new UsageError(ErrorKind.BAD_RESPONSE, `Cursor answered ${error.status}`);
        }
        return new UsageError(ErrorKind.BAD_RESPONSE, 'Cursor unreachable');
    }
}
