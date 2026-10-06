import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {HttpClient} from '../lib/http.js';
import {createProviders} from '../providers/registry.js';
import {watchFile} from '../lib/watch.js';
import {ErrorKind} from '../providers/provider.js';

const STALE_MS = 15 * 60 * 1000;
const LOADING_TIMEOUT_S = 20;

/**
 * @typedef {object} ProviderState
 * @property {import('../providers/provider.js').Provider} provider
 * @property {import('./types.js').Snapshot|null} snapshot  last good reading
 * @property {string|null} error   user-facing status when the last fetch failed
 * @property {boolean} stale       reading older than STALE_MS or last fetch failed
 * @property {boolean} loading     first fetch not finished yet
 * @property {Date|null} checkedAt  when the provider was last polled, successfully or not
 */

/**
 * Owns the providers and polls them. Keeps the last good snapshot so a
 * failed refresh dims the ring instead of blanking it; never invents numbers.
 * Emits `changed` after every refresh round or selection change.
 */
export const UsageStore = GObject.registerClass({
    Signals: {'changed': {}},
}, class UsageStore extends GObject.Object {
    /** @param {import('../lib/config.js').Config} config */
    _init(config) {
        super._init();
        this._config = config;
        this._http = new HttpClient();
        this._providers = createProviders();
        /** All detected providers, enabled or not. @type {Map<string, ProviderState>} */
        this._states = new Map();
        /** @type {Map<string, number>} provider id to GLib source id */
        this._timerIds = new Map();
        this._loadingTimeoutId = 0;
        /** @type {Map<string, {cancel: () => void}[]>} provider id to its file watchers */
        this._watchers = new Map();
        this._started = false;
        this._destroyed = false;
    }

    /** Enabled providers in the user's order. @returns {ProviderState[]} */
    get states() {
        const {enabledProviders, providerOrder} = this._config;
        const rank = id => {
            const i = providerOrder.indexOf(id);
            return i === -1 ? providerOrder.length : i;
        };
        return [...this._states.values()]
            .filter(s => enabledProviders.length === 0 || enabledProviders.includes(s.provider.id))
            .sort((a, b) => rank(a.provider.id) - rank(b.provider.id));
    }

    /**
     * Apply new settings live.
     *
     * @param {import('../lib/config.js').Config} config
     */
    applyConfig(config) {
        const previous = this._config;
        this._config = config;
        if (!this._started)
            return;
        if (config.pollInterval !== previous.pollInterval ||
            JSON.stringify(config.providerPollIntervals) !== JSON.stringify(previous.providerPollIntervals))
            this._startTimers();
        const enabledNow = JSON.stringify(config.enabledProviders);
        if (enabledNow !== JSON.stringify(previous.enabledProviders)) {
            // A provider that was just switched on has no reading yet.
            this.refresh().catch(e => console.error(`CodeNotchBar refresh: ${e.message}`));
        }
        this.emit('changed');
    }

    async start() {
        this._started = true;

        // A fetch that hangs must not spin forever.
        this._loadingTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LOADING_TIMEOUT_S, () => {
            this._loadingTimeoutId = 0;
            for (const state of this._states.values()) {
                if (state.loading) {
                    state.loading = false;
                    state.error = 'No response yet';
                    state.stale = true;
                }
            }
            this.emit('changed');
            return GLib.SOURCE_REMOVE;
        });

        // Agents are independent: a slow detection (e.g. `gh auth token`) must
        // not hold back the others.
        await Promise.all(this._providers.map(provider => this._startProvider(provider)));
        if (this._destroyed)
            return;
        this._startTimers();
    }

    /**
     * Show one agent as soon as it is found on this machine (credentials or
     * binary present), loading until its first reading lands.
     */
    async _startProvider(provider) {
        const found = await provider.isAvailable().catch(() => false);
        if (!found || this._destroyed)
            return;
        const state = {provider, snapshot: null, error: null, stale: false, loading: true, checkedAt: null};
        this._states.set(provider.id, state);
        this._watch(state);
        this.emit('changed');
        await this._refreshOne(state);
        if (!this._destroyed)
            this.emit('changed');
    }

    /**
     * Refresh a provider the moment it writes a new reading; the poll timer
     * stays as the fallback for when nothing is written.
     */
    _watch(state) {
        const watchers = state.provider.watchedFiles()
            .map(path => watchFile(path, () => {
                // Disabled providers are not refreshed, same as on the timer.
                if (this._destroyed || !this.states.includes(state))
                    return;
                this._refreshOne(state)
                    .then(() => this._destroyed || this.emit('changed'))
                    .catch(e => console.error(`CodeNotchBar refresh: ${e.message}`));
            }))
            .filter(Boolean);
        this._watchers.set(state.provider.id, watchers);
    }

    /** Seconds between checks for one provider: its own setting, else the global one. */
    _intervalFor(id) {
        const own = this._config.providerPollIntervals?.[id];
        return Number.isFinite(own) && own > 0 ? own : this._config.pollInterval;
    }

    /** One timer per provider, so each agent can be polled at its own pace. */
    _startTimers() {
        this._stopTimers();
        for (const state of this._states.values()) {
            const id = state.provider.id;
            this._timerIds.set(id, GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._intervalFor(id), () => {
                // Disabled providers are not polled: no requests for agents the user hid.
                if (this.states.includes(state)) {
                    this._refreshOne(state)
                        .then(() => this._destroyed || this.emit('changed'))
                        .catch(e => console.error(`CodeNotchBar refresh: ${e.message}`));
                }
                return GLib.SOURCE_CONTINUE;
            }));
        }
    }

    _stopTimers() {
        for (const timerId of this._timerIds.values())
            GLib.source_remove(timerId);
        this._timerIds.clear();
    }

    async refresh() {
        // Disabled providers are not polled: no requests for agents the user hid.
        await Promise.all(this.states.map(state => this._refreshOne(state)));
        if (!this._destroyed)
            this.emit('changed');
    }

    async _refreshOne(state) {
        try {
            state.snapshot = await state.provider.fetchSnapshot(this._http);
            state.error = null;
            state.stale = false;
        } catch (e) {
            if (this._destroyed)
                return;
            state.error = e.message;
            // An expired credential is not signed out: keep showing the last reading.
            state.stale = true;
            if (e.kind === undefined)
                console.error(`CodeNotchBar ${state.provider.id}: ${e.message}`);
            if (e.kind === ErrorKind.NEEDS_AUTH)
                state.snapshot = null;
        }
        state.loading = false;
        state.checkedAt = new Date();
        if (state.snapshot && Date.now() - state.snapshot.fetchedAt.getTime() > STALE_MS)
            state.stale = true;
    }

    destroy() {
        this._destroyed = true;
        this._stopTimers();
        for (const watchers of this._watchers.values())
            watchers.forEach(w => w.cancel());
        this._watchers.clear();
        if (this._loadingTimeoutId) {
            GLib.source_remove(this._loadingTimeoutId);
            this._loadingTimeoutId = 0;
        }
        for (const state of this._states.values())
            state.provider.destroy();
        this._states.clear();
        this._http.destroy();
        this._http = null;
    }
});
