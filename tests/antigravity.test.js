import {parseUsage, sanitize} from '../providers/antigravity.js';
import {assertEqual, assertTrue, test} from './harness.js';

const TABBED = 'Gemini Models\tWeekly Limit Remaining\t94%\t2026-10-09T06:16:08Z\n' +
    'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-09T06:16:08Z\n';
const HEADED = 'Quota:\nGemini Models Five Hour Limit Remaining 78% 2026-09-10T06:12:31Z\n' +
    'Gemini Models Weekly Limit Remaining 94% 2026-09-12T01:47:23Z\n';

function throwsKind(text) {
    try {
        parseUsage(text);
    } catch (e) {
        return e.kind;
    }
    return null;
}

test('antigravity: parses the tab separated report', () => {
    const w = parseUsage(TABBED);
    assertEqual(w.map(x => x.id), ['gemini_models_weekly', 'claude_and_gpt_models_weekly']);
    assertEqual(w.map(x => x.label), ['Gemini · Weekly', 'Claude/GPT · Weekly']);
    assertTrue(Math.abs(w[0].usedFraction - 0.06) < 1e-9);
    assertEqual(w[1].usedFraction, 0);
    assertEqual(w[0].resetsAt.toISOString(), '2026-10-09T06:16:08.000Z');
});

test('antigravity: parses the headed space separated report', () => {
    const w = parseUsage(HEADED);
    assertEqual(w.map(x => x.label), ['Gemini · 5h', 'Gemini · Weekly']);
    assertTrue(Math.abs(w[0].usedFraction - 0.22) < 1e-9);
});

test('antigravity: strips terminal escapes and CRLF', () => {
    const raw = '\x1b[?25h\x1b[32mQuota:\x1b[0m\r\n' + HEADED.split('\n')[1] + '\r\n';
    assertEqual(sanitize(raw), 'Quota:\n' + HEADED.split('\n')[1] + '\n');
    assertEqual(parseUsage(raw).length, 1);
});

test('antigravity: rejects bad readings instead of inventing zeros', () => {
    for (const bad of ['', 'authentication required', 'Quota:\nunknown',
        TABBED.replace('94%', '101%'), TABBED.replace('94%', '-5%'),
        TABBED.replace('94%', 'NaN%'), TABBED.replace('2026-10-09T06:16:08Z', 'not-a-date')])
        assertEqual(throwsKind(bad), 'bad-response');
});
