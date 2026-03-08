/**
 * Request More Time
 *
 * Lets a child request additional time for an activity.
 * Creates the request via the Allow2 API, then polls for
 * parent approval/denial. Emits events as the status changes.
 */

import { EventEmitter } from 'node:events';

const DEFAULT_POLL_INTERVAL = 5000;   // 5 seconds
const DEFAULT_TIMEOUT = 300000;       // 5 minutes

export class RequestManager extends EventEmitter {

    /**
     * @param {object} options
     * @param {import('./api.js').Allow2Api} options.api - Allow2Api instance
     * @param {number} [options.pollInterval] - Polling interval in ms (default 5000)
     * @param {number} [options.timeout]      - Max wait time in ms (default 300000)
     */
    constructor(options) {
        super();
        this._api = options.api;
        this._pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;
        this._timeout = options.timeout || DEFAULT_TIMEOUT;
        this._pollTimer = null;
        this._timeoutTimer = null;
    }

    /**
     * Submit a "request more time" to the Allow2 API and begin polling.
     *
     * @param {object} params
     * @param {number} params.userId
     * @param {number} params.pairId
     * @param {string} params.pairToken
     * @param {number} params.childId
     * @param {number} params.duration   - Minutes requested
     * @param {number} params.activity   - Activity ID
     * @param {string} [params.message]  - Optional message to parent
     * @returns {Promise<{ requestId: string, statusSecret: string }>}
     */
    async createRequest(params) {
        try {
            const response = await this._api.createRequest(params);
            const requestId = response.requestId;
            const statusSecret = response.statusSecret;

            this.emit('request-created', { requestId: requestId });
            this.startPolling(requestId, statusSecret);

            return { requestId: requestId, statusSecret: statusSecret };
        } catch (err) {
            this.emit('request-error', err);
            throw err;
        }
    }

    /**
     * Begin polling the request status endpoint.
     *
     * @param {string} requestId
     * @param {string} statusSecret
     */
    startPolling(requestId, statusSecret) {
        this.stopPolling();

        // Timeout — give up after configured duration
        this._timeoutTimer = setTimeout(() => {
            this.stopPolling();
            this.emit('request-timeout');
        }, this._timeout);

        this._poll(requestId, statusSecret);
    }

    /**
     * Cancel any active polling.
     */
    stopPolling() {
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }
    }

    // ── Internal ──────────────────────────────────────────────

    _poll(requestId, statusSecret) {
        this._pollTimer = setTimeout(async () => {
            try {
                const status = await this._api.getRequestStatus(requestId, statusSecret);

                if (status.status === 'approved') {
                    this.stopPolling();
                    this.emit('request-approved', {
                        requestId: requestId,
                        extension: status.extension,
                    });
                    return;
                }

                if (status.status === 'denied') {
                    this.stopPolling();
                    this.emit('request-denied', { requestId: requestId });
                    return;
                }

                // Still pending — schedule next poll
                this._poll(requestId, statusSecret);
            } catch (err) {
                this.emit('request-error', err);
                // Keep polling despite transient errors
                this._poll(requestId, statusSecret);
            }
        }, this._pollInterval);
    }
}
