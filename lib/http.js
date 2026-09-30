import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const decoder = new TextDecoder('utf-8');

export class HttpError extends Error {
    /**
     * @param {number} status
     * @param {number|null} retryAfter seconds from the Retry-After header
     */
    constructor(status, retryAfter = null) {
        super(`HTTP ${status}`);
        this.name = 'HttpError';
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

/**
 * Parse a Retry-After header: either delta-seconds or an HTTP date.
 *
 * @param {string|null} header
 * @returns {number|null} seconds
 */
export function parseRetryAfter(header) {
    if (!header)
        return null;
    const trimmed = header.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds))
        return Math.max(0, seconds);
    const date = GLib.DateTime.new_from_iso8601(trimmed, null);
    if (!date)
        return null;
    return Math.max(0, date.to_unix() - GLib.DateTime.new_now_utc().to_unix());
}

/**
 * Async JSON GET client. Owns one Soup.Session; call destroy() to abort
 * in-flight requests.
 */
export class HttpClient {
    constructor(timeoutSeconds = 15) {
        this._session = new Soup.Session({timeout: timeoutSeconds});
        this._cancellable = new Gio.Cancellable();
    }

    /**
     * @param {string} url
     * @param {Object<string,string>} headers
     * @returns {Promise<any>} parsed JSON body
     * @throws {HttpError} on non-2xx status
     */
    async getJson(url, headers = {}) {
        const message = Soup.Message.new('GET', url);
        const requestHeaders = message.get_request_headers();
        for (const [name, value] of Object.entries(headers))
            requestHeaders.append(name, value);

        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable);

        const status = message.get_status();
        if (status < 200 || status >= 300) {
            const retry = parseRetryAfter(message.get_response_headers().get_one('Retry-After'));
            throw new HttpError(status, retry);
        }
        return JSON.parse(decoder.decode(bytes.get_data()));
    }

    destroy() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._session?.abort();
        this._session = null;
    }
}
