import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {readConfig} from './lib/config.js';
import {UsageStore} from './model/usageStore.js';
import {DetailPopout} from './ui/detailPopout.js';
import {FloatingWidget} from './ui/floatingWidget.js';

/** Settings keys that change what is on screen or how often it is polled. */
const LIVE_KEYS = [
    'scale', 'background-opacity', 'background-color', 'popout-opacity',
    'show-percent-label', 'ring-window', 'show-weekly-ring', 'warn-threshold', 'critical-threshold',
    'poll-interval', 'provider-poll-intervals', 'snap-threshold', 'remember-position',
    'debug-mode', 'enabled-providers', 'provider-order',
];

export default class CodeNotchExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const config = readConfig(this._settings);

        this._stylesheet = this.dir.get_child('stylesheet.css');
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(this._stylesheet);

        this._popout = new DetailPopout(this.dir, config);
        Main.layoutManager.addChrome(this._popout);

        this._widget = new FloatingWidget(this._popout, this.dir, config, this._settings,
            () => this.openPreferences());
        Main.layoutManager.addChrome(this._widget);

        this._store = new UsageStore(config);
        this._changedId = this._store.connect('changed',
            () => this._widget?.setStates(this._store.states));

        this._settingsIds = LIVE_KEYS.map(key =>
            this._settings.connect(`changed::${key}`, () => this._applyConfig()));

        this._store.start().catch(e => console.error(`CodeNotchBar: ${e.message}`));
    }

    _applyConfig() {
        const config = readConfig(this._settings);
        this._popout.applyConfig(config);
        this._widget.applyConfig(config);
        this._store.applyConfig(config);
    }

    disable() {
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = null;

        if (this._store) {
            this._store.disconnect(this._changedId);
            this._store.destroy();
            this._store = null;
        }
        if (this._widget) {
            Main.layoutManager.removeChrome(this._widget);
            this._widget.destroy();
            this._widget = null;
        }
        if (this._popout) {
            Main.layoutManager.removeChrome(this._popout);
            this._popout.destroy();
            this._popout = null;
        }
        if (this._stylesheet) {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._stylesheet);
            this._stylesheet = null;
        }
        this._settings = null;
    }
}
