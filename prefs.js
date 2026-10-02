import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PROVIDER_META} from './providers/meta.js';

const RING_WINDOWS = [
    ['headline', 'Current session (headline)'],
    ['weekly', 'Weekly'],
];

const ALL_KEYS = [
    'scale', 'background-opacity', 'background-color', 'popout-opacity', 'show-percent-label',
    'ring-window', 'warn-threshold', 'critical-threshold', 'poll-interval', 'provider-poll-intervals',
    'snap-threshold', 'remember-position', 'position-x', 'position-y', 'dock-state', 'enabled-providers', 'provider-order',
];

function hexOf(rgba) {
    const c = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${c(rgba.red)}${c(rgba.green)}${c(rgba.blue)}`;
}

function spinRow(settings, key, {title, subtitle = '', lower, upper, step, digits = 0}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, {title, subtitle = ''}) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class CodeNotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(560, 720);

        window.add(this._appearancePage(settings));
        window.add(this._displayPage(settings));
        window.add(this._behaviourPage(settings, window));
        window.add(this._providersPage(settings));
        window.connect('close-request', () => {
            window._settings = null;
            return false;
        });
    }

    _appearancePage(settings) {
        const page = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'applications-graphics-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Notch'});
        page.add(group);

        group.add(spinRow(settings, 'scale', {
            title: 'Size', subtitle: 'Scale of the notch and its popout',
            lower: 0.75, upper: 1.75, step: 0.05, digits: 2,
        }));
        group.add(spinRow(settings, 'background-opacity', {
            title: 'Background opacity', lower: 0.2, upper: 1.0, step: 0.05, digits: 2,
        }));
        group.add(spinRow(settings, 'popout-opacity', {
            title: 'Popout opacity', lower: 0.3, upper: 1.0, step: 0.05, digits: 2,
        }));

        const colorRow = new Adw.ActionRow({title: 'Background colour'});
        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const current = new Gdk.RGBA();
        if (!current.parse(settings.get_string('background-color')))
            current.parse('#0d0d0d');
        button.set_rgba(current);
        button.connect('notify::rgba', () => settings.set_string('background-color', hexOf(button.get_rgba())));
        colorRow.add_suffix(button);
        group.add(colorRow);

        group.add(switchRow(settings, 'show-percent-label', {title: 'Show percentage under the ring'}));
        return page;
    }

    _displayPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Display', icon_name: 'view-reveal-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Ring'});
        page.add(group);

        const combo = new Adw.ComboRow({
            title: 'Limit shown in the ring',
            model: Gtk.StringList.new(RING_WINDOWS.map(([, label]) => label)),
        });
        const sync = () => {
            combo.selected = Math.max(0, RING_WINDOWS.findIndex(([id]) => id === settings.get_string('ring-window')));
        };
        sync();
        combo.connect('notify::selected', () =>
            settings.set_string('ring-window', RING_WINDOWS[combo.selected][0]));
        settings.connect('changed::ring-window', sync);
        group.add(combo);

        const colours = new Adw.PreferencesGroup({
            title: 'Colours',
            description: 'Ring turns amber and red at these usage levels.',
        });
        page.add(colours);
        const warn = spinRow(settings, 'warn-threshold', {
            title: 'Amber from', lower: 0.1, upper: 0.99, step: 0.05, digits: 2,
        });
        const critical = spinRow(settings, 'critical-threshold', {
            title: 'Red from', lower: 0.1, upper: 1.0, step: 0.05, digits: 2,
        });
        colours.add(warn);
        colours.add(critical);
        return page;
    }

    _behaviourPage(settings, window) {
        const page = new Adw.PreferencesPage({title: 'Behaviour', icon_name: 'preferences-system-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Refresh and docking',
            description: 'A short refresh interval keeps the numbers fresher but sends more requests to ' +
                'each agent\'s usage API. Those APIs rate limit (HTTP 429), and Claude\'s does so quickly; ' +
                'a limited agent shows "Rate limited" and is retried later. 60 seconds or more is recommended. ' +
                'Agents can have their own interval on the Agents page.',
        });
        page.add(group);

        group.add(spinRow(settings, 'poll-interval', {
            title: 'Refresh interval', subtitle: 'Seconds between usage checks (default for all agents)',
            lower: 15, upper: 600, step: 5,
        }));
        group.add(spinRow(settings, 'snap-threshold', {
            title: 'Snap distance', subtitle: 'Pixels from a screen edge where the notch docks',
            lower: 20, upper: 400, step: 10,
        }));
        group.add(switchRow(settings, 'remember-position', {
            title: 'Remember position', subtitle: 'Restore position and docking after restart',
        }));

        const reset = new Adw.PreferencesGroup();
        page.add(reset);
        const resetPosition = new Adw.ButtonRow({title: 'Reset position'});
        resetPosition.connect('activated', () => {
            for (const key of ['position-x', 'position-y', 'dock-state'])
                settings.reset(key);
        });
        reset.add(resetPosition);

        const resetAll = new Adw.ButtonRow({title: 'Reset all settings', css_classes: ['destructive-action']});
        resetAll.connect('activated', () => {
            for (const key of ALL_KEYS)
                settings.reset(key);
            window.close();
        });
        reset.add(resetAll);
        return page;
    }

    _providersPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Agents', icon_name: 'system-users-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Agents',
            description: 'Only agents found on this machine are shown. Use the arrows to reorder.',
        });
        page.add(group);

        let rows = [];
        const orderedIds = () => {
            const saved = settings.get_strv('provider-order').filter(id => PROVIDER_META.some(p => p.id === id));
            const rest = PROVIDER_META.map(p => p.id).filter(id => !saved.includes(id));
            return [...saved, ...rest];
        };
        const isEnabled = id => {
            const enabled = settings.get_strv('enabled-providers');
            return enabled.length === 0 || enabled.includes(id);
        };
        const setEnabled = (id, on) => {
            const set = new Set(PROVIDER_META.map(p => p.id).filter(p => (p === id ? on : isEnabled(p))));
            // Everything on is stored as [] so agents added later show up by default.
            settings.set_strv('enabled-providers',
                set.size === PROVIDER_META.length ? [] : PROVIDER_META.map(p => p.id).filter(p => set.has(p)));
        };
        const move = (id, delta) => {
            const order = orderedIds();
            const from = order.indexOf(id);
            const to = from + delta;
            if (to < 0 || to >= order.length)
                return;
            order.splice(to, 0, order.splice(from, 1)[0]);
            settings.set_strv('provider-order', order);
        };

        const rebuild = () => {
            for (const row of rows)
                group.remove(row);
            rows = [];
            const order = orderedIds();
            order.forEach((id, index) => {
                const meta = PROVIDER_META.find(p => p.id === id);
                const row = new Adw.ActionRow({title: meta.displayName});
                row.add_prefix(new Gtk.Image({
                    gicon: new Gio.FileIcon({file: this.dir.get_child('icons').get_child(meta.iconFile)}),
                    pixel_size: 20,
                }));

                const up = new Gtk.Button({icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER,
                    css_classes: ['flat'], sensitive: index > 0});
                up.connect('clicked', () => move(id, -1));
                const down = new Gtk.Button({icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER,
                    css_classes: ['flat'], sensitive: index < order.length - 1});
                down.connect('clicked', () => move(id, 1));
                const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: isEnabled(id)});
                toggle.connect('notify::active', () => setEnabled(id, toggle.active));

                row.add_suffix(up);
                row.add_suffix(down);
                row.add_suffix(toggle);
                row.activatable_widget = toggle;
                group.add(row);
                rows.push(row);
            });
        };
        rebuild();
        // Rebuilt only on external changes to keep a switch being clicked stable.
        settings.connect('changed::provider-order', rebuild);

        page.add(this._pollIntervalsGroup(settings));
        return page;
    }

    _pollIntervalsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Refresh interval per agent',
            description: 'Seconds between usage checks for one agent. 0 uses the default from Behaviour. ' +
                'Shorter intervals risk rate limiting by that agent\'s usage API; 60 seconds or more is recommended.',
        });

        const MIN = 15;
        const read = () => settings.get_value('provider-poll-intervals').deepUnpack();
        const rows = new Map();

        for (const meta of PROVIDER_META) {
            const row = new Adw.SpinRow({
                title: meta.displayName,
                adjustment: new Gtk.Adjustment({lower: 0, upper: 600, step_increment: 5, page_increment: 30}),
            });
            row.value = read()[meta.id] ?? 0;
            row.connect('notify::value', () => {
                let value = Math.round(row.value);
                const current = read()[meta.id] ?? 0;
                // 1..14 is below the minimum: jump to the minimum going up, to "default" going down.
                if (value > 0 && value < MIN)
                    value = value > current ? MIN : 0;
                if (value !== row.value)
                    row.value = value;
                if (value === current)
                    return;
                const next = {...read()};
                if (value === 0)
                    delete next[meta.id];
                else
                    next[meta.id] = value;
                settings.set_value('provider-poll-intervals', new GLib.Variant('a{si}', next));
            });
            rows.set(meta.id, row);
            group.add(row);
        }

        // Keep the rows in step with outside changes, e.g. "Reset all settings".
        settings.connect('changed::provider-poll-intervals', () => {
            const saved = read();
            for (const [id, row] of rows) {
                if (row.value !== (saved[id] ?? 0))
                    row.value = saved[id] ?? 0;
            }
        });
        return group;
    }
}
