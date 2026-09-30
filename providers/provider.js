/** Failure kinds a provider can raise; the store turns them into UI status. */
export const ErrorKind = Object.freeze({
    NEEDS_AUTH: 'needs-auth',
    CREDENTIAL_EXPIRED: 'credential-expired',
    RATE_LIMITED: 'rate-limited',
    BAD_RESPONSE: 'bad-response',
    NOTHING_METERED: 'nothing-metered',
});

export class UsageError extends Error {
    /**
     * @param {string} kind one of ErrorKind
     * @param {string} message user-facing text
     * @param {number|null} retryAfter seconds, for RATE_LIMITED
     */
    constructor(kind, message, retryAfter = null) {
        super(message);
        this.name = 'UsageError';
        this.kind = kind;
        this.retryAfter = retryAfter;
    }
}

/**
 * Base class for an agent whose limits can be read.
 *
 * Providers only ever *read* credentials owned by the agent's own tooling;
 * they never refresh or write them.
 */
export class Provider {
    /**
     * @param {object} meta
     * @param {string} meta.id
     * @param {string} meta.displayName
     * @param {string} meta.iconFile   file name inside icons/
     * @param {string} meta.signIn     hint shown when signed out
     */
    constructor({id, displayName, iconFile, signIn}) {
        this.id = id;
        this.displayName = displayName;
        this.iconFile = iconFile;
        this.signIn = signIn;
    }

    /**
     * Whether this agent is present on the machine. Providers that are not
     * installed are hidden rather than shown as errors.
     *
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        return true;
    }

    /**
     * @param {import('../lib/http.js').HttpClient} _http
     * @returns {Promise<import('../model/types.js').Snapshot>}
     * @throws {UsageError}
     */
    async fetchSnapshot(_http) {
        throw new Error('not implemented');
    }

    destroy() {}
}
