/**
 * CheeseMate Web Push Notification Worker for Cloudflare Workers
 * 
 * Completely standalone, zero-dependency ES module implementation of:
 * - RFC 8292 (VAPID / Voluntary Application Server Identification for Web Push)
 * - RFC 8291 (Message Encryption for Web Push using 'aes128gcm')
 * - RFC 8188 (Encrypted Content-Encoding for HTTP)
 * 
 * Works out of the box with zero npm packages using standard Web Crypto API.
 * Can be deployed via Cloudflare API or pasted directly into Cloudflare Dashboard!
 */

// Default VAPID Keys for CheeseMate (can also be overridden via Worker Environment Variables)
const DEFAULT_VAPID_PUBLIC_KEY = 'BKg-LrqshpQPZ-hamsMkdCoo7ABvSFbBZpHcnlkYqpqRJ4M8UdI9WBqd79fL7YnIr0PbyKdaHhI-uSAhY4mL7hs';
const DEFAULT_VAPID_PRIVATE_KEY = 'aVDZhWCUmW_Z3f40UIDmU62JFw5EsrqmoVJrpvmFcOk';
const DEFAULT_VAPID_SUBJECT = 'mailto:yuvalkalan@gmail.com';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
};

// ============================================================================
// Base64Url and Binary Utilities
// ============================================================================

function base64UrlToUint8Array(base64Url) {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function uint8ArrayToBase64Url(uint8Array) {
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToUint8Array(str) {
    return new TextEncoder().encode(str);
}

function concatUint8Arrays(arrays) {
    const totalLength = arrays.reduce((acc, a) => acc + a.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

// ============================================================================
// Web Crypto VAPID (RFC 8292)
// ============================================================================

async function importVapidPrivateKey(privateKeyBase64Url, publicKeyBase64Url) {
    const pubBytes = base64UrlToUint8Array(publicKeyBase64Url);
    // Uncompressed P-256 public key is 65 bytes: 0x04 || X (32 bytes) || Y (32 bytes)
    const x = uint8ArrayToBase64Url(pubBytes.slice(1, 33));
    const y = uint8ArrayToBase64Url(pubBytes.slice(33, 65));

    const jwk = {
        kty: 'EC',
        crv: 'P-256',
        x: x,
        y: y,
        d: privateKeyBase64Url,
        ext: true
    };

    return await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
}

async function createVapidToken(audience, subject, cryptoPrivateKey, publicKeyBase64Url) {
    const header = { typ: 'JWT', alg: 'ES256' };
    const exp = Math.floor(Date.now() / 1000) + (12 * 60 * 60); // 12 hours
    const payload = {
        aud: audience,
        exp: exp,
        sub: subject
    };

    const encHeader = uint8ArrayToBase64Url(stringToUint8Array(JSON.stringify(header)));
    const encPayload = uint8ArrayToBase64Url(stringToUint8Array(JSON.stringify(payload)));
    const unsignedToken = `${encHeader}.${encPayload}`;

    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoPrivateKey,
        stringToUint8Array(unsignedToken)
    );

    // Standard Web Crypto ECDSA produces IEEE P1363 (r || s, 64 bytes)
    const encSignature = uint8ArrayToBase64Url(new Uint8Array(signature));
    const jwt = `${unsignedToken}.${encSignature}`;

    return `vapid t=${jwt}, k=${publicKeyBase64Url}`;
}

// ============================================================================
// RFC 8291 Web Push Payload Encryption (aes128gcm)
// ============================================================================

async function hkdfExtractAndExpand(saltBytes, ikmBytes, infoBytes, length) {
    const saltKey = await crypto.subtle.importKey(
        'raw',
        saltBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const prk = await crypto.subtle.sign('HMAC', saltKey, ikmBytes);

    const prkKey = await crypto.subtle.importKey(
        'raw',
        prk,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const expandData = concatUint8Arrays([infoBytes, new Uint8Array([1])]);
    const okm = await crypto.subtle.sign('HMAC', prkKey, expandData);
    return new Uint8Array(okm).slice(0, length);
}

async function encryptPayload(clientP256dhBase64, clientAuthBase64, payloadString) {
    const clientPublicKeyBytes = base64UrlToUint8Array(clientP256dhBase64);
    const clientAuthSecret = base64UrlToUint8Array(clientAuthBase64);

    // 1. Generate local ephemeral ECDH key pair
    const localKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );

    const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

    // 2. Import client public key
    const clientPublicKey = await crypto.subtle.importKey(
        'raw',
        clientPublicKeyBytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );

    // 3. Perform ECDH key exchange to derive shared secret (32 bytes)
    const sharedSecret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: clientPublicKey },
        localKeyPair.privateKey,
        256
    );

    // 4. Derive IKM via HKDF with auth secret
    const authInfo = concatUint8Arrays([
        stringToUint8Array('WebPush: info\0'),
        clientPublicKeyBytes,
        localPublicKeyRaw
    ]);
    const ikm = await hkdfExtractAndExpand(clientAuthSecret, new Uint8Array(sharedSecret), authInfo, 32);

    // 5. Generate random 16-byte salt
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // 6. Derive Content Encryption Key (CEK) and Nonce
    const cekInfo = stringToUint8Array('Content-Encoding: aes128gcm\0');
    const cek = await hkdfExtractAndExpand(salt, ikm, cekInfo, 16);

    const nonceInfo = stringToUint8Array('Content-Encoding: nonce\0');
    const nonce = await hkdfExtractAndExpand(salt, ikm, nonceInfo, 12);

    // 7. Format plaintext with RFC 8188 delimiter (\x02 for the last record)
    const payloadBytes = stringToUint8Array(payloadString);
    const plaintext = concatUint8Arrays([payloadBytes, new Uint8Array([2])]);

    // 8. Encrypt using AES-128-GCM
    const aesKey = await crypto.subtle.importKey(
        'raw',
        cek,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
    );

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 },
        aesKey,
        plaintext
    );

    // 9. Construct RFC 8188 header:
    // salt (16 bytes) || rs (4 bytes = 4096) || idlen (1 byte = 65) || keyid (65 bytes)
    const rs = new Uint8Array([0, 0, 16, 0]); // 4096
    const idlen = new Uint8Array([localPublicKeyRaw.length]); // 65

    return concatUint8Arrays([
        salt,
        rs,
        idlen,
        localPublicKeyRaw,
        new Uint8Array(ciphertext)
    ]);
}

