import GLib from 'gi://GLib';

/**
 * Decode the claims of a JWT without verifying it. Used only for expiry
 * hints and account ids; the server validates the token.
 *
 * @param {string} token
 * @returns {object|null}
 */
export function jwtClaims(token) {
    const parts = token.split('.');
    if (parts.length < 2)
        return null;
    try {
        const padded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
        const bytes = GLib.base64_decode(padded + '='.repeat((4 - padded.length % 4) % 4));
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_e) {
        return null;
    }
}
