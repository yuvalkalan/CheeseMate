'use strict';

/* global firebase, $ */

// eslint-disable-next-line no-unused-vars
var NotificationsManager = (function () {
    var VAPID_PUBLIC_KEY = 'BKg-LrqshpQPZ-hamsMkdCoo7ABvSFbBZpHcnlkYqpqRJ4M8UdI9WBqd79fL7YnIr0PbyKdaHhI-uSAhY4mL7hs';
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

        this.currentUser = null;
        this.unsubscribe = null;
        this.notifications = [];
        this.initialLoadDone = false;
        this.swRegistration = null;
        this.spotRequestListeners = {};
        this.spotRequestData = {};

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
            var storedKey = localStorage.getItem('cheesemate_vapid_key');
            if (existingSub && storedKey === VAPID_PUBLIC_KEY) {
                return existingSub;
            }

            var unsubPromise = existingSub ? existingSub.unsubscribe().catch(function () { return true; }) : Promise.resolve(true);

            return unsubPromise.then(function () {
                var appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
                return that.swRegistration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: appServerKey
                }).then(function (newSub) {
                    try {
                        localStorage.setItem('cheesemate_vapid_key', VAPID_PUBLIC_KEY);
                    } catch (e) {
                        // Ignore quota/private mode errors
                    }
                    return newSub;
                });
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
    };

    NotificationsManager.prototype.onUserSignedIn = function (user) {
        var that = this;
        that.currentUser = user;
        that.stopWatching();
        that.initialLoadDone = false;

        that.element.removeClass('d-none');

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
        var oldUser = this.currentUser;
        this.stopWatching();
        this.currentUser = null;
        this.notifications = [];
        this.element.addClass('d-none');
        this.badgeElement.addClass('d-none').text('0');
        this.render([], 0);

        if (oldUser && 'serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(function (reg) {
                return reg.pushManager.getSubscription();
            }).then(function (sub) {
                if (sub) {
                    fetch(WORKER_URL + '/unsubscribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid: oldUser.uid, endpoint: sub.endpoint })
                    }).catch(function () {});
                }
            }).catch(function () {});
        }
    };

    NotificationsManager.prototype.stopWatching = function () {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.stopSpotRequestListeners();
    };

    NotificationsManager.prototype.stopSpotRequestListeners = function () {
        var that = this;
        if (that.spotRequestListeners) {
            Object.keys(that.spotRequestListeners).forEach(function (reqId) {
                if (typeof that.spotRequestListeners[reqId] === 'function') {
                    try {
                        that.spotRequestListeners[reqId]();
                    } catch (e) {}
                }
            });
            that.spotRequestListeners = {};
        }
    };

    NotificationsManager.prototype.updateSpotRequestUI = function (requestId, data) {
        var that = this;
        if (!that.element || !requestId) return;

        var container = that.element.find('.notification-spot-actions[data-request-id="' + requestId + '"]');
        if (!container.length) return;

        if (data && data.status === 'taken') {
            var saveBtn = container.find('.btn-save-spot');
            container.find('.btn-cancel-spot').remove();
            if (saveBtn.length > 0) {
                saveBtn.removeClass('btn-success').addClass('btn-secondary btn-spot-taken disabled')
                    .prop('disabled', true)
                    .attr('data-action', 'spot-taken')
                    .html('<i class="fas fa-check-circle ml-1"></i> נתפס מקום!');
                return;
            }
            container.empty();
            var takenBtn = $('<button type="button" class="btn btn-sm btn-secondary btn-spot-taken disabled" disabled data-action="spot-taken">' +
                '<i class="fas fa-check-circle ml-1"></i> נתפס מקום!' +
                '</button>');
            container.append(takenBtn);
        }
    };

    NotificationsManager.prototype.respondToSpotRequest = function (notif, reqId, action, saveBtn, cancelBtn) {
        var that = this;
        if (!that.currentUser || !that.firestoreDb || !reqId) return;

        if (action === 'taken') {
            var myUsername = (typeof personalArea !== 'undefined' && personalArea && personalArea.getCurrentUsername) ?
                personalArea.getCurrentUsername() :
                (that.currentUser.displayName || (that.currentUser.email ? that.currentUser.email.split('@')[0] : 'חבר'));

            var spotRef = that.firestoreDb.collection('spotRequests').doc(reqId);
            spotRef.update({
                status: 'taken',
                savedByUid: that.currentUser.uid,
                savedByUsername: myUsername,
                updatedAt: Date.now()
            }).then(function () {
                that.markAsRead(notif.id);
                that.spotRequestData[reqId] = { status: 'taken', savedByUid: that.currentUser.uid, savedByUsername: myUsername };
                that.updateSpotRequestUI(reqId, that.spotRequestData[reqId]);

                if (notif.fromUid && notif.fromUid !== that.currentUser.uid) {
                    var confirmMsg = myUsername + ' שמר/ה לך מקום!';
                    var reqNotifRef = that.firestoreDb.collection('users').doc(notif.fromUid).collection('notifications').doc();
                    reqNotifRef.set({
                        type: 'general',
                        fromUid: that.currentUser.uid,
                        fromUsername: myUsername,
                        message: confirmMsg,
                        timestamp: Date.now(),
                        read: false
                    }).catch(function () {});

                    if (NotificationsManager.sendPush) {
                        NotificationsManager.sendPush(notif.fromUid, {
                            title: 'CheeseMate - מקום נשמר!',
                            body: confirmMsg,
                            icon: '/icons/android-chrome-192x192.png',
                            badge: '/icons/favicon-32x32.png',
                            url: '/?tab=friends',
                            tag: reqNotifRef.id
                        });
                    }
                }
            }).catch(function (err) {
                console.error('Error taking spot:', err);
                alert('שגיאה בשמירת מקום: ' + (err.message || err));
                if (saveBtn) {
                    saveBtn.prop('disabled', false).removeClass('disabled').html('<i class="fas fa-check ml-1"></i> שמרתי מקום!');
                }
                if (cancelBtn) {
                    cancelBtn.prop('disabled', false).removeClass('disabled');
                }
            });
        } else if (action === 'cancelled') {
            that.markAsRead(notif.id);
            var container = that.element.find('.notification-spot-actions[data-request-id="' + reqId + '"]');
            if (container.length) {
                container.empty().append($('<span class="text-muted small">בוטל</span>'));
            }
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
            var isSystem = (notif.type === 'system' || notif.type === 'update' || notif.type === 'alert' || notif.type === 'system_broadcast' || notif.type === 'system_direct');
            if (notif.type === 'friend_request_accepted') {
                iconHtml = '<i class="fas fa-user-check text-success notification-icon"></i>';
            } else if (notif.type === 'friend_request_received') {
                iconHtml = '<i class="fas fa-user-plus text-primary notification-icon"></i>';
            } else if (notif.type === 'save_spot_request') {
                iconHtml = '<i class="fas fa-chair text-primary notification-icon"></i>';
            } else if (notif.type === 'update') {
                iconHtml = '<i class="fas fa-star text-info notification-icon"></i>';
            } else if (notif.type === 'alert') {
                iconHtml = '<i class="fas fa-exclamation-circle text-danger notification-icon"></i>';
            } else if (isSystem) {
                iconHtml = '<i class="fas fa-bullhorn text-warning notification-icon"></i>';
            }

            var icon = $(iconHtml);
            var content = $('<div class="notification-content"></div>');
            var msg = $('<div class="notification-message"></div>');

            if (isSystem) {
                var badgeText = 'מערכת';
                var badgeClass = 'badge-warning text-dark';
                if (notif.type === 'update') {
                    badgeText = 'עדכון';
                    badgeClass = 'badge-info text-white';
                } else if (notif.type === 'alert') {
                    badgeText = 'התראה';
                    badgeClass = 'badge-danger text-white';
                }
                msg.append($('<span class="badge ' + badgeClass + ' ml-1 font-weight-normal"></span>').text(badgeText));
                msg.append($('<span></span>').text(' ' + (notif.message || '')));
            } else {
                var senderProfile = (notif.fromUid && typeof personalArea !== 'undefined' && personalArea.getProfileInfo)
                    ? personalArea.getProfileInfo(notif.fromUid)
                    : null;
                var isNonStandard = (typeof RoleManager !== 'undefined')
                    ? !RoleManager.isStandardUser(senderProfile || { level: notif.fromLevel, role: notif.fromRole })
                    : Boolean(senderProfile && senderProfile.isAdmin);

                if (isNonStandard && notif.fromUsername && notif.message && notif.message.indexOf(notif.fromUsername) !== -1) {
                    var splitIdx = notif.message.indexOf(notif.fromUsername);
                    var beforeName = notif.message.substring(0, splitIdx);
                    var afterName = notif.message.substring(splitIdx + notif.fromUsername.length);
                    var senderSpan = $('<span></span>').text(notif.fromUsername);
                    if (typeof RoleManager !== 'undefined') {
                        RoleManager.applyRoleHover(senderSpan, senderProfile || { level: notif.fromLevel, role: notif.fromRole });
                    } else if (senderProfile && senderProfile.level === 2) {
                        senderSpan.addClass('role-atmosphere-gradient');
                    } else {
                        senderSpan.addClass('admin-golden-gradient');
                    }
                    if (beforeName) msg.append($('<span></span>').text(beforeName));
                    msg.append(senderSpan);
                    if (afterName) msg.append($('<span></span>').text(afterName));
                } else {
                    msg.text(notif.message || '');
                }
            }

            var time = $('<div class="notification-time"></div>').text(formatTimeAgo(notif.timestamp));

            content.append(msg, time);

            if (notif.type === 'save_spot_request' && notif.requestId) {
                var reqId = notif.requestId;
                var actionsDiv = $('<div class="notification-spot-actions mt-2 d-flex flex-wrap align-items-center" data-request-id="' + reqId + '"></div>');

                var cachedData = that.spotRequestData[reqId];
                if (cachedData && cachedData.status === 'taken') {
                    var takenBtn = $('<button type="button" class="btn btn-sm btn-secondary btn-spot-taken disabled" disabled data-action="spot-taken">' +
                        '<i class="fas fa-check-circle ml-1"></i> נתפס מקום!' +
                        '</button>');
                    actionsDiv.append(takenBtn);
                } else {
                    var saveBtn = $('<button type="button" class="btn btn-sm btn-success btn-save-spot mr-2" data-action="saved-spot">' +
                        '<i class="fas fa-check ml-1"></i> שמרתי מקום!' +
                        '</button>');

                    var cancelBtn = $('<button type="button" class="btn btn-sm btn-outline-secondary btn-cancel-spot" data-action="cancel-spot">' +
                        '<i class="fas fa-times ml-1"></i> ביטול' +
                        '</button>');

                    saveBtn.click(function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        saveBtn.prop('disabled', true).addClass('disabled').html('<i class="fas fa-spinner fa-spin ml-1"></i> שומר...');
                        cancelBtn.prop('disabled', true).addClass('disabled');
                        that.respondToSpotRequest(notif, reqId, 'taken', saveBtn, cancelBtn);
                    });

                    cancelBtn.click(function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        that.respondToSpotRequest(notif, reqId, 'cancelled', saveBtn, cancelBtn);
                    });

                    actionsDiv.append(saveBtn, cancelBtn);
                }

                content.append(actionsDiv);

                if (!that.spotRequestListeners[reqId] && that.firestoreDb) {
                    that.spotRequestListeners[reqId] = that.firestoreDb.collection('spotRequests').doc(reqId)
                        .onSnapshot(function (docSnap) {
                            if (docSnap.exists) {
                                var spotData = docSnap.data();
                                that.spotRequestData[reqId] = spotData;
                                that.updateSpotRequestUI(reqId, spotData);
                            }
                        }, function (err) {
                            console.warn('Error listening to spotRequest ' + reqId + ':', err);
                        });
                }
            }
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
        var that = this;
        var isSystem = (notifData.type === 'system' || notifData.type === 'update' || notifData.type === 'alert' || notifData.type === 'system_broadcast' || notifData.type === 'system_direct');
        var title = isSystem ? (notifData.fromUsername || 'CheeseMate - הודעת מערכת') : 'CheeseMate';
        var options = {
            body: notifData.message || 'התקבלה הודעה חדשה ב-CheeseMate',
            icon: '/icons/android-chrome-192x192.png',
            badge: '/icons/favicon-32x32.png',
            tag: notifData.id || ('cheesemate-' + Date.now()),
            renotify: true,
            vibrate: [200, 100, 200],
            data: {
                url: isSystem ? '/' : '/?tab=friends'
            }
        };

        if (that.swRegistration && that.swRegistration.showNotification) {
            that.swRegistration.showNotification(title, options).catch(function () {
                if (window.Notification && Notification.permission === 'granted') {
                    try {
                        new Notification(title, options);
                    } catch (e) {
                        // Ignore
                    }
                }
            });
        } else if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(function (reg) {
                that.swRegistration = reg;
                return reg.showNotification(title, options);
            }).catch(function () {
                if (window.Notification && Notification.permission === 'granted') {
                    try {
                        new Notification(title, options);
                    } catch (e) {
                        // Ignore
                    }
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
                icon: options.icon || '/icons/android-chrome-192x192.png',
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

    /**
     * Complete notification helper: stores document in Firestore AND dispatches Cloudflare Worker Web Push
     * Ensures all system notifications reach the recipient when site is closed or phone is locked.
     */
    NotificationsManager.sendNotificationToUser = function (firestoreDb, targetUid, notifData, pushOptions) {
        if (!firestoreDb || !targetUid || !notifData) {
            return Promise.resolve(null);
        }

        var notifRef = firestoreDb.collection('users').doc(targetUid).collection('notifications').doc();
        var docPayload = {
            type: notifData.type || 'general',
            fromUid: notifData.fromUid || '',
            fromUsername: notifData.fromUsername || '',
            message: notifData.message || '',
            timestamp: notifData.timestamp || Date.now(),
            read: false
        };

        return notifRef.set(docPayload).then(function () {
            var mergedPushOptions = {
                title: (pushOptions && pushOptions.title) || 'CheeseMate',
                body: (pushOptions && pushOptions.body) || docPayload.message,
                icon: (pushOptions && pushOptions.icon) || '/icons/android-chrome-192x192.png',
                badge: (pushOptions && pushOptions.badge) || '/icons/favicon-32x32.png',
                url: (pushOptions && pushOptions.url) || '/?tab=friends',
                tag: notifRef.id,
                delaySeconds: (pushOptions && pushOptions.delaySeconds) || 0
            };

            return NotificationsManager.sendPush(targetUid, mergedPushOptions);
        }).catch(function (err) {
            console.warn('Error sending notification to user:', err);
            return null;
        });
    };

    return NotificationsManager;
})();
