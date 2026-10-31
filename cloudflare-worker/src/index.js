import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const vapid = {
      subject: env.VAPID_SUBJECT || 'mailto:yuvalkalan@gmail.com',
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };

    try {
      // 1. Health check
      if (path === '/' && request.method === 'GET') {
        return jsonResponse({
          service: 'CheeseMate Push Notification Worker',
          status: 'active',
          endpoints: ['/vapid-public-key', '/subscribe', '/unsubscribe', '/send'],
        });
      }

      // 2. VAPID Public Key
      if (path === '/vapid-public-key' && request.method === 'GET') {
        return jsonResponse({
          success: true,
          publicKey: vapid.publicKey,
        });
      }

      // 3. Subscribe
      if (path === '/subscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.uid || !body.subscription || !body.subscription.endpoint) {
          return jsonResponse({ success: false, error: 'Missing uid or subscription object' }, 400);
        }

        const uid = String(body.uid).trim();
        const sub = body.subscription;
        if (!sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
          return jsonResponse({ success: false, error: 'Subscription missing p256dh or auth keys' }, 400);
        }

        const kvKey = `user:${uid}`;
        const existing = (await env.SUBSCRIPTIONS.get(kvKey, { type: 'json' })) || [];
        // Prune duplicates of same endpoint and keep up to 10 most recent devices
        const filtered = existing.filter((s) => s.endpoint !== sub.endpoint);
        filtered.push({
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
          },
          updatedAt: Date.now(),
        });

        // Limit to 10 subscriptions per user to prevent unbounded storage
        const trimmed = filtered.slice(-10);
        await env.SUBSCRIPTIONS.put(kvKey, JSON.stringify(trimmed));

        return jsonResponse({ success: true, count: trimmed.length });
      }

      // 4. Unsubscribe
      if (path === '/unsubscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.uid || !body.endpoint) {
          return jsonResponse({ success: false, error: 'Missing uid or endpoint' }, 400);
        }

        const uid = String(body.uid).trim();
        const kvKey = `user:${uid}`;
        const existing = (await env.SUBSCRIPTIONS.get(kvKey, { type: 'json' })) || [];
        const filtered = existing.filter((s) => s.endpoint !== body.endpoint);

        if (filtered.length === 0) {
          await env.SUBSCRIPTIONS.delete(kvKey);
        } else {
          await env.SUBSCRIPTIONS.put(kvKey, JSON.stringify(filtered));
        }

        return jsonResponse({ success: true, count: filtered.length });
      }

      // 5. Send push notification to target user
      if (path === '/send' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.targetUid) {
          return jsonResponse({ success: false, error: 'Missing targetUid' }, 400);
        }

        const targetUid = String(body.targetUid).trim();
        const kvKey = `user:${targetUid}`;
        const subscriptions = (await env.SUBSCRIPTIONS.get(kvKey, { type: 'json' })) || [];

        if (subscriptions.length === 0) {
          return jsonResponse({ success: true, sent: 0, reason: 'no_active_subscriptions' });
        }

        // Support delay before sending (e.g. for testing lock screen notifications)
        if (body.delaySeconds && typeof body.delaySeconds === 'number' && body.delaySeconds > 0) {
          const delayMs = Math.min(body.delaySeconds, 30) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const pushPayload = JSON.stringify({
          title: body.title || 'CheeseMate',
          body: body.body || '',
          icon: body.icon || '/logo.png',
          badge: body.badge || '/icons/favicon-32x32.png',
          url: body.url || '/',
          tag: body.tag || `cheesemate-${Date.now()}`,
          timestamp: Date.now(),
        });

        let sent = 0;
        const deadEndpoints = new Set();
        const results = [];

        for (const sub of subscriptions) {
          try {
            const pushMessage = {
              data: pushPayload,
              options: {
                ttl: body.ttl || 86400, // 24 hours
              },
            };

            const payload = await buildPushPayload(pushMessage, sub, vapid);
            const res = await fetch(sub.endpoint, payload);

            if (res.status === 404 || res.status === 410) {
              // Endpoint has expired or unsubscribed
              deadEndpoints.add(sub.endpoint);
              results.push({ endpoint: sub.endpoint, status: res.status, expired: true });
            } else if (res.ok) {
              sent++;
              results.push({ endpoint: sub.endpoint, status: res.status, ok: true });
            } else {
              const errText = await res.text().catch(() => '');
              results.push({ endpoint: sub.endpoint, status: res.status, error: errText });
            }
          } catch (err) {
            results.push({ endpoint: sub.endpoint, error: err.message });
          }
        }

        // Clean up dead subscriptions if any
        if (deadEndpoints.size > 0) {
          const remaining = subscriptions.filter((s) => !deadEndpoints.has(s.endpoint));
          if (remaining.length === 0) {
            await env.SUBSCRIPTIONS.delete(kvKey);
          } else {
            await env.SUBSCRIPTIONS.put(kvKey, JSON.stringify(remaining));
          }
        }

        return jsonResponse({
          success: true,
          sent,
          total: subscriptions.length,
          pruned: deadEndpoints.size,
          results,
        });
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    } catch (err) {
      return jsonResponse({ success: false, error: err.message || 'Internal error' }, 500);
    }
  },
};
