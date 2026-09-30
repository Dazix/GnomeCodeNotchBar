import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {HttpClient} from '../lib/http.js';
import {createProviders, detectAvailable} from '../providers/registry.js';
import {ErrorKind} from '../providers/provider.js';

const STALE_MS = 15 * 60 * 1000;

/**
 * @typedef {object} ProviderState
 * @property {import('../providers/provider.js').Provider} provider
 * @property {import('./types.js').Snapshot|null} snapshot  last good reading
 * @property {string|null} error   user-facing status when the last fetch failed
 * @property {boolean} stale       reading older than STALE_MS or last fetch failed
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
        this._timerId = 0;
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
        if (config.pollInterval !== previous.pollInterval)
            this._startTimer();
        const enabledNow = JSON.stringify(config.enabledProviders);
        if (enabledNow !== JSON.stringify(previous.enabledProviders)) {
            // A provider that was just switched on has no reading yet.
            this.refresh().catch(e => console.error(`CodeNotchBar refresh: ${e.message}`));
        }
        this.emit('changed');
    }

    async start() {
        const available = await detectAvailable(this._providers);
        if (this._destroyed)
            return;
        for (const provider of available)
            this._states.set(provider.id, {provider, snapshot: null, error: null, stale: false});
        this._started = true;

        this.emit('changed');
        await this.refresh();
        if (this._destroyed)
            return;
        this._startTimer();
    }

    _startTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._config.pollInterval, () => {
            this.refresh().catch(e => console.error(`CodeNotchBar refresh: ${e.message}`));
            return GLib.SOURCE_CONTINUE;
        });
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
        if (state.snapshot && Date.now() - state.snapshot.fetchedAt.getTime() > STALE_MS)
            state.stale = true;
    }

    destroy() {
        this._destroyed = true;
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        for (const state of this._states.values())
            state.provider.destroy();
        this._states.clear();
        this._http.destroy();
        this._http = null;
    }
});
