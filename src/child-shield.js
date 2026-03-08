/**
 * ChildShield — Child identification, PIN verification, and session management.
 *
 * Port of the Brave browser's ChildShield/ChildManager pattern for Node.js.
 * Manages which child is currently using the device, with PIN-based
 * verification and automatic session timeout on inactivity.
 *
 * @example
 *   import { ChildShield } from './child-shield.js';
 *
 *   const shield = new ChildShield({
 *       children: pairingData.children,
 *       verificationLevel: 'pin',
 *       sessionTimeout: 300000,
 *   });
 *
 *   shield.on('child-select-required', (children) => { ... });
 *   shield.on('session-timeout', () => { ... });
 *
 *   await shield.selectChild(789, '1234');
 */

import { EventEmitter } from 'node:events';
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 300000; // 5 minutes
const DEFAULT_SESSION_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Hash a PIN with the given salt using SHA-256.
 * @param {string} pin - The raw PIN string.
 * @param {string} salt - Hex-encoded salt.
 * @returns {string} Hex-encoded SHA-256 hash.
 */
function hashPin(pin, salt) {
    return createHash('sha256')
        .update(pin + salt)
        .digest('hex');
}

/**
 * Constant-time comparison of two hex hash strings.
 * @param {string} a - First hex string.
 * @param {string} b - Second hex string.
 * @returns {boolean} True if equal.
 */
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) {
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}


export class ChildShield extends EventEmitter {

