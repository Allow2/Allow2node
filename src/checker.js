/**
 * Check Loop + Per-Activity Enforcement
 *
 * Periodically calls the Allow2 check API and tracks per-activity
 * state transitions (allowed → blocked, soft-lock, hard-lock).
 * Delegates warning scheduling to WarningScheduler.
 */

import { WarningScheduler } from './warnings.js';

// Activity ID 8 = Screen Time (device-level master switch)
const SCREEN_TIME_ACTIVITY = 8;

export class Checker {

    /**
     * @param {object} options
     * @param {import('./api.js').Allow2Api} options.api
     * @param {Function} options.emit - EventEmitter emit bound to daemon
     * @param {object}   options.credentials - { userId, pairId, pairToken, deviceToken }
     * @param {number}   options.childId
     * @param {Array<{ id: number }>} options.activities - Activities to check
     * @param {number}   [options.checkInterval=60] - Seconds between checks
     * @param {number}   [options.hardLockTimeout=300] - Seconds after soft-lock before hard-lock
     * @param {number}   [options.gracePeriod=300] - Offline grace period in seconds
     * @param {object}   [options.warningThresholds] - Custom WarningScheduler thresholds
     */
    constructor(options) {
        this._api = options.api;
        this._emit = options.emit;
        this._credentials = options.credentials;
        this._childId = options.childId;
        this._activities = options.activities;
        this._checkInterval = (options.checkInterval || 60) * 1000;
        this._hardLockTimeout = (options.hardLockTimeout || 300) * 1000;
        this._gracePeriod = (options.gracePeriod || 300) * 1000;

        this._tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Per-activity state: Map<activityId, { allowed: boolean, remaining: number }>
        this._state = new Map();

        // Soft-lock tracking
        this._softLocked = false;
        this._softLockTimer = null;

        // Offline tracking
        this._offlineSince = null;
        this._offlineGraceEmitted = false;

        // Timer handle
        this._timer = null;
        this._running = false;

        this._warnings = new WarningScheduler({
            emit: this._emit,
            thresholds: options.warningThresholds,
        });
    }

    /**
     * Start the check loop. Runs an immediate check, then repeats on interval.
     */
    start() {
        if (this._running) return;
        this._running = true;
        this._runCheck();
    }

    /**
     * Stop the check loop and clean up timers.
     */
    stop() {
        this._running = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        if (this._softLockTimer) {
            clearTimeout(this._softLockTimer);
            this._softLockTimer = null;
        }
    }

    /**
     * Notify the checker that time was extended for an activity
     * (e.g., parent approved a request). Resets warning state.
     *
     * @param {number} activityId
     */
    onTimeExtended(activityId) {
        this._warnings.resetActivity(String(activityId));

        // If we were soft-locked, cancel the hard-lock timer and re-evaluate on next check
        if (this._softLocked) {
            this._softLocked = false;
            if (this._softLockTimer) {
                clearTimeout(this._softLockTimer);
                this._softLockTimer = null;
            }
            this._emit('unlock', { reason: 'time-extended', activityId: activityId });
        }
    }

    /**
     * Reset all state (e.g., new child selected).
     */
    reset(childId) {
        this._childId = childId;
        this._state.clear();
        this._softLocked = false;
        this._offlineSince = null;
        this._offlineGraceEmitted = false;
        this._warnings.resetAll();
        if (this._softLockTimer) {
            clearTimeout(this._softLockTimer);
            this._softLockTimer = null;
        }
    }

    // ----------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------

    async _runCheck() {
        if (!this._running) return;

        try {
            await this._doCheck();
        } catch (err) {
            this._handleError(err);
        }

        if (this._running) {
            this._timer = setTimeout(() => this._runCheck(), this._checkInterval);
        }
    }

    async _doCheck() {
        const activityMap = {};
        for (let i = 0; i < this._activities.length; i++) {
            const act = this._activities[i];
            activityMap[act.id] = 1; // 1 = active / requesting check
        }

        const result = await this._api.check({
            userId: this._credentials.userId,
            pairId: this._credentials.pairId,
            pairToken: this._credentials.pairToken,
            deviceToken: this._credentials.deviceToken,
            tz: this._tz,
            childId: this._childId,
            activities: activityMap,
            log: true,
        });

        // Successful API call — clear offline state
        if (this._offlineSince) {
            this._offlineSince = null;
            this._offlineGraceEmitted = false;
        }

        this._processResult(result);
    }

    _processResult(result) {
        // The check API returns `activities` as an object keyed by activity ID.
        // Each entry has: { id, activity, allowed, remaining, ... }
        const activities = result.activities || {};
        const ids = Object.keys(activities);

        let allBlocked = true;
        const warningData = {};

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const current = activities[id];
            const allowed = !!current.allowed;
            const remaining = current.remaining != null ? current.remaining : Infinity;

            const prev = this._state.get(id);
            const wasAllowed = prev ? prev.allowed : true;

            // Detect allowed → blocked transition
            if (wasAllowed && !allowed) {
                this._emit('activity-blocked', {
                    activityId: Number(id),
                    activity: current.activity || id,
                    remaining: 0,
                });

                // Screen Time (8) hitting 0 means full device lock
                if (Number(id) === SCREEN_TIME_ACTIVITY) {
                    this._triggerSoftLock('screen-time-exhausted');
                }
            }

            // Detect blocked → allowed transition (unlock)
            if (!wasAllowed && allowed && prev) {
                this._warnings.resetActivity(id);
                if (this._softLocked) {
                    // Re-evaluate soft lock below after processing all activities
                }
            }

            // Update state
            this._state.set(id, { allowed: allowed, remaining: remaining });

            if (allowed) {
                allBlocked = false;
                warningData[id] = { remaining: remaining };
            }
        }

        // If ALL activities are now blocked, trigger soft-lock
        if (ids.length > 0 && allBlocked && !this._softLocked) {
            this._triggerSoftLock('all-activities-blocked');
        }

        // If we were soft-locked but something is now allowed, unlock
        if (this._softLocked && !allBlocked) {
            this._softLocked = false;
            if (this._softLockTimer) {
                clearTimeout(this._softLockTimer);
                this._softLockTimer = null;
            }
            this._emit('unlock', { reason: 'activity-unblocked' });
        }

        // Feed remaining times to warning scheduler for allowed activities
        if (Object.keys(warningData).length > 0) {
            this._warnings.update(warningData);
        }
    }

    _triggerSoftLock(reason) {
        if (this._softLocked) return;
        this._softLocked = true;

        this._emit('soft-lock', { reason: reason });

        // Start hard-lock countdown
        this._softLockTimer = setTimeout(() => {
            if (this._softLocked && this._running) {
                this._emit('hard-lock', { reason: 'soft-lock-timeout' });
            }
        }, this._hardLockTimeout);
    }

    _handleError(err) {
        // HTTP 401 = credentials revoked, device unpaired
        if (err && err.status === 401) {
            this._emit('unpaired', { error: err });
            this.stop();
            return;
        }

        // Network / timeout errors → offline handling
        const now = Date.now();
        if (!this._offlineSince) {
            this._offlineSince = now;
        }

        const offlineDuration = now - this._offlineSince;

        if (offlineDuration < this._gracePeriod) {
            if (!this._offlineGraceEmitted) {
                this._offlineGraceEmitted = true;
                this._emit('offline-grace', {
                    since: this._offlineSince,
                    graceRemaining: this._gracePeriod - offlineDuration,
                });
            }
        } else {
            this._emit('offline-deny', {
                since: this._offlineSince,
                offlineDuration: offlineDuration,
            });
        }
    }
}
