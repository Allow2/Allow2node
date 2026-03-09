/**
 * Plaintext Credential Backend
 *
 * Stores pairing credentials as a JSON file in ~/.allow2/credentials.json.
 * File permissions are locked down to owner-only (0o600).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_PATH = path.join(os.homedir(), '.allow2', 'credentials.json');

export class PlaintextBackend {

    /**
     * @param {object} [options]
     * @param {string} [options.path] - Override the credential file path
     */
    constructor(options = {}) {
        this._path = options.path || DEFAULT_PATH;
    }

    /**
     * Persist credentials to disk.
     *
     * @param {object} data - { userId, pairId, pairToken, deviceToken, children }
     */
    async store(data) {
        const dir = path.dirname(this._path);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await fs.writeFile(this._path, JSON.stringify(data, null, 2), { mode: 0o600 });
    }

    /**
     * Load credentials from disk.
     *
     * @returns {Promise<object|null>} The stored data or null if missing/corrupt
     */
    async load() {
        try {
            const raw = await fs.readFile(this._path, 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            if (err.code === 'ENOENT') {
                return null;
            }
            throw err;
        }
    }

    /**
     * Delete the credential file.
     */
    async clear() {
        try {
            await fs.unlink(this._path);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }

    /**
     * Load last-used timestamps for all children.
     *
     * @returns {Promise<object>} Map of childId (string) to ISO timestamp string, or {} if missing/corrupt
     */
    async loadLastUsed() {
        var lastUsedPath = path.join(path.dirname(this._path), 'last-used.json');
        try {
            var raw = await fs.readFile(lastUsedPath, 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            if (err.code === 'ENOENT') {
                return {};
            }
            return {};
        }
    }

    /**
     * Update the last-used timestamp for a specific child.
     *
     * @param {number|string} childId - The child ID to update
     */
    async updateLastUsed(childId) {
        var lastUsedPath = path.join(path.dirname(this._path), 'last-used.json');
        var data = await this.loadLastUsed();
        data[String(childId)] = new Date().toISOString();
        var dir = path.dirname(lastUsedPath);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await fs.writeFile(lastUsedPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    }
}
