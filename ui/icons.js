import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

const FALLBACK = 'generic.svg';

/**
 * @param {Gio.File} extDir
 * @param {string} iconFile file name inside icons/
 * @returns {Gio.FileIcon}
 */
export function loadIcon(extDir, iconFile) {
    const dir = extDir.get_child('icons');
    let file = dir.get_child(iconFile);
    if (!file.query_exists(null))
        file = dir.get_child(FALLBACK);
    return new Gio.FileIcon({file});
}

const EFFECT_NAME = 'icon-contrast';

/** Full-colour logos that are shown as-is on any background. */
const COLOR_ICONS = new Set(['antigravity.svg']);

/**
 * The icon artwork is white. On a light background darken it to black so it
 * stays visible; on a dark one leave it alone. Full-colour icons are left alone.
 *
 * @param {St.Icon} icon
 * @param {boolean} dark true when the background is light (text is black)
 */
export function setIconContrast(icon, dark) {
    icon.remove_effect_by_name(EFFECT_NAME);
    if (!dark || COLOR_ICONS.has(icon.gicon?.file?.get_basename()))
        return;
    const effect = new Clutter.BrightnessContrastEffect();
    effect.set_brightness(-1);
    icon.add_effect_with_name(EFFECT_NAME, effect);
}
