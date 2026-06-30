/**
 * Allow2 API Client
 *
 * Low-level fetch-based client for the Allow2 REST API.
 * Used internally by DeviceDaemon — not typically called directly.
 *
 * VID/Token: Each Allow2 integration has a registered Version ID (vid) and
 * version token (deviceToken). These identify the APPLICATION (e.g., "allow2linux"),
 * not the individual device. The per-device identity is the uuid field.
 *
 * Production defaults are baked in. In NON-PRODUCTION (dev) builds only, the target
 * can be switched for testing:
 *   ALLOW2_ENV=staging        (or sandbox / production)   ← preferred switch
 *   ALLOW2_API_URL=https://custom-api.example.com         ← advanced raw-URL escape hatch
 *   ALLOW2_VID=12345
 *   ALLOW2_TOKEN=mytoken
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * PRODUCTION SAFETY — HARD GUARD
 * ──────────────────────────────────────────────────────────────────────────────
 * Node has no compile step, so the production guard is a BUILD-BAKED FLAG that the
 * release/installer build MUST set:
 *
 *     ALLOW2_PRODUCTION=1        (preferred — set by the packaged/release build)
 *   or NODE_ENV=production
 *
 * When EITHER is in effect, every staging override (ALLOW2_ENV and ALLOW2_API_URL,
 * including an explicit options.apiUrl) is IGNORED and the production endpoints are
 * used unconditionally. A shipped product can therefore never attach to staging by
 * any runtime input. Release/installer builds MUST bake ALLOW2_PRODUCTION=1.
 */

// Production endpoints — always the default, and the ONLY option in a production build.
const PROD_API_URL = 'https://api.allow2.com';
const PROD_SERVICE_URL = 'https://service.allow2.com';

// Staging endpoints — reachable ONLY from a non-production (dev) build.
const STAGING_API_URL = 'https://staging-api.allow2.com';
const STAGING_SERVICE_URL = 'https://staging-service.allow2.com';

// Back-compat export (some callers reference DEFAULT_API_URL).
const DEFAULT_API_URL = PROD_API_URL;

// Build-baked production flag. Release/installer builds MUST set ALLOW2_PRODUCTION=1
// (NODE_ENV=production is also honoured). When true, all staging overrides are dead.
const IS_PRODUCTION_BUILD =
    process.env.ALLOW2_PRODUCTION === '1' ||
    process.env.ALLOW2_PRODUCTION === 'true' ||
    process.env.NODE_ENV === 'production';

/**
 * Resolve the target endpoints for the CURRENT BUILD.
 *
 * Hard guard: in a production build this ALWAYS returns the production endpoints and
 * marks the result non-overridable — ALLOW2_ENV is ignored entirely.
 */
function resolveEnvironment() {
    if (IS_PRODUCTION_BUILD) {
        return { apiUrl: PROD_API_URL, serviceUrl: PROD_SERVICE_URL, name: 'production', overridable: false };
    }
    const env = (process.env.ALLOW2_ENV || '').toLowerCase();
    if (env === 'staging' || env === 'sandbox') {
        console.warn('⚠️  Allow2 SDK targeting ' + env.toUpperCase() +
            ' — DEV ONLY; release builds (ALLOW2_PRODUCTION=1 / NODE_ENV=production) always use production.');
        return { apiUrl: STAGING_API_URL, serviceUrl: STAGING_SERVICE_URL, name: env, overridable: true };
    }
    return { apiUrl: PROD_API_URL, serviceUrl: PROD_SERVICE_URL, name: 'production', overridable: true };
}

// Default production VID/Token for allow2linux.
// Register your own at https://developer.allow2.com for other integrations.
const DEFAULT_VID = 0;
const DEFAULT_TOKEN = '';

export class Allow2Api {

