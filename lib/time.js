import GLib from 'gi://GLib';

/**
 * Human reset text for a limit window.
 *
 * @param {Date|null} resetsAt
 * @param {Date} [now]
 * @returns {string}
 */
export function formatReset(resetsAt, now = new Date()) {
    if (!resetsAt)
        return '';
    const seconds = Math.round((resetsAt.getTime() - now.getTime()) / 1000);
    if (seconds <= 0)
        return 'Resetting…';

    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60)
        return `Resets in ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const rest = minutes % 60;
        return rest ? `Resets in ${hours}h ${rest}m` : `Resets in ${hours}h`;
    }

    const local = GLib.DateTime.new_from_unix_local(Math.floor(resetsAt.getTime() / 1000));
    return `Resets ${local.format('%a %H:%M')}`;
}

/**
 * @param {Date|null} date
 * @param {Date} [now]
 * @returns {string} e.g. "3 min ago"
 */
export function formatAge(date, now = new Date()) {
    if (!date)
        return '';
    const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}