// ============================================================================
// Push Notification Dispatcher
// ============================================================================

async function sendToSubscription(subscription, payload, vapidKey, vapidPublicKey, vapidSubject) {
    if (!subscription || !subscription.endpoint) {
        return { success: false, error: 'Missing endpoint' };
    }

    try {
        const endpointUrl = new URL(subscription.endpoint);
        const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
        const vapidHeader = await createVapidToken(audience, vapidSubject, vapidKey, vapidPublicKey);

        const hasKeys = subscription.keys && subscription.keys.p256dh && subscription.keys.auth;
        let requestBody = null;
        const requestHeaders = {
            'TTL': '86400',
            'Urgency': 'high',
            'Authorization': vapidHeader
        };

        if (hasKeys && payload) {
            const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const encryptedBody = await encryptPayload(
                subscription.keys.p256dh,
                subscription.keys.auth,
                payloadString
            );
            requestBody = encryptedBody;
            requestHeaders['Content-Type'] = 'application/octet-stream';
            requestHeaders['Content-Encoding'] = 'aes128gcm';
        } else {
            requestHeaders['Content-Length'] = '0';
        }

        const response = await fetch(subscription.endpoint, {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody
        });

        const status = response.status;
        const isSuccess = status >= 200 && status < 300;
        const isExpired = status === 404 || status === 410;

        return {
            endpoint: subscription.endpoint,
            status: status,
            success: isSuccess,
            expired: isExpired
        };
    } catch (err) {
        return {
            endpoint: subscription.endpoint,
            success: false,
            error: err.message
        };
    }
}

// ============================================================================
// Worker Request Handler
// ============================================================================

export default {
    async fetch(request, env) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS
            });
        }

        const url = new URL(request.url);

        // GET / or /health
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            return new Response(
                JSON.stringify({
                    status: 'ok',
                    service: 'CheeseMate Push Worker',
                    timestamp: new Date().toISOString(),
                    hint: 'POST /send with { subscriptions: [...], payload: { title, body } }'
                }, null, 2),
                {
                    status: 200,
                    headers: {
                        ...CORS_HEADERS,
                        'Content-Type': 'application/json'
                    }
                }
            );
        }

        // POST /send
        if (request.method === 'POST' && url.pathname === '/send') {
            try {
                const body = await request.json();
                const subscriptions = Array.isArray(body.subscriptions) ? body.subscriptions : [];
                const payload = body.payload || {
                    title: 'CheeseMate',
                    body: 'התראה חדשה מ-CheeseMate',
                    icon: '/icons/favicon-32x32.png',
                    data: { url: '/' }
                };

                // Optional delay to test background / locked phone push
                if (body.delaySeconds && typeof body.delaySeconds === 'number' && body.delaySeconds > 0) {
                    const safeDelay = Math.min(Math.floor(body.delaySeconds), 30);
                    await new Promise(resolve => setTimeout(resolve, safeDelay * 1000));
                }

                if (subscriptions.length === 0) {
                    return new Response(
                        JSON.stringify({ success: true, count: 0, results: [], message: 'No subscriptions provided' }),
                        {
                            status: 200,
                            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
                        }
                    );
                }

                const vapidPublicKey = (env && env.VAPID_PUBLIC_KEY) || DEFAULT_VAPID_PUBLIC_KEY;
                const vapidPrivateKey = (env && env.VAPID_PRIVATE_KEY) || DEFAULT_VAPID_PRIVATE_KEY;
                const vapidSubject = (env && env.VAPID_SUBJECT) || DEFAULT_VAPID_SUBJECT;

                // Import VAPID key once for batch
                const cryptoVapidKey = await importVapidPrivateKey(vapidPrivateKey, vapidPublicKey);

                const results = await Promise.all(
                    subscriptions.map(sub => sendToSubscription(sub, payload, cryptoVapidKey, vapidPublicKey, vapidSubject))
                );

                return new Response(
                    JSON.stringify({
                        success: true,
                        count: results.length,
                        results: results
                    }),
                    {
                        status: 200,
                        headers: {
                            ...CORS_HEADERS,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            } catch (err) {
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: err.message
                    }),
                    {
                        status: 500,
                        headers: {
                            ...CORS_HEADERS,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            }
        }

        // 404 for unknown routes
        return new Response('Not Found', {
            status: 404,
            headers: CORS_HEADERS
        });
    }
};
