/**
 * DeviceDaemon — Main entry point for the Allow2 Device SDK.
 *
 * Manages the full device lifecycle:
 *   1. Unpaired   → sits idle, waits for openApp() to start pairing
 *   2. Pairing    → pairing wizard active
 *   3. Paired     → paired but no child selected yet
 *   4. Enforcing  → child selected, check loop running
 *   5. Parent     → parent mode, no enforcement
 *
 * The daemon never throws on missing credentials — it emits events so the
 * platform layer (allow2linux, etc.) can show the appropriate UI.
 *
 * Usage:
 *   const daemon = new DeviceDaemon({
 *       deviceName: 'Living Room PC',
 *       activities: [{ id: 1 }, { id: 8 }],
 *       credentialBackend: myBackend,
 *       childResolver: myResolver,
 *   });
 *   daemon.on('child-select-required', (children) => showSelector(children));
 *   daemon.on('warning', (w) => showWarning(w));
 *   daemon.on('soft-lock', () => lockScreen());
 *   daemon.on('unpaired', () => showUnpairedUI());
 *   await daemon.start();
 *   // When user opens the Allow2 app:
 *   await daemon.openApp();
 */

import { EventEmitter } from 'node:events';
import { Allow2Api } from './api.js';
import { Checker } from './checker.js';
import { PairingWizard } from './pairing.js';

export class DeviceDaemon extends EventEmitter {

    /**
     * @param {object} options
     * @param {string}   [options.deviceName] - Human-readable device name
     * @param {Array<{ id: number }>} options.activities - Activities to monitor
     * @param {number}   [options.checkInterval=60] - Seconds between API checks
     * @param {object}   options.credentialBackend - { load(): Promise<creds>, store(creds): Promise }
     * @param {object}   options.childResolver - { resolve(children): { childId, childName } | null }
     * @param {number}   [options.gracePeriod=300] - Offline grace period in seconds
     * @param {number}   [options.hardLockTimeout=300] - Seconds after soft-lock before hard-lock
     * @param {Array}    [options.warnings] - Custom warning thresholds
     * @param {string}   [options.apiUrl] - Override API URL (or set ALLOW2_API_URL env var)
     * @param {number}   [options.vid] - Override version ID (or set ALLOW2_VID env var)
     * @param {string}   [options.token] - Override version token (or set ALLOW2_TOKEN env var)
     * @param {number}   [options.pairingPort=3000] - Port for pairing wizard web UI
     */
    constructor(options) {
        super();

        if (!options.activities || options.activities.length === 0) {
            throw new Error('activities array is required and must not be empty');
        }
        if (!options.credentialBackend) {
            throw new Error('credentialBackend is required');
        }
        if (!options.childResolver) {
            throw new Error('childResolver is required');
        }

        this._deviceName = options.deviceName || 'Allow2 Device';
        this._activities = options.activities;
        this._checkInterval = options.checkInterval || 60;
        this._credentialBackend = options.credentialBackend;
        this._childResolver = options.childResolver;
        this._gracePeriod = options.gracePeriod || 300;
        this._hardLockTimeout = options.hardLockTimeout || 300;
        this._warningThresholds = options.warnings || null;
        this._pairingPort = options.pairingPort || 3000;

        this._api = new Allow2Api({
            apiUrl: options.apiUrl,
            vid: options.vid,
            token: options.token,
        });

        this._checker = null;
        this._credentials = null;
        this._childId = null;
        this._running = false;
        this._pairingWizard = null;

        /** @type {'unpaired'|'pairing'|'paired'|'enforcing'|'parent'} */
        this._state = 'unpaired';
    }

    /** The Allow2Api instance (for advanced usage like createRequest). */
    get api() {
        return this._api;
    }

    /** Current credentials (read-only). */
    get credentials() {
        return this._credentials;
    }

    /** Currently selected child ID. */
    get childId() {
        return this._childId;
    }

