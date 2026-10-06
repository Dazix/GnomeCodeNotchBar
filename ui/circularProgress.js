import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Cairo from 'cairo';

import {loadIcon, setIconContrast} from './icons.js';
import {metrics as metricsFor} from './metrics.js';

const ANIMATION_MS = 500;
const easeOutCubic = t => 1 - Math.pow(1 - Math.min(1, t), 3);

/** Ring showing a used fraction, with the agent's icon in the middle. */
export const CircularProgressWithIcon = GObject.registerClass(
class CircularProgressWithIcon extends St.Widget {
    _init(extDir, iconFile, config) {
        super._init({layout_manager: new Clutter.BinLayout()});
        this._fraction = 0;
        this._color = {r: 0.5, g: 0.5, b: 0.5};
        this._metrics = metricsFor(config.scale);
        this._track = {r: 0.2, g: 0.2, b: 0.2};
        this._spin = {r: 0.6, g: 0.6, b: 0.6};
        this._weeklyFraction = 0;
        this._weeklyColor = {r: 0.5, g: 0.5, b: 0.5};
        this._hasWeekly = false;
        this._loading = false;
        this._angle = -Math.PI / 2;
        this._spinTimer = 0;

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
        this.connect('destroy', () => this._stopAnimation());
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
        const strong = c => c + (fg - c) * 0.6;
        this._spin = {r: strong(bg.r), g: strong(bg.g), b: strong(bg.b)};
        this.set_size(metrics.ringSize, metrics.ringSize);
        this._icon.set_style(`width: ${metrics.iconSize}px; height: ${metrics.iconSize}px;`);
        setIconContrast(this._icon, config.palette.dark);
        this._area.queue_repaint();
    }

    /**
     * @param {number|null} fraction 0..1, null when there is no reading
     * @param {{r:number,g:number,b:number}} color
     * @param {{fraction: number, color: {r:number,g:number,b:number}}|null} [weekly]
     *     drawn as a thinner ring inside the main one; null hides it
     */
    setProgress(fraction, color, weekly = null) {
        const clamp = f => Math.max(0, Math.min(1, f));
        const target = fraction === null ? 0 : clamp(fraction);
        const weeklyTarget = weekly ? clamp(weekly.fraction) : 0;
        const weeklyColor = weekly?.color ?? this._weeklyColor;
        const sameColor = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;
        const hasWeekly = weekly !== null;
        if (target === this._targetFraction && sameColor(color, this._targetColor) &&
            weeklyTarget === this._targetWeekly && sameColor(weeklyColor, this._targetWeeklyColor) &&
            hasWeekly === this._hasWeekly)
            return;
        this._targetFraction = target;
        this._targetColor = color;
        this._targetWeekly = weeklyTarget;
        this._targetWeeklyColor = weeklyColor;
        this._hasWeekly = hasWeekly;

        this._stopAnimation();
        const fromFraction = this._fraction;
        const fromColor = this._color;
        const fromWeekly = this._weeklyFraction;
        const fromWeeklyColor = this._weeklyColor;
        const mix = (a, b, t) => ({
            r: a.r + (b.r - a.r) * t,
            g: a.g + (b.g - a.g) * t,
            b: a.b + (b.b - a.b) * t,
        });

        this._timeline = new Clutter.Timeline({actor: this, duration: ANIMATION_MS});
        this._timeline.connect('new-frame', (tl, ms) => {
            const t = easeOutCubic(ms / ANIMATION_MS);
            this._fraction = fromFraction + (target - fromFraction) * t;
            this._color = mix(fromColor, color, t);
            this._weeklyFraction = fromWeekly + (weeklyTarget - fromWeekly) * t;
            this._weeklyColor = mix(fromWeeklyColor, weeklyColor, t);
            this._area.queue_repaint();
        });
        this._timeline.connect('completed', () => {
            this._fraction = target;
            this._color = color;
            this._weeklyFraction = weeklyTarget;
            this._weeklyColor = weeklyColor;
            this._area.queue_repaint();
            this._stopAnimation();
        });
        this._timeline.start();
    }

    _stopAnimation() {
        if (!this._timeline)
            return;
        this._timeline.stop();
        this._timeline = null;
    }

    /**
     * Spin a short arc around the ring while the first reading is on its way.
     *
     * @param {boolean} on
     */
    setLoading(on) {
        if (on === this._loading)
            return;
        this._loading = on;
        this._icon.opacity = on ? 140 : 255;
        if (on) {
            this._spinTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                this._angle = (this._angle + 0.2) % (2 * Math.PI);
                this._area.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            this._stopSpin();
        }
        this._area.queue_repaint();
    }

    _stopSpin() {
        if (this._spinTimer) {
            GLib.source_remove(this._spinTimer);
            this._spinTimer = 0;
        }
    }

    vfunc_destroy() {
        this._stopSpin();
        super.vfunc_destroy();
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

            if (this._loading) {
                const s = this._spin;
                cr.setSourceRGBA(s.r, s.g, s.b, 1.0);
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.arc(cx, cy, radius, this._angle, this._angle + Math.PI / 2);
                cr.stroke();
            } else if (this._fraction > 0) {
                const start = -Math.PI / 2;
                cr.setSourceRGBA(this._color.r, this._color.g, this._color.b, 1.0);
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.arc(cx, cy, radius, start, start + this._fraction * 2 * Math.PI);
                cr.stroke();
            }

            if (this._hasWeekly && !this._loading) {
                // Thinner and fainter ring touching the main one, weekly limit; filled part only.
                const inner = Math.max(1.5, line / 2);
                const gap = Math.max(0.5, line * 0.1);
                const innerRadius = radius - line / 2 - gap - inner / 2;
                cr.setLineWidth(inner);
                if (this._weeklyFraction > 0) {
                    const start = -Math.PI / 2;
                    const c = this._weeklyColor;
                    cr.setSourceRGBA(c.r, c.g, c.b, 0.65);
                    cr.setLineCap(Cairo.LineCap.ROUND);
                    cr.arc(cx, cy, innerRadius, start, start + this._weeklyFraction * 2 * Math.PI);
                    cr.stroke();
                }
            }
        } finally {
            cr.$dispose();
        }
    }
});
