/** @typedef {{r:number,g:number,b:number}} Rgb  channels 0..1 */

const WHITE = {r: 1, g: 1, b: 1};
const BLACK = {r: 0, g: 0, b: 0};
const MIN_TEXT_RATIO = 4.5;

const linear = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance. @param {Rgb} c */
export function luminance(c) {
    return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** WCAG contrast ratio, 1..21. @param {Rgb} a @param {Rgb} b */
export function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** @param {Rgb} from @param {Rgb} to @param {number} t 0..1 */
function mix(from, to, t) {
    return {
        r: from.r + (to.r - from.r) * t,
        g: from.g + (to.g - from.g) * t,
        b: from.b + (to.b - from.b) * t,
    };
}

/**
 * Move `color` toward `target` until it reaches `minRatio` against `bg`
 * (or `target` itself if that is as far as it can go).
 */
function ensureContrast(color, bg, target, minRatio) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
        const candidate = mix(color, target, t);
        if (contrastRatio(candidate, bg) >= minRatio)
            return candidate;
    }
    return target;
}

/** @param {Rgb} c @returns {string} CSS `rgb(...)` */
export function css(c) {
    const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgb(${h(c.r)}, ${h(c.g)}, ${h(c.b)})`;
}

/**
 * Text and chrome colours that stay readable on a user-chosen background.
 * Picks black or white as the primary text, whichever contrasts more, then
 * derives quieter tones that still meet WCAG AA (4.5:1) for text.
 *
 * @param {Rgb} bg
 */
export function textPalette(bg) {
    const primary = contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? WHITE : BLACK;
    const inverse = primary === WHITE ? BLACK : WHITE;
    // Quieter tones: blend toward the background, then pull back until legible.
    const quiet = (amount) => ensureContrast(mix(primary, bg, amount), bg, primary, MIN_TEXT_RATIO);
    return {
        // True when the text is black, i.e. the background is light. Icons are
        // white artwork and must be darkened to match.
        dark: primary === BLACK,
        primary: css(primary),
        secondary: css(quiet(0.35)),
        tertiary: css(quiet(0.5)),
        // A warm accent for status text, darkened / lightened until legible.
        warning: css(ensureContrast({r: 0.90, g: 0.65, b: 0.10}, bg, primary, MIN_TEXT_RATIO)),
        // Bar track and hairlines: a faint tint of the text colour.
        track: css(mix(bg, primary, 0.18)),
        border: `rgba(${Math.round(primary.r * 255)}, ${Math.round(primary.g * 255)}, ${Math.round(primary.b * 255)}, 0.15)`,
        inverse: css(inverse),
    };
}
