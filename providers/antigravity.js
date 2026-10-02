import GLib from 'gi://GLib';

import {backoffSeconds} from '../lib/backoff.js';
import {exists, expandHome} from '../lib/files.js';
import {run} from '../lib/subprocess.js';
import {ErrorKind, Provider, UsageError} from './provider.js';

const FALLBACK_BIN = '~/.local/bin/agy';
const STATE_DIR = 'codenotchbar/agy-work';
const PRINT_TIMEOUT = '30s';
const PROCESS_TIMEOUT_SECONDS = 70;
/** Each read starts the CLI, which may call the network: never more often than this. */
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_OUTPUT = 64 * 1024;

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const ROW = /^(.+?)\s+Limit\s+Remaining\s+(-?[\d.]+|NaN)%\s+(\S+)$/;

/** @param {string} text raw CLI output, possibly with terminal escapes */
export function sanitize(text) {
    return text.replace(ANSI, '').replace(/\r\n?/g, '\n');
}

function windowId(group) {
    return group.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function windowLabel(group) {
    return group
        .replace(/\s+Models?\b/i, '')
        .replace(/\s+and\s+/i, '/')
        .replace(/\s+Weekly$/i, ' · Weekly')
        .replace(/\s+Five Hour$/i, ' · 5h');
}

/**
 * Parse `agy --print /usage`: one `<label> Limit Remaining <n>% <reset>` row
 * per quota, columns separated by tabs (older builds: spaces, after a
 * `Quota:` heading). Anything unrecognised is an error, never a zero reading.
 *
 * @param {string} text
 * @returns {import('../model/types.js').LimitWindow[]}
 */
export function parseUsage(text) {
    const windows = [];
    for (const line of sanitize(text).split('\n')) {
        const row = ROW.exec(line.replace(/\t/g, ' ').trim());
        if (!row)
            continue;
        const remaining = Number(row[2]);
        const resetsAt = new Date(row[3]);
        if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100 ||
            Number.isNaN(resetsAt.getTime()))
            throw new UsageError(ErrorKind.BAD_RESPONSE, 'Unreadable Antigravity quota');
        windows.push({
            id: windowId(row[1]),
            label: windowLabel(row[1]),
            usedFraction: (100 - remaining) / 100,
            resetsAt,
        });
    }
    if (windows.length === 0)
        throw new UsageError(ErrorKind.BAD_RESPONSE, 'Antigravity returned no quota');
    return windows;
}

/** The tightest limit fills the ring. */
function headlineOf(windows) {
    return windows.reduce((a, b) => (b.usedFraction > a.usedFraction ? b : a)).id;
}

export class AntigravityProvider extends Provider {
    constructor() {
        super({
            id: 'antigravity',
            displayName: 'Antigravity',
            iconFile: 'antigravity.svg',
            signIn: 'Run `agy` and sign in',
        });
        this._last = null;
        this._lastAt = 0;
        this._inFlight = null;
        this._consecutiveFailures = 0;
        this._retryNoEarlierThan = 0;
    }

    /** `~/.local/bin` is often missing from the shell's PATH. */
    _binary() {
        return GLib.find_program_in_path('agy') ?? (exists(FALLBACK_BIN) ? expandHome(FALLBACK_BIN) : null);
    }

    async isAvailable() {
        return this._binary() !== null;
    }

    async fetchSnapshot(_http) {
        const now = Date.now();
        if (this._last && now - this._lastAt < MIN_INTERVAL_MS)
            return this._last;
        if (now < this._retryNoEarlierThan) {
            throw new UsageError(ErrorKind.RATE_LIMITED, 'Antigravity did not answer',
                (this._retryNoEarlierThan - now) / 1000);
        }
        this._inFlight ??= this._read().finally(() => {
            this._inFlight = null;
        });
        return this._inFlight;
    }

    async _read() {
        const bin = this._binary();
        if (!bin)
            throw new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);

        // An empty directory of our own: the CLI files a project under its cwd.
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), STATE_DIR]);
        GLib.mkdir_with_parents(dir, 0o700);
        const out = await run([bin, '--sandbox', '--print-timeout', PRINT_TIMEOUT, '--print', '/usage'],
            PROCESS_TIMEOUT_SECONDS, dir);
        if (out === null || out.length > MAX_OUTPUT) {
            const wait = backoffSeconds(this._consecutiveFailures++);
            this._retryNoEarlierThan = Date.now() + wait * 1000;
            throw new UsageError(ErrorKind.BAD_RESPONSE, 'Antigravity did not answer');
        }

        let windows;
        try {
            windows = parseUsage(out);
        } catch (e) {
            if (/sign.?in|log.?in|logged in|authenticat/i.test(out))
                throw new UsageError(ErrorKind.NEEDS_AUTH, this.signIn);
            throw e;
        }
        this._consecutiveFailures = 0;
        this._last = {
            id: this.id,
            displayName: this.displayName,
            windows,
            headlineId: headlineOf(windows),
            plan: null,
            fetchedAt: new Date(),
        };
        this._lastAt = Date.now();
        return this._last;
    }
}