    /**
     * @param {object} options
     * @param {Array}  options.children          - Child objects from pairing data.
     * @param {string} [options.verificationLevel='pin'] - 'honour' | 'pin' | 'parent-only'
     * @param {number} [options.sessionTimeout]  - Inactivity timeout in ms (default 300000).
     * @param {Function} [options.onSelectRequired] - Convenience callback for 'child-select-required'.
     */
    constructor(options = {}) {
        super();

        this._children = (options.children || []).slice();
        this._verificationLevel = options.verificationLevel || 'pin';
        this._sessionTimeout = (options.sessionTimeout != null)
            ? options.sessionTimeout
            : DEFAULT_SESSION_TIMEOUT_MS;

        // Current state
        this._currentChild = null;
        this._parentMode = false;
        this._sessionTimer = null;
        this._lastActivity = 0;

        // Rate-limiting state: keyed by childId (or 'parent')
        this._attempts = new Map();

        // Wire up convenience callback
        if (typeof options.onSelectRequired === 'function') {
            this.on('child-select-required', options.onSelectRequired);
        }
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------

    /**
     * Select a child by ID, optionally verifying their PIN.
     *
     * @param {number} childId - The child's ID.
     * @param {string} [pin]   - The raw PIN (required when verificationLevel is 'pin').
     * @returns {boolean} True if the child was successfully selected.
     */
    selectChild(childId, pin) {
        if (this._verificationLevel === 'parent-only') {
            return false;
        }

        const child = this._findChild(childId);
        if (!child) {
            return false;
        }

        // Check lockout
        if (this._isLockedOut(childId)) {
            const remaining = this._lockoutRemaining(childId);
            this.emit('child-locked-out', Math.ceil(remaining / 1000));
            return false;
        }

        // PIN verification (skip for 'honour' level)
        if (this._verificationLevel === 'pin') {
            if (!pin) {
                return false;
            }
            if (!child.pinHash || !child.pinSalt) {
                // Child has no PIN set — treat as honour
            } else {
                const computed = hashPin(pin, child.pinSalt);
                if (!safeCompare(computed, child.pinHash)) {
                    this._recordFailedAttempt(childId);
                    return false;
                }
            }
        }

        // Success — clear attempts and activate session
        this._clearAttempts(childId);
        this._activateChild(child);
        return true;
    }

    /**
     * Authenticate as a parent using the parent PIN.
     * The parent PIN is stored on the first child entry as a convention,
     * but is supplied via the `parentPinHash` / `parentPinSalt` fields
     * on the children array's meta (or passed during construction).
     *
     * For simplicity, the parent PIN is verified against a special
     * entry in the children array where `id === 0` or `name === '__parent__'`,
     * OR the caller may store parent credentials on the shield directly.
     *
     * @param {string} pin - The raw parent PIN.
     * @returns {boolean} True if parent mode was entered.
     */
    selectParent(pin) {
        if (!pin) {
            return false;
        }

        const parentEntry = this._findParentEntry();
        if (!parentEntry) {
            return false;
        }

        // Check lockout
        if (this._isLockedOut('parent')) {
            const remaining = this._lockoutRemaining('parent');
            this.emit('child-locked-out', Math.ceil(remaining / 1000));
            return false;
        }

        if (!parentEntry.pinHash || !parentEntry.pinSalt) {
            return false;
        }

        const computed = hashPin(pin, parentEntry.pinSalt);
        if (!safeCompare(computed, parentEntry.pinHash)) {
            this._recordFailedAttempt('parent');
            return false;
        }

        this._clearAttempts('parent');
        this._enterParentMode();
        return true;
    }

    /**
     * End the current session. Clears child selection or parent mode
     * and emits 'child-select-required'.
     */
    clearSelection() {
        this._stopSessionTimer();
        this._currentChild = null;
        this._parentMode = false;
        this._lastActivity = 0;
        this.emit('child-select-required', this.getChildren());
    }

    /**
     * Returns the currently selected child object, or null.
     * @returns {object|null}
     */
    getCurrentChild() {
        return this._currentChild;
    }

    /**
     * Returns true if the device is in parent (unrestricted) mode.
     * @returns {boolean}
     */
    isParentMode() {
        return this._parentMode;
    }

    /**
     * Record user interaction to keep the session alive.
     * Call this on meaningful user activity (key press, mouse move, etc.).
     */
    recordActivity() {
        this._lastActivity = Date.now();
        if (this._currentChild || this._parentMode) {
            this._resetSessionTimer();
        }
    }

    /**
     * Replace the children list (e.g., after a getUpdates call).
     * Preserves the current selection if the child still exists.
     *
     * @param {Array} children - Updated child objects.
     */
    updateChildren(children) {
        this._children = (children || []).slice();

        // If a child is selected, make sure they still exist
        if (this._currentChild) {
            const still = this._findChild(this._currentChild.id);
            if (!still) {
                // Child was removed — force re-selection
                this.clearSelection();
            } else {
                // Update the cached object with fresh data
                this._currentChild = Object.assign({}, still);
            }
        }
    }

    /**
     * Returns a safe copy of the children list (excluding PINs).
     * Suitable for display in a child selector UI.
     * @returns {Array}
     */
    getChildren() {
        return this._children.map(function (c) {
            return {
                id: c.id,
                name: c.name,
                avatarUrl: c.avatarUrl,
                color: c.color,
                hasAccount: c.hasAccount,
            };
        });
    }

    /**
     * Clean up timers. Call when the shield is no longer needed.
     */
    destroy() {
        this._stopSessionTimer();
        this.removeAllListeners();
    }

    // ---------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------

    /**
     * Find a child by ID in the current list.
     * @param {number} childId
     * @returns {object|undefined}
     */
    _findChild(childId) {
        for (let i = 0; i < this._children.length; i++) {
            if (this._children[i].id === childId) {
                return this._children[i];
            }
        }
        return undefined;
    }

    /**
     * Find the parent entry in the children list.
     * Convention: id === 0 or name === '__parent__'.
     */
    _findParentEntry() {
        for (let i = 0; i < this._children.length; i++) {
            const c = this._children[i];
            if (c.id === 0 || c.name === '__parent__') {
                return c;
            }
        }
        return undefined;
    }

    /**
     * Activate a child session.
     */
    _activateChild(child) {
        this._parentMode = false;
        this._currentChild = Object.assign({}, child);
        this._lastActivity = Date.now();
        this._resetSessionTimer();
        this.emit('child-selected', child.id, child.name);
    }

    /**
     * Enter parent mode (unrestricted access).
     */
    _enterParentMode() {
        this._currentChild = null;
        this._parentMode = true;
        this._lastActivity = Date.now();
        this._resetSessionTimer();
        this.emit('parent-mode-entered');
    }

    // ---------------------------------------------------------------
    // Session timer
    // ---------------------------------------------------------------

    _resetSessionTimer() {
        this._stopSessionTimer();
        if (this._sessionTimeout <= 0) {
            return; // Timeout disabled
        }
        this._sessionTimer = setTimeout(() => {
            this._onSessionTimeout();
        }, this._sessionTimeout);
        // Prevent the timer from keeping the process alive
        if (this._sessionTimer && typeof this._sessionTimer.unref === 'function') {
            this._sessionTimer.unref();
        }
    }

    _stopSessionTimer() {
        if (this._sessionTimer) {
            clearTimeout(this._sessionTimer);
            this._sessionTimer = null;
        }
    }

    _onSessionTimeout() {
        this._sessionTimer = null;
        this._currentChild = null;
        this._parentMode = false;
        this._lastActivity = 0;
        this.emit('session-timeout');
        this.emit('child-select-required', this.getChildren());
    }

    // ---------------------------------------------------------------
    // Rate limiting
    // ---------------------------------------------------------------

    /**
     * Get or create the rate-limit record for a key.
     */
    _getAttemptRecord(key) {
        if (!this._attempts.has(key)) {
            this._attempts.set(key, { failed: 0, lockoutUntil: 0 });
        }
        return this._attempts.get(key);
    }

    _isLockedOut(key) {
        const record = this._getAttemptRecord(key);
        if (record.lockoutUntil > 0 && Date.now() < record.lockoutUntil) {
            return true;
        }
        // Lockout expired — reset
        if (record.lockoutUntil > 0 && Date.now() >= record.lockoutUntil) {
            record.failed = 0;
            record.lockoutUntil = 0;
        }
        return false;
    }

    _lockoutRemaining(key) {
        const record = this._getAttemptRecord(key);
        const remaining = record.lockoutUntil - Date.now();
        return remaining > 0 ? remaining : 0;
    }

    _recordFailedAttempt(key) {
        const record = this._getAttemptRecord(key);
        record.failed += 1;

        if (record.failed >= MAX_PIN_ATTEMPTS) {
            record.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
            this.emit('child-locked-out', Math.ceil(LOCKOUT_DURATION_MS / 1000));
        } else {
            this.emit('child-pin-failed', record.failed, MAX_PIN_ATTEMPTS);
        }
    }

    _clearAttempts(key) {
        this._attempts.delete(key);
    }
}
