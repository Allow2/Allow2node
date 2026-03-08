/**
 * Allow2 Device SDK v2
 *
 * Parental controls for apps and devices.
 * https://developer.allow2.com
 */

// Core
export { DeviceDaemon } from './daemon.js';
export { ChildShield } from './child-shield.js';
export { PairingWizard } from './pairing.js';
export { Allow2Api } from './api.js';

// Utilities
export { UpdatePoller } from './updates.js';
export { RequestManager } from './request.js';
export { OfflineHandler } from './offline.js';

// Credential backends
export { createBackend, PlaintextBackend } from './credentials/index.js';

// Child resolvers
export { resolveChild as resolveLinuxUser } from './child-resolver/linux-user.js';
