/**
 * Offline Handler
 *
 * Caches the last successful check result and enforces a grace period
 * when the device loses connectivity. After the grace period expires,
 * defaults to DENY (block all activities).
 *
 * Cache is held in memory and persisted to disk so it survives daemon restarts.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_GRACE_PERIOD = 300; // seconds
const DEFAULT_CACHE_PATH = path.join(os.homedir(), '.allow2', 'cache.json');

export class OfflineHandler extends EventEmitter {

    /**
     * @param {object} [options]
     * @param {number} [options.gracePeriod] - Seconds before deny-by-default kicks in (default 300)
     * @param {string} [options.cachePath]   - Path to the disk cache file
     */
    constructor(options = {}) {
        super();
        this._gracePeriod = options.gracePeriod != null ? options.gracePeriod : DEFAULT_GRACE_PERIOD;
        this._cachePath = options.cachePath || DEFAULT_CACHE_PATH;
        this._cached = null;       // { result, timestamp }
        this._loaded = false;
    }

    /**
     * Store a successful check result in memory and persist to disk.
     *
     * @param {object} checkResult - The raw API check response
     */
    async cacheResult(checkResult) {
        this._cached = {
            result: checkResult,
            timestamp: Date.now(),
        };

        await this._writeDisk(this._cached);
    }

    /**
     * Return the cached check result, loading from disk on first call if needed.
     * Returns null if no cache exists.
     *
     * @returns {Promise<object|null>} The cached check result or null
     */
    async getCachedResult() {
        if (!this._loaded) {
            await this._loadDisk();
        }
        if (!this._cached) {
            return null;
        }
        return this._cached.result;
    }

    /**
     * Seconds elapsed since the last successful check.
     * Returns Infinity if no cached result exists.
     *
     * @returns {Promise<number>}
     */
    async getGraceElapsed() {
        if (!this._loaded) {
            await this._loadDisk();
        }
        if (!this._cached) {
            return Infinity;
        }
        return Math.floor((Date.now() - this._cached.timestamp) / 1000);
    }

    /**
     * True if we are still within the grace period.
     *
     * @returns {Promise<boolean>}
     */
    async isInGracePeriod() {
        const elapsed = await this.getGraceElapsed();
        if (elapsed < this._gracePeriod) {
            this.emit('offline-grace', elapsed);
            return true;
        }
        return false;
    }

    /**
     * True if the grace period has expired and we should deny by default.
     *
     * @returns {Promise<boolean>}
     */
    async shouldDeny() {
        const elapsed = await this.getGraceElapsed();
        if (elapsed >= this._gracePeriod) {
            this.emit('offline-deny');
            return true;
        }
        return false;
    }

    // ── Internal ──────────────────────────────────────────────

    async _writeDisk(data) {
        try {
            const dir = path.dirname(this._cachePath);
            await fs.mkdir(dir, { recursive: true, mode: 0o700 });
            await fs.writeFile(this._cachePath, JSON.stringify(data), { mode: 0o600 });
        } catch (_err) {
            // Disk write failure is non-fatal — memory cache still works
        }
    }

    async _loadDisk() {
        this._loaded = true;
        try {
            const raw = await fs.readFile(this._cachePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.result && typeof parsed.timestamp === 'number') {
                this._cached = parsed;
            }
        } catch (_err) {
            // No cache file or corrupt — start fresh
        }
    }
}
