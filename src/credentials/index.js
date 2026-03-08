/**
 * Credential Backend Factory
 *
 * Provides a unified interface for credential storage.
 * Currently supports 'plaintext' (JSON file). The 'libsecret' backend
 * is available on Linux systems with libsecret installed.
 */

import { PlaintextBackend } from './plaintext.js';

/**
 * Create a credential storage backend.
 *
 * @param {string} type    - Backend type: 'plaintext' or 'libsecret'
 * @param {object} [options] - Backend-specific options
 * @returns {PlaintextBackend|LibsecretBackend}
 */
export async function createBackend(type, options) {
    if (type === 'plaintext') {
        return new PlaintextBackend(options);
    }

    if (type === 'libsecret') {
        // Lazy-load to avoid hard dependency on libsecret native module.
        // Users who want libsecret must install the optional peer dependency.
        let LibsecretBackend;
        try {
            const mod = await import('./libsecret.js');
            LibsecretBackend = mod.LibsecretBackend;
        } catch (_err) {
            throw new Error(
                'libsecret backend requires the "libsecret" package. ' +
                'Install it with: npm install libsecret'
            );
        }
        return new LibsecretBackend(options);
    }

    throw new Error('Unknown credential backend type: ' + type);
}

export { PlaintextBackend } from './plaintext.js';
