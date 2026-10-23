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
    'show-percent-label', 'compact-mode', 'ring-window', 'show-weekly-ring', 'warn-threshold', 'critical-threshold',
    'poll-interval', 'provider-poll-intervals', 'snap-threshold', 'remember-position',
    'debug-mode', 'enabled-providers', 'provider-order',
];

/**
 * Lifecycle: nothing is created before enable(); the widgets, the usage store (its polling
 * timers, file watchers and HTTP session) and the signal handlers made there are all undone
 * in disable(). What the extension reads, runs and sends is listed in the README.
 */
export default class CodeNotchExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const config = readConfig(this._settings);

        this._stylesheet = this.dir.get_child('stylesheet.css');
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(this._stylesheet);

        this._popout = new DetailPopout(this.dir, config);
        Main.layoutManager.addChrome(this._popout, {trackFullscreen: false});

        this._widget = new FloatingWidget(this._popout, this.dir, config, this._settings,
            () => this.openPreferences());
        Main.layoutManager.addChrome(this._widget, {trackFullscreen: false});

        // A window that exactly fills a monitor (no top bar on a secondary one) gets scanned out
        // directly, which skips the shell chrome drawn above it. Shell itself inhibits this during
        // the overview and modal grabs, which is why alt+tab briefly brought the notch back.
        global.compositor.disable_unredirect();
        this._unredirectDisabled = true;

        // Other chrome or a fullscreen window can end up above the notch: lift it back.
        this._restackedId = global.display.connect('restacked', () => {
            this._raiseChrome();
            this._reassertUnredirect();
        });
        this._raiseChrome();

        this._store = new UsageStore(config);
        this._changedId = this._store.connect('changed',
            () => this._widget?.setStates(this._store.states));

        this._settingsIds = LIVE_KEYS.map(key =>
            this._settings.connect(`changed::${key}`, () => this._applyConfig()));

        this._store.start().catch(e => console.error(`CodeNotchBar: ${e.message}`));
    }

    _raiseChrome() {
        // Above the other chrome, but just below the modal dialogs (system dialogs stay on top).
        const {uiGroup, modalDialogGroup} = Main.layoutManager;
        for (const actor of [this._popout, this._widget]) {
            if (actor?.get_parent() === uiGroup && modalDialogGroup?.get_parent() === uiGroup)
                uiGroup.set_child_below_sibling(actor, modalDialogGroup);
        }
    }

    _reassertUnredirect() {
        // The inhibit is a single counter shared by everyone, and Shell sometimes releases one more
        // time than it took (seen around unlocking the screen), which silently drops ours. Mutter
        // offers no getter, so release and take it again in the same turn: while it is held this
        // is a no-op, and once it was lost the release is ignored and the take restores it.
        if (!this._unredirectDisabled)
            return;
        global.compositor.enable_unredirect();
        global.compositor.disable_unredirect();
    }

    _applyConfig() {
        const config = readConfig(this._settings);
        this._popout.applyConfig(config);
        this._widget.applyConfig(config);
        this._store.applyConfig(config);
    }

    disable() {
        if (this._unredirectDisabled) {
            global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
        }
        if (this._restackedId) {
            global.display.disconnect(this._restackedId);
            this._restackedId = null;
        }
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
