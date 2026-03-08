/**
 * Update Poller
 *
 * Polls GET /api/getUpdates for changes since the last check.
 * Emits granular events for extensions, day type changes, quota updates,
 * bans, and children list refreshes.
 */

import { EventEmitter } from 'node:events';

export class UpdatePoller extends EventEmitter {

    /**
     * @param {object} options
     * @param {import('./api.js').Allow2Api} options.api
     * @param {number} [options.pollInterval=30000] - Milliseconds between polls
     */
    constructor(options) {
        super();
        this._api = options.api;
        this._pollInterval = options.pollInterval || 30000;

        this._credentials = null;
        this._lastTimestamp = null;
        this._timer = null;
        this._running = false;
    }

    /**
     * Begin polling with the given credentials.
     *
     * @param {object} credentials
     * @param {number|string} credentials.userId
     * @param {number|string} credentials.pairId
     * @param {string} credentials.pairToken
     * @param {string} credentials.deviceToken
     */
    start(credentials) {
        if (this._running) return;

        this._credentials = credentials;
        this._running = true;
        this._poll();
    }

    /**
     * Stop polling.
     */
    stop() {
        this._running = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    // ── Internal ──────────────────────────────────────────────

    async _poll() {
        if (!this._running) return;

        try {
            await this._fetchUpdates();
        } catch (err) {
            this._handleError(err);
        }

        if (this._running) {
            this._timer = setTimeout(() => this._poll(), this._pollInterval);
        }
    }

    async _fetchUpdates() {
        const params = {
            userId: this._credentials.userId,
            pairId: this._credentials.pairId,
            pairToken: this._credentials.pairToken,
            deviceToken: this._credentials.deviceToken,
        };

        if (this._lastTimestamp) {
            params.timestampMillis = this._lastTimestamp;
        }

        const result = await this._api.getUpdates(params);

        // Advance the timestamp so the next poll only gets deltas
        if (result && result.timestampMillis) {
            this._lastTimestamp = result.timestampMillis;
        }

        this._processUpdates(result);
    }

    /**
     * Parse the getUpdates response and emit appropriate events.
     *
     * Expected response shape:
     * {
     *   timestampMillis: number,
     *   extensions: [{ childId, activity, additionalMinutes }],
     *   dayTypeChanges: [{ childId, dayType }],
     *   quotaUpdates: [{ childId, activity, newQuota }],
     *   bans: [{ childId, activity, banned }],
     *   children: [{ id, name, pin, ... }]
     * }
     */
    _processUpdates(result) {
        if (!result) return;

        // Extensions — parent approved extra time
        const extensions = result.extensions;
        if (extensions && extensions.length > 0) {
            for (let i = 0; i < extensions.length; i++) {
                this.emit('extension', {
                    childId: extensions[i].childId,
                    activity: extensions[i].activity,
                    additionalMinutes: extensions[i].additionalMinutes,
                });
            }
        }

        // Day type changes — e.g. school day switched to holiday
        const dayTypeChanges = result.dayTypeChanges;
        if (dayTypeChanges && dayTypeChanges.length > 0) {
            for (let j = 0; j < dayTypeChanges.length; j++) {
                this.emit('day-type-changed', {
                    childId: dayTypeChanges[j].childId,
                    dayType: dayTypeChanges[j].dayType,
                });
            }
        }

        // Quota updates — daily limit changed
        const quotaUpdates = result.quotaUpdates;
        if (quotaUpdates && quotaUpdates.length > 0) {
            for (let k = 0; k < quotaUpdates.length; k++) {
                this.emit('quota-updated', {
                    childId: quotaUpdates[k].childId,
                    activity: quotaUpdates[k].activity,
                    newQuota: quotaUpdates[k].newQuota,
                });
            }
        }

        // Bans — activity banned/unbanned
        const bans = result.bans;
        if (bans && bans.length > 0) {
            for (let m = 0; m < bans.length; m++) {
                this.emit('ban', {
                    childId: bans[m].childId,
                    activity: bans[m].activity,
                    banned: bans[m].banned,
                });
            }
        }

        // Children list refresh — names, PINs, added/removed children
        const children = result.children;
        if (children && children.length > 0) {
            this.emit('children-updated', children);
        }
    }

    /**
     * Handle errors from the polling loop.
     * HTTP 401 indicates the device has been unpaired.
     */
    _handleError(err) {
        if (err && err.status === 401) {
            this.emit('unpaired', { error: err });
            this.stop();
            return;
        }

        this.emit('error', err);
    }
}
