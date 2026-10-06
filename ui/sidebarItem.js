import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {colorForFraction, percent, windowForRing} from '../model/types.js';
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
        const m = metricsFor(config.scale);
        this._box.set_style(`padding-bottom: ${m.itemPadBottom}px;`);
        this._label.set_style(`color: ${config.palette.primary}; font-weight: bold; text-align: center; ` +
            `font-size: ${m.labelFontPt}pt; margin-top: ${m.labelMarginTop}px;`);
        this._label.visible = config.showPercentLabel;
        this._ring.applyMetrics(m, config);
        if (this.state)
            this.update(this.state);
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
            this._ring.setProgress(window.usedFraction, color.rgb);
            this._label.text = `${percent(window.usedFraction)}%`;
        } else {
            this._ring.setProgress(null, NEUTRAL);
            this._label.text = '–';
        }
        this.opacity = state.stale ? 128 : 255;

        // The popout is built once on hover: redraw it so it follows the ring.
        if (this.hover && this._popout.visible && !this._widget.isDragging)
            this._popout.showFor(this, state, this._widget.isDockedRight);
    }
});
