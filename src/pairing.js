/**
 * Pairing Wizard
 *
 * Manages one-time device pairing with the Allow2 platform.
 * Parents NEVER enter credentials on the child's device.
 *
 * Flow:
 * 1. Wizard calls API to register a pairing session (initPINPairing)
 * 2. API returns a server-assigned PIN and session ID
 * 3. Device displays the PIN (and QR code deep link) to the user
 * 4. Parent opens Allow2 app on their phone, enters the PIN (or scans QR code)
 * 5. Wizard polls checkPairingStatus until parent confirms
 * 6. On confirmation, receives credentials (userId, pairId, pairToken, children)
 * 7. Stores credentials via the credential backend
 *
 * Optionally starts a local Express server on localhost for a web UI
 * showing the PIN — this is a convenience, not required for pairing.
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import express from 'express';

export class PairingWizard extends EventEmitter {

    /**
     * @param {object} options
     * @param {import('./api.js').Allow2Api} options.api
     * @param {object} options.credentialBackend - { store(creds), load(), clear() }
     * @param {number} [options.port=3000]
     * @param {string} [options.deviceName] - Human-readable device name
     * @param {string} [options.uuid] - Persistent device UUID (generated if not provided)
     */
    constructor(options) {
        super();
        this._api = options.api;
        this._credentialBackend = options.credentialBackend;
        this._port = options.port || 3000;
        this._deviceName = options.deviceName || 'Linux PC';
        this._uuid = options.uuid || null;

        this._pin = null;
        this._sessionId = null;
        this._paired = false;
        this._pairingResult = null;
        this._server = null;
        this._app = null;
        this._pollTimer = null;
        this._qrUrl = null;
    }

    /**
     * Start the pairing flow:
     * 1. Register with the Allow2 API to get a server-assigned PIN
     * 2. Optionally start a local Express server for the web UI
     * 3. Begin polling for parent confirmation
     *
     * @returns {Promise<{ pin: string, port: number, url: string, qrUrl: string }>}
     */
    async start() {
        this._paired = false;
        this._pairingResult = null;

        // Generate or reuse device UUID
        if (!this._uuid) {
            this._uuid = await this._loadOrCreateUuid();
        }

        // Register pairing session with the Allow2 API
        var apiResult;
        try {
            console.log('[pairing] Calling initPINPairing (uuid=' + this._uuid + ', device=' + this._deviceName + ')');
            apiResult = await this._api.initPINPairing({
                uuid: this._uuid,
                deviceName: this._deviceName,
            });
            console.log('[pairing] API response: ' + JSON.stringify(apiResult));
        } catch (err) {
            // If the API call fails, fall back to local-only PIN mode
            // (e.g., API unreachable, VID not configured yet)
            console.warn('[pairing] API initPINPairing failed: ' + (err.message || err)
                + ' — falling back to local PIN mode');
            apiResult = null;
        }

        if (apiResult && apiResult.pin) {
            // Use server-assigned PIN and session ID
            this._pin = String(apiResult.pin);
            this._sessionId = apiResult.sessionId || apiResult.pairingSessionId || null;
            console.log('[pairing] Using server PIN: ' + this._pin + ' (session=' + this._sessionId + ')');
        } else {
            // Fallback: generate local PIN (won't work without API registration,
            // but at least shows something to the user)
            this._pin = _generatePin();
            this._sessionId = null;
            console.warn('[pairing] Using local PIN (no API session): ' + this._pin);
        }

        // Build QR deep link URL
        this._qrUrl = 'https://app.allow2.com/pair?pin=' + this._pin;

        // Start local Express server for web UI (optional, non-fatal if port busy)
        var port = this._port;
        try {
            await this._startExpress();
        } catch (err) {
            console.warn('[pairing] Express server failed on port ' + port + ': '
                + (err.message || err) + ' — pairing still works via PIN/QR');
            this._server = null;
            this._app = null;
        }

        // Start polling for pairing completion (if we have a session ID)
        if (this._sessionId) {
            this._startPolling();
        }

        var info = {
            pin: this._pin,
            port: port,
            url: 'http://localhost:' + port,
            qrUrl: this._qrUrl,
        };
        this.emit('started', { pin: this._pin, port: port, qrUrl: this._qrUrl });
        return info;
    }

    /**
     * Shut down: stop polling, stop Express server.
     * @returns {Promise<void>}
     */
    async stop() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }

        if (!this._server) return;

        return new Promise((resolve) => {
            this._server.close(() => {
                this._server = null;
                this._app = null;
                resolve();
            });
        });
    }

    /**
     * Return the current 6-digit PIN.
     * @returns {string|null}
     */
    getPin() {
        return this._pin;
    }

    /**
     * Return the QR deep link URL.
     * @returns {string|null}
     */
    getQrUrl() {
        return this._qrUrl;
    }

    /**
     * Called when pairing is confirmed (either via API polling or local callback).
     * Stores credentials via the credential backend and emits 'paired'.
     *
     * @param {object} pairingData - Data received from the Allow2 API
     * @param {number} pairingData.userId - Controller's user ID
     * @param {number} pairingData.pairId - Pairing ID
     * @param {string} pairingData.pairToken - Pairing token for subsequent API calls
     * @param {Array}  [pairingData.children] - List of children on this account
     */
    async completePairing(pairingData) {
        try {
            if (!pairingData.userId || !pairingData.pairId || !pairingData.pairToken) {
                throw new Error('Pairing callback missing required fields (userId, pairId, pairToken)');
            }

            var credentials = {
                userId: pairingData.userId,
                pairId: pairingData.pairId,
                pairToken: pairingData.pairToken,
                children: pairingData.children || [],
            };

            // Persist credentials
            await this._credentialBackend.store(credentials);

            this._paired = true;
            this._pairingResult = credentials;

            this.emit('paired', {
                userId: credentials.userId,
                pairToken: credentials.pairToken,
                children: credentials.children,
            });

            // Auto-terminate the wizard after successful pairing
            await this.stop();

            return credentials;
        } catch (err) {
            this.emit('error', err);
            throw err;
        }
    }

    // ── Internal ──────────────────────────────────────────────

    /**
     * Load existing device UUID from credential backend, or create one.
     */
    async _loadOrCreateUuid() {
        try {
            var creds = await this._credentialBackend.load();
            if (creds && creds.uuid) {
                return creds.uuid;
            }
        } catch (_err) { /* no creds yet */ }

        // Generate and persist a new UUID
        var uuid = crypto.randomUUID();
        try {
            // Store just the UUID for now (credentials will be overwritten on pairing)
            await this._credentialBackend.store({ uuid: uuid });
        } catch (_err) { /* best effort */ }
        return uuid;
    }

    /**
     * Start polling the Allow2 API for pairing confirmation.
     */
    _startPolling() {
        if (this._pollTimer) return;

        var self = this;
        var pollCount = 0;
        var maxPolls = 360; // 30 minutes at 5s intervals

        this._pollTimer = setInterval(function () {
            if (self._paired) {
                clearInterval(self._pollTimer);
                self._pollTimer = null;
                return;
            }

            pollCount++;
            if (pollCount > maxPolls) {
                clearInterval(self._pollTimer);
                self._pollTimer = null;
                self.emit('error', new Error('Pairing timed out after 30 minutes'));
                return;
            }

            self._api.checkPairingStatus(self._sessionId).then(function (result) {
                if (result && result.paired && result.userId && result.pairId && result.pairToken) {
                    self.completePairing(result);
                }
            }).catch(function (err) {
                // Polling errors are non-fatal — just retry next interval
                if (pollCount % 12 === 0) { // log every minute
                    console.warn('[pairing] Poll error:', err.message);
                }
            });
        }, 5000);
    }

    /**
     * Start the local Express server for the web UI.
     */
    _startExpress() {
        var self = this;
        this._app = express();
        this._app.use(express.json());
        this._setupRoutes();

        return new Promise(function (resolve, reject) {
            try {
                self._server = self._app.listen(self._port, function () {
                    resolve();
                });

                self._server.on('error', function (err) {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    _setupRoutes() {
        var self = this;

        // GET / — Serve the pairing page
        this._app.get('/', function (_req, res) {
            res.type('html').send(_buildPairingPage(self._pin, self._port, self._qrUrl));
        });

        // GET /status — Polling endpoint for the web page
        this._app.get('/status', function (_req, res) {
            res.json({
                paired: self._paired,
                result: self._paired ? { userId: self._pairingResult.userId } : null,
            });
        });

        // POST /pair-callback — Receive pairing data from Allow2 server (legacy callback)
        this._app.post('/pair-callback', async function (req, res) {
            if (self._paired) {
                res.status(409).json({ error: 'Already paired' });
                return;
            }

            var body = req.body;
            if (!body || !body.userId || !body.pairId || !body.pairToken) {
                res.status(400).json({ error: 'Missing required fields (userId, pairId, pairToken)' });
                return;
            }

            try {
                var credentials = await self.completePairing(body);
                res.json({ success: true, userId: credentials.userId });
            } catch (err) {
                res.status(500).json({ error: err.message || 'Pairing failed' });
            }
        });

        // GET /success — Success confirmation page
        this._app.get('/success', function (_req, res) {
            res.type('html').send(_buildSuccessPage());
        });
    }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 6-digit PIN.
 * @returns {string}
 */
function _generatePin() {
    var num = crypto.randomInt(0, 1000000);
    return String(num).padStart(6, '0');
}

/**
 * Build the self-contained HTML pairing page.
 * @param {string} pin
 * @param {number} port
 * @param {string} qrUrl
 * @returns {string}
 */
function _buildPairingPage(pin, port, qrUrl) {
    // Split PIN into individual digits for display
    var digits = pin.split('').map(function(d) {
        return '<span class="digit">' + d + '</span>';
    }).join('');

    return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Allow2 - Device Pairing</title>\n' +
'<style>\n' +
'* { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'body {\n' +
'  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\n' +
'  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n' +
'  min-height: 100vh;\n' +
'  display: flex;\n' +
'  align-items: center;\n' +
'  justify-content: center;\n' +
'  color: #333;\n' +
'}\n' +
'.card {\n' +
'  background: #fff;\n' +
'  border-radius: 16px;\n' +
'  box-shadow: 0 20px 60px rgba(0,0,0,0.3);\n' +
'  padding: 48px 40px;\n' +
'  max-width: 480px;\n' +
'  width: 90%;\n' +
'  text-align: center;\n' +
'}\n' +
'.logo {\n' +
'  font-size: 28px;\n' +
'  font-weight: 700;\n' +
'  color: #667eea;\n' +
'  margin-bottom: 8px;\n' +
'  letter-spacing: -0.5px;\n' +
'}\n' +
'.subtitle {\n' +
'  font-size: 14px;\n' +
'  color: #888;\n' +
'  margin-bottom: 32px;\n' +
'}\n' +
'.instruction {\n' +
'  font-size: 16px;\n' +
'  color: #555;\n' +
'  margin-bottom: 24px;\n' +
'  line-height: 1.5;\n' +
'}\n' +
'.pin-display {\n' +
'  display: flex;\n' +
'  justify-content: center;\n' +
'  gap: 10px;\n' +
'  margin: 32px 0;\n' +
'}\n' +
'.digit {\n' +
'  display: inline-flex;\n' +
'  align-items: center;\n' +
'  justify-content: center;\n' +
'  width: 56px;\n' +
'  height: 68px;\n' +
'  font-size: 36px;\n' +
'  font-weight: 700;\n' +
'  color: #333;\n' +
'  background: #f0f2ff;\n' +
'  border: 2px solid #dde0f5;\n' +
'  border-radius: 12px;\n' +
'}\n' +
'.status {\n' +
'  font-size: 14px;\n' +
'  color: #888;\n' +
'  margin-top: 32px;\n' +
'  display: flex;\n' +
'  align-items: center;\n' +
'  justify-content: center;\n' +
'  gap: 8px;\n' +
'}\n' +
'.spinner {\n' +
'  width: 16px;\n' +
'  height: 16px;\n' +
'  border: 2px solid #ddd;\n' +
'  border-top-color: #667eea;\n' +
'  border-radius: 50%;\n' +
'  animation: spin 0.8s linear infinite;\n' +
'}\n' +
'@keyframes spin { to { transform: rotate(360deg); } }\n' +
'.steps {\n' +
'  text-align: left;\n' +
'  margin: 24px 0;\n' +
'  padding: 0;\n' +
'  list-style: none;\n' +
'  counter-reset: step;\n' +
'}\n' +
'.steps li {\n' +
'  counter-increment: step;\n' +
'  font-size: 14px;\n' +
'  color: #555;\n' +
'  padding: 8px 0;\n' +
'  padding-left: 36px;\n' +
'  position: relative;\n' +
'  line-height: 1.4;\n' +
'}\n' +
'.steps li::before {\n' +
'  content: counter(step);\n' +
'  position: absolute;\n' +
'  left: 0;\n' +
'  top: 6px;\n' +
'  width: 24px;\n' +
'  height: 24px;\n' +
'  background: #667eea;\n' +
'  color: #fff;\n' +
'  border-radius: 50%;\n' +
'  display: flex;\n' +
'  align-items: center;\n' +
'  justify-content: center;\n' +
'  font-size: 12px;\n' +
'  font-weight: 600;\n' +
'}\n' +
'.error-msg {\n' +
'  color: #e53e3e;\n' +
'  font-size: 14px;\n' +
'  margin-top: 16px;\n' +
'  display: none;\n' +
'}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="card">\n' +
'  <div class="logo">Allow2</div>\n' +
'  <div class="subtitle">Device Pairing</div>\n' +
'\n' +
'  <p class="instruction">Enter this PIN in the Allow2 app on your phone to pair this device.</p>\n' +
'\n' +
'  <div class="pin-display">' + digits + '</div>\n' +
'\n' +
'  <ol class="steps">\n' +
'    <li>Open the <strong>Allow2</strong> app on your phone</li>\n' +
'    <li>Go to <strong>Devices</strong> and tap <strong>Add Device</strong></li>\n' +
'    <li>Enter the 6-digit PIN shown above</li>\n' +
'    <li>This page will update automatically when paired</li>\n' +
'  </ol>\n' +
'\n' +
'  <div class="status" id="status">\n' +
'    <div class="spinner"></div>\n' +
'    <span>Waiting for parent to confirm...</span>\n' +
'  </div>\n' +
'  <div class="error-msg" id="error"></div>\n' +
'</div>\n' +
'\n' +
'<script>\n' +
'(function() {\n' +
'  var pollInterval = 2000;\n' +
'  var errorCount = 0;\n' +
'  var maxErrors = 30;\n' +
'\n' +
'  function checkStatus() {\n' +
'    var xhr = new XMLHttpRequest();\n' +
'    xhr.open("GET", "/status", true);\n' +
'    xhr.timeout = 5000;\n' +
'\n' +
'    xhr.onload = function() {\n' +
'      if (xhr.status === 200) {\n' +
'        errorCount = 0;\n' +
'        try {\n' +
'          var data = JSON.parse(xhr.responseText);\n' +
'          if (data.paired) {\n' +
'            window.location.href = "/success";\n' +
'            return;\n' +
'          }\n' +
'        } catch (e) { /* ignore parse error */ }\n' +
'      }\n' +
'      setTimeout(checkStatus, pollInterval);\n' +
'    };\n' +
'\n' +
'    xhr.onerror = function() {\n' +
'      errorCount++;\n' +
'      if (errorCount >= maxErrors) {\n' +
'        var el = document.getElementById("error");\n' +
'        el.textContent = "Connection lost. Please refresh this page.";\n' +
'        el.style.display = "block";\n' +
'        return;\n' +
'      }\n' +
'      setTimeout(checkStatus, pollInterval);\n' +
'    };\n' +
'\n' +
'    xhr.ontimeout = xhr.onerror;\n' +
'    xhr.send();\n' +
'  }\n' +
'\n' +
'  setTimeout(checkStatus, pollInterval);\n' +
'})();\n' +
'</script>\n' +
'</body>\n' +
'</html>';
}

/**
 * Build the success page shown after pairing completes.
 * @returns {string}
 */
function _buildSuccessPage() {
    return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Allow2 - Paired Successfully</title>\n' +
'<style>\n' +
'* { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'body {\n' +
'  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\n' +
'  background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);\n' +
'  min-height: 100vh;\n' +
'  display: flex;\n' +
'  align-items: center;\n' +
'  justify-content: center;\n' +
'  color: #333;\n' +
'}\n' +
'.card {\n' +
'  background: #fff;\n' +
'  border-radius: 16px;\n' +
'  box-shadow: 0 20px 60px rgba(0,0,0,0.3);\n' +
'  padding: 48px 40px;\n' +
'  max-width: 480px;\n' +
'  width: 90%;\n' +
'  text-align: center;\n' +
'}\n' +
'.logo {\n' +
'  font-size: 28px;\n' +
'  font-weight: 700;\n' +
'  color: #48bb78;\n' +
'  margin-bottom: 8px;\n' +
'}\n' +
'.check {\n' +
'  width: 80px;\n' +
'  height: 80px;\n' +
'  margin: 24px auto;\n' +
'  background: #f0fff4;\n' +
'  border-radius: 50%;\n' +
'  display: flex;\n' +
'  align-items: center;\n' +
'  justify-content: center;\n' +
'  font-size: 40px;\n' +
'  color: #48bb78;\n' +
'  border: 3px solid #c6f6d5;\n' +
'}\n' +
'.message {\n' +
'  font-size: 20px;\n' +
'  font-weight: 600;\n' +
'  color: #2d3748;\n' +
'  margin: 16px 0 8px;\n' +
'}\n' +
'.detail {\n' +
'  font-size: 14px;\n' +
'  color: #718096;\n' +
'  line-height: 1.5;\n' +
'}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="card">\n' +
'  <div class="logo">Allow2</div>\n' +
'  <div class="check">&#10003;</div>\n' +
'  <div class="message">Device Paired Successfully</div>\n' +
'  <p class="detail">This device is now connected to your Allow2 account.<br>You can close this window.</p>\n' +
'</div>\n' +
'</body>\n' +
'</html>';
}
