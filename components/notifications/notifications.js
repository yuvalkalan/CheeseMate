'use strict';

/* global firebase */

// eslint-disable-next-line no-unused-vars
var NotificationsManager = (function () {
    var VAPID_PUBLIC_KEY = 'BKg-LrqshpQPZ-hamsMkdCoo7ABvSFbBZpHcnlkYqpqRJ4M8UdI9WBqd79fL7YnIr0PbyKdaHhI-uSAhY4mL7hs';
    var WORKER_SEND_URL = 'https://cheesemate-push.yuvalkalan.workers.dev/send';

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var rawData = window.atob(base64);
        var outputArray = new Uint8Array(rawData.length);
        for (var i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    function formatTimeAgo(timestamp) {
        if (!timestamp) return '';
        var diffMs = Date.now() - timestamp;
        var diffSec = Math.floor(diffMs / 1000);
        var diffMin = Math.floor(diffSec / 60);
        var diffHour = Math.floor(diffMin / 60);
        var diffDays = Math.floor(diffHour / 24);

        if (diffMin < 1) return 'ממש עכשיו';
        if (diffMin < 60) return 'לפני ' + diffMin + (diffMin === 1 ? ' דקה' : ' דקות');
        if (diffHour < 24) return 'לפני ' + diffHour + (diffHour === 1 ? ' שעה' : ' שעות');
        if (diffDays === 1) return 'אתמול';
        if (diffDays < 7) return 'לפני ' + diffDays + ' ימים';

        var date = new Date(timestamp);
        return date.toLocaleDateString('he-IL');
    }

    function NotificationsManager(options) {
        this.firestoreDb = options.firestoreDb;
        this.element = options.element;
        this.badgeElement = options.badgeElement;
        this.listElement = options.listElement;
        this.markAllBtn = options.markAllBtn;
        this.browserPromptElement = options.browserPromptElement;
        this.enableBrowserBtn = options.enableBrowserBtn;
        this.testPushBtn = options.testPushBtn;

        this.currentUser = null;
        this.unsubscribe = null;
        this.notifications = [];
        this.initialLoadDone = false;
        this.swRegistration = null;

        this.initUI();
        this.initServiceWorker();
    }

    NotificationsManager.VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY;
    NotificationsManager.WORKER_SEND_URL = WORKER_SEND_URL;

    NotificationsManager.prototype.initServiceWorker = function () {
        var that = this;
        if (!('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(function (reg) {
                that.swRegistration = reg;
                if (window.Notification && Notification.permission === 'granted' && that.currentUser) {
                    that.ensurePushSubscription();
                }
            })
            .catch(function (err) {
                console.warn('Service worker registration failed:', err);
            });
    };

    NotificationsManager.prototype.ensurePushSubscription = function () {
        var that = this;
        if (!that.currentUser || !that.firestoreDb || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            return Promise.resolve(null);
        }

        return navigator.serviceWorker.ready.then(function (reg) {
            that.swRegistration = reg;
            return reg.pushManager.getSubscription();
        }).then(function (existingSub) {
            if (existingSub) {
                return existingSub;
            }
            var convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            return that.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            });
        }).then(function (subscription) {
            if (!subscription) return null;
            return that.syncSubscriptionToFirestore(subscription);
        }).catch(function (err) {
            console.warn('Failed to ensure push subscription:', err);
            return null;
        });
    };

    NotificationsManager.prototype.syncSubscriptionToFirestore = function (subscription) {
        var that = this;
        if (!that.currentUser || !that.firestoreDb || !subscription) {
            return Promise.resolve();
        }

        var subJson = subscription.toJSON ? subscription.toJSON() : null;
        if (!subJson || !subJson.endpoint) {
            subJson = {
                endpoint: subscription.endpoint,
                keys: {}
            };
        }
        subJson.updatedAt = Date.now();
        subJson.userAgent = navigator.userAgent || '';

        var userRef = that.firestoreDb.collection('users').doc(that.currentUser.uid);
        return userRef.get().then(function (doc) {
            if (!doc.exists) return;
            var currentSubs = (doc.data() && doc.data().pushSubscriptions) || [];
            // Remove previous entry with same endpoint
            var updatedSubs = currentSubs.filter(function (s) {
                return s && s.endpoint !== subJson.endpoint;
            });
            updatedSubs.push(subJson);
            if (updatedSubs.length > 20) {
                updatedSubs = updatedSubs.slice(updatedSubs.length - 20);
            }
            return userRef.update({ pushSubscriptions: updatedSubs });
        }).catch(function (err) {
            console.warn('Error saving push subscription to Firestore:', err);
        });
    };

    NotificationsManager.prototype.initUI = function () {
        var that = this;

        if (that.markAllBtn) {
            that.markAllBtn.click(function (e) {
                e.preventDefault();
                e.stopPropagation();
                that.markAllAsRead();
            });
        }

        if (that.enableBrowserBtn) {
            that.enableBrowserBtn.click(function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (window.Notification && Notification.requestPermission) {
                    Notification.requestPermission().then(function (permission) {
                        if (that.browserPromptElement) {
                            if (permission === 'granted' || permission === 'denied') {
                                that.browserPromptElement.addClass('d-none');
                            }
                        }
                        if (permission === 'granted') {
                            that.ensurePushSubscription();
                        }
                    });
                }
            });
        }

        if (that.testPushBtn) {
            that.testPushBtn.click(function (e) {
                e.preventDefault();
                e.stopPropagation();
                that.sendTestPush(5);
            });
        }
    };

    NotificationsManager.prototype.sendTestPush = function (delaySeconds) {
        var that = this;
        if (!that.currentUser) {
            alert('עליך להתחבר כדי לשלוח התראת בדיקה');
            return;
        }

        if (window.Notification && Notification.permission !== 'granted') {
            Notification.requestPermission().then(function (permission) {
                if (permission === 'granted') {
                    that.ensurePushSubscription().then(function () {
                        that.triggerTestPush(delaySeconds);
                    });
                } else {
                    alert('יש לאשר הרשאת התראות כדי לקבל התראות בדחיפה');
                }
            });
            return;
        }

        that.ensurePushSubscription().then(function () {
            that.triggerTestPush(delaySeconds);
        });
    };

    NotificationsManager.prototype.triggerTestPush = function (delaySeconds) {
        var that = this;
        var delay = (typeof delaySeconds === 'number' && delaySeconds > 0) ? delaySeconds : 5;
        alert('התראת בדיקה תישלח בעוד ' + delay + ' שניות!\nסגור את הלשונית או נעל את הטלפון עכשיו כדי לראות את ההתראה מופיעה במסך הנעול.');

        var payload = {
            title: 'CheeseMate בדיקה',
            body: 'בדיקת התראה מוצלחת! ההתראה עובדת גם כשהאתר סגור או כשהמסך נעול.',
            icon: '/icons/favicon-32x32.png',
            badge: '/icons/favicon-32x32.png',
            data: { url: '/' }
        };

        NotificationsManager.sendPushToUser(that.firestoreDb, that.currentUser.uid, payload, delay);
    };

    NotificationsManager.prototype.checkBrowserPrompt = function () {
        if (!this.browserPromptElement) return;
        if (window.Notification && Notification.permission === 'default') {
            this.browserPromptElement.removeClass('d-none');
        } else {
            this.browserPromptElement.addClass('d-none');
        }
    };

    NotificationsManager.prototype.onUserSignedIn = function (user) {
        var that = this;
        that.currentUser = user;
        that.stopWatching();
        that.initialLoadDone = false;

        that.element.removeClass('d-none');
        that.checkBrowserPrompt();

        if (window.Notification && Notification.permission === 'granted') {
            that.ensurePushSubscription();
        }

        var query = that.firestoreDb.collection('users').doc(user.uid)
            .collection('notifications')
            .orderBy('timestamp', 'desc')
            .limit(50);

        that.unsubscribe = query.onSnapshot(function (snapshot) {
            var notifs = [];
            var unreadCount = 0;
            var newItemsForAlert = [];

            snapshot.docChanges().forEach(function (change) {
                if (change.type === 'added' && that.initialLoadDone) {
                    var d = change.doc.data();
                    if (d && !d.read) {
                        newItemsForAlert.push(d);
                    }
                }
            });

            snapshot.forEach(function (doc) {
                var item = doc.data() || {};
                item.id = doc.id;
                if (!item.read) {
                    unreadCount++;
                }
                notifs.push(item);
            });

            that.notifications = notifs;
            that.render(notifs, unreadCount);

            if (that.initialLoadDone && newItemsForAlert.length > 0) {
                newItemsForAlert.forEach(function (alertItem) {
                    that.showDesktopNotification(alertItem);
                });
            }
            that.initialLoadDone = true;
        }, function (error) {
            console.warn('Notifications listener error:', error);
        });
    };

    NotificationsManager.prototype.onUserSignedOut = function () {
        this.stopWatching();
        this.currentUser = null;
        this.notifications = [];
        this.element.addClass('d-none');
        this.badgeElement.addClass('d-none').text('0');
        this.render([], 0);
    };

    NotificationsManager.prototype.stopWatching = function () {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    };

    NotificationsManager.prototype.render = function (notifs, unreadCount) {
        var that = this;

        // Update badge
        if (unreadCount > 0) {
            that.badgeElement.text(unreadCount > 99 ? '99+' : unreadCount).removeClass('d-none');
        } else {
            that.badgeElement.addClass('d-none');
        }

        // Update mark all as read button visibility/style
        if (that.markAllBtn) {
            if (unreadCount > 0) {
                that.markAllBtn.removeClass('text-muted').addClass('text-primary');
            } else {
                that.markAllBtn.removeClass('text-primary').addClass('text-muted');
            }
        }

        if (!that.listElement) return;

        that.listElement.empty();

        if (notifs.length === 0) {
            that.listElement.html(
                '<div class="notifications-empty text-center text-muted py-4">' +
                '<i class="far fa-bell-slash fa-2x mb-2 d-block text-muted"></i>' +
                'אין התראות חדשות' +
                '</div>'
            );
            return;
        }

        notifs.forEach(function (notif) {
            var item = $('<div class="notification-item"></div>');
            if (!notif.read) {
                item.addClass('unread');
            }

            var iconHtml = '<i class="fas fa-check-circle text-success notification-icon"></i>';
            if (notif.type === 'friend_request_accepted') {
                iconHtml = '<i class="fas fa-user-check text-success notification-icon"></i>';
            } else if (notif.type === 'friend_request_received') {
                iconHtml = '<i class="fas fa-user-plus text-primary notification-icon"></i>';
            }

            var icon = $(iconHtml);
            var content = $('<div class="notification-content"></div>');
            var msg = $('<div class="notification-message"></div>').text(notif.message || '');
            var time = $('<div class="notification-time"></div>').text(formatTimeAgo(notif.timestamp));

            content.append(msg, time);
            item.append(icon, content);

            if (!notif.read) {
                item.append($('<div class="notification-unread-dot" title="לא נקרא"></div>'));
            }

            item.click(function (e) {
                e.preventDefault();
                if (!notif.read) {
                    that.markAsRead(notif.id);
                }
            });

            that.listElement.append(item);
        });
    };

    NotificationsManager.prototype.markAsRead = function (notifId) {
        if (!this.currentUser || !this.firestoreDb || !notifId) return;

        this.firestoreDb.collection('users').doc(this.currentUser.uid)
            .collection('notifications').doc(notifId)
            .update({ read: true })
            .catch(function (err) {
                console.warn('Error marking notification as read:', err);
            });
    };

    NotificationsManager.prototype.markAllAsRead = function () {
        if (!this.currentUser || !this.firestoreDb) return;

        var unread = this.notifications.filter(function (n) { return !n.read; });
        if (unread.length === 0) return;

        var batch = this.firestoreDb.batch();
        var userNotifsRef = this.firestoreDb.collection('users').doc(this.currentUser.uid).collection('notifications');

        unread.forEach(function (n) {
            batch.update(userNotifsRef.doc(n.id), { read: true });
        });

        batch.commit().catch(function (err) {
            console.warn('Error marking all notifications as read:', err);
        });
    };

    NotificationsManager.prototype.showDesktopNotification = function (notifData) {
        var title = 'CheeseMate';
        var options = {
            body: notifData.message,
            icon: '/icons/favicon-32x32.png',
            badge: '/icons/favicon-32x32.png',
            data: { url: '/' }
        };

        if (this.swRegistration && this.swRegistration.showNotification) {
            this.swRegistration.showNotification(title, options).catch(function () {
                try {
                    new Notification(title, options);
                } catch (e) {
                    // Ignore if restricted
                }
            });
        } else if (window.Notification && Notification.permission === 'granted') {
            try {
                new Notification(title, options);
            } catch (e) {
                // Ignore if browser restricts notifications
            }
        }
    };

    /**
     * Send Web Push notification to a target user via the Cloudflare Worker
     * Works when target user's browser is closed or phone is locked!
     */
    NotificationsManager.sendPushToUser = function (firestoreDb, targetUid, payload, delaySeconds) {
        if (!firestoreDb || !targetUid || !payload) {
            return Promise.resolve(null);
        }

        return firestoreDb.collection('users').doc(targetUid).get().then(function (doc) {
            if (!doc.exists) return null;
            var data = doc.data() || {};
            var subscriptions = data.pushSubscriptions || [];
            if (!subscriptions || subscriptions.length === 0) {
                return null;
            }

            return fetch(WORKER_SEND_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    subscriptions: subscriptions,
                    payload: payload,
                    delaySeconds: delaySeconds || 0
                })
            }).then(function (resp) {
                return resp.json();
            }).catch(function (err) {
                console.warn('Failed to dispatch push notification via Cloudflare Worker:', err);
                return null;
            });
        }).catch(function (err) {
            console.warn('Error fetching recipient subscriptions for push:', err);
            return null;
        });
    };

    return NotificationsManager;
})();
