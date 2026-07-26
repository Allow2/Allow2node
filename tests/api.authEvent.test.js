/**
 * Tests for the plane-2 usage-auth report path:
 *   - Allow2Api.reportAuthEvent  -> POST /api/authEvent with the pairToken seam + method/childId
 *   - DeviceDaemon.reportAuthEvent -> pulls creds, defaults childId to the selected child, emits event
 *
 * The HTTP layer is mocked by stubbing global.fetch, so no live endpoint is touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Allow2Api } from '../src/api.js';
import { DeviceDaemon } from '../src/daemon.js';

/** Install a fake fetch that records the call and returns a JSON 200. Returns { calls, restore }. */
function stubFetch(responseBody = { status: 'success' }, status = 200) {
    const original = global.fetch;
    const calls = [];
    global.fetch = async function (url, options) {
        calls.push({ url, options });
        return {
            ok: status >= 200 && status < 300,
            status,
            async json() { return responseBody; },
        };
    };
    return { calls, restore() { global.fetch = original; } };
}

test('Allow2Api.reportAuthEvent POSTs the exact /api/authEvent contract', async () => {
    const { calls, restore } = stubFetch({ status: 'success' });
    try {
        const api = new Allow2Api({ apiUrl: 'https://example.test', vid: 42, token: 'devtok' });
        const res = await api.reportAuthEvent({
            userId: 'owner-uuid',
            pairId: 7,
            pairToken: 'pair-secret',
            childId: 'child-uuid',
            method: 'pin',
        });

        assert.equal(res.status, 'success');
        assert.equal(calls.length, 1);

        const { url, options } = calls[0];
        assert.equal(url, 'https://example.test/api/authEvent');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');

        const body = JSON.parse(options.body);
        assert.deepEqual(body, {
            userId: 'owner-uuid',
            pairId: 7,
            pairToken: 'pair-secret',
            deviceToken: 'devtok',   // pulled from the client's version token (like logUsage)
            childId: 'child-uuid',
            method: 'pin',
        });
    } finally {
        restore();
    }
});

test('Allow2Api.reportAuthEvent surfaces a 401 as an error (best-effort, no swallow)', async () => {
    const { restore } = stubFetch({ status: 'error', message: 'Invalid request.' }, 401);
    try {
        const api = new Allow2Api({ apiUrl: 'https://example.test', vid: 42, token: 'devtok' });
        await assert.rejects(
            () => api.reportAuthEvent({ userId: 'o', pairId: 1, pairToken: 'p', method: 'pin' }),
            (err) => err.status === 401,
        );
    } finally {
        restore();
    }
});

test('DeviceDaemon.reportAuthEvent uses stored creds, defaults childId, and emits', async () => {
    const daemon = new DeviceDaemon({
        activities: [{ id: 1 }],
        credentialBackend: { async load() { return null; }, async store() {}, async clear() {} },
        childResolver: { resolve() { return null; } },
    });

    // Simulate a paired + child-selected device without touching the network.
    daemon._credentials = { userId: 'owner-uuid', pairId: 7, pairToken: 'pair-secret', children: [] };
    daemon._childId = 'selected-child';

    let apiParams = null;
    daemon._api.reportAuthEvent = async (params) => { apiParams = params; return { status: 'success' }; };

    let emitted = null;
    daemon.on('auth-event-reported', (e) => { emitted = e; });

    const res = await daemon.reportAuthEvent({ method: 'offline_code' });

    assert.equal(res.status, 'success');
    assert.deepEqual(apiParams, {
        userId: 'owner-uuid',
        pairId: 7,
        pairToken: 'pair-secret',
        childId: 'selected-child',   // defaulted from the selected child
        method: 'offline_code',
    });
    assert.deepEqual(emitted, { childId: 'selected-child', method: 'offline_code' });
});

test('DeviceDaemon.reportAuthEvent throws when the device is not paired', async () => {
    const daemon = new DeviceDaemon({
        activities: [{ id: 1 }],
        credentialBackend: { async load() { return null; }, async store() {}, async clear() {} },
        childResolver: { resolve() { return null; } },
    });
    daemon._credentials = null;

    await assert.rejects(() => daemon.reportAuthEvent({ method: 'pin' }), /not paired/i);
});
