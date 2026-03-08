/**
 * Pairing Wizard
 *
 * Serves a local web UI for one-time device pairing.
 * Parents NEVER enter credentials on the child's device.
 *
 * Flow:
 * 1. Wizard starts Express server on localhost
 * 2. Generates a 6-digit PIN and displays it on the web page
 * 3. Parent opens Allow2 app on their phone, enters the PIN (or scans QR code)
 * 4. Server receives callback when parent confirms from their phone
 * 5. On confirmation, receives pairing data (userId, pairToken, children) from callback
 * 6. Stores credentials via the credential backend
 * 7. Shuts down Express server
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
     */
    constructor(options) {
        super();
        this._api = options.api;
        this._credentialBackend = options.credentialBackend;
        this._port = options.port || 3000;

        this._pin = null;
        this._paired = false;
        this._pairingResult = null;
        this._server = null;
        this._app = null;
    }

    /**
     * Start the Express server, generate a PIN, and begin listening.
     * @returns {Promise<{ pin: string, port: number, url: string }>}
     */
    async start() {
        this._pin = _generatePin();
        this._paired = false;
        this._pairingResult = null;

        this._app = express();
        this._app.use(express.json());

        this._setupRoutes();

        return new Promise((resolve, reject) => {
            try {
                this._server = this._app.listen(this._port, () => {
                    const info = {
                        pin: this._pin,
                        port: this._port,
                        url: 'http://localhost:' + this._port,
                    };
                    this.emit('started', { pin: this._pin, port: this._port });
                    resolve(info);
                });

                this._server.on('error', (err) => {
                    this.emit('error', err);
                    reject(err);
                });
            } catch (err) {
                this.emit('error', err);
                reject(err);
            }
        });
    }

    /**
     * Shut down the Express server.
     * @returns {Promise<void>}
     */
    async stop() {
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
     * Called when the server receives pairing confirmation from Allow2.
     * The Allow2 server sends the credentials directly in the callback.
     * Stores credentials via the credential backend and emits 'paired'.
     *
     * @param {object} pairingData - Data received from the Allow2 callback
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

            const credentials = {
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

            // Auto-terminate the wizard server after successful pairing
            await this.stop();

            return credentials;
        } catch (err) {
            this.emit('error', err);
            throw err;
        }
    }

    // ── Internal ──────────────────────────────────────────────

    _setupRoutes() {
        // GET / — Serve the pairing page
        this._app.get('/', (_req, res) => {
            res.type('html').send(_buildPairingPage(this._pin, this._port));
        });

        // GET /status — Polling endpoint for the web page
        this._app.get('/status', (_req, res) => {
            res.json({
                paired: this._paired,
                result: this._paired ? { userId: this._pairingResult.userId } : null,
            });
        });

        // POST /pair-callback — Receive pairing data from Allow2 server
        this._app.post('/pair-callback', async (req, res) => {
            if (this._paired) {
                res.status(409).json({ error: 'Already paired' });
                return;
            }

            const body = req.body;
            if (!body || !body.userId || !body.pairId || !body.pairToken) {
                res.status(400).json({ error: 'Missing required fields (userId, pairId, pairToken)' });
                return;
            }

            // PIN verification is mandatory
            if (!body.pin || body.pin !== this._pin) {
                res.status(403).json({ error: 'PIN mismatch' });
                return;
            }

            try {
                const credentials = await this.completePairing(body);
                res.json({ success: true, userId: credentials.userId });
            } catch (err) {
                res.status(500).json({ error: err.message || 'Pairing failed' });
            }
        });

        // GET /success — Success confirmation page
        this._app.get('/success', (_req, res) => {
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
    // Generate a number between 0 and 999999, zero-padded to 6 digits
    const num = crypto.randomInt(0, 1000000);
    return String(num).padStart(6, '0');
}

/**
 * Generate a random UUID v4 for the device.
 * @returns {string}
 */
function _generateUUID() {
    return crypto.randomUUID();
}

/**
 * Build the self-contained HTML pairing page.
 * @param {string} pin
 * @param {number} port
 * @returns {string}
 */
function _buildPairingPage(pin, port) {
    // Split PIN into individual digits for display
    const digits = pin.split('').map(function(d) {
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
