import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish');

/**
 * Run a command and capture its stdout without blocking the main loop.
 *
 * @param {string[]} argv
 * @param {number} [timeoutSeconds]
 * @param {string|null} [cwd] working directory for the child
 * @param {Object<string, string|null>} [env] variables to set for the child; null unsets
 * @returns {Promise<string|null>} trimmed stdout, or null on any failure
 */
export async function run(argv, timeoutSeconds = 10, cwd = null, env = {}) {
    if (!GLib.find_program_in_path(argv[0]) && !GLib.file_test(argv[0], GLib.FileTest.IS_EXECUTABLE))
        return null;

    let proc;
    try {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        if (cwd)
            launcher.set_cwd(cwd);
        for (const [key, value] of Object.entries(env)) {
            if (value === null)
                launcher.unsetenv(key);
            else
                launcher.setenv(key, value, true);
        }
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
 * Like `run`, but stdout and stderr are read together line by line and the
 * child is killed as soon as a line matches `stopPattern`.
 *
 * @param {string[]} argv
 * @param {number} timeoutSeconds
 * @param {string|null} cwd
 * @param {Object<string, string|null>} env variables to set for the child; null unsets
 * @param {RegExp} stopPattern
 * @returns {Promise<{output: string, stopped: boolean}|null>} null when it
 *     could not run, failed or timed out without matching
 */
export async function runUntilMatch(argv, timeoutSeconds, cwd, env, stopPattern) {
    if (!GLib.find_program_in_path(argv[0]) && !GLib.file_test(argv[0], GLib.FileTest.IS_EXECUTABLE))
        return null;

    let proc;
    try {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
        });
        if (cwd)
            launcher.set_cwd(cwd);
        for (const [key, value] of Object.entries(env)) {
            if (value === null)
                launcher.unsetenv(key);
            else
                launcher.setenv(key, value, true);
        }
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

    const stream = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()});
    const lines = [];
    try {
        for (;;) {
            const [line] = await stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
            if (line === null)
                break;
            const text = new TextDecoder().decode(line);
            lines.push(text);
            if (stopPattern.test(text)) {
                proc.force_exit();
                return {output: lines.join('\n'), stopped: true};
            }
        }
        await proc.wait_async(cancellable);
        if (!proc.get_successful())
            return null;
        return {output: lines.join('\n').trim(), stopped: false};
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
