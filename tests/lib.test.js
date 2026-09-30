import GLib from 'gi://GLib';

import {backoffSeconds} from '../lib/backoff.js';
import {contrastRatio, css, luminance, textPalette} from '../lib/contrast.js';
import {jwtClaims} from '../lib/jwt.js';
import {formatAge, formatReset} from '../lib/time.js';
import {assertEqual, assertTrue, test} from './harness.js';

const BLACK = {r: 0, g: 0, b: 0};
const WHITE = {r: 1, g: 1, b: 1};

// backoff
test('backoff: starts at one minute', () => assertEqual(backoffSeconds(0), 60));
test('backoff: doubles per attempt', () => assertEqual(backoffSeconds(2), 240));
test('backoff: capped at 15 minutes', () => assertEqual(backoffSeconds(50), 900));
test('backoff: Retry-After 0 is ignored', () => assertEqual(backoffSeconds(0, 0), 60));
test('backoff: larger Retry-After raises the wait', () => assertEqual(backoffSeconds(0, 300), 300));
test('backoff: Retry-After cannot exceed ceiling', () => assertEqual(backoffSeconds(0, 99999), 900));

// contrast
test('contrast: black/white is 21:1', () => assertTrue(Math.abs(contrastRatio(BLACK, WHITE) - 21) < 1e-9));
test('contrast: luminance extremes', () => {
    assertEqual(luminance(BLACK), 0);
    assertTrue(Math.abs(luminance(WHITE) - 1) < 1e-9);
});
test('contrast: css clamps and rounds', () => assertEqual(css({r: 2, g: -1, b: 0.5}), 'rgb(255, 0, 128)'));
test('contrast: dark bg gets light text', () => {
    const p = textPalette({r: 0.05, g: 0.05, b: 0.05});
    assertEqual(p.dark, false);
    assertEqual(p.primary, 'rgb(255, 255, 255)');
});
test('contrast: light bg gets dark text', () => {
    const p = textPalette({r: 0.95, g: 0.95, b: 0.95});
    assertEqual(p.dark, true);
    assertEqual(p.primary, 'rgb(0, 0, 0)');
});

// jwt
function makeJwt(claims) {
    const enc = obj => GLib.base64_encode(new TextEncoder().encode(JSON.stringify(obj)))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return `${enc({alg: 'none'})}.${enc(claims)}.sig`;
}
test('jwt: decodes claims', () => assertEqual(jwtClaims(makeJwt({sub: 'abc', exp: 123})), {sub: 'abc', exp: 123}));
test('jwt: decodes url-safe payload with padding', () => assertEqual(jwtClaims(makeJwt({n: '???>>>'})), {n: '???>>>'}));
test('jwt: no dots gives null', () => assertEqual(jwtClaims('nodots'), null));
test('jwt: garbage payload gives null', () => assertEqual(jwtClaims('a.!!!.c'), null));

// time
const NOW = new Date('2026-01-01T12:00:00Z');
const at = seconds => new Date(NOW.getTime() + seconds * 1000);
test('time: formatReset null', () => assertEqual(formatReset(null, NOW), ''));
test('time: formatReset past', () => assertEqual(formatReset(at(-5), NOW), 'Resetting…'));
test('time: formatReset minutes', () => assertEqual(formatReset(at(61), NOW), 'Resets in 2 min'));
test('time: formatReset whole hours', () => assertEqual(formatReset(at(7200), NOW), 'Resets in 2h'));
test('time: formatReset hours and minutes', () => assertEqual(formatReset(at(5400), NOW), 'Resets in 1h 30m'));
test('time: formatReset beyond a day is weekday text', () => {
    assertTrue(/^Resets \S+ \d\d:\d\d$/.test(formatReset(at(3 * 86400), NOW)));
});
test('time: formatAge', () => {
    assertEqual(formatAge(null, NOW), '');
    assertEqual(formatAge(at(-10), NOW), 'just now');
    assertEqual(formatAge(at(-300), NOW), '5 min ago');
    assertEqual(formatAge(at(-7300), NOW), '2h ago');
});
