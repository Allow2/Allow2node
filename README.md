# Allow2 SDK for Node.js

[![npm version](https://img.shields.io/npm/v/allow2.svg?style=flat-square)](https://www.npmjs.com/package/allow2)
[![npm downloads](https://img.shields.io/npm/dm/allow2.svg?style=flat-square)](https://www.npmjs.com/package/allow2)
[![Node.js CI](https://img.shields.io/github/actions/workflow/status/Allow2/allow2node/ci.yml?style=flat-square)](https://github.com/Allow2/allow2node/actions)

Official Allow2 Parental Freedom SDK for Node.js.

| | |
|---|---|
| **Package** | `allow2` |
| **Targets** | Node.js 18+ (ESM, `"type": "module"`) |
| **Dependencies** | None (uses native `fetch`) |
| **Language** | JavaScript (ES Modules) |

## Installation

```bash
npm install allow2
```

## Quick Start

```js
import { DeviceDaemon } from 'allow2';
import { PlaintextBackend } from 'allow2/credentials/plaintext.js';

const daemon = new DeviceDaemon({
    deviceName: 'Living Room PC',
    activities: [{ id: 1 }, { id: 8 }],        // Internet + Screen Time
    credentialBackend: new PlaintextBackend(),
    childResolver: { resolve: (children) => null },  // interactive selection
});

daemon.on('pairing-required', ({ pin, qrUrl }) => {
    console.log(`Enter PIN: ${pin}`);
});
daemon.on('child-select-required', ({ children }) => {
    console.log('Select a child:', children.map(c => c.name));
});
daemon.on('warning', ({ level, remaining }) => {
    console.log(`Warning: ${level}, ${remaining}s left`);
});
daemon.on('soft-lock', () => console.log('Time is up!'));

await daemon.start();
await daemon.openApp();  // triggers pairing if unpaired
```

## Modules

| Module | File | Purpose |
|--------|------|---------|
| **Daemon** | `daemon.js` | Main orchestrator managing the full device lifecycle |
| **API Client** | `api.js` | Fetch-based REST client for all Allow2 endpoints |
| **Pairing** | `pairing.js` | Express-based pairing wizard (QR code + PIN display) |
| **Child Shield** | `child-shield.js` | PIN hashing (SHA-256 + salt), rate limiting, session timeout |
| **Checker** | `checker.js` | Permission check loop with per-activity enforcement and stacking |
| **Warnings** | `warnings.js` | Configurable progressive warning scheduler |
| **Offline** | `offline.js` | Response cache, grace period, deny-by-default fallback |
| **Request** | `request.js` | "Request More Time" flow with polling |
| **Updates** | `updates.js` | Poll for children, quota, ban, and day type changes |
| **Credentials** | `credentials/` | `PlaintextBackend` default + pluggable `createBackend()` factory |
| **Child Resolvers** | `child-resolver/` | OS username mapping (`linux-user.js`) and interactive selector |

## Permission Checks

```js
// The check loop runs automatically once a child is selected.
// Listen for results:
daemon.on('check-result', (result) => {
    for (const [id, activity] of Object.entries(result.activities)) {
        console.log(`${id}: allowed=${activity.allowed}, remaining=${activity.remaining}s`);
    }
    console.log(`Today: ${result.dayTypes.today}, Tomorrow: ${result.dayTypes.tomorrow}`);
});
```

## Request More Time

```js
// Child requests 30 more minutes of gaming
const { requestId, statusSecret } = await daemon.requestMoreTime({
    activity: 3,        // Gaming
    duration: 30,       // minutes
    message: "Can I please have more time? Almost done with this level.",
});

// Poll until parent responds
const status = await daemon.pollRequestStatus(requestId, statusSecret);

if (status.status === 'approved') {
    console.log(`Approved! ${status.duration} extra minutes.`);
} else if (status.status === 'denied') {
    console.log('Request denied.');
}
```

## Feedback

```js
// Submit feedback
const { discussionId } = await daemon.submitFeedback({
    category: 'not_working',
    message: 'The block screen appears even when time is remaining.',
});

// Load feedback threads
const { discussions } = await daemon.loadDeviceFeedback();
for (const thread of discussions) {
    console.log(`[${thread.category}] ${thread.status} - ${thread.messageCount} messages`);
}

// Reply to a thread
await daemon.replyToFeedback(discussionId, 'This happens every Tuesday.');
```

## Warnings

The SDK fires progressive warnings as time runs out:

```
15 min -> 5 min -> 1 min -> 30 sec -> 10 sec -> BLOCKED
```

```js
daemon.on('warning', ({ level, remaining }) => {
    // level: '15min', '5min', '1min', '30sec', '10sec'
    showWarningBanner(`${remaining} seconds remaining`);
});

daemon.on('soft-lock', () => {
    showBlockScreen();
});
```

## Credential Storage

The SDK uses a pluggable credential backend. The default `PlaintextBackend` writes to `~/.allow2/credentials.json` with `chmod 600`.

For production, implement the interface with platform-specific secure storage:

```js
const myBackend = {
    async load() {
        // Return { userId, pairId, pairToken, children } or null
    },
    async store(credentials) {
        // Persist credentials (Keychain, Secret Service, DPAPI, etc.)
    },
    async clear() {
        // Remove stored credentials
    },
};
```

## Target Platforms

| Platform | Notes |
|----------|-------|
| **Linux** | allow2linux daemon (Steam Deck, desktop) |
| **macOS** | Desktop apps, Electron |
| **Windows** | Desktop apps, Electron |
| **Embedded** | Any device with Node.js 18+ |
| **Server** | Service-side integrations |

## Architecture

The SDK follows the Allow2 Device Operational Lifecycle:

1. **Pairing** (one-time) -- QR code or 6-digit PIN, parent never enters credentials on device
2. **Child Identification** (every session) -- OS account mapping, child selector with PIN, or verification via the child's Allow2 app (iOS/Android) or web portal
3. **Parent Access** -- parent verifies via their Allow2 app or locally with PIN for unrestricted mode
4. **Permission Checks** (continuous) -- POST to service URL every 30-60s with `log: true`
5. **Warnings & Countdowns** -- progressive alerts before blocking
6. **Request More Time** -- child requests, parent approves/denies from their phone (also works offline)
7. **Feedback** -- bug reports and feature requests sent directly to you, the developer

All API communication uses native `fetch` with no external dependencies. The check endpoint POSTs to the **service URL** (`service.allow2.com`), while all other endpoints use the **API URL** (`api.allow2.com`).

Environment overrides via `ALLOW2_API_URL`, `ALLOW2_VID`, and `ALLOW2_TOKEN` environment variables.

## License

See [LICENSE](LICENSE) for details.
