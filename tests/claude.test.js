import {mergeWindows, parseHookFile, parseUsage} from '../providers/claude.js';
import {assertEqual, test} from './harness.js';

const WEEK = {utilization: 69, resets_at: '2026-10-03T00:00:00Z'};

test('claude: idle session without reset time is kept', () => {
    const w = parseUsage({five_hour: {utilization: 0, resets_at: null}, seven_day: WEEK});
    assertEqual(w.map(x => x.id), ['session', 'weekly_all']);
    assertEqual(w[0].usedFraction, 0);
    assertEqual(w[0].resetsAt, null);
});

test('claude: idle limits[] entry without reset time is kept', () => {
    const w = parseUsage({limits: [{kind: 'session', percent: 0, resets_at: null}]});
    assertEqual(w.map(x => x.id), ['session']);
});

test('claude: missing session window is not invented', () => {
    assertEqual(parseUsage({five_hour: null, seven_day: WEEK}).map(x => x.id), ['weekly_all']);
});

test('claude: mod file maps five_hour and seven_day to windows', () => {
    const r = parseHookFile({
        fetchedAt: '2026-10-05T12:00:00Z',
        windows: [
            {kind: 'seven_day', percentUsed: 63, resetsAt: '2026-10-06T00:00:00Z'},
            {kind: 'five_hour', percentUsed: 3, resetsAt: null},
            {kind: 'spend_limit', percentUsed: 10},
        ],
    });
    assertEqual(r.windows.map(x => x.id), ['session', 'weekly_all']);
    assertEqual(r.windows[1].usedFraction, 0.63);
});

test('claude: mod file without readings is ignored', () => {
    assertEqual(parseHookFile(null), null);
    assertEqual(parseHookFile({fetchedAt: '2026-10-05T12:00:00Z', windows: []}), null);
    assertEqual(parseHookFile({windows: [{kind: 'five_hour', percentUsed: 1}]}), null);
});

const NOW = Date.parse('2026-10-05T12:00:00Z');
const win = (id, used, resets) => ({id, label: id, usedFraction: used, resetsAt: resets ? new Date(resets) : null});

test('claude: merge keeps the higher usage of the same window', () => {
    const reset = '2026-10-05T15:00:00Z';
    const apiLow = mergeWindows([win('session', 0.4, reset)], [win('session', 0.3, reset)], NOW);
    assertEqual(apiLow[0].usedFraction, 0.4);
    const apiHigh = mergeWindows([win('session', 0.3, reset)], [win('session', 0.4, reset)], NOW);
    assertEqual(apiHigh[0].usedFraction, 0.4);
});

test('claude: merge lets a later window win even with lower usage', () => {
    const w = mergeWindows(
        [win('session', 0.9, '2026-10-05T13:00:00Z')],
        [win('session', 0.1, '2026-10-05T18:00:00Z')], NOW);
    assertEqual(w[0].usedFraction, 0.1);
    const kept = mergeWindows(
        [win('session', 0.1, '2026-10-05T18:00:00Z')],
        [win('session', 0.9, '2026-10-05T13:00:00Z')], NOW);
    assertEqual(kept[0].usedFraction, 0.1);
});

test('claude: merge replaces an expired or reset-less window', () => {
    assertEqual(mergeWindows([win('session', 0.9, '2026-10-05T11:00:00Z')], [win('session', 0.1, '2026-10-05T16:00:00Z')], NOW)[0].usedFraction, 0.1);
    assertEqual(mergeWindows([win('session', 0.9, null)], [win('session', 0.1, '2026-10-05T16:00:00Z')], NOW)[0].usedFraction, 0.1);
    assertEqual(mergeWindows([win('session', 0.9, '2026-10-05T16:00:00Z')], [win('session', 0.1, null)], NOW)[0].usedFraction, 0.9);
});

test('claude: merge keeps windows only one source knows', () => {
    const w = mergeWindows(
        [win('weekly_all', 0.5, '2026-10-08T00:00:00Z')],
        [win('session', 0.2, '2026-10-05T15:00:00Z')], NOW);
    assertEqual(w.map(x => x.id), ['session', 'weekly_all']);
});
