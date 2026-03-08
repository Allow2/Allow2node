/**
 * Warning Scheduler
 *
 * Tracks remaining time per activity and emits 'warning' events
 * when configurable thresholds are crossed. Prevents duplicate
 * warnings for the same level+activity combination.
 */

const DEFAULT_THRESHOLDS = [
    { remaining: 15 * 60, level: 'info' },
    { remaining: 5 * 60,  level: 'urgent' },
    { remaining: 60,      level: 'final' },
    { remaining: 30,      level: 'countdown' },
];

export class WarningScheduler {

    /**
     * @param {object} options
     * @param {Function} options.emit - The EventEmitter emit function to call
     * @param {Array}   [options.thresholds] - Warning thresholds sorted descending by remaining
     */
    constructor(options) {
        this._emit = options.emit;
        this._thresholds = (options.thresholds || DEFAULT_THRESHOLDS)
            .slice()
            .sort((a, b) => b.remaining - a.remaining);

        // Map<activityId, Set<level>> — tracks which warnings have fired
        this._fired = new Map();
    }

    /**
     * Called by the Checker after each check response.
     * Evaluates every activity's remaining time against thresholds.
     *
     * @param {Object<string, { remaining: number }>} activities
     *   Keys are activity IDs (as strings), values have at least `remaining` in seconds.
     */
    update(activities) {
        const ids = Object.keys(activities);
        for (let i = 0; i < ids.length; i++) {
            const activityId = ids[i];
            const remaining = activities[activityId].remaining;

            if (remaining == null || remaining < 0) {
                continue;
            }

            let firedSet = this._fired.get(activityId);
            if (!firedSet) {
                firedSet = new Set();
                this._fired.set(activityId, firedSet);
            }

            for (let t = 0; t < this._thresholds.length; t++) {
                const threshold = this._thresholds[t];
                if (remaining <= threshold.remaining && !firedSet.has(threshold.level)) {
                    firedSet.add(threshold.level);
                    this._emit('warning', {
                        level: threshold.level,
                        activityId: activityId,
                        remaining: remaining,
                    });
                }
            }
        }
    }

    /**
     * Reset warnings for an activity (e.g., parent approved more time).
     * Next check cycle will re-evaluate thresholds from scratch.
     *
     * @param {string} activityId
     */
    resetActivity(activityId) {
        this._fired.delete(activityId);
    }

    /**
     * Reset all warning state (e.g., new child session).
     */
    resetAll() {
        this._fired.clear();
    }
}
