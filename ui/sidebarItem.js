import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {colorForFraction, percent, weeklyWindow, windowForRing} from '../model/types.js';
import {CircularProgressWithIcon} from './circularProgress.js';
import {metrics as metricsFor} from './metrics.js';

const NEUTRAL = {r: 0.4, g: 0.4, b: 0.4};

/** One agent in the sidebar: ring, percentage, hover popout. */
export const SidebarItem = GObject.registerClass(
class SidebarItem extends St.Button {
    _init(state, popout, widget, extDir, config) {
        super._init({reactive: true, can_focus: true, track_hover: true, x_expand: true});
        this._popout = popout;
        this._widget = widget;
        this._config = config;
        this.state = state;

        this._box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        this._ring = new CircularProgressWithIcon(extDir, state.provider.iconFile, config);
        this._ring.x_align = Clutter.ActorAlign.CENTER;
        this._box.add_child(this._ring);

        this._label = new St.Label({x_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._label);
        this.set_child(this._box);

        this.connect('notify::hover', () => {
            if (this.hover && !this._widget.isDragging)
                this._popout.showFor(this, this.state, this._widget.isDockedRight);
            else
                this._popout.hide();
        });
        this.applyConfig(config);
        this.update(state);
    }

    /** @param {import('../lib/config.js').Config} config */
    applyConfig(config) {
        this._config = config;
        this._metrics = metricsFor(config.scale, config.compactMode);
        this._box.set_style(`padding-bottom: ${this._metrics.itemPadBottom}px;`);
        // Without a ring the percentage is the only reading, so it is always shown.
        this._label.visible = config.showPercentLabel || config.compactMode;
        this._ring.applyMetrics(this._metrics, config);
        this._styleLabel(config.palette.primary);
        if (this.state)
            this.update(this.state);
    }

    /** @param {string} color CSS colour of the percentage */
    _styleLabel(color) {
        const m = this._metrics;
        this._label.set_style(`color: ${color}; font-weight: bold; text-align: center; ` +
            `font-size: ${m.labelFontPt}pt; margin-top: ${m.labelMarginTop}px;`);
    }

    /** @param {import('../model/usageStore.js').ProviderState} state */
    update(state) {
        this.state = state;
        const {warnThreshold, criticalThreshold, ringWindow} = this._config;
        const window = state.snapshot ? windowForRing(state.snapshot, ringWindow) : null;
        const loading = Boolean(state.loading) && !window;
        this._ring.setLoading(loading);
        if (loading) {
            this._label.text = '…';
        } else if (window) {
            const color = colorForFraction(window.usedFraction, warnThreshold, criticalThreshold);
            // Inner ring only when it adds information: not when the main ring is already weekly.
            const weekly = this._config.showWeeklyRing && !this._config.compactMode
                ? weeklyWindow(state.snapshot)
                : null;
            const inner = weekly && weekly !== window
                ? {
                    fraction: weekly.usedFraction,
                    color: colorForFraction(weekly.usedFraction, warnThreshold, criticalThreshold).rgb,
                }
                : null;
            this._ring.setProgress(window.usedFraction, color.rgb, inner);
            this._label.text = `${percent(window.usedFraction)}%`;
            // The ring colour is gone in compact mode: carry the thresholds on the text.
            this._styleLabel(this._config.compactMode ? color.css : this._config.palette.primary);
        } else {
            this._ring.setProgress(null, NEUTRAL);
            this._label.text = '–';
            this._styleLabel(this._config.palette.primary);
        }
        this.opacity = state.stale ? 128 : 255;

        // The popout is built once on hover: redraw it so it follows the ring.
        if (this.hover && this._popout.visible && !this._widget.isDragging)
            this._popout.showFor(this, state, this._widget.isDockedRight);
    }
});