    /** Whether the daemon is running. */
    get running() {
        return this._running;
    }

    /** Whether the device is paired. */
    get paired() {
        return !!(this._credentials && this._credentials.pairId && this._credentials.pairToken);
    }

    /** Current daemon state: 'unpaired', 'pairing', 'paired', 'enforcing', or 'parent'. */
    get state() {
        return this._state;
    }

    /** Whether the daemon is in parent mode (no enforcement). */
    get isParentMode() {
        return this._state === 'parent';
    }

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

    /**
     * Start the daemon.
     *
     * Checks for stored credentials:
     * - If unpaired → sits idle, logs message, waits for openApp()
     * - If paired   → proceeds to child identification and enforcement
     */
    async start() {
        if (this._running) return;
        this._running = true;

        // 1. Try to load stored pairing credentials
        try {
            this._credentials = await this._credentialBackend.load();
        } catch (err) {
            console.error('Failed to load credentials:', err.message);
            this._credentials = null;
        }

        // 2. If not paired, sit idle and wait for openApp()
        if (!this._credentials || !this._credentials.pairId || !this._credentials.pairToken) {
            this._state = 'unpaired';
            console.log('Device not paired. Waiting for user to open Allow2 app.');
            return;
        }

        // 3. Already paired — proceed to child identification
        this._state = 'paired';
        await this._beginEnforcement();
    }

    /**
     * Stop the daemon: stop check loop, stop pairing wizard, clean up.
     */
    stop() {
        this._running = false;
        if (this._checker) {
            this._checker.stop();
            this._checker = null;
        }
        if (this._pairingWizard) {
            this._pairingWizard.stop();
            this._pairingWizard = null;
        }
        this._childId = null;

        // Reset state based on whether we have credentials
        if (this._credentials && this._credentials.pairId) {
            this._state = 'paired';
        } else {
            this._state = 'unpaired';
        }
    }

    /**
     * Called when the user opens the Allow2 app / UI.
     *
     * If unpaired, starts the pairing flow.
     * If already paired, emits status info for the UI to display.
     */
    async openApp() {
        if (this._state === 'unpaired' || (!this._credentials || !this._credentials.pairId)) {
            // Start pairing flow
            await this._startPairing();
        } else {
            // Already paired — emit status info
            this.emit('status-requested', {
                state: this._state,
                children: (this._credentials && this._credentials.children) || [],
                currentChildId: this._childId,
                // remaining time will be filled by checker if available
                remaining: this._checker ? this._checker.getRemaining() : null,
            });
        }
    }

    /**
     * Enter parent mode: stops enforcement, no restrictions applied.
     */
    enterParentMode() {
        if (this._checker) {
            this._checker.stop();
            this._checker = null;
        }
        this._state = 'parent';
        this.emit('parent-mode', {});
    }

    /**
     * Called by the platform layer after pairing completes externally
     * (e.g., if the overlay handles pairing instead of the Express wizard).
     *
     * @param {object} credentials - { userId, pairId, pairToken, children }
     */
    async onPairingComplete(credentials) {
        await this._onPaired(credentials);
    }

    // ----------------------------------------------------------------
    // Child Management
    // ----------------------------------------------------------------

    /**
     * Switch to a different child (e.g., child selector UI).
     * Stops current check loop, sets new child, restarts.
     *
     * @param {number} childId
     * @param {string} [name]
     */
    async selectChild(childId, name) {
        if (this._checker) {
            this._checker.stop();
        }

        this._childId = childId;
        this._state = 'enforcing';
        this.emit('child-selected', { childId: childId, name: name || null });

        this._updateLastUsed(childId);

        if (this._running && this._credentials) {
            this._startChecker();
        }
    }

    /**
     * Handle a failed child PIN attempt.
     *
     * @param {number} childId
     * @param {number} attemptsRemaining
     */
    childPinFailed(childId, attemptsRemaining) {
        this.emit('child-pin-failed', {
            childId: childId,
            attemptsRemaining: attemptsRemaining,
        });

        if (attemptsRemaining <= 0) {
            this.emit('child-locked-out', { childId: childId });
        }
    }

