import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Cairo from 'cairo';

import {loadIcon, setIconContrast} from './icons.js';
import {metrics as metricsFor} from './metrics.js';

/** Ring showing a used fraction, with the agent's icon in the middle. */
export const CircularProgressWithIcon = GObject.registerClass(
class CircularProgressWithIcon extends St.Widget {
    _init(extDir, iconFile, config) {
        super._init({layout_manager: new Clutter.BinLayout()});
        this._fraction = 0;
        this._color = {r: 0.5, g: 0.5, b: 0.5};
        this._metrics = metricsFor(config.scale);
        this._track = {r: 0.2, g: 0.2, b: 0.2};

        this._area = new St.DrawingArea({
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL,
        });
        this._area.connect('repaint', this._onRepaint.bind(this));
        this.add_child(this._area);

        this._icon = new St.Icon({
            gicon: loadIcon(extDir, iconFile),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
        });
        this.add_child(this._icon);
        this.applyMetrics(this._metrics, config);
    }

    /**
     * @param {ReturnType<typeof metricsFor>} metrics
     * @param {import('../lib/config.js').Config} config
     */
    applyMetrics(metrics, config) {
        this._metrics = metrics;
        // Empty ring track: a faint tint of the text colour over the background.
        const fg = config.palette.dark ? 0 : 1;
        const bg = config.backgroundColor;
        const mix = c => c + (fg - c) * 0.2;
        this._track = {r: mix(bg.r), g: mix(bg.g), b: mix(bg.b)};
        this.set_size(metrics.ringSize, metrics.ringSize);
        this._icon.set_style(`width: ${metrics.iconSize}px; height: ${metrics.iconSize}px;`);
        setIconContrast(this._icon, config.palette.dark);
        this._area.queue_repaint();
    }

    /**
     * @param {number|null} fraction 0..1, null when there is no reading
     * @param {{r:number,g:number,b:number}} color
     */
    setProgress(fraction, color) {
        this._fraction = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
        this._color = color;
        this._area.queue_repaint();
    }

    _onRepaint(area) {
        const cr = area.get_context();
        try {
            const line = this._metrics.ringLine;
            const [w, h] = area.get_surface_size();
            const cx = w / 2;
            const cy = h / 2;
            const radius = Math.min(w, h) / 2 - line;

            cr.setLineWidth(line);
            cr.setSourceRGBA(this._track.r, this._track.g, this._track.b, 1.0);
            cr.arc(cx, cy, radius, 0, 2 * Math.PI);
            cr.stroke();

            if (this._fraction > 0) {
                const start = -Math.PI / 2;
                cr.setSourceRGBA(this._color.r, this._color.g, this._color.b, 1.0);
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.arc(cx, cy, radius, start, start + this._fraction * 2 * Math.PI);
                cr.stroke();
            }
        } finally {
            cr.$dispose();
        }
    }
});
