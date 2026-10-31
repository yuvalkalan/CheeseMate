'use strict';

/* global BootstrapDialog, firebase, gtag */

// eslint-disable-next-line no-unused-vars
var PersonalArea = (function () {
    function PersonalArea(options) {
        this.firestoreDb = options.firestoreDb;
        this.onBeforeAccountDelete = options.onBeforeAccountDelete || function () {};
        this.onUsernameChanged = options.onUsernameChanged || function () {};
        this.onIncomingRequestsCountChanged = options.onIncomingRequestsCountChanged || function () {};
        this.onFriendsChanged = options.onFriendsChanged || function () {};
        this.onLevelChanged = options.onLevelChanged || function () {};

        this.currentUser = null;
        this.userDocData = null;
        this.unsubscribeUserDoc = null;
        this.dialog = null;
        this.activeTab = 'friends'; // 'friends' | 'requests'
        this.isChangeNameOpen = false;
        this.isSearchOpen = false;
        this.lastSearchQuery = '';
        this.searchResults = null;
        this.isSearching = false;
        this.profilesCache = {};
    }

    function deriveDefaultUsername(user) {
        if (user && user.email) {
            var beforeAt = user.email.split('@')[0].trim();
            if (beforeAt) {
                return beforeAt;
            }
        }
        if (user && user.displayName) {
            return user.displayName.replace('&#39;', '\'').trim();
        }
        return 'משתמש';
    }

    PersonalArea.prototype.getCurrentUsername = function () {
        if (this.userDocData && this.userDocData.username) {
            return this.userDocData.username;
        }
        return deriveDefaultUsername(this.currentUser);
    };

    PersonalArea.prototype.getLevel = function () {
        if (this.userDocData && typeof this.userDocData.level === 'number') {
            return this.userDocData.level;
        }
        return 0; // 0 for "user"
    };

    PersonalArea.prototype.isAdmin = function () {
        return this.getLevel() === 1;
    };

    PersonalArea.prototype.onUserSignedIn = function (user) {
        var that = this;
        this.stopWatching();
        this.currentUser = user;

        if (!user || !this.firestoreDb) {
            return;
        }

        var userRef = this.firestoreDb.collection('users').doc(user.uid);
        this.unsubscribeUserDoc = userRef.onSnapshot(function (snapshot) {
            var data = snapshot.exists ? snapshot.data() : {};
            var defaultUsername = deriveDefaultUsername(user);
            var emailLower = (user.email || '').toLowerCase();
            var levelToSave = 0;
            if (typeof data.level === 'number') {
                levelToSave = data.level;
            }

            var needsInit = !snapshot.exists ||
                !data.username ||
                typeof data.level !== 'number' ||
                data.usernameLower !== (data.username || defaultUsername).toLowerCase() ||
                (emailLower && data.email !== emailLower) ||
                data.uid !== user.uid;

            if (needsInit) {
                var usernameToSave = data.username || defaultUsername;
                var initUpdate = {
                    uid: user.uid,
                    email: emailLower,
                    username: usernameToSave,
                    usernameLower: usernameToSave.toLowerCase(),
                    displayName: usernameToSave,
                    level: levelToSave
                };
                if (!Array.isArray(data.friends)) {
                    initUpdate.friends = [];
                }
                if (!Array.isArray(data.incomingRequests)) {
                    initUpdate.incomingRequests = [];
                }
                if (!Array.isArray(data.outgoingRequests)) {
                    initUpdate.outgoingRequests = [];
                }
                userRef.set(initUpdate, { merge: true });
                data = $.extend({}, data, initUpdate);
            }

            that.userDocData = data;
            that.profilesCache[user.uid] = data;

            var currentLevel = (typeof data.level === 'number') ? data.level : levelToSave;
            that.onLevelChanged(currentLevel);

            var username = that.getCurrentUsername();
            that.onUsernameChanged(username);

            var incoming = Array.isArray(data.incomingRequests) ? data.incomingRequests : [];
            that.onIncomingRequestsCountChanged(incoming.length);

            var friends = Array.isArray(data.friends) ? data.friends : [];
            that.onFriendsChanged(friends);

            that.loadReferencedProfiles(function () {
                that.refreshDialogContent();
                if (that.userDocData) {
                    that.onFriendsChanged(Array.isArray(that.userDocData.friends) ? that.userDocData.friends : []);
                }
            });
        });
    };

    PersonalArea.prototype.stopWatching = function () {
        if (this.unsubscribeUserDoc) {
            this.unsubscribeUserDoc();
            this.unsubscribeUserDoc = null;
        }
        this.currentUser = null;
        this.userDocData = null;
        this.onIncomingRequestsCountChanged(0);
        this.onFriendsChanged([]);
    };

    PersonalArea.prototype.loadReferencedProfiles = function (callback) {
        var that = this;
        if (!this.userDocData || !this.firestoreDb) {
            if (callback) callback();
            return;
        }

        var friends = Array.isArray(this.userDocData.friends) ? this.userDocData.friends : [];
        var incoming = Array.isArray(this.userDocData.incomingRequests) ? this.userDocData.incomingRequests : [];
        var outgoing = Array.isArray(this.userDocData.outgoingRequests) ? this.userDocData.outgoingRequests : [];

        var uidsMap = {};
        friends.concat(incoming).concat(outgoing).forEach(function (uid) {
            if (uid) {
                uidsMap[uid] = true;
            }
        });

        var uids = Object.keys(uidsMap);
        if (uids.length === 0) {
            if (callback) callback();
            return;
        }

        var remaining = uids.length;
        uids.forEach(function (uid) {
            that.firestoreDb.collection('users').doc(uid).get()
                .then(function (doc) {
                    if (doc.exists) {
                        that.profilesCache[uid] = doc.data();
                    } else {
                        that.profilesCache[uid] = {
                            uid: uid,
                            username: uid,
                            email: ''
                        };
                    }
                })
                .catch(function () {})
                .then(function () {
                    remaining--;
                    if (remaining === 0 && callback) {
                        callback();
                    }
                });
        });
    };

    PersonalArea.prototype.openDialog = function () {
        var that = this;
        if (!this.currentUser) {
            return;
        }

        this.isChangeNameOpen = false;

        if (this.dialog) {
            this.refreshDialogContent();
            this.dialog.open();
            return;
        }

        var contentContainer = $('<div class="personal-area-container"></div>');

        this.dialog = new BootstrapDialog({
            title: 'אזור אישי',
            message: contentContainer,
            size: BootstrapDialog.SIZE_LARGE,
            autodestroy: false,
            buttons: [{
                label: 'סגור',
                action: function (dialog) {
                    dialog.close();
                }
            }],
            onshow: function () {
                that.loadReferencedProfiles(function () {
                    that.refreshDialogContent();
                });
            }
        });

        this.refreshDialogContent();
        this.dialog.open();
    };

    PersonalArea.prototype.refreshDialogContent = function () {
        if (!this.dialog || !this.currentUser) {
            return;
        }

        var container = this.dialog.getMessage();
        container.empty();

        container.append(this.buildHeaderElement());
        if (this.isChangeNameOpen) {
            container.append(this.buildChangeNameElement());
        }
        container.append(this.buildSubTabsNavElement());

        if (this.activeTab === 'friends') {
            container.append(this.buildFriendsTabElement());
        } else {
            container.append(this.buildRequestsTabElement());
        }
    };

    PersonalArea.prototype.buildHeaderElement = function () {
        var that = this;
        var username = this.getCurrentUsername();
        var email = (this.userDocData && this.userDocData.email) || (this.currentUser && this.currentUser.email) || '';

        var header = $('<div class="personal-area-header"></div>');

        var userInfo = $('<div class="personal-area-user-info"></div>');
        var avatar = $('<div class="personal-area-avatar"><i class="fas fa-user"></i></div>');
        var textWrap = $('<div></div>');
        var usernameLine = $('<div class="personal-area-username-line"></div>').text(username);
        var emailLine = $('<div class="personal-area-email-line text-muted"></div>').text(email);
        textWrap.append(usernameLine);
        if (email) {
            textWrap.append(emailLine);
        }
        userInfo.append(avatar, textWrap);

        var actions = $('<div class="personal-area-actions"></div>');

        var changeNameBtn = $('<button type="button" class="btn btn-sm btn-outline-primary">' +
            '<i class="fas fa-edit"></i> שינוי שם' +
            '</button>').click(function () {
            that.isChangeNameOpen = !that.isChangeNameOpen;
            that.refreshDialogContent();
        });

        var logoutBtn = $('<button type="button" class="btn btn-sm btn-outline-secondary">' +
            '<i class="fas fa-sign-out-alt"></i> התנתקות' +
            '</button>').click(function () {
            that.confirmLogout();
        });

        var deleteAccountBtn = $('<button type="button" class="btn btn-sm btn-outline-danger">' +
            '<i class="fas fa-user-times"></i> מחיקת חשבון' +
            '</button>').click(function () {
            that.confirmAccountDeletion();
        });

        actions.append(changeNameBtn, logoutBtn, deleteAccountBtn);
        header.append(userInfo, actions);

        return header;
    };

    PersonalArea.prototype.buildChangeNameElement = function () {
        var that = this;
        var currentName = this.getCurrentUsername();

        var box = $('<form class="personal-area-change-name-box"></form>');
        var label = $('<label class="font-weight-bold mb-1" for="personal-area-new-name-input">שם משתמש במערכת</label>');
        var inputGroup = $('<div class="input-group input-group-sm"></div>');
        var input = $('<input type="text" id="personal-area-new-name-input" class="form-control" maxlength="50" required>')
            .val(currentName);

        var appendGroup = $('<div class="input-group-append"></div>');
        var saveBtn = $('<button type="submit" class="btn btn-primary">שמירה</button>');
        var cancelBtn = $('<button type="button" class="btn btn-secondary">ביטול</button>').click(function () {
            that.isChangeNameOpen = false;
            that.refreshDialogContent();
        });

        appendGroup.append(saveBtn, cancelBtn);
        inputGroup.append(input, appendGroup);
        box.append(label, inputGroup);

        box.on('submit', function (e) {
            e.preventDefault();
            var newName = (input.val() || '').trim();
            if (!newName) {
                return;
            }
            saveBtn.prop('disabled', true);
            that.changeUsername(newName, function () {
                that.isChangeNameOpen = false;
                that.refreshDialogContent();
            });
        });

        return box;
    };

    PersonalArea.prototype.changeUsername = function (newName, callback) {
        var that = this;
        if (!this.currentUser || !this.firestoreDb) {
            if (callback) callback();
            return;
        }

        var uid = this.currentUser.uid;
        var update = {
            username: newName,
            usernameLower: newName.toLowerCase(),
            displayName: newName
        };

        if (this.currentUser.updateProfile) {
            this.currentUser.updateProfile({ displayName: newName }).catch(function () {});
        }

        this.firestoreDb.collection('users').doc(uid).set(update, { merge: true })
            .then(function () {
                that.onUsernameChanged(newName);
                if (callback) callback();
            })
            .catch(function (err) {
                alert('שגיאה בעדכון שם המשתמש: ' + err.message);
                if (callback) callback();
            });
    };

    PersonalArea.prototype.buildSubTabsNavElement = function () {
        var that = this;
        var friends = (this.userDocData && Array.isArray(this.userDocData.friends)) ? this.userDocData.friends : [];
        var incoming = (this.userDocData && Array.isArray(this.userDocData.incomingRequests)) ? this.userDocData.incomingRequests : [];

        var nav = $('<ul class="nav nav-tabs personal-area-tabs"></ul>');

        var friendsTabItem = $('<li class="nav-item"></li>');
        var friendsLink = $('<a class="nav-link' + (this.activeTab === 'friends' ? ' active' : '') + '"></a>')
            .append($('<i class="fas fa-user-friends ml-1"></i>'))
            .append($('<span>החברים שלי</span>'));
        if (friends.length > 0) {
            friendsLink.append($('<span class="badge badge-secondary personal-area-tab-badge"></span>').text(friends.length));
        }
        friendsLink.click(function (e) {
            e.preventDefault();
            that.activeTab = 'friends';
            that.refreshDialogContent();
        });
        friendsTabItem.append(friendsLink);

        var requestsTabItem = $('<li class="nav-item"></li>');
        var requestsLink = $('<a class="nav-link' + (this.activeTab === 'requests' ? ' active' : '') + '"></a>')
            .append($('<i class="fas fa-user-plus ml-1"></i>'))
            .append($('<span>בקשות חברות</span>'));
        if (incoming.length > 0) {
            requestsLink.append($('<span class="badge badge-danger personal-area-tab-badge"></span>').text(incoming.length));
        }
        requestsLink.click(function (e) {
            e.preventDefault();
            that.activeTab = 'requests';
            that.refreshDialogContent();
        });
        requestsTabItem.append(requestsLink);

        nav.append(friendsTabItem, requestsTabItem);
        return nav;
    };

    PersonalArea.prototype.getProfileInfo = function (uid) {
        var profile = this.profilesCache[uid] || {};
        var username = profile.username || profile.displayName || (profile.email ? profile.email.split('@')[0] : uid);
        return {
            uid: uid,
            username: username,
            email: profile.email || ''
        };
    };

    PersonalArea.prototype.getFriendDisplayName = function (uid) {
        var profile = this.getProfileInfo(uid);
        return profile ? profile.username : uid;
    };

    PersonalArea.prototype.buildFriendsTabElement = function () {
        var that = this;
        var wrap = $('<div></div>');
        var friendUids = (this.userDocData && Array.isArray(this.userDocData.friends)) ? this.userDocData.friends.slice() : [];

        if (friendUids.length === 0) {
            wrap.append($('<div class="personal-area-empty-state">אין עדיין חברים ברשימה.</div>'));
            return wrap;
        }

        var friendProfiles = friendUids.map(function (uid) {
            return that.getProfileInfo(uid);
        });

        // Sort alphabetically by username
        friendProfiles.sort(function (a, b) {
            return a.username.localeCompare(b.username, 'he', { sensitivity: 'base' });
        });

        var list = $('<ul class="list-group"></ul>');
        friendProfiles.forEach(function (friend) {
            var item = $('<li class="list-group-item personal-area-list-item"></li>');
            var details = $('<div class="personal-area-person-details" style="cursor: pointer;" title="לחץ לצפייה במערכת של ' + friend.username + '"></div>');
            details.append($('<span class="personal-area-person-name"></span>').text(friend.username));
            if (friend.email) {
                details.append($('<span class="personal-area-person-email text-muted"></span>').text(friend.email));
            }

            var doView = function () {
                if (that.dialog) {
                    that.dialog.close();
                }
                var viewFn = window.cheeseMateViewFriendSchedule;
                if (viewFn && friend.uid) {
                    viewFn(friend.uid, friend.username);
                }
            };
            details.click(doView);

            var actions = $('<div class="personal-area-item-actions"></div>');
            var viewBtn = $('<button type="button" class="btn btn-sm btn-outline-primary">' +
                '<i class="fas fa-calendar-alt ml-1"></i> צפה במערכת' +
                '</button>').click(doView);

            var removeBtn = $('<button type="button" class="btn btn-sm btn-outline-danger">' +
                '<i class="fas fa-user-minus"></i> הסר חבר' +
                '</button>').click(function () {
                removeBtn.prop('disabled', true);
                that.removeFriend(friend.uid);
            });

            actions.append(viewBtn, removeBtn);
            item.append(details, actions);
            list.append(item);
        });

        wrap.append(list);
        return wrap;
    };

    PersonalArea.prototype.buildRequestsTabElement = function () {
        var that = this;
        var wrap = $('<div></div>');

        var topBar = $('<div class="d-flex justify-content-between align-items-center mb-2"></div>');
        topBar.append($('<h6 class="mb-0 font-weight-bold">בקשות חברות ממתינות</h6>'));

        var plusBtn = $('<button type="button" class="btn btn-sm btn-primary" title="שליחת בקשת חברות חדשה">' +
            '<i class="fas fa-plus"></i> הוספת חבר' +
            '</button>').click(function () {
            that.isSearchOpen = !that.isSearchOpen;
            if (!that.isSearchOpen) {
                that.searchResults = null;
                that.lastSearchQuery = '';
            }
            that.refreshDialogContent();
        });
        topBar.append(plusBtn);
        wrap.append(topBar);

        if (this.isSearchOpen) {
            wrap.append(this.buildSearchPanelElement());
        }

        var incomingUids = (this.userDocData && Array.isArray(this.userDocData.incomingRequests))
            ? this.userDocData.incomingRequests.slice()
            : [];

        if (incomingUids.length === 0) {
            wrap.append($('<div class="personal-area-empty-state">אין בקשות חברות ממתינות.</div>'));
            return wrap;
        }

        var requesterProfiles = incomingUids.map(function (uid) {
            return that.getProfileInfo(uid);
        });
        requesterProfiles.sort(function (a, b) {
            return a.username.localeCompare(b.username, 'he', { sensitivity: 'base' });
        });

        var list = $('<ul class="list-group"></ul>');
        requesterProfiles.forEach(function (requester) {
            var item = $('<li class="list-group-item personal-area-list-item"></li>');
            var details = $('<div class="personal-area-person-details"></div>');
            details.append($('<span class="personal-area-person-name"></span>').text(requester.username));
            if (requester.email) {
                details.append($('<span class="personal-area-person-email text-muted"></span>').text(requester.email));
            }

            var actions = $('<div class="personal-area-item-actions"></div>');
            var acceptBtn = $('<button type="button" class="btn btn-sm btn-success">' +
                '<i class="fas fa-check"></i> אישור' +
                '</button>').click(function () {
                acceptBtn.prop('disabled', true);
                declineBtn.prop('disabled', true);
                that.acceptFriendRequest(requester.uid);
            });

            var declineBtn = $('<button type="button" class="btn btn-sm btn-outline-danger">' +
                '<i class="fas fa-times"></i> דחייה' +
                '</button>').click(function () {
                acceptBtn.prop('disabled', true);
                declineBtn.prop('disabled', true);
                that.declineFriendRequest(requester.uid);
            });

            actions.append(acceptBtn, declineBtn);
            item.append(details, actions);
            list.append(item);
        });

        wrap.append(list);
        return wrap;
    };

    PersonalArea.prototype.buildSearchPanelElement = function () {
        var that = this;
        var panel = $('<div class="personal-area-search-panel"></div>');

        var form = $('<form class="mb-2"></form>');
        var label = $('<label class="small font-weight-bold mb-1" for="personal-area-user-search">חיפוש משתמשים לפי שם משתמש או כתובת אימייל</label>');
        var inputGroup = $('<div class="input-group input-group-sm"></div>');
        var input = $('<input type="text" id="personal-area-user-search" class="form-control" placeholder="הזינו שם משתמש או אימייל...">')
            .val(this.lastSearchQuery);
        var append = $('<div class="input-group-append"></div>');
        var searchBtn = $('<button type="submit" class="btn btn-primary"><i class="fas fa-search"></i> חיפוש</button>');
        append.append(searchBtn);
        inputGroup.append(input, append);
        form.append(label, inputGroup);

        form.on('submit', function (e) {
            e.preventDefault();
            var q = (input.val() || '').trim();
            if (!q) {
                return;
            }
            that.searchUsers(q);
        });

        panel.append(form);

        if (this.isSearching) {
            panel.append($('<div class="text-muted small py-2">מחפש משתמשים...</div>'));
        } else if (this.searchResults !== null) {
            if (this.searchResults.length === 0) {
                panel.append($('<div class="text-muted small py-2">לא נמצאו משתמשים תואמים.</div>'));
            } else {
                var resultsList = $('<ul class="list-group mt-2"></ul>');
                var friends = (this.userDocData && Array.isArray(this.userDocData.friends)) ? this.userDocData.friends : [];
                var incoming = (this.userDocData && Array.isArray(this.userDocData.incomingRequests)) ? this.userDocData.incomingRequests : [];
                var outgoing = (this.userDocData && Array.isArray(this.userDocData.outgoingRequests)) ? this.userDocData.outgoingRequests : [];

                this.searchResults.forEach(function (userObj) {
                    var item = $('<li class="list-group-item personal-area-list-item"></li>');
                    var details = $('<div class="personal-area-person-details"></div>');
                    var uName = userObj.username || userObj.displayName || (userObj.email ? userObj.email.split('@')[0] : userObj.uid);
                    details.append($('<span class="personal-area-person-name"></span>').text(uName));
                    if (userObj.email) {
                        details.append($('<span class="personal-area-person-email text-muted"></span>').text(userObj.email));
                    }

                    var actions = $('<div class="personal-area-item-actions"></div>');
                    if (friends.indexOf(userObj.uid) !== -1) {
                        actions.append($('<span class="badge badge-success">חברים</span>'));
                    } else if (outgoing.indexOf(userObj.uid) !== -1) {
                        var cancelBtn = $('<button type="button" class="btn btn-sm btn-outline-secondary">' +
                            '<i class="fas fa-undo ml-1"></i> בטל בקשה' +
                            '</button>').click(function () {
                            cancelBtn.prop('disabled', true);
                            that.cancelFriendRequest(userObj.uid);
                        });
                        actions.append(cancelBtn);
                    } else if (incoming.indexOf(userObj.uid) !== -1) {
                        var acceptNowBtn = $('<button type="button" class="btn btn-sm btn-success">' +
                            '<i class="fas fa-check"></i> אשר בקשה' +
                            '</button>').click(function () {
                            acceptNowBtn.prop('disabled', true);
                            that.acceptFriendRequest(userObj.uid);
                        });
                        actions.append(acceptNowBtn);
                    } else {
                        var sendReqBtn = $('<button type="button" class="btn btn-sm btn-primary">' +
                            '<i class="fas fa-user-plus"></i> שלח בקשת חברות' +
                            '</button>').click(function () {
                            sendReqBtn.prop('disabled', true);
                            that.sendFriendRequest(userObj.uid);
                        });
                        actions.append(sendReqBtn);
                    }

                    item.append(details, actions);
                    resultsList.append(item);
                });
                panel.append(resultsList);
            }
        }

        return panel;
    };

    PersonalArea.prototype.searchUsers = function (queryStr) {
        var that = this;
        if (!this.currentUser || !this.firestoreDb) {
            return;
        }

        this.lastSearchQuery = queryStr;
        this.isSearching = true;
        this.refreshDialogContent();

        var qLower = queryStr.toLowerCase();
        var myUid = this.currentUser.uid;

        this.firestoreDb.collection('users').get()
            .then(function (snapshot) {
                var matches = [];
                snapshot.forEach(function (doc) {
                    if (doc.id === myUid) {
                        return;
                    }
                    var d = doc.data() || {};
                    var uName = (d.username || d.displayName || '').toLowerCase();
                    var uEmail = (d.email || '').toLowerCase();
                    if ((uName && uName.indexOf(qLower) !== -1) || (uEmail && uEmail.indexOf(qLower) !== -1)) {
                        var profile = {
                            uid: doc.id,
                            username: d.username || d.displayName || (d.email ? d.email.split('@')[0] : doc.id),
                            email: d.email || ''
                        };
                        that.profilesCache[doc.id] = profile;
                        matches.push(profile);
                    }
                });

                matches.sort(function (a, b) {
                    return a.username.localeCompare(b.username, 'he', { sensitivity: 'base' });
                });

                that.isSearching = false;
                that.searchResults = matches;
                that.refreshDialogContent();
            })
            .catch(function (err) {
                that.isSearching = false;
                that.searchResults = [];
                that.refreshDialogContent();
                alert('שגיאה בחיפוש משתמשים: ' + err.message);
            });
    };

    PersonalArea.prototype.cancelFriendRequest = function (targetUid) {
        if (!this.currentUser || !this.firestoreDb || !targetUid) {
            return;
        }

        var that = this;
        var myUid = this.currentUser.uid;
        var batch = this.firestoreDb.batch();
        var myRef = this.firestoreDb.collection('users').doc(myUid);
        var targetRef = this.firestoreDb.collection('users').doc(targetUid);

        batch.set(myRef, {
            outgoingRequests: firebase.firestore.FieldValue.arrayRemove(targetUid)
        }, { merge: true });

        batch.set(targetRef, {
            incomingRequests: firebase.firestore.FieldValue.arrayRemove(myUid)
        }, { merge: true });

        batch.commit().then(function () {
            that.refreshDialogContent();
        }).catch(function (err) {
            alert('שגיאה בביטול בקשת החברות: ' + err.message);
        });
    };

    PersonalArea.prototype.sendFriendRequest = function (targetUid) {
        var that = this;
        if (!this.currentUser || !this.firestoreDb || !targetUid) {
            return;
        }

        var myUid = this.currentUser.uid;
        var myUsername = this.getCurrentUsername() || 'חבר';
        var batch = this.firestoreDb.batch();
        var myRef = this.firestoreDb.collection('users').doc(myUid);
        var targetRef = this.firestoreDb.collection('users').doc(targetUid);

        batch.set(myRef, {
            outgoingRequests: firebase.firestore.FieldValue.arrayUnion(targetUid)
        }, { merge: true });

        batch.set(targetRef, {
            incomingRequests: firebase.firestore.FieldValue.arrayUnion(myUid)
        }, { merge: true });

        // Add notification for the recipient that they received a friend request
        var notifRef = this.firestoreDb.collection('users').doc(targetUid).collection('notifications').doc();
        var requestMsg = myUsername + ' שלח לך בקשת חברות!';
        batch.set(notifRef, {
            type: 'friend_request_received',
            fromUid: myUid,
            fromUsername: myUsername,
            message: requestMsg,
            timestamp: Date.now(),
            read: false
        });

        batch.commit().then(function () {
            that.refreshDialogContent();
            if (typeof NotificationsManager !== 'undefined' && NotificationsManager.sendPush) {
                return NotificationsManager.sendPush(targetUid, {
                    title: 'CheeseMate',
                    body: requestMsg,
                    icon: '/icons/android-chrome-192x192.png',
                    badge: '/icons/favicon-32x32.png',
                    url: '/?tab=friends',
                    tag: notifRef.id
                }).then(function (res) {
                    console.log('Friend request push dispatch response:', res);
                });
            }
        }).catch(function (err) {
            alert('שגיאה בשליחת בקשת החברות: ' + err.message);
        });
    };

    PersonalArea.prototype.acceptFriendRequest = function (requesterUid) {
        var that = this;
        if (!this.currentUser || !this.firestoreDb || !requesterUid) {
            return;
        }

        var myUid = this.currentUser.uid;
        var myUsername = this.getCurrentUsername() || 'חבר';
        var batch = this.firestoreDb.batch();
        var myRef = this.firestoreDb.collection('users').doc(myUid);
        var requesterRef = this.firestoreDb.collection('users').doc(requesterUid);

        batch.set(myRef, {
            incomingRequests: firebase.firestore.FieldValue.arrayRemove(requesterUid),
            outgoingRequests: firebase.firestore.FieldValue.arrayRemove(requesterUid),
            friends: firebase.firestore.FieldValue.arrayUnion(requesterUid)
        }, { merge: true });

        batch.set(requesterRef, {
            outgoingRequests: firebase.firestore.FieldValue.arrayRemove(myUid),
            incomingRequests: firebase.firestore.FieldValue.arrayRemove(myUid),
            friends: firebase.firestore.FieldValue.arrayUnion(myUid)
        }, { merge: true });

        // Add notification for the requester that their friend request was accepted
        var notifRef = this.firestoreDb.collection('users').doc(requesterUid).collection('notifications').doc();
        var acceptMsg = myUsername + ' אישר את בקשת החברות שלך!';
        batch.set(notifRef, {
            type: 'friend_request_accepted',
            fromUid: myUid,
            fromUsername: myUsername,
            message: acceptMsg,
            timestamp: Date.now(),
            read: false
        });

        batch.commit().then(function () {
            that.refreshDialogContent();
            if (typeof NotificationsManager !== 'undefined' && NotificationsManager.sendPush) {
                return NotificationsManager.sendPush(requesterUid, {
                    title: 'CheeseMate',
                    body: acceptMsg,
                    icon: '/icons/android-chrome-192x192.png',
                    badge: '/icons/favicon-32x32.png',
                    url: '/?tab=friends',
                    tag: notifRef.id
                }).then(function (res) {
                    console.log('Friend request accept push dispatch response:', res);
                });
            }
        }).catch(function (err) {
            alert('שגיאה באישור בקשת החברות: ' + err.message);
        });
    };

    PersonalArea.prototype.declineFriendRequest = function (requesterUid) {
        if (!this.currentUser || !this.firestoreDb || !requesterUid) {
            return;
        }

        var myUid = this.currentUser.uid;
        var batch = this.firestoreDb.batch();
        var myRef = this.firestoreDb.collection('users').doc(myUid);
        var requesterRef = this.firestoreDb.collection('users').doc(requesterUid);

        batch.set(myRef, {
            incomingRequests: firebase.firestore.FieldValue.arrayRemove(requesterUid)
        }, { merge: true });

        batch.set(requesterRef, {
            outgoingRequests: firebase.firestore.FieldValue.arrayRemove(myUid)
        }, { merge: true });

        batch.commit().catch(function (err) {
            alert('שגיאה בדחיית בקשת החברות: ' + err.message);
        });
    };

    PersonalArea.prototype.removeFriend = function (friendUid) {
        if (!this.currentUser || !this.firestoreDb || !friendUid) {
            return;
        }

        var myUid = this.currentUser.uid;
        var batch = this.firestoreDb.batch();
        var myRef = this.firestoreDb.collection('users').doc(myUid);
        var friendRef = this.firestoreDb.collection('users').doc(friendUid);

        batch.set(myRef, {
            friends: firebase.firestore.FieldValue.arrayRemove(friendUid)
        }, { merge: true });

        batch.set(friendRef, {
            friends: firebase.firestore.FieldValue.arrayRemove(myUid)
        }, { merge: true });

        batch.commit().catch(function (err) {
            alert('שגיאה בהסרת החבר: ' + err.message);
        });
    };

    PersonalArea.prototype.confirmLogout = function () {
        var that = this;
        BootstrapDialog.show({
            title: 'התנתקות מהמערכת',
            message: 'האם אתם בטוחים שברצונכם להתנתק מהמערכת?',
            buttons: [{
                label: 'התנתקות',
                cssClass: 'btn-primary',
                action: function (confirmDialog) {
                    confirmDialog.close();
                    if (that.dialog) {
                        that.dialog.close();
                    }
                    firebase.auth().signOut();
                }
            }, {
                label: 'ביטול',
                action: function (confirmDialog) {
                    confirmDialog.close();
                }
            }]
        });
    };

    PersonalArea.prototype.confirmAccountDeletion = function () {
        var that = this;
        BootstrapDialog.show({
            title: 'מחיקת חשבון',
            type: BootstrapDialog.TYPE_DANGER,
            message: 'האם אתם בטוחים שברצונכם למחוק את החשבון שלכם לצמיתות?<br>' +
                'פעולה זו תמחק את כל המערכות השמורות, רשימת החברים ופרטי החשבון שלכם, ולא ניתן לבטלה.',
            buttons: [{
                label: 'מחק חשבון לצמיתות',
                cssClass: 'btn-danger',
                action: function (confirmDialog) {
                    confirmDialog.enableButtons(false);
                    that.deleteAccount(function () {
                        confirmDialog.close();
                        if (that.dialog) {
                            that.dialog.close();
                        }
                    }, function () {
                        confirmDialog.enableButtons(true);
                    });
                }
            }, {
                label: 'ביטול',
                action: function (confirmDialog) {
                    confirmDialog.close();
                }
            }]
        });
    };

    PersonalArea.prototype.deleteAccount = function (onSuccess, onError) {
        var that = this;
        var user = this.currentUser;
        if (!user || !this.firestoreDb) {
            if (onError) onError();
            return;
        }

        var myUid = user.uid;
        var data = this.userDocData || {};
        var friends = Array.isArray(data.friends) ? data.friends : [];
        var incoming = Array.isArray(data.incomingRequests) ? data.incomingRequests : [];
        var outgoing = Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [];

        // Stop active Firestore watchers before deleting documents
        this.onBeforeAccountDelete();
        this.stopWatching();

        var db = this.firestoreDb;
        var batch = db.batch();

        friends.forEach(function (fUid) {
            batch.set(db.collection('users').doc(fUid), {
                friends: firebase.firestore.FieldValue.arrayRemove(myUid)
            }, { merge: true });
        });

        incoming.forEach(function (reqUid) {
            batch.set(db.collection('users').doc(reqUid), {
                outgoingRequests: firebase.firestore.FieldValue.arrayRemove(myUid)
            }, { merge: true });
        });

        outgoing.forEach(function (targetUid) {
            batch.set(db.collection('users').doc(targetUid), {
                incomingRequests: firebase.firestore.FieldValue.arrayRemove(myUid)
            }, { merge: true });
        });

        var semestersMap = (typeof window.availableSemesters === 'object' && window.availableSemesters)
            ? window.availableSemesters
            : {};
        Object.keys(semestersMap).forEach(function (sem) {
            batch.delete(db.collection('users').doc(myUid).collection('semesters').doc(sem));
        });

        batch.delete(db.collection('users').doc(myUid));

        batch.commit()
            .then(function () {
                return user.delete();
            })
            .then(function () {
                if (onSuccess) onSuccess();
            })
            .catch(function (err) {
                if (err && err.code === 'auth/requires-recent-login') {
                    // User's Firestore data is already deleted; sign out and inform user
                    firebase.auth().signOut().then(function () {
                        if (onSuccess) onSuccess();
                    });
                } else {
                    alert('שגיאה במחיקת החשבון: ' + (err ? err.message : ''));
                    if (onError) onError();
                }
            });
    };

    return PersonalArea;
})();
