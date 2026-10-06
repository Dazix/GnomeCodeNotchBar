import GLib from 'gi://GLib';

import {watchFile} from '../lib/watch.js';
import {ClaudeProvider} from '../providers/claude.js';
import {Provider} from '../providers/provider.js';
import {assertEqual, assertTrue, test} from './harness.js';

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

function tempDir() {
    return GLib.dir_make_tmp('notchbar-watch-XXXXXX');
}

test('watchFile: fires once for a burst of writes', async () => {
    const dir = tempDir();
    const path = `${dir}/limits.json`;
    let calls = 0;
    const watcher = watchFile(path, () => calls++, 50);
    try {
        GLib.file_set_contents(path, '1');
        GLib.file_set_contents(path, '2');
        await sleep(400);
        assertEqual(calls, 1);
    } finally {
        watcher.cancel();
    }
});

test('watchFile: sees a file that did not exist and a directory that was missing', async () => {
    const path = `${tempDir()}/nested/limits.json`;
    let calls = 0;
    const watcher = watchFile(path, () => calls++, 50);
    try {
        GLib.file_set_contents(path, '{}');
        await sleep(400);
        assertEqual(calls, 1);
    } finally {
        watcher.cancel();
    }
});

test('watchFile: ignores other files in the directory', async () => {
    const dir = tempDir();
    let calls = 0;
    const watcher = watchFile(`${dir}/limits.json`, () => calls++, 50);
    try {
        GLib.file_set_contents(`${dir}/other.json`, '{}');
        await sleep(300);
        assertEqual(calls, 0);
    } finally {
        watcher.cancel();
    }
});

test('watchFile: cancel stops further calls', async () => {
    const dir = tempDir();
    const path = `${dir}/limits.json`;
    let calls = 0;
    watchFile(path, () => calls++, 50).cancel();
    GLib.file_set_contents(path, '1');
    await sleep(300);
    assertEqual(calls, 0);
});

test('providers: only Claude watches a file, and the one the mod writes', () => {
    const base = new Provider({id: 'p', displayName: 'P', iconFile: 'p.svg', signIn: ''});
    assertEqual(base.watchedFiles(), []);
    const files = new ClaudeProvider().watchedFiles();
    assertEqual(files.length, 1);
    assertTrue(files[0].endsWith('code-notch-bar/claude-rate-limits.json'));
});