    /**
     * Signal that the child session has timed out (e.g., idle timeout).
     * Stops the checker and requests child re-identification.
     */
    sessionTimeout() {
        if (this._checker) {
            this._checker.stop();
            this._checker = null;
        }
        this._childId = null;
        this._state = 'paired';
        this.emit('session-timeout', {});

        // Re-resolve child
        if (this._running && this._credentials) {
            this._resolveChild();
        }
    }

    // ----------------------------------------------------------------
    // Requests (convenience wrappers)
    // ----------------------------------------------------------------

    /**
     * Create a "Request More Time" request on behalf of the current child.
     *
     * @param {object} params
     * @param {number} params.duration - Requested minutes
     * @param {number} params.activity - Activity ID
     * @param {string} [params.message] - Message to parent
     * @returns {Promise<object>} - { requestId, statusSecret }
     */
    async requestMoreTime(params) {
        if (!this._childId) {
            throw new Error('No child selected');
        }
        return this._api.createRequest({
            userId: this._credentials.userId,
            pairId: this._credentials.pairId,
            pairToken: this._credentials.pairToken,
            childId: this._childId,
            duration: params.duration,
            activity: params.activity,
            message: params.message,
        });
    }

    /**
     * Poll the status of a pending request.
     *
     * @param {string} requestId
     * @param {string} statusSecret
     * @returns {Promise<object>}
     */
    async pollRequestStatus(requestId, statusSecret) {
        const result = await this._api.getRequestStatus(requestId, statusSecret);

        if (result && result.status === 'approved') {
            this.emit('request-approved', {
                requestId: requestId,
                activityId: result.activityId,
                duration: result.duration,
            });
            if (this._checker && result.activityId) {
                this._checker.onTimeExtended(result.activityId);
            }
        } else if (result && result.status === 'denied') {
            this.emit('request-denied', {
                requestId: requestId,
                reason: result.reason,
            });
        }

        return result;
    }

    // ----------------------------------------------------------------
    // Feedback
    // ----------------------------------------------------------------

    /**
     * Whether the current session user can submit feedback.
     * Returns true if the user has an Allow2 account (parent mode, or
     * child with a linked user account).
     */
    get canSubmitFeedback() {
        // Parent mode: always true (parent has an account by definition)
        if (this._state === 'parent') return true;

        // Must be paired with credentials
        if (!this._credentials || !this._credentials.userId) return false;

        // If a child is selected, check if they have a linked account
        if (this._childId && this._credentials.children) {
            var children = this._credentials.children;
            for (var i = 0; i < children.length; i++) {
                var child = children[i];
                if ((child.id || child.childId) === this._childId) {
                    // Child with linked user account can submit
                    return !!(child.LinkedUserId || child.linkedUserId);
                }
            }
            return false; // child not found
        }

        // Paired with userId = parent context
        return !!this._credentials.userId;
    }

    /**
     * Submit feedback to the Allow2 server.
     *
     * @param {object} params
     * @param {string} params.category - One of: bypass, missing_feature, not_working, question, other
     * @param {string} params.message  - Feedback message text
     * @param {object} [params.deviceContext] - Optional override for device context fields
     * @returns {Promise<{ discussionId: string }>}
     */
    async submitFeedback(params) {
        if (!this.canSubmitFeedback) {
            throw new Error('Cannot submit feedback: no account associated');
        }
        if (!params || !params.category || !params.message) {
            throw new Error('category and message are required');
        }

        var validCategories = ['bypass', 'missing_feature', 'not_working', 'question', 'other'];
        if (validCategories.indexOf(params.category) === -1) {
            throw new Error('Invalid category. Must be one of: ' + validCategories.join(', '));
        }

        var context = {
            deviceName: this._deviceName,
            platform: 'unknown',
            sdkVersion: '2.0.0',
            productName: 'allow2',
        };
        if (params.deviceContext) {
            if (params.deviceContext.deviceName) context.deviceName = params.deviceContext.deviceName;
            if (params.deviceContext.platform) context.platform = params.deviceContext.platform;
            if (params.deviceContext.sdkVersion) context.sdkVersion = params.deviceContext.sdkVersion;
            if (params.deviceContext.productName) context.productName = params.deviceContext.productName;
        }

        var result = await this._api.submitFeedback({
            userId: this._credentials.userId,
            pairId: this._credentials.pairId,
            pairToken: this._credentials.pairToken,
            childId: this._childId,
            vid: this._api.vid,
            category: params.category,
            message: params.message,
            deviceContext: context,
        });

        this.emit('feedback-submitted', {
            discussionId: result.discussionId,
            category: params.category,
        });

        return result;
    }

