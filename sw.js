/* eslint-env serviceworker */
'use strict';

// CheeseMate Service Worker for Web Push notifications (site closed or phone locked)
const SW_VERSION = 'cheesemate-sw-v1';

self.addEventListener('install', (event) => {
    // Activate immediately without waiting for existing clients to close
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Take control of uncontrolled clients immediately
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let payload = {};
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            payload = {
                title: 'CheeseMate',
                body: event.data.text()
            };
        }
    }

    const title = payload.title || 'CheeseMate';
    const options = {
        body: payload.body || 'התקבלה הודעה חדשה ב-CheeseMate',
        icon: payload.icon || '/icons/favicon-32x32.png',
        badge: payload.badge || '/icons/favicon-32x32.png',
        tag: payload.tag || ('cheesemate-' + Date.now()),
        renotify: true,
        vibrate: [200, 100, 200],
        data: {
            url: (payload.data && payload.data.url) || payload.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If any window is already open under this origin, focus it and navigate
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if ('focus' in client) {
                    if (targetUrl && client.url !== targetUrl && 'navigate' in client) {
                        client.navigate(targetUrl);
                    }
                    return client.focus();
                }
            }
            // If no window is open (e.g. browser was closed or phone locked), open a new window
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
