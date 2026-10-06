import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {expandHome} from './files.js';

const DEBOUNCE_MS = 200;

/**
 * Call `onChange` shortly after a file is written, created or replaced.
 *
 * The parent directory is watched, not the file: the file may not exist yet,
 * and a writer that renames a temp file over it would end a file monitor.
 * Bursts of events are collapsed into one call.
 *
 * @param {string} path
 * @param {() => void} onChange
 * @param {number} [debounceMs]
 * @returns {{cancel: () => void}|null} null when the directory cannot be watched
 */
export function watchFile(path, onChange, debounceMs = DEBOUNCE_MS) {
    const file = Gio.File.new_for_path(expandHome(path));
    const dir = file.get_parent();
    const name = file.get_basename();

    let monitor;
    try {
        GLib.mkdir_with_parents(dir.get_path(), 0o755);
        monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
    } catch (e) {
        console.error(`CodeNotchBar watch ${path}: ${e.message}`);
        return null;
    }

    let timerId = 0;
    const handler = monitor.connect('changed', (_monitor, changed, other, event) => {
        const hit = changed?.get_basename() === name || other?.get_basename() === name;
        const done = event === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
            event === Gio.FileMonitorEvent.CREATED ||
            event === Gio.FileMonitorEvent.MOVED_IN ||
            event === Gio.FileMonitorEvent.RENAMED;
        if (!hit || !done)
            return;
        if (timerId)
            GLib.source_remove(timerId);
        timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, debounceMs, () => {
            timerId = 0;
            onChange();
            return GLib.SOURCE_REMOVE;
        });
    });

    return {
        cancel() {
            if (timerId)
                GLib.source_remove(timerId);
            timerId = 0;
            monitor.disconnect(handler);
            monitor.cancel();
        },
    };
}