    /**
     * Load all feedback discussions for this device.
     *
     * @returns {Promise<{ discussions: Array }>}
     */
    async loadDeviceFeedback() {
        if (!this._credentials || !this._credentials.pairId) {
            throw new Error('Device not paired');
        }

        var result = await this._api.loadFeedback({
            userId: this._credentials.userId,
            pairId: this._credentials.pairId,
            pairToken: this._credentials.pairToken,
        });

        this.emit('feedback-loaded', {
            discussions: (result && result.discussions) || [],
        });

        return result;
    }

    /**
     * Reply to an existing feedback discussion.
     *
     * @param {string} discussionId - The discussion to reply to
     * @param {string} message      - The reply message
     * @returns {Promise<{ messageId: string }>}
     */
    async replyToFeedback(discussionId, message) {
        if (!discussionId || !message) {
            throw new Error('discussionId and message are required');
        }

        var result = await this._api.feedbackReply({
            userId: this._credentials.userId,
            pairId: this._credentials.pairId,
            pairToken: this._credentials.pairToken,
            discussionId: discussionId,
            message: message,
        });

        this.emit('feedback-reply-sent', {
            discussionId: discussionId,
            messageId: result.messageId,
        });

        return result;
    }

    /**
     * Convert feedback params to a human-readable label.
     *
     * @param {object} params
     * @param {object} params.feedback
     * @param {string} params.feedback.category
     * @returns {string}
     */
    static feedbackParamsToText(params) {
        if (!params || !params.feedback) return '';
        var labels = {
            bypass: 'Bypass / Circumvention report',
            missing_feature: 'Missing Feature report',
            not_working: 'Not Working report',
            question: 'Question',
            other: 'General feedback',
        };
        return labels[params.feedback.category] || 'Feedback';
    }

    // ----------------------------------------------------------------
    // Internal — Pairing
    // ----------------------------------------------------------------

    async _startPairing() {
        this._state = 'pairing';

        this._pairingWizard = new PairingWizard({
            api: this._api,
            credentialBackend: this._credentialBackend,
            port: this._pairingPort,
            deviceName: this._deviceName,
        });

        var self = this;

        this._pairingWizard.on('paired', function (credentials) {
            self._pairingWizard = null;
            self._onPaired(credentials);
        });

        this._pairingWizard.on('error', function (err) {
            self.emit('pairing-error', err);
        });

        try {
            var info = await this._pairingWizard.start();

            // Emit event so platform layer can show the PIN and QR code
            // qrUrl is the deep link: https://app.allow2.com/pair?pin=XXXXXX
            this.emit('pairing-required', {
                wizard: this._pairingWizard,
                pin: info.pin,
                port: info.port,
                url: info.url,
                qrUrl: info.qrUrl,
            });
        } catch (err) {
            this.emit('pairing-error', err);
        }
    }

    async _onPaired(credentials) {
        this._credentials = credentials;
        this._state = 'paired';

        this.emit('paired', {
            userId: credentials.userId,
            children: credentials.children,
        });

        if (this._running) {
            await this._beginEnforcement();
        }
    }

