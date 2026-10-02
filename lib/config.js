/**
 * @typedef {object} Config
 * @property {number} scale
 * @property {number} backgroundOpacity
 * @property {{r:number,g:number,b:number}} backgroundColor  0..1 channels
 * @property {ReturnType<typeof textPalette>} palette  readable text colours for backgroundColor
 * @property {number} popoutOpacity
 * @property {boolean} showPercentLabel
 * @property {'headline'|'weekly'} ringWindow
 * @property {number} warnThreshold
 * @property {number} criticalThreshold
 * @property {number} pollInterval  seconds
 * @property {Object<string,number>} providerPollIntervals  seconds per provider id; missing = pollInterval
 * @property {number} snapThreshold px
 * @property {boolean} rememberPosition
 * @property {string[]} enabledProviders  empty = all detected
 * @property {string[]} providerOrder
 */

import {textPalette} from './contrast.js';

const FALLBACK_COLOR = {r: 0.05, g: 0.05, b: 0.05};

/**
 * Parse `#rrggbb` (or `#rgb`) into 0..1 channels.
 *
 * @param {string} hex
 * @returns {{r:number,g:number,b:number}}
 */
export function parseHexColor(hex) {
    let digits = String(hex).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(digits))
        digits = [...digits].map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(digits))
        return {...FALLBACK_COLOR};
    return {
        r: parseInt(digits.slice(0, 2), 16) / 255,
        g: parseInt(digits.slice(2, 4), 16) / 255,
        b: parseInt(digits.slice(4, 6), 16) / 255,
    };
}

/**
 * Snapshot of all settings as a plain object, so UI code never touches
 * Gio.Settings directly.
 *
 * @param {import('gi://Gio').Settings} settings
 * @returns {Config}
 */
export function readConfig(settings) {
    const warn = settings.get_double('warn-threshold');
    const critical = settings.get_double('critical-threshold');
    const backgroundColor = parseHexColor(settings.get_string('background-color'));
    return {
        scale: settings.get_double('scale'),
        backgroundOpacity: settings.get_double('background-opacity'),
        backgroundColor,
        palette: textPalette(backgroundColor),
        popoutOpacity: settings.get_double('popout-opacity'),
        showPercentLabel: settings.get_boolean('show-percent-label'),
        ringWindow: settings.get_string('ring-window'),
        // The pair must stay ordered even if a user edits dconf by hand.
        warnThreshold: Math.min(warn, critical),
        criticalThreshold: Math.max(warn, critical),
        pollInterval: settings.get_int('poll-interval'),
        providerPollIntervals: settings.get_value('provider-poll-intervals').deepUnpack(),
        snapThreshold: settings.get_int('snap-threshold'),
        rememberPosition: settings.get_boolean('remember-position'),
        enabledProviders: settings.get_strv('enabled-providers'),
        providerOrder: settings.get_strv('provider-order'),
    };
}
