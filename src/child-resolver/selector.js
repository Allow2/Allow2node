/**
 * Interactive Child Selector Resolver
 *
 * For devices without OS-level account mapping (shared single-login devices,
 * IoT, consoles, kiosks). This resolver does not attempt automatic resolution;
 * it simply signals that a child selector UI must be shown.
 *
 * The actual selection happens when the integration calls
 * `childShield.selectChild(childId, pin)` after the user picks a child.
 *
 * @example
 *   import { resolveChild } from './child-resolver/selector.js';
 *   import { ChildShield } from '../child-shield.js';
 *
 *   const shield = new ChildShield({ children });
 *   const match = resolveChild(children);
 *   // match is always null — listen for the event instead:
 *   shield.on('child-select-required', (children) => {
 *       showSelectorUI(children);
 *   });
 *   // Trigger it:
 *   requestSelection(shield);
 */

/**
 * Attempt to resolve a child automatically.
 * Always returns null — this resolver requires manual selection.
 *
 * @param {Array} children - Array of child objects from pairing data.
 * @returns {null} Always null; selection must happen via UI.
 */
export function resolveChild(children) {
    // No automatic resolution possible on shared devices.
    // The integration must show a child selector and call
    // childShield.selectChild() when the user picks one.
    return null;
}

/**
 * Request that the child shield emit a selection event.
 * Call this at boot or session start on shared devices.
 *
 * @param {import('../child-shield.js').ChildShield} childShield - The ChildShield instance.
 */
export function requestSelection(childShield) {
    if (childShield && typeof childShield.emit === 'function') {
        childShield.emit('child-select-required', childShield.getChildren());
    }
}
