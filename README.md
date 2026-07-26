# Allow2 SDK for Node.js

[![npm version](https://img.shields.io/npm/v/allow2.svg?style=flat-square)](https://www.npmjs.com/package/allow2)
[![npm downloads](https://img.shields.io/npm/dm/allow2.svg?style=flat-square)](https://www.npmjs.com/package/allow2)
[![Node.js CI](https://img.shields.io/github/actions/workflow/status/Allow2/allow2node/ci.yml?style=flat-square)](https://github.com/Allow2/allow2node/actions)

> **Developer Resources** -- The [Allow2 MCP Server](https://mcp.allow2.com) provides comprehensive API documentation, integration guides, architecture overviews, and interactive examples. Connect it to your AI coding assistant for the best development experience. **Start there.**

Official Allow2 Parental Freedom **Device SDK** for Node.js — for software that runs on a child's device (games, desktop apps, IoT, set-top boxes).

> **Building a web service with user accounts?** Use [`allow2-service`](https://github.com/Allow2/Allow2node-service) (the [Service SDK](https://www.npmjs.com/package/allow2-service)) instead. Device and Service SDKs are separate packages.

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
| **Request** | `request.js` | Request flow (more time, day type change, ban lift) with polling |
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

## Usage-Auth Events (plane-2)

When someone identifies themselves to **start a usage session** on the device — enters the
account/child PIN, passes an offline 6-digit / QR self-auth, or is locally auto-identified —
report it so the server can alert the account holder (and other parents) and keep an audit trail:

```js
// Call this the moment a usage-auth succeeds locally (e.g. on PIN success).
// The device has ALREADY authorized locally (offline-first); this is a
// notification + audit signal, not an authorization.
await daemon.reportAuthEvent({
    method: 'pin',        // 'pin' | 'offline_code' | 'qr' (anything else => generic 'token')
    // childId defaults to the currently selected child
});

daemon.on('auth-event-reported', ({ childId, method }) => {
    console.log(`Reported ${method} auth for child ${childId}`);
});
```

Best-effort, exactly like `logUsage`: a single POST over the paired-device seam, with **no offline
queue or replay** — the server does not deduplicate, so a replayed event would double-notify the
parent. The SDK exposes the capability; your enforcer decides when to call it.

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
3. **Parent Access** -- parent verifies via their Allow2 app (iOS/Android), web portal, or locally with PIN for unrestricted mode
4. **Permission Checks** (continuous) -- POST to service URL every 30-60s with `log: true`
5. **Warnings & Countdowns** -- progressive alerts before blocking
6. **Requests** -- child requests changes (more time, day type change, ban lift), parent approves/denies from their phone (also works offline via voice codes)
7. **Feedback** -- bug reports and feature requests sent directly to you, the developer

All API communication uses native `fetch` with no external dependencies. The check endpoint POSTs to the **service URL** (`service.allow2.com`), while all other endpoints use the **API URL** (`api.allow2.com`).

Environment overrides via `ALLOW2_API_URL`, `ALLOW2_VID`, and `ALLOW2_TOKEN` environment variables.

## Offline Operation

Once a device is paired, Allow2 remains fully configurable even when the device is offline. The parent can still manage the child's limits, approve requests, and change settings from their Allow2 app or the web portal -- changes are synchronised the next time the device connects.

On the device side:

- **Cached permissions** -- the last successful check result is cached locally. During a configurable grace period (default 5 minutes), the device continues to enforce the cached result.
- **Deny-by-default** -- after the grace period expires without connectivity, all activities are blocked. This prevents children from bypassing controls by disabling Wi-Fi or enabling airplane mode.
- **Requests (offline)** -- children can still submit all request types (more time, day type change, ban lift) even when the device is offline. The request is presented to the parent via their app or a voice code that can be read over the phone. The parent approves or denies from their end, and the device applies the result when connectivity resumes (or immediately via a voice code response entered locally).
- **Automatic resync** -- when the device comes back online, it immediately fetches the latest permissions, processes any queued requests, and resumes normal check polling.

This means a paired device is never "unmanageable" -- the parent always has control, regardless of the device's network state.

## License

See [LICENSE](LICENSE) for details.
