import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {formatAge, formatReset} from '../lib/time.js';
import {colorForFraction, percent} from '../model/types.js';
import {loadIcon, setIconContrast} from './icons.js';
import {metrics as metricsFor} from './metrics.js';

const rgba = ({r, g, b}, alpha) =>
    `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;

/** Hover bubble: one bar row per limit window of the hovered agent. */
export const DetailPopout = GObject.registerClass(
class DetailPopout extends St.BoxLayout {
    _init(extDir, config) {
        super._init({vertical: true, visible: false});
        this._extDir = extDir;
        this._config = config;
        this._m = metricsFor(config.scale);
        /** Last shown percentage per provider/window, so bars grow from it. */
        this._lastPct = new Map();

        this._header = new St.BoxLayout();
        this._titleIcon = new St.Icon();
        this._titleLabel = new St.Label({x_expand: true});
        this._planLabel = new St.Label();
        this._header.add_child(this._titleIcon);
        this._header.add_child(this._titleLabel);
        this._header.add_child(this._planLabel);
        this.add_child(this._header);

        this._rows = new St.BoxLayout({vertical: true});
        this.add_child(this._rows);

        this._status = new St.Label();
        this._status.clutter_text.line_wrap = true;
        this.add_child(this._status);

        this._source = new St.Label();
        this._source.clutter_text.line_wrap = true;
        this.add_child(this._source);

        this.applyConfig(config);
    }

    /** @param {import('../lib/config.js').Config} config */
    applyConfig(config) {
        this._config = config;
        const m = this._m = metricsFor(config.scale);
        this.set_style(
            `background-color: ${rgba(config.backgroundColor, config.popoutOpacity)}; ` +
            `border-radius: ${m.popoutRadius}px; padding: ${m.popoutPad}px; width: ${m.popoutWidth}px; ` +
            `border: 1px solid ${config.palette.border}; box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.5);`);
        this._header.set_style(`margin-bottom: ${m.popoutPad}px;`);
        this._titleIcon.set_style(
            `width: ${m.popoutIcon}px; height: ${m.popoutIcon}px; margin-right: ${m.popoutIcon / 2}px;`);
        setIconContrast(this._titleIcon, config.palette.dark);
        this._titleLabel.set_style(
            `font-weight: bold; font-size: ${m.titleFontPt}pt; color: ${config.palette.primary};`);
        this._planLabel.set_style(`color: ${config.palette.secondary}; font-size: ${m.textFontPt}pt;`);
        this._status.set_style(`color: ${config.palette.warning}; font-size: ${m.textFontPt}pt;`);
        this._source.set_style(
            `color: ${config.palette.tertiary}; font-size: ${m.textFontPt}pt; margin-top: ${m.popoutPad / 2}px;`);
        this.hide();
    }

    /**
     * @param {Clutter.Actor} sourceActor
     * @param {import('../model/usageStore.js').ProviderState} state
     * @param {boolean} dockedRight
     */
    showFor(sourceActor, state, dockedRight) {
        const {provider, snapshot} = state;
        this._titleIcon.set_gicon(loadIcon(this._extDir, provider.iconFile));
        this._titleLabel.text = provider.displayName;
        this._planLabel.text = snapshot?.plan ?? '';

        this._rows.destroy_all_children();
        for (const window of snapshot?.windows ?? [])
            this._rows.add_child(this._buildRow(provider.id, window));

        let status = '';
        if (state.loading && !snapshot)
            status = 'Loading…';
        else if (state.error)
            status = snapshot ? `${state.error} · last reading ${formatAge(snapshot.fetchedAt)}` : state.error;
        this._status.text = status;
        this._status.visible = status !== '';

        const showSource = this._config.debugMode && snapshot?.source;
        this._source.text = showSource ? `Source: ${snapshot.source} · read ${formatAge(snapshot.fetchedAt)}` : '';
        this._source.visible = Boolean(showSource);

        const [sourceX, sourceY] = sourceActor.get_transformed_position();
        const gap = this._m.popoutPad - 1;
        const targetX = dockedRight ? sourceX - this.width - gap : sourceX + sourceActor.width + gap;
        this.set_position(targetX, sourceY - this.height / 2 + sourceActor.height / 2);
        this.show();
    }

    _buildRow(providerId, window) {
        const m = this._m;
        const {warnThreshold, criticalThreshold, palette} = this._config;
        const gap = Math.round(m.popoutPad * 0.4);
        const row = new St.BoxLayout({vertical: true});
        row.set_style(`margin-bottom: ${gap}px;`);

        const head = new St.BoxLayout({x_expand: true});
        head.set_style(`margin-bottom: ${gap}px;`);
        const label = new St.Label({text: window.label, x_expand: true});
        label.set_style(`color: ${palette.secondary}; font-size: ${m.textFontPt}pt;`);
        head.add_child(label);
        const reset = new St.Label({text: formatReset(window.resetsAt), x_align: Clutter.ActorAlign.END});
        reset.set_style(`color: ${palette.tertiary}; font-size: ${m.textFontPt}pt;`);
        head.add_child(reset);
        row.add_child(head);

        const pct = percent(window.usedFraction);
        const bg = new St.BoxLayout();
        bg.set_style(`height: ${m.barHeight}px; background-color: ${palette.track}; ` +
            `border-radius: ${m.barHeight / 2}px; margin-bottom: ${gap}px;`);
        const fill = new St.BoxLayout();
        const color = colorForFraction(window.usedFraction, warnThreshold, criticalThreshold).css;
        fill.set_style(`height: ${m.barHeight}px; border-radius: ${m.barHeight / 2}px; ` +
            `background-color: ${color};`);
        const targetWidth = Math.floor(pct / 100 * m.barWidth);
        const key = `${providerId}/${window.label}`;
        const previous = this._lastPct.get(key) ?? 0;
        this._lastPct.set(key, pct);
        fill.set_width(Math.floor(previous / 100 * m.barWidth));
        bg.add_child(fill);
        if (previous !== pct)
            fill.ease({width: targetWidth, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        else
            fill.set_width(targetWidth);
        row.add_child(bg);

        const pctLabel = new St.Label({text: `${pct}% Used`});
        pctLabel.set_style(`color: ${palette.secondary}; font-size: ${m.textFontPt}pt; margin-bottom: ${gap * 2}px;`);
        row.add_child(pctLabel);
        return row;
    }
});