    // ----------------------------------------------------------------
    // Internal — Enforcement
    // ----------------------------------------------------------------

    async _beginEnforcement() {
        // Resolve which child is using the device
        await this._resolveChild();

        // If child was resolved, start the check loop
        if (this._childId) {
            this._state = 'enforcing';
            this._startChecker();
        }
        // Otherwise, _resolveChild emitted 'child-select-required'
        // and we wait for selectChild() to be called
    }

    async _resolveChild() {
        const children = (this._credentials && this._credentials.children) || [];

        // Annotate children with lastUsedAt from credential backend
        var annotatedChildren = [];
        for (var i = 0; i < children.length; i++) {
            var child = Object.assign({}, children[i]);
            child.lastUsedAt = null;
            annotatedChildren.push(child);
        }

        if (this._credentialBackend && typeof this._credentialBackend.loadLastUsed === 'function') {
            try {
                var lastUsedMap = await this._credentialBackend.loadLastUsed();
                if (lastUsedMap) {
                    for (var j = 0; j < annotatedChildren.length; j++) {
                        var childId = annotatedChildren[j].id || annotatedChildren[j].childId;
                        if (childId && lastUsedMap[childId]) {
                            annotatedChildren[j].lastUsedAt = lastUsedMap[childId];
                        }
                    }
                }
            } catch (err) {
                // Non-critical — proceed without lastUsedAt data
                console.error('Failed to load lastUsed data:', err.message);
            }
        }

        // Sort by lastUsedAt descending (most recent first), nulls last
        // ISO 8601 strings sort correctly with localeCompare
        annotatedChildren.sort(function (a, b) {
            if (a.lastUsedAt && b.lastUsedAt) {
                return b.lastUsedAt.localeCompare(a.lastUsedAt);
            }
            if (a.lastUsedAt && !b.lastUsedAt) return -1;
            if (!a.lastUsedAt && b.lastUsedAt) return 1;
            return 0;
        });

        // Try automatic resolution (OS username mapping, etc.)
        var match = null;
        if (typeof this._childResolver === 'function') {
            match = this._childResolver(annotatedChildren);
        } else if (this._childResolver && typeof this._childResolver.resolve === 'function') {
            match = await this._childResolver.resolve(annotatedChildren);
        }

        if (match && match.childId) {
            this._childId = match.childId;
            this._state = 'enforcing';
            this._updateLastUsed(match.childId);
            this.emit('child-selected', { childId: match.childId, name: match.childName || null });
        } else {
            // No automatic match — need interactive selection
            this.emit('child-select-required', { children: annotatedChildren });
        }
    }

    _startChecker() {
        if (this._checker) {
            this._checker.stop();
        }

        var self = this;

        this._checker = new Checker({
            api: this._api,
            emit: this.emit.bind(this),
            credentials: this._credentials,
            childId: this._childId,
            activities: this._activities,
            checkInterval: this._checkInterval,
            hardLockTimeout: this._hardLockTimeout,
            gracePeriod: this._gracePeriod,
            warningThresholds: this._warningThresholds,
        });

        // Listen for unpaired events from the checker (HTTP 401)
        this.on('unpaired', function onUnpaired() {
            self._state = 'unpaired';
            self._credentials = null;
            if (self._checker) {
                self._checker.stop();
                self._checker = null;
            }
            self._childId = null;
            // Remove this one-shot listener
            self.removeListener('unpaired', onUnpaired);
        });

        this._checker.start();
    }

    /**
     * Persist the last-used timestamp for a child to the credential backend.
     *
     * @param {number} childId
     */
    _updateLastUsed(childId) {
        if (this._credentialBackend && typeof this._credentialBackend.updateLastUsed === 'function') {
            this._credentialBackend.updateLastUsed(childId).catch(function (err) {
                console.error('Failed to update lastUsed for child ' + childId + ':', err.message);
            });
        }
    }
}
