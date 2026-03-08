/**
 * Linux User Child Resolver
 *
 * Maps the current Linux OS user account to an Allow2 child.
 * If the logged-in username matches a child's name (case-insensitive),
 * that child is auto-selected without requiring a UI selector.
 *
 * If no match is found, returns null — the caller should fall back
 * to the interactive selector and emit 'child-select-required'.
 *
 * @example
 *   import { resolveChild } from './child-resolver/linux-user.js';
 *
 *   const match = await resolveChild(children);
 *   if (match) {
 *       await childShield.selectChild(match.childId, pin);
 *   }
 */

import { execSync } from 'node:child_process';

/**
 * Get the current Linux username.
 * Prefers the USER environment variable; falls back to `whoami`.
 *
 * @returns {string} The current username, or empty string on failure.
 */
function getLinuxUsername() {
    if (process.env.USER) {
        return process.env.USER;
    }
    try {
        return execSync('whoami', { encoding: 'utf8' }).trim();
    } catch (_err) {
        return '';
    }
}

/**
 * Resolve the current Linux user to an Allow2 child.
 *
 * Matching is case-insensitive against each child's `name` field.
 * Children may also have an optional `osUsername` field for explicit mapping.
 *
 * @param {Array} children - Array of child objects from pairing data.
 * @returns {{ childId: number, childName: string } | null}
 */
export function resolveChild(children) {
    if (!children || children.length === 0) {
        return null;
    }

    const username = getLinuxUsername();
    if (!username) {
        return null;
    }

    const lower = username.toLowerCase();

    for (let i = 0; i < children.length; i++) {
        const child = children[i];

        // Skip the parent entry
        if (child.id === 0 || child.name === '__parent__') {
            continue;
        }

        // Explicit OS username mapping takes priority
        if (child.osUsername && child.osUsername.toLowerCase() === lower) {
            return { childId: child.id, childName: child.name };
        }

        // Fall back to name match
        if (child.name && child.name.toLowerCase() === lower) {
            return { childId: child.id, childName: child.name };
        }
    }

    return null;
}
