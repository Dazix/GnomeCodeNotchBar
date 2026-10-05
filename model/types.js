/**
 * @typedef {object} LimitWindow
 * @property {string} id            stable key, e.g. "session", "weekly_all"
 * @property {string} label         display name
 * @property {number} usedFraction  0..1 (may exceed 1)
 * @property {Date|null} resetsAt
 */

/**
 * @typedef {object} Snapshot
 * @property {string} id            provider id
 * @property {string} displayName
 * @property {LimitWindow[]} windows
 * @property {string} headlineId    window shown in the ring
 * @property {string|null} plan
 * @property {Date} fetchedAt
 * @property {string} [source]    where the reading came from, shown in debug mode
 */

/**
 * Ring colour by used fraction: green / amber / red.
 *
 * @param {number} fraction
 * @param {number} [warn] fraction where amber starts
 * @param {number} [critical] fraction where red starts
 */
export function colorForFraction(fraction, warn = 0.7, critical = 0.9) {
    if (fraction >= critical)
        return {rgb: {r: 0.86, g: 0.24, b: 0.20}, css: '#db3d33'};
    if (fraction >= warn)
        return {rgb: {r: 0.90, g: 0.65, b: 0.10}, css: '#e6a61a'};
    return {rgb: {r: 0.15, g: 0.72, b: 0.45}, css: '#26b873'};
}

/**
 * The window that fills the ring: the headline one, or the weekly one when
 * the user asked for it (falls back to the headline if none is weekly).
 *
 * @param {Snapshot} snapshot
 * @param {'headline'|'weekly'} mode
 * @returns {LimitWindow|null}
 */
export function windowForRing(snapshot, mode) {
    if (mode === 'weekly') {
        const weekly = snapshot.windows.find(w => w.id === 'weekly_all') ??
            snapshot.windows.find(w => w.id === 'secondary') ??
            snapshot.windows.find(w => w.id.includes('week'));
        if (weekly)
            return weekly;
    }
    return headlineWindow(snapshot);
}

/**
 * @param {Snapshot} snapshot
 * @returns {LimitWindow|null}
 */
export function headlineWindow(snapshot) {
    return snapshot.windows.find(w => w.id === snapshot.headlineId) ?? snapshot.windows[0] ?? null;
}

/** @param {number} fraction @returns {number} whole percent, clamped 0..100 */
export function percent(fraction) {
    return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}
