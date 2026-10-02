import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

/**
 * Run a command and capture its stdout without blocking the main loop.
 *
 * @param {string[]} argv
 * @param {number} [timeoutSeconds]
 * @param {string|null} [cwd] working directory for the child
 * @returns {Promise<string|null>} trimmed stdout, or null on any failure
 */
export async function run(argv, timeoutSeconds = 10, cwd = null) {
    if (!GLib.find_program_in_path(argv[0]) && !GLib.file_test(argv[0], GLib.FileTest.IS_EXECUTABLE))
        return null;

    let proc;
    try {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        if (cwd)
            launcher.set_cwd(cwd);
        proc = launcher.spawnv(argv);
    } catch (_e) {
        return null;
    }

    const cancellable = new Gio.Cancellable();
    const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
        cancellable.cancel();
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });

    try {
        // The GJS promise resolves with [stdout, stderr]; the boolean is dropped.
        const [stdout] = await proc.communicate_utf8_async(null, cancellable);
        if (!proc.get_successful() || stdout === null)
            return null;
        return stdout.trim();
    } catch (_e) {
        return null;
    } finally {
        GLib.source_remove(timer);
    }
}

/**
 * @param {string} program
 * @returns {boolean}
 */
export function hasProgram(program) {
    return GLib.find_program_in_path(program) !== null;
}
