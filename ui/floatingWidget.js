import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {metrics as metricsFor} from './metrics.js';
import {paintNotch} from './notchShape.js';
import {SidebarItem} from './sidebarItem.js';

const SNAP_DURATION = 350;
const UNDOCK_DURATION = 250;
const DEFAULT_POSITION = {x: 200, y: 200};

const DOCK_WEIGHTS = {
    'floating': {f: 1.0, r: 0.0, l: 0.0},
    'docked-right': {f: 0.0, r: 1.0, l: 0.0},
    'docked-left': {f: 0.0, r: 0.0, l: 1.0},
};

/** Draggable notch that docks to the left / right screen edge. */
export const FloatingWidget = GObject.registerClass(
class FloatingWidget extends St.Widget {
    /**
     * @param {import('./detailPopout.js').DetailPopout} popout
     * @param {import('gi://Gio').File} extDir
     * @param {import('../lib/config.js').Config} config
     * @param {import('gi://Gio').Settings} settings  used to persist position
     * @param {() => void} onOpenPrefs
     */
    _init(popout, extDir, config, settings, onOpenPrefs) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        // No empty pill: shown by setStates once the first agent is known.
        this.visible = false;

        this._popout = popout;
        this._extDir = extDir;
        this._config = config;
        this._settings = settings;
        this._onOpenPrefs = onOpenPrefs;
        this._metrics = metricsFor(config.scale);
        /** @type {Map<string, SidebarItem>} */
        this._items = new Map();
        this.isDragging = false;
        this.isDockedRight = false;
        this.dockState = 'floating';

        // Shape blend weights: a free pill at first.
        this._weights = {...DOCK_WEIGHTS.floating};
        this._morphFrom = {...this._weights};
        this._morphTo = {...this._weights};

        // The vertical padding follows the shape: small when floating, large
        // when docked. `_ly` is where the icon column starts (y + top padding);
        // it is what the user positions, so icons stay put while padding changes.
        this._ly = 0;
        this._lyFrom = null;
        this._lyTo = 0;
        this._padTop = 0;

        // St.Adjustment tied to this actor is driven by the frame clock.
        this._morphAdj = new St.Adjustment({actor: this, value: 0, lower: 0, upper: 1});
        this._morphAdj.connect('notify::value', () => {
            const p = this._morphAdj.value;
            for (const key of ['f', 'r', 'l'])
                this._weights[key] = this._morphFrom[key] + (this._morphTo[key] - this._morphFrom[key]) * p;
            if (this._lyFrom !== null)
                this._ly = this._lyFrom + (this._lyTo - this._lyFrom) * p;
            this._syncPadding();
            this._bgArea.queue_repaint();
        });

        this._bgArea = new St.DrawingArea({
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL,
        });
        this._bgArea.connect('repaint', area => paintNotch(area, this._weights, {
            metrics: this._metrics,
            color: this._config.backgroundColor,
            opacity: this._config.backgroundOpacity,
        }));
        this.add_child(this._bgArea);

        this._container = new St.BoxLayout({
            vertical: true,
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL,
        });
        this.add_child(this._container);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('motion-event', this._onMotion.bind(this));
        this.connect('button-release-event', this._onButtonRelease.bind(this));

        this._restorePosition();
        this._applyMetrics();
    }

    /**
     * Apply new settings live.
     *
     * @param {import('../lib/config.js').Config} config
     */
    applyConfig(config) {
        const scaleChanged = config.scale !== this._config.scale;
        this._config = config;
        this._metrics = metricsFor(config.scale);
        this._applyMetrics();
        for (const item of this._items.values())
            item.applyConfig(config);
        if (scaleChanged && this.dockState !== 'floating') {
            // The width changed: put a docked notch back flush with its edge.
            this._snapToEdge(0);
        }
    }

    _applyMetrics() {
        this.set_width(this._metrics.widgetWidth);
        this._syncPadding();
        this._bgArea.queue_repaint();
    }

    /** Top padding for the current shape weights: floating pad blended into docked pad. */
    _padFor(weights, metrics = this._metrics) {
        const total = (weights.f + weights.r + weights.l) || 1;
        const docked = 1 - weights.f / total;
        return Math.round(metrics.floatPadV + (metrics.containerPadV - metrics.floatPadV) * docked);
    }

    /** Apply the padding for the current weights and keep the icon column where it was. */
    _syncPadding() {
        const m = this._metrics;
        const top = this._padFor(this._weights);
        // Every item ends with itemPadBottom, so the last one already supplies
        // that much of the bottom padding; subtract it to keep top and bottom equal.
        const bottom = Math.max(0, top - m.itemPadBottom);
        this._padTop = top;
        this._container.set_style(`padding: ${top}px ${m.containerPadH}px ${bottom}px ${m.containerPadH}px;`);
        this.y = this._ly - top;
    }

    /**
     * Sync the sidebar with the store: add new agents, update existing ones,
     * and keep the store's order.
     *
     * @param {import('../model/usageStore.js').ProviderState[]} states
     */
    setStates(states) {
        const seen = new Set();
        states.forEach((state, index) => {
            seen.add(state.provider.id);
            let item = this._items.get(state.provider.id);
            if (item) {
                item.update(state);
            } else {
                item = new SidebarItem(state, this._popout, this, this._extDir, this._config);
                this._items.set(state.provider.id, item);
                this._container.add_child(item);
            }
            this._container.set_child_at_index(item, index);
        });
        for (const [id, item] of this._items) {
            if (!seen.has(id)) {
                this._popout.hide();
                item.destroy();
                this._items.delete(id);
            }
        }
        this.visible = this._items.size > 0;
    }

    _restorePosition() {
        const monitor = Main.layoutManager.primaryMonitor;
        const x = this._settings.get_int('position-x');
        const y = this._settings.get_int('position-y');
        if (!this._config.rememberPosition || x < 0 || y < 0 || !monitor) {
            this.set_position(DEFAULT_POSITION.x, DEFAULT_POSITION.y);
            this._ly = DEFAULT_POSITION.y + this._padFor(this._weights);
            return;
        }
        const dock = this._settings.get_string('dock-state');
        this.dockState = dock;
        this.isDockedRight = dock === 'docked-right';
        this._weights = {...DOCK_WEIGHTS[dock]};
        this.set_position(x, y);
        this._ly = y + this._padFor(this._weights);
    }

    _savePosition(x, y) {
        if (!this._config.rememberPosition)
            return;
        this._settings.set_int('position-x', Math.round(x));
        this._settings.set_int('position-y', Math.round(y));
        this._settings.set_string('dock-state', this.dockState);
    }

    /** @param {number|null} lyTo icon column top to glide to; null keeps it where it is */
    _animateMorph(f, r, l, duration, lyTo = null) {
        this._morphFrom = {...this._weights};
        this._morphTo = {f, r, l};
        this._lyFrom = lyTo === null ? null : this._ly;
        this._lyTo = lyTo;
        this._morphAdj.remove_transition('value');
        this._morphAdj.value = 0;
        this._morphAdj.ease(1, {duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _onButtonPress(actor, event) {
        const button = event.get_button();
        if (button === 3) {
            this._popout.hide();
            this._onOpenPrefs();
            return Clutter.EVENT_STOP;
        }
        if (button !== 1)
            return Clutter.EVENT_PROPAGATE;

        if (this.dockState !== 'floating') {
            this.dockState = 'floating';
            this.isDockedRight = false;
            this._animateMorph(1.0, 0.0, 0.0, UNDOCK_DURATION);
        }

        this._popout.hide();
        const [x, y] = event.get_coords();
        this._dragStart = {x, y, actorX: this.x, actorY: this._ly};
        this.isDragging = true;
        return Clutter.EVENT_STOP;
    }

    _onMotion(actor, event) {
        if (!this.isDragging)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._ly = this._dragStart.actorY + y - this._dragStart.y;
        this.set_position(this._dragStart.actorX + x - this._dragStart.x, this._ly - this._padTop);
        return Clutter.EVENT_STOP;
    }

    _onButtonRelease() {
        if (!this.isDragging)
            return Clutter.EVENT_PROPAGATE;
        this.isDragging = false;
        this._snapToEdge(SNAP_DURATION);
        return Clutter.EVENT_STOP;
    }

    _snapToEdge(duration) {
        const monitor = Main.layoutManager.primaryMonitor;
        const threshold = this._config.snapThreshold;
        let snapX = this.x;
        const nearRight = this.x + this.width > monitor.x + monitor.width - threshold;
        const nearLeft = this.x < monitor.x + threshold;
        let dock = 'floating';

        if (nearRight) {
            snapX = monitor.x + monitor.width - this.width;
            dock = 'docked-right';
        } else if (nearLeft) {
            snapX = monitor.x;
            dock = 'docked-left';
        }
        this.dockState = dock;
        this.isDockedRight = dock === 'docked-right';

        // The padding (and so the height) changes with the dock state: clamp the
        // icon column against the height the notch will have, not the current one.
        const target = DOCK_WEIGHTS[dock];
        const padTarget = this._padFor(target);
        const tallness = pad => pad + Math.max(0, pad - this._metrics.itemPadBottom);
        const targetHeight = this.height - tallness(this._padTop) + tallness(padTarget);
        const minLy = monitor.y + padTarget;
        const maxLy = monitor.y + monitor.height - targetHeight + padTarget;
        const snapLy = Math.max(minLy, Math.min(maxLy, this._ly));

        if (duration > 0) {
            this.ease({x: snapX, duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            this._animateMorph(target.f, target.r, target.l, duration, snapLy);
        } else {
            this.x = snapX;
            this._ly = snapLy;
            this._weights = {...target};
            this._syncPadding();
            this._bgArea.queue_repaint();
        }
        // Save the target: this.x / this.y are still mid-animation here.
        this._savePosition(snapX, snapLy - padTarget);
    }
});
