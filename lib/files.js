import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

const decoder = new TextDecoder('utf-8');

/**
 * Expand a leading `~` to the user's home directory.
 *
 * @param {string} path
 * @returns {string}
 */
export function expandHome(path) {
    if (path === '~' || path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(1)]);
    return path;
}

/**
 * Read a file as UTF-8 text without blocking the main loop.
 *
 * @param {string} path
 * @returns {Promise<string|null>} null when the file is missing or unreadable
 */
export async function readText(path) {
    const file = Gio.File.new_for_path(expandHome(path));
    try {
        const [bytes] = await file.load_contents_async(null);
        return decoder.decode(bytes);
    } catch (_e) {
        return null;
    }
}

/**
 * Read and parse a JSON file.
 *
 * @param {string} path
 * @returns {Promise<any|null>} null when missing or not valid JSON
 */
export async function readJson(path) {
    const text = await readText(path);
    if (text === null)
        return null;
    try {
        return JSON.parse(text);
    } catch (_e) {
        return null;
    }
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function exists(path) {
    return GLib.file_test(expandHome(path), GLib.FileTest.EXISTS);
}
