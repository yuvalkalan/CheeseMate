'use strict';

/* global firebase */

// eslint-disable-next-line no-unused-vars
var NotificationsManager = (function () {
    function NotificationsManager(options) {
        this.firestoreDb = options.firestoreDb;
        this.element = options.element;
        this.badgeElement = options.badgeElement;
        this.listElement = options.listElement;
        this.markAllBtn = options.markAllBtn;
        this.browserPromptElement = options.browserPromptElement;
        this.enableBrowserBtn = options.enableBrowserBtn;

        this.currentUser = null;
        this.unsubscribe = null;
        this.notifications = [];
        this.initialLoadDone = false;

        this.initUI();
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
                    });
                }
            });
        }
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

                // If it's a friend acceptance or involves a friend, allow viewing their schedule
                if (notif.fromUid && (window.cheeseMateViewFriendSchedule || window.cheeseForkViewFriendSchedule)) {
                    var viewFn = window.cheeseMateViewFriendSchedule || window.cheeseForkViewFriendSchedule;
                    viewFn(notif.fromUid, notif.fromUsername);
                    that.element.find('.dropdown-menu').dropdown('toggle');
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
                    icon: 'icons/favicon-32x32.png'
                });
            } catch (e) {
                // Ignore if browser restricts notifications
            }
        }
    };

    return NotificationsManager;
})();