    /**
     * @param {Object} options
     * @param {string} [options.apiUrl] - API base URL (or set ALLOW2_API_URL env var)
     * @param {number} [options.vid] - Version ID (or set ALLOW2_VID env var)
     * @param {string} [options.token] - Version token (or set ALLOW2_TOKEN env var)
     * @param {number} [options.timeout] - Request timeout in ms (default 15000)
     */
    constructor(options = {}) {
        // Resolve endpoints through the production guard. In a production build the
        // result is non-overridable; in a dev build, a raw-URL override (options.apiUrl
        // or ALLOW2_API_URL) is honoured as an advanced escape hatch.
        const resolved = resolveEnvironment();
        let apiUrl = resolved.apiUrl;
        let serviceUrl = resolved.serviceUrl;
        if (resolved.overridable) {
            const override = options.apiUrl || process.env.ALLOW2_API_URL;
            if (override) {
                console.warn('⚠️  Allow2 SDK using custom endpoint ' + override + ' — DEV ONLY.');
                apiUrl = override;
                serviceUrl = override;
            }
        }
        this.environment = resolved.name;
        this.baseUrl = apiUrl;
        this.serviceUrl = serviceUrl;
        this.timeout = options.timeout || 15000;

        // VID/Token: explicit option > env var > baked-in default
        this.vid = options.vid || parseInt(process.env.ALLOW2_VID, 10) || DEFAULT_VID;
        this.token = options.token || process.env.ALLOW2_TOKEN || DEFAULT_TOKEN;

        if (!this.vid || !this.token) {
            console.warn('Allow2 API: VID/Token not configured. Set ALLOW2_VID and ALLOW2_TOKEN environment variables, or pass vid/token in options.');
        }
    }

