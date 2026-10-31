'use strict';

/* global firebase, $ */

// eslint-disable-next-line no-unused-vars
var NotificationsManager = (function () {
    var VAPID_PUBLIC_KEY = 'BF758LqnJZ0G2xGLLZMsJVkY77-kfftlG5BnStq52FkfeDb64K0eywSvAjyaZlY-8zbMzjM9_AfWQW7hr4rVvCo';
    var WORKER_URL = 'https://cheesemate-push.yuvalkalan.workers.dev';

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        var base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');
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
    NotificationsManager.WORKER_URL = WORKER_URL;

    NotificationsManager.prototype.initServiceWorker = function () {
        var that = this;
        if (!('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(function (reg) {
                that.swRegistration = reg;
                if (window.Notification && Notification.permission === 'granted' && that.currentUser) {
                    that.syncPushSubscription();
                }
            })
            .catch(function (err) {
                console.warn('Service worker registration failed:', err);
            });
    };

    NotificationsManager.prototype.syncPushSubscription = function () {
        var that = this;
        if (!that.currentUser || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            return Promise.resolve(null);
        }

        return navigator.serviceWorker.ready.then(function (reg) {
            that.swRegistration = reg;
            return reg.pushManager.getSubscription();
        }).then(function (existingSub) {
            if (existingSub) {
                return existingSub;
            }
            var appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            return that.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: appServerKey
            });
        }).then(function (subscription) {
            if (!subscription || !that.currentUser) {
                return null;
            }

            return fetch(WORKER_URL + '/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    uid: that.currentUser.uid,
                    subscription: subscription.toJSON()
                })
            }).then(function (res) {
                return res.json();
            }).catch(function (err) {
                console.warn('Failed to register subscription with push worker:', err);
                return null;
            });
        }).catch(function (err) {
            console.warn('Error during push subscription sync:', err);
            return null;
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
                            that.syncPushSubscription();
                        }
                    });
                }
            });
        }

        if (that.testPushBtn) {
            that.testPushBtn.click(function (e) {
                e.preventDefault();
                e.stopPropagation();

                if (!that.currentUser) {
                    alert('נא להתחבר למערכת תחילה');
                    return;
                }

                if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                    alert('הדפדפן שלך אינו תומך בהתראות Push');
                    return;
                }

                if (Notification.permission !== 'granted') {
                    Notification.requestPermission().then(function (permission) {
                        if (permission === 'granted') {
                            that.syncPushSubscription().then(function () {
                                that.triggerTestPush();
                            });
                        } else {
                            alert('יש לאשר קבלת התראות בדפדפן כדי לקבל הודעות Push');
                        }
                    });
                    return;
                }

                that.triggerTestPush();
            });
        }
    };

    NotificationsManager.prototype.triggerTestPush = function () {
        var that = this;
        if (!that.currentUser) return;

        var originalHtml = that.testPushBtn.html();
        that.testPushBtn.prop('disabled', true).html(
            '<i class="fas fa-spinner fa-spin ml-1"></i> שולח בעוד 5 שנ\'... נעל את המסך!'
        );

        // Ensure subscription is synced first, then schedule push with 5s delay
        that.syncPushSubscription().then(function () {
            return NotificationsManager.sendPush(that.currentUser.uid, {
                title: 'CheeseMate',
                body: 'בדיקת התראה מוצלחת! האתר פועל גם בנעילת מסך.',
                url: '/',
                tag: 'cheesemate-test-' + Date.now(),
                delaySeconds: 5
            });
        }).then(function (result) {
            if (result && result.sent === 0 && result.reason === 'no_active_subscriptions') {
                alert('לא נמצא מכשיר רשום להתראות. נסה להפעיל מחדש את הרשאות ההתראות.');
            }
        }).catch(function (err) {
            console.warn('Error during test push:', err);
        }).finally(function () {
            setTimeout(function () {
                that.testPushBtn.prop('disabled', false).html(originalHtml);
            }, 6000);
        });
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
            that.syncPushSubscription();
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

        if (unreadCount > 0) {
            that.badgeElement.text(unreadCount > 99 ? '99+' : unreadCount).removeClass('d-none');
        } else {
            that.badgeElement.addClass('d-none');
        }

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
        if (window.Notification && Notification.permission === 'granted') {
            try {
                new Notification('CheeseMate', {
                    body: notifData.message,
                    icon: '/icons/favicon-32x32.png'
                });
            } catch (e) {
                // Ignore if browser restricts notifications
            }
        }
    };

    /**
     * Send Web Push notification to target user via Cloudflare Worker
     * Delivers push notification even when site is closed or phone is locked!
     */
    NotificationsManager.sendPush = function (targetUid, options) {
        if (!targetUid) {
            return Promise.resolve(null);
        }

        options = options || {};

        return fetch(WORKER_URL + '/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                targetUid: targetUid,
                title: options.title || 'CheeseMate',
                body: options.body || '',
                icon: options.icon || '/icons/favicon-32x32.png',
                badge: options.badge || '/icons/favicon-32x32.png',
                url: options.url || '/',
                tag: options.tag || ('cheesemate-' + Date.now()),
                delaySeconds: options.delaySeconds || 0
            })
        }).then(function (res) {
            return res.json();
        }).catch(function (err) {
            console.warn('Error sending push notification via Cloudflare Worker:', err);
            return null;
        });
    };

    return NotificationsManager;
})();
