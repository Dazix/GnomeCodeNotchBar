import {ErrorKind, Provider, UsageError} from '../providers/provider.js';
import {colorForFraction, headlineWindow, percent, weeklyWindow, windowForRing} from '../model/types.js';
import {assertEqual, assertTrue, test} from './harness.js';

const win = (id, usedFraction = 0) => ({id, label: id, usedFraction, resetsAt: null});
const snap = (windows, headlineId = 'session') => ({
    id: 'x', displayName: 'X', windows, headlineId, plan: null, fetchedAt: new Date(0),
});

test('percent: rounds and clamps', () => {
    assertEqual(percent(0.336), 34);
    assertEqual(percent(-1), 0);
    assertEqual(percent(3), 100);
});

test('colorForFraction: green / amber / red thresholds', () => {
    assertEqual(colorForFraction(0.1).css, '#26b873');
    assertEqual(colorForFraction(0.7).css, '#e6a61a');
    assertEqual(colorForFraction(0.9).css, '#db3d33');
    assertEqual(colorForFraction(0.5, 0.4, 0.6).css, '#e6a61a');
});

test('headlineWindow: picks headline, falls back to first, else null', () => {
    assertEqual(headlineWindow(snap([win('a'), win('session')])).id, 'session');
    assertEqual(headlineWindow(snap([win('a')])).id, 'a');
    assertEqual(headlineWindow(snap([])), null);
});

test('windowForRing: headline mode ignores weekly', () => {
    assertEqual(windowForRing(snap([win('session'), win('weekly_all')]), 'headline').id, 'session');
});

test('windowForRing: weekly mode prefers weekly_all, then secondary, then *week*', () => {
    assertEqual(windowForRing(snap([win('session'), win('secondary'), win('weekly_all')]), 'weekly').id, 'weekly_all');
    assertEqual(windowForRing(snap([win('session'), win('secondary')]), 'weekly').id, 'secondary');
    assertEqual(windowForRing(snap([win('session'), win('per_week')]), 'weekly').id, 'per_week');
});

test('windowForRing: weekly mode falls back to headline', () => {
    assertEqual(windowForRing(snap([win('session')]), 'weekly').id, 'session');
});

test('weeklyWindow: finds the weekly window or null', () => {
    assertEqual(weeklyWindow(snap([win('session'), win('weekly_all')])).id, 'weekly_all');
    assertEqual(weeklyWindow(snap([win('session')])), null);
});

test('UsageError: carries kind, message and retryAfter', () => {
    const e = new UsageError(ErrorKind.RATE_LIMITED, 'slow down', 30);
    assertTrue(e instanceof Error);
    assertEqual([e.name, e.kind, e.message, e.retryAfter], ['UsageError', 'rate-limited', 'slow down', 30]);
});

test('Provider: defaults', async () => {
    const p = new Provider({id: 'p', displayName: 'P', iconFile: 'p.svg', signIn: 'log in'});
    assertEqual([p.id, p.displayName, p.iconFile, p.signIn], ['p', 'P', 'p.svg', 'log in']);
    assertEqual(await p.isAvailable(), true);
    let threw = false;
    try {
        await p.fetchSnapshot(null);
    } catch (_e) {
        threw = true;
    }
    assertTrue(threw, 'base fetchSnapshot must throw');
});
