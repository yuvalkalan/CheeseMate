'use strict';

/**
 * CheeseMate Service Worker for Web Push Notifications and Offline Capabilities
 */

// Install event - activate immediately
self.addEventListener('install', function (event) {
    self.skipWaiting();
});

// Activate event - claim clients immediately
self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

// Push event - triggered when a Web Push message arrives (site closed or phone locked)
self.addEventListener('push', function (event) {
    var data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = {
                title: 'CheeseMate',
                body: event.data.text()
            };
        }
    }

    var title = data.title || 'CheeseMate';
    var options = {
        body: data.body || 'התראה חדשה מ-CheeseMate',
        icon: data.icon || '/icons/favicon-32x32.png',
        badge: data.badge || '/icons/favicon-32x32.png',
        data: data.data || { url: '/' },
        tag: data.tag || 'cheesemate-notification',
        renotify: true,
        vibrate: [100, 50, 100]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Notification click event - open or focus the app
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    var targetUrl = '/';
    if (event.notification.data && event.notification.data.url) {
        targetUrl = event.notification.data.url;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            // If a window is already open, focus it
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if ('focus' in client) {
                    if (targetUrl && targetUrl !== '/' && 'navigate' in client) {
                        client.navigate(targetUrl);
                    }
                    return client.focus();
                }
            }
            // If no window is open, open a new one
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
