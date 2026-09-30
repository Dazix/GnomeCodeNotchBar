const FLOOR_SECONDS = 60;
const CEILING_SECONDS = 15 * 60;
const MAX_DOUBLINGS = 4;

/**
 * Wait after a 429. The server hint is only honoured as a floor-raiser: some
 * endpoints answer `Retry-After: 0`, and obeying that retries immediately.
 * The wait starts at a minute, doubles per consecutive 429 and is capped.
 *
 * @param {number} attempt consecutive rate limits so far
 * @param {number|null} retryAfter server hint in seconds
 * @returns {number} seconds
 */
export function backoffSeconds(attempt, retryAfter = null) {
    const doubled = FLOOR_SECONDS * 2 ** Math.min(attempt, MAX_DOUBLINGS);
    return Math.min(CEILING_SECONDS, Math.max(doubled, retryAfter ?? 0));
}