    async _fetch(path, options = {}) {
        const url = this.baseUrl + path;
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

            let body;
            try {
                body = await response.json();
            } catch (_parseErr) {
                if (!response.ok) {
                    const err = new Error('API error ' + response.status);
                    err.status = response.status;
                    throw err;
                }
                throw new Error('Unexpected non-JSON response from API');
            }

            if (!response.ok) {
                const err = new Error(body.message || 'API error ' + response.status);
                err.status = response.status;
                err.code = body.code;
                err.body = body;
                throw err;
            }

            return body;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Initiate QR-code pairing.
     * Returns a pairing session that the parent completes from their phone.
     *
     * @param {Object} params
     * @param {string} params.uuid - Unique device instance ID (generated once, stored locally)
     * @param {string} params.deviceName - Human-readable device name ("Emma's Steam Deck")
     */
    async initQRPairing(params) {
        return this._fetch('/api/pair/qr/init', {
            method: 'POST',
            body: JSON.stringify({
                uuid: params.uuid,
                name: params.deviceName,
                deviceToken: this.token,
                vid: this.vid,
                platform: params.platform || 'linux',
            }),
        });
    }

    /**
     * Initiate PIN-code pairing.
     * Returns a PIN that the parent enters in their Allow2 app.
     *
     * @param {Object} params
     * @param {string} params.uuid - Unique device instance ID
     * @param {string} params.deviceName - Human-readable device name
     */
    async initPINPairing(params) {
        return this._fetch('/api/pair/pin/init', {
            method: 'POST',
            body: JSON.stringify({
                uuid: params.uuid,
                name: params.deviceName,
                deviceToken: this.token,
                vid: this.vid,
                platform: params.platform || 'linux',
            }),
        });
    }

    /**
     * Poll pairing status (called while waiting for parent to confirm).
     *
     * @param {string} pairingSessionId - From initQRPairing/initPINPairing response
     */
    async checkPairingStatus(pairingSessionId) {
        return this._fetch('/api/pair/status/' + pairingSessionId);
    }

    /**
     * Check permissions for a child + activities.
     * Returns per-activity allowed/remaining status.
     */
    async check(params) {
        return this._fetch('/serviceapi/check', {
            method: 'POST',
            body: JSON.stringify({
                userId: params.userId,
                pairId: params.pairId,
                pairToken: params.pairToken,
                deviceToken: this.token,
                tz: params.tz,
                childId: params.childId,
                activities: params.activities,
                log: params.log !== undefined ? params.log : true,
            }),
        });
    }

    /**
     * Poll for updates (extensions, day type changes, quota updates, bans, child data).
     */
    async getUpdates(params) {
        const query = new URLSearchParams({
            userId: String(params.userId),
            pairId: String(params.pairId),
            pairToken: params.pairToken,
            deviceToken: this.token,
        });
        if (params.timestampMillis) {
            query.set('timestampMillis', String(params.timestampMillis));
        }
        return this._fetch('/api/getUpdates?' + query.toString());
    }

    /**
     * Create a "Request More Time" request from a child.
     */
    async createRequest(params) {
        return this._fetch('/api/request/createRequest', {
            method: 'POST',
            body: JSON.stringify({
                userId: params.userId,
                pairId: params.pairId,
                pairToken: params.pairToken,
                childId: params.childId,
                duration: params.duration,
                activity: params.activity,
                message: params.message,
            }),
        });
    }

    /**
     * Poll request approval status.
     */
    async getRequestStatus(requestId, statusSecret) {
        return this._fetch('/api/request/' + requestId + '/status', {
            headers: {
                'X-Status-Secret': statusSecret,
            },
        });
    }

    // ----------------------------------------------------------------
    // Feedback
    // ----------------------------------------------------------------

    /**
     * Submit feedback from a device/child to the Allow2 server.
     *
     * @param {object} params
     * @param {number} params.userId
     * @param {number} params.pairId
     * @param {string} params.pairToken
     * @param {number} [params.childId]
     * @param {number} [params.vid]
     * @param {string} params.category - One of: bypass, missing_feature, not_working, question, other
     * @param {string} params.message
     * @param {object} [params.deviceContext]
     * @returns {Promise<{ discussionId: string }>}
     */
    async submitFeedback(params) {
        return this._fetch('/api/feedback/submit', {
            method: 'POST',
            body: JSON.stringify({
                userId: params.userId,
                pairId: params.pairId,
                pairToken: params.pairToken,
                childId: params.childId,
                vid: params.vid || this.vid,
                category: params.category,
                message: params.message,
                deviceContext: params.deviceContext,
            }),
        });
    }

    /**
     * Load feedback discussions for a device.
     *
     * @param {object} params
     * @param {number} params.userId
     * @param {number} params.pairId
     * @param {string} params.pairToken
     * @returns {Promise<{ discussions: Array }>}
     */
    async loadFeedback(params) {
        return this._fetch('/api/feedback/load', {
            method: 'POST',
            body: JSON.stringify({
                userId: params.userId,
                pairId: params.pairId,
                pairToken: params.pairToken,
            }),
        });
    }

    /**
     * Reply to an existing feedback discussion.
     *
     * @param {object} params
     * @param {number} params.userId
     * @param {number} params.pairId
     * @param {string} params.pairToken
     * @param {string} params.discussionId
     * @param {string} params.message
     * @returns {Promise<{ messageId: string }>}
     */
    async feedbackReply(params) {
        return this._fetch('/api/feedback/reply', {
            method: 'POST',
            body: JSON.stringify({
                userId: params.userId,
                pairId: params.pairId,
                pairToken: params.pairToken,
                discussionId: params.discussionId,
                message: params.message,
            }),
        });
    }

    // ----------------------------------------------------------------
    // Usage Logging
    // ----------------------------------------------------------------

    /**
     * Log usage explicitly (e.g., reconcile after offline period).
     */
    async logUsage(params) {
        return this._fetch('/api/logUsage', {
            method: 'POST',
            body: JSON.stringify({
                userId: params.userId,
                pairId: params.pairId,
                pairToken: params.pairToken,
                deviceToken: this.token,
                childId: params.childId,
                activities: params.activities,
            }),
        });
    }
}
