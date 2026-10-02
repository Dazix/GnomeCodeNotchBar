import {parseUsage} from '../providers/claude.js';
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
