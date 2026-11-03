/* CheeseMate Admin Dashboard Logic */

(function () {
    'use strict';

    var firebaseConfig = {
        apiKey: 'AIzaSyC7leQH8fYdT_ycbYsezVXSSYgtK1wBOEU',
        authDomain: 'cheesemate-yk.firebaseapp.com',
        appId: '1:215004619874:web:2049a06ba5c2aa95fd1d3b',
        projectId: 'cheesemate-yk',
        storageBucket: 'cheesemate-yk.firebasestorage.app',
        messagingSenderId: '215004619874'
    };

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    var auth = firebase.auth();
    var db = firebase.firestore();

    var currentUser = null;
    var allUsers = [];
    var userToDelete = null;

    // Mapping of permission levels: numeric level -> { level, name, description }
    var permissionLevelsMap = {
        0: { level: 0, name: 'user', description: 'משתמש רגיל' },
        1: { level: 1, name: 'admin', description: 'מנהל מערכת' }
    };

    // DOM Elements
    var loadingState = $('#admin-loading-state');
    var loginState = $('#admin-login-state');
    var deniedState = $('#admin-denied-state');
    var dashboardState = $('#admin-dashboard-state');
    var userProfileHeader = $('#admin-user-profile');
    var userNameHeader = $('#admin-user-name');
    var deniedUserEmail = $('#denied-user-email');

    var statTotalUsers = $('#stat-total-users');
    var statAdminUsers = $('#stat-admin-users');
    var statRegularUsers = $('#stat-regular-users');

    var searchInput = $('#admin-search-input');
    var roleFilter = $('#admin-role-filter');
    var usersTableBody = $('#admin-users-tbody');
    var noUsersPlaceholder = $('#admin-no-users');
    var refreshBtn = $('#admin-refresh-users-btn');

    var deleteModal = $('#deleteUserModal');
    var deleteModalUsername = $('#delete-modal-username');
    var deleteModalEmail = $('#delete-modal-email');
    var deleteModalUid = $('#delete-modal-uid');
    var confirmDeleteBtn = $('#confirm-delete-user-btn');

    // Notification Modal Elements
    var notifyModal = $('#sendNotificationModal');
    var notifyForm = $('#admin-send-notification-form');
    var openNotifyModalBtn = $('#admin-open-notify-modal-btn');
    var notifyRadioBroadcast = $('#notify-target-broadcast');
    var notifyRadioSpecific = $('#notify-target-specific');
    var notifyBroadcastInfo = $('#notify-broadcast-info');
    var notifyBroadcastCount = $('#notify-broadcast-count');
    var notifySpecificContainer = $('#notify-specific-users-container');
    var notifyUsersChecklist = $('#notify-users-checklist');
    var notifyUserSearch = $('#notify-user-search');
    var notifySelectAllBtn = $('#notify-select-all-btn');
    var notifyDeselectAllBtn = $('#notify-deselect-all-btn');
    var notifySelectedCountBadge = $('#notify-selected-users-badge');
    var notifySenderName = $('#notify-sender-name');
    var notifyTypeSelect = $('#notify-type-select');
    var notifyMessageText = $('#notify-message-text');
    var notifyCharCounter = $('#notify-char-counter');
    var notifySendPush = $('#notify-send-push');
    var notifyPreviewIcon = $('#notify-preview-icon');
    var notifyPreviewBadge = $('#notify-preview-badge');
    var notifyPreviewSender = $('#notify-preview-sender');
    var notifyPreviewMsg = $('#notify-preview-msg');
    var notifyProgressBox = $('#notify-progress-box');
    var notifyProgressBar = $('#notify-progress-bar');
    var notifyProgressLabel = $('#notify-progress-label');
    var notifyProgressPercent = $('#notify-progress-percent');
    var notifyResultAlert = $('#notify-result-alert');
    var notifySubmitBtn = $('#notify-submit-btn');
    var notifyCancelBtn = $('#notify-cancel-btn');

    function switchView(view) {
        loadingState.addClass('d-none');
        loginState.addClass('d-none');
        deniedState.addClass('d-none');
        dashboardState.addClass('d-none');

        if (view === 'loading') {
            loadingState.removeClass('d-none');
        } else if (view === 'login') {
            loginState.removeClass('d-none');
            userProfileHeader.addClass('d-none');
        } else if (view === 'denied') {
            deniedState.removeClass('d-none');
            userProfileHeader.addClass('d-none');
        } else if (view === 'dashboard') {
            dashboardState.removeClass('d-none');
            userProfileHeader.removeClass('d-none').addClass('d-flex');
        }
    }

    function isAdministrator(user, data) {
        if (!user || !data) return false;
        return data.level === 1 || data.level === '1';
    }

    // Load and seed permissionLevels collection
    function loadPermissionLevels() {
        return db.collection('permissionLevels').get()
            .then(function (snapshot) {
                if (snapshot.empty) {
                    var batch = db.batch();
                    batch.set(db.collection('permissionLevels').doc('0'), {
                        level: 0,
                        name: 'user',
                        description: 'משתמש רגיל'
                    });
                    batch.set(db.collection('permissionLevels').doc('1'), {
                        level: 1,
                        name: 'admin',
                        description: 'מנהל מערכת'
                    });
                    return batch.commit().then(function () {
                        console.log('Seeded permissionLevels collection with defaults (0: user, 1: admin).');
                        if (typeof RoleManager !== 'undefined') {
                            RoleManager.registerRole({ level: 0, name: 'user', description: 'משתמש רגיל', isStandard: true });
                            RoleManager.registerRole({ level: 1, name: 'admin', description: 'מנהל מערכת', isStandard: false });
                        }
                    }).catch(function (seedErr) {
                        console.warn('Could not seed permissionLevels:', seedErr);
                    });
                } else {
                    snapshot.forEach(function (doc) {
                        var data = doc.data() || {};
                        var lvl = typeof data.level === 'number' ? data.level : parseInt(doc.id, 10);
                        if (!isNaN(lvl)) {
                            permissionLevelsMap[lvl] = {
                                level: lvl,
                                name: data.name || (lvl === 1 ? 'admin' : 'user'),
                                description: data.description || ''
                            };
                            if (typeof RoleManager !== 'undefined') {
                                RoleManager.registerRole({
                                    level: lvl,
                                    name: data.name || (lvl === 1 ? 'admin' : 'user'),
                                    description: data.description || '',
                                    isStandard: (lvl === 0)
                                });
                            }
                        }
                    });
                }
            })
            .catch(function (err) {
                console.warn('Error fetching permissionLevels, using fallback map:', err);
            });
    }

    // Auth State Observer
    auth.onAuthStateChanged(function (user) {
        currentUser = user;
        if (!user) {
            switchView('login');
            return;
        }

        switchView('loading');

        db.collection('users').doc(user.uid).get()
            .then(function (doc) {
                var data = doc.exists ? doc.data() : {};

                if (isAdministrator(user, data)) {
                    // Update admin's lastSeen timestamp in Firestore
                    db.collection('users').doc(user.uid).set({
                        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true }).catch(function (err) {
                        console.warn('Failed to update admin lastSeen timestamp:', err);
                    });

                    var displayName = data.username || data.displayName || user.displayName || user.email || 'מנהל';
                    userNameHeader.text(displayName);
                    if (typeof RoleManager !== 'undefined') {
                        RoleManager.applyRoleHover(userNameHeader, data);
                    } else {
                        userNameHeader.addClass('admin-golden-gradient');
                    }
                    switchView('dashboard');
                    loadPermissionLevels().then(function () {
                        loadAllUsers();
                    });
                } else {
                    deniedUserEmail.text(user.email || user.uid);
                    switchView('denied');
                }
            })
            .catch(function (err) {
                console.error('Error fetching user document:', err);
                deniedUserEmail.text(user.email || user.uid);
                switchView('denied');
            });
    });

    // Login Event Handlers
    $('#admin-google-login-btn').click(function () {
        var provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(function (err) {
            alert('שגיאה בהתחברות באמצעות Google: ' + err.message);
        });
    });

    $('#admin-email-login-form').submit(function (e) {
        e.preventDefault();
        var email = $('#admin-login-email').val();
        var pass = $('#admin-login-password').val();
        var errBox = $('#admin-login-error');

        errBox.addClass('d-none').text('');
        auth.signInWithEmailAndPassword(email, pass).catch(function (err) {
            errBox.removeClass('d-none').text('שגיאה בהתחברות: ' + err.message);
        });
    });

    $('#admin-logout-btn, #denied-switch-account-btn').click(function () {
        auth.signOut();
    });

    // Load and Render Users
    function loadAllUsers() {
        refreshBtn.prop('disabled', true).find('i').addClass('fa-spin');

        loadPermissionLevels().then(function () {
            return db.collection('users').get();
        }).then(function (snapshot) {
            allUsers = [];
            snapshot.forEach(function (doc) {
                var d = doc.data() || {};
                var level = (typeof d.level === 'number') ? d.level : 0;

                var email = d.email || '';
                if (!email && doc.id === (currentUser ? currentUser.uid : '')) {
                    email = currentUser.email || '';
                }

                allUsers.push({
                    uid: doc.id,
                    username: d.username || d.displayName || (email ? email.split('@')[0] : 'ללא שם'),
                    email: email,
                    level: level,
                    friends: Array.isArray(d.friends) ? d.friends : [],
                    incomingRequests: Array.isArray(d.incomingRequests) ? d.incomingRequests : [],
                    outgoingRequests: Array.isArray(d.outgoingRequests) ? d.outgoingRequests : [],
                    lastSeen: extractUserLastSeen(d),
                    data: d
                });
            });

            allUsers.sort(function (a, b) {
                if (a.level === 1 && b.level !== 1) return -1;
                if (a.level !== 1 && b.level === 1) return 1;
                return a.username.localeCompare(b.username, 'he', { sensitivity: 'base' });
            });

            updateStats();
            renderUsersTable();
            refreshBtn.prop('disabled', false).find('i').removeClass('fa-spin');
        }).catch(function (err) {
            refreshBtn.prop('disabled', false).find('i').removeClass('fa-spin');
            alert('שגיאה בטעינת המשתמשים: ' + err.message);
        });
    }

    refreshBtn.click(loadAllUsers);

    function updateStats() {
        var total = allUsers.length;
        var admins = 0;
        var regulars = 0;

        allUsers.forEach(function (u) {
            if (u.level === 1) {
                admins++;
            } else {
                regulars++;
            }
        });

        statTotalUsers.text(total);
        statAdminUsers.text(admins);
        statRegularUsers.text(regulars);
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function padZero(num) {
        return num < 10 ? '0' + num : String(num);
    }

    function parseDate(val) {
        if (!val) return null;
        if (typeof val.toDate === 'function') {
            try {
                var res = val.toDate();
                return (res instanceof Date && !isNaN(res.getTime())) ? res : null;
            } catch (e) {
                return null;
            }
        }
        if (val instanceof Date) {
            return isNaN(val.getTime()) ? null : val;
        }
        if (typeof val === 'number') {
            var ms = val < 1e11 ? val * 1000 : val;
            var dNum = new Date(ms);
            return isNaN(dNum.getTime()) ? null : dNum;
        }
        if (typeof val === 'string') {
            var parsed = Date.parse(val);
            if (!isNaN(parsed)) {
                return new Date(parsed);
            }
        }
        if (typeof val === 'object' && typeof val.seconds === 'number') {
            var dSec = new Date(val.seconds * 1000 + (val.nanoseconds ? val.nanoseconds / 1e6 : 0));
            return isNaN(dSec.getTime()) ? null : dSec;
        }
        return null;
    }

    function extractUserLastSeen(d) {
        var raw = d && (d.lastSeen || d.last_seen || d.lastActive || d.lastLogin || d.lastSeenAt || d.updatedAt);
        return parseDate(raw);
    }

    function formatLastSeen(date) {
        if (!date) {
            return {
                html: '<span class="text-muted small" title="לא נרשמה פעילות">-</span>',
                title: 'לא נרשמה פעילות'
            };
        }

        var now = Date.now();
        var timeMs = date.getTime();
        var diffMs = now - timeMs;
        var day = padZero(date.getDate());
        var month = padZero(date.getMonth() + 1);
        var year = date.getFullYear();
        var fullDateStr = day + '/' + month + '/' + year;
        var hours = padZero(date.getHours());
        var minutes = padZero(date.getMinutes());
        var timeStr = hours + ':' + minutes;
        var fullFormatted = fullDateStr + ' ' + timeStr;

        if (diffMs < 2 * 60 * 1000) {
            return {
                html: '<span class="badge badge-success font-weight-normal py-1 px-2"><i class="fas fa-circle ml-1 small" style="font-size: 0.5rem; vertical-align: middle;"></i> מחובר עכשיו</span><small class="last-seen-date d-block mt-1">' + fullFormatted + '</small>',
                title: fullFormatted
            };
        }

        var diffSec = Math.floor(diffMs / 1000);
        var diffMin = Math.floor(diffSec / 60);
        var diffHour = Math.floor(diffMin / 60);
        var diffDays = Math.floor(diffHour / 24);

        var relativeText = '';
        var subText = fullFormatted;
        if (diffMin < 60) {
            relativeText = 'לפני ' + (diffMin === 1 ? 'דקה' : (diffMin === 2 ? '2 דקות' : diffMin + ' דקות'));
        } else if (diffHour < 24) {
            relativeText = 'לפני ' + (diffHour === 1 ? 'שעה' : (diffHour === 2 ? 'שעתיים' : diffHour + ' שעות'));
        } else if (diffDays === 1) {
            relativeText = 'אתמול ב-' + timeStr;
        } else if (diffDays === 2) {
            relativeText = 'לפני יומיים ב-' + timeStr;
        } else if (diffDays < 7) {
            relativeText = 'לפני ' + diffDays + ' ימים';
        } else {
            relativeText = fullDateStr;
            subText = timeStr;
        }

        return {
            html: '<div class="last-seen-time">' + relativeText + '</div><small class="last-seen-date d-block">' + subText + '</small>',
            title: fullFormatted
        };
    }

    function renderUsersTable() {
        var q = (searchInput.val() || '').trim().toLowerCase();
        var selectedRole = roleFilter.val();

        var filtered = allUsers.filter(function (u) {
            var matchesRole = true;
            if (selectedRole === '1') {
                matchesRole = (u.level === 1);
            } else if (selectedRole === '0') {
                matchesRole = (u.level === 0);
            }

            if (!matchesRole) return false;

            if (!q) return true;

            var matchName = u.username.toLowerCase().indexOf(q) !== -1;
            var matchEmail = u.email.toLowerCase().indexOf(q) !== -1;
            var matchUid = u.uid.toLowerCase().indexOf(q) !== -1;

            return matchName || matchEmail || matchUid;
        });

        usersTableBody.empty();

        if (filtered.length === 0) {
            noUsersPlaceholder.removeClass('d-none');
            return;
        }

        noUsersPlaceholder.addClass('d-none');

        filtered.forEach(function (u) {
            var isCurrent = currentUser && currentUser.uid === u.uid;
            var isAdmin = (u.level === 1);
            var levelInfo = permissionLevelsMap[u.level] || {
                level: u.level,
                name: u.level === 1 ? 'admin' : 'user',
                description: u.level === 1 ? 'מנהל מערכת' : 'משתמש רגיל'
            };

            var avatarChar = u.username ? u.username.charAt(0).toUpperCase() : '?';
            var avatarBg = isAdmin ? '#e74a3b' : '#4e73df';

            var tr = $('<tr></tr>');

            // 1. User column
            var userTd = $('<td></td>');
            var userFlex = $('<div class="d-flex align-items-center"></div>');
            var avatar = $('<div class="user-avatar ml-2" style="background-color: ' + avatarBg + '"></div>').text(avatarChar);
            var userMeta = $('<div></div>');
            var nameSpan = $('<span></span>').text(u.username);
            if (typeof RoleManager !== 'undefined') {
                RoleManager.applyRoleHover(nameSpan, u);
            } else if (isAdmin) {
                nameSpan.addClass('admin-golden-gradient');
            } else {
                nameSpan.addClass('text-dark');
            }
            if (typeof RoleManager !== 'undefined' && RoleManager.isStandardUser(u)) {
                nameSpan.addClass('text-dark');
            }
            var nameEl = $('<div class="font-weight-bold"></div>').append(nameSpan);
            if (isCurrent) {
                nameEl.append(' <span class="badge badge-light border text-muted small">(אתה)</span>');
            }
            userMeta.append(nameEl);
            userFlex.append(avatar, userMeta);
            userTd.append(userFlex);

            // 2. Email column
            var emailTd = $('<td></td>');
            if (u.email) {
                emailTd.text(u.email);
            } else {
                emailTd.html('<span class="text-muted small">לא צוין</span>');
            }

            // 3. UID column with copy
            var uidTd = $('<td></td>');
            var uidBadge = $('<span class="uid-badge" title="לחץ להעתקת UID"></span>')
                .html('<i class="far fa-copy ml-1"></i> ' + escapeHtml(u.uid))
                .click(function () {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(u.uid).then(function () {
                            uidBadge.addClass('text-success').html('<i class="fas fa-check ml-1"></i> הועתק!');
                            setTimeout(function () {
                                uidBadge.removeClass('text-success').html('<i class="far fa-copy ml-1"></i> ' + escapeHtml(u.uid));
                            }, 1500);
                        });
                    }
                });
            uidTd.append(uidBadge);

            // 4. Role / Level column with dropdown selector
            var roleTd = $('<td></td>');
            var roleSelect = $('<select class="custom-select custom-select-sm" style="width: auto; min-width: 140px;"></select>');
            var userLevelName = (permissionLevelsMap[0] ? permissionLevelsMap[0].name : 'user');
            var adminLevelName = (permissionLevelsMap[1] ? permissionLevelsMap[1].name : 'admin');
            roleSelect.append('<option value="0"' + (!isAdmin ? ' selected' : '') + '>0 - ' + userLevelName + '</option>');
            roleSelect.append('<option value="1"' + (isAdmin ? ' selected' : '') + '>1 - ' + adminLevelName + '</option>');

            if (isCurrent) {
                roleSelect.prop('disabled', true).attr('title', 'לא ניתן לשנות את הרשאת החשבון המחובר');
            } else {
                roleSelect.change(function () {
                    var newLevel = parseInt($(this).val(), 10);
                    changeUserLevel(u.uid, newLevel, roleSelect);
                });
            }

            var roleBadge = $('<span class="badge mr-2 ' + (isAdmin ? 'badge-role-admin' : 'badge-role-user') + '"></span>')
                .text(levelInfo.name + ' (' + u.level + ')');

            var roleWrapper = $('<div class="d-flex align-items-center"></div>');
            roleWrapper.append(roleBadge, roleSelect);
            roleTd.append(roleWrapper);

            // 5. Friends count column
            var friendsTd = $('<td></td>');
            var fCount = u.friends.length;
            friendsTd.html('<span class="badge badge-light border"><i class="fas fa-user-friends ml-1 text-primary"></i> ' + fCount + '</span>');

            // 6. Last Seen column
            var lastSeenTd = $('<td></td>');
            var lastSeenFormatted = formatLastSeen(u.lastSeen);
            lastSeenTd.attr('title', lastSeenFormatted.title);
            lastSeenTd.html(lastSeenFormatted.html);

            // 7. Actions column (Send Notification & Delete buttons)
            var actionsTd = $('<td class="text-center"></td>');
            var sendNotifyBtn = $('<button class="btn btn-outline-primary btn-sm ml-1" title="שלח הודעה למשתמש זה"></button>')
                .html('<i class="fas fa-paper-plane ml-1"></i> הודעה')
                .click(function () {
                    openSendNotificationModal(u.uid);
                });

            var deleteBtn = $('<button class="btn btn-outline-danger btn-sm" title="מחק משתמש לצמיתות"></button>')
                .html('<i class="fas fa-trash-alt ml-1"></i> מחק');

            if (isCurrent) {
                deleteBtn.prop('disabled', true).attr('title', 'לא ניתן למחוק את החשבון המחובר מלוח הניהול');
            } else {
                deleteBtn.click(function () {
                    openDeleteModal(u);
                });
            }

            actionsTd.append(sendNotifyBtn, deleteBtn);

            tr.append(userTd, emailTd, uidTd, roleTd, friendsTd, lastSeenTd, actionsTd);
            usersTableBody.append(tr);
        });
    }

    searchInput.on('input', renderUsersTable);
    roleFilter.change(renderUsersTable);

    // Change User Level
    function changeUserLevel(targetUid, newLevel, selectEl) {
        selectEl.prop('disabled', true);
        var numLevel = parseInt(newLevel, 10);

        db.collection('users').doc(targetUid).update({
            level: numLevel
        }).then(function () {
            selectEl.prop('disabled', false);
            // Update in memory
            var userObj = allUsers.find(function (u) { return u.uid === targetUid; });
            if (userObj) {
                userObj.level = numLevel;
            }
            updateStats();
            renderUsersTable();
        }).catch(function (err) {
            selectEl.prop('disabled', false);
            alert('שגיאה בעדכון הרשאת המשתמש: ' + err.message);
            renderUsersTable();
        });
    }

    // Open Delete Modal
    function openDeleteModal(u) {
        userToDelete = u;
        deleteModalUsername.text(u.username);
        if (typeof RoleManager !== 'undefined') {
            RoleManager.applyRoleHover(deleteModalUsername, u);
        } else if (u.level === 1) {
            deleteModalUsername.addClass('admin-golden-gradient');
        } else {
            deleteModalUsername.removeClass('admin-golden-gradient');
        }
        deleteModalEmail.text(u.email || 'לא צוין');
        deleteModalUid.text(u.uid);
        confirmDeleteBtn.prop('disabled', false).html('<i class="fas fa-trash-alt ml-1"></i> מחק משתמש');
        deleteModal.modal('show');
    }

    // Confirm Delete User
    confirmDeleteBtn.click(function () {
        if (!userToDelete) return;

        var targetUid = userToDelete.uid;
        confirmDeleteBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm ml-1" role="status" aria-hidden="true"></span> מוחק נתונים...');

        // 1. Find all friends or connected users that reference targetUid and clean them up
        var batch = db.batch();

        allUsers.forEach(function (u) {
            if (u.uid === targetUid) return;
            var uRef = db.collection('users').doc(u.uid);
            var needsFriendClean = u.friends.indexOf(targetUid) !== -1;
            var needsIncomingClean = u.incomingRequests.indexOf(targetUid) !== -1;
            var needsOutgoingClean = u.outgoingRequests.indexOf(targetUid) !== -1;

            if (needsFriendClean || needsIncomingClean || needsOutgoingClean) {
                var updates = {};
                if (needsFriendClean) updates.friends = firebase.firestore.FieldValue.arrayRemove(targetUid);
                if (needsIncomingClean) updates.incomingRequests = firebase.firestore.FieldValue.arrayRemove(targetUid);
                if (needsOutgoingClean) updates.outgoingRequests = firebase.firestore.FieldValue.arrayRemove(targetUid);
                batch.update(uRef, updates);
            }
        });

        // 2. Fetch and delete semesters subcollection
        var semestersPromise = db.collection('users').doc(targetUid).collection('semesters').get()
            .then(function (semSnap) {
                semSnap.forEach(function (sDoc) {
                    batch.delete(sDoc.ref);
                });
            }).catch(function (e) {
                console.warn('Could not list semesters:', e);
            });

        // 3. Fetch and delete notifications subcollection
        var notifsPromise = db.collection('users').doc(targetUid).collection('notifications').get()
            .then(function (notifSnap) {
                notifSnap.forEach(function (nDoc) {
                    batch.delete(nDoc.ref);
                });
            }).catch(function (e) {
                console.warn('Could not list notifications:', e);
            });

        Promise.all([semestersPromise, notifsPromise]).then(function () {
            // 4. Delete the user document itself
            batch.delete(db.collection('users').doc(targetUid));

            return batch.commit();
        }).then(function () {
            deleteModal.modal('hide');
            // Remove from local list
            allUsers = allUsers.filter(function (u) { return u.uid !== targetUid; });
            updateStats();
            renderUsersTable();
            alert('המשתמש ' + userToDelete.username + ' נמחק בהצלחה לצמיתות.');
            userToDelete = null;
        }).catch(function (err) {
            confirmDeleteBtn.prop('disabled', false).html('<i class="fas fa-trash-alt ml-1"></i> מחק משתמש');
            alert('שגיאה במחיקת המשתמש: ' + err.message);
        });
    });

    // ==========================================
    // System Notification Modal & Sending Logic
    // ==========================================

    function updateSelectedUsersCount() {
        var count = notifyUsersChecklist.find('.notify-user-chk:checked').length;
        notifySelectedCountBadge.text('נבחרו ' + count + ' משתמשים');
        if (count > 0) {
            notifySelectedCountBadge.removeClass('badge-secondary').addClass('badge-primary');
        } else {
            notifySelectedCountBadge.removeClass('badge-primary').addClass('badge-secondary');
        }
    }

    function populateUsersChecklist(preselectedUid) {
        notifyUsersChecklist.empty();
        notifyUserSearch.val('');

        allUsers.forEach(function (u) {
            var row = $('<div class="notify-user-row d-flex align-items-center justify-content-between"></div>');
            row.attr('data-username', (u.username || '').toLowerCase());
            row.attr('data-email', (u.email || '').toLowerCase());
            row.attr('data-uid', (u.uid || '').toLowerCase());

            var leftFlex = $('<div class="d-flex align-items-center"></div>');
            var chk = $('<input type="checkbox" class="notify-user-chk ml-2">').val(u.uid);
            if (preselectedUid && u.uid === preselectedUid) {
                chk.prop('checked', true);
                row.addClass('selected');
            }

            var avatarBg = (u.level === 1) ? '#e74a3b' : '#4e73df';
            var avatarLetter = u.username ? u.username.charAt(0).toUpperCase() : '?';
            var avatar = $('<div class="notify-user-avatar ml-2" style="background-color: ' + avatarBg + '"></div>').text(avatarLetter);

            var userMeta = $('<div></div>');
            var nameSpan = $('<span></span>').text(u.username);
            if (typeof RoleManager !== 'undefined') {
                RoleManager.applyRoleHover(nameSpan, u);
            } else if (u.level === 1) {
                nameSpan.addClass('admin-golden-gradient');
            }
            var nameDiv = $('<div class="small font-weight-bold"></div>').append(nameSpan);
            if (currentUser && currentUser.uid === u.uid) {
                nameDiv.append(' <span class="badge badge-light border text-muted small">(אתה)</span>');
            }
            var emailDiv = $('<div class="small text-muted"></div>').text(u.email || 'ללא דוא״ל');
            userMeta.append(nameDiv, emailDiv);

            leftFlex.append(chk, avatar, userMeta);

            var rightBadges = $('<div class="d-flex align-items-center"></div>');
            var roleBadge = $('<span class="badge mr-1 ' + (u.level === 1 ? 'badge-role-admin' : 'badge-role-user') + '" style="font-size: 0.7rem;"></span>')
                .text(u.level === 1 ? 'admin' : 'user');
            rightBadges.append(roleBadge);

            row.append(leftFlex, rightBadges);

            chk.change(function () {
                if ($(this).is(':checked')) {
                    row.addClass('selected');
                } else {
                    row.removeClass('selected');
                }
                updateSelectedUsersCount();
            });

            row.click(function (e) {
                if (e.target.tagName.toLowerCase() !== 'input') {
                    chk.prop('checked', !chk.is(':checked')).trigger('change');
                }
            });

            notifyUsersChecklist.append(row);
        });

        updateSelectedUsersCount();
    }

    notifyUserSearch.on('input', function () {
        var q = ($(this).val() || '').trim().toLowerCase();
        notifyUsersChecklist.find('.notify-user-row').each(function () {
            var r = $(this);
            var uName = r.attr('data-username') || '';
            var uEmail = r.attr('data-email') || '';
            var uUid = r.attr('data-uid') || '';
            if (!q || uName.indexOf(q) !== -1 || uEmail.indexOf(q) !== -1 || uUid.indexOf(q) !== -1) {
                r.removeClass('d-none');
            } else {
                r.addClass('d-none');
            }
        });
    });

    notifySelectAllBtn.click(function () {
        notifyUsersChecklist.find('.notify-user-row:not(.d-none) .notify-user-chk').prop('checked', true).trigger('change');
    });

    notifyDeselectAllBtn.click(function () {
        notifyUsersChecklist.find('.notify-user-chk').prop('checked', false).trigger('change');
    });

    $('input[name="notifyTargetMode"]').change(function () {
        var mode = $(this).val();
        if (mode === 'broadcast') {
            notifyBroadcastInfo.removeClass('d-none');
            notifySpecificContainer.addClass('d-none');
        } else {
            notifyBroadcastInfo.addClass('d-none');
            notifySpecificContainer.removeClass('d-none');
            updateSelectedUsersCount();
        }
    });

    function updateNotificationPreview() {
        var text = notifyMessageText.val() || '';
        var sender = notifySenderName.val() || 'מערכת CheeseMate';
        var type = notifyTypeSelect.val();

        notifyCharCounter.text(text.length);
        if (text.length > 500) {
            notifyCharCounter.addClass('text-danger font-weight-bold');
        } else {
            notifyCharCounter.removeClass('text-danger font-weight-bold');
        }

        notifyPreviewSender.text(sender);
        notifyPreviewMsg.text(text || '(תוכן ההודעה יוצג כאן...)');

        if (type === 'update') {
            notifyPreviewIcon.html('<i class="fas fa-star text-info fa-lg"></i>');
            notifyPreviewBadge.text('עדכון').removeClass('badge-warning text-dark badge-danger').addClass('badge-info text-white');
        } else if (type === 'alert') {
            notifyPreviewIcon.html('<i class="fas fa-exclamation-circle text-danger fa-lg"></i>');
            notifyPreviewBadge.text('התראה').removeClass('badge-warning text-dark badge-info').addClass('badge-danger text-white');
        } else {
            notifyPreviewIcon.html('<i class="fas fa-bullhorn text-warning fa-lg"></i>');
            notifyPreviewBadge.text('מערכת').removeClass('badge-info text-white badge-danger').addClass('badge-warning text-dark');
        }
    }

    notifyMessageText.on('input', updateNotificationPreview);
    notifySenderName.on('input', updateNotificationPreview);
    notifyTypeSelect.change(updateNotificationPreview);

    function openSendNotificationModal(preselectedUid) {
        notifyBroadcastCount.text(allUsers.length);
        notifyMessageText.val('');
        notifySenderName.val('מערכת CheeseMate');
        notifyTypeSelect.val('system');
        notifySendPush.prop('checked', true);
        notifyProgressBox.addClass('d-none');
        notifyProgressBar.css('width', '0%');
        notifyProgressPercent.text('0%');
        notifyResultAlert.addClass('d-none').removeClass('alert-success alert-danger').text('');
        notifySubmitBtn.prop('disabled', false).html('<i class="fas fa-paper-plane ml-1"></i> שלח הודעה');
        notifyCancelBtn.prop('disabled', false);

        populateUsersChecklist(preselectedUid);

        if (preselectedUid) {
            notifyRadioSpecific.prop('checked', true).trigger('change');
        } else {
            // Default to broadcast as requested
            notifyRadioBroadcast.prop('checked', true).trigger('change');
        }

        updateNotificationPreview();
        notifyModal.modal('show');
    }

    openNotifyModalBtn.click(function () {
        openSendNotificationModal(null);
    });

    notifyForm.submit(function (e) {
        e.preventDefault();

        var msg = (notifyMessageText.val() || '').trim();
        if (!msg) {
            alert('אנא הזינו תוכן להודעה.');
            notifyMessageText.focus();
            return;
        }
        if (msg.length > 500) {
            alert('תוכן ההודעה ארוך מדי (מקסימום 500 תווים).');
            notifyMessageText.focus();
            return;
        }

        var sender = (notifySenderName.val() || '').trim() || 'מערכת CheeseMate';
        var type = notifyTypeSelect.val() || 'system';
        var shouldSendPush = notifySendPush.is(':checked');
        var targetMode = $('input[name="notifyTargetMode"]:checked').val();

        var targetUids = [];
        if (targetMode === 'broadcast') {
            targetUids = allUsers.map(function (u) { return u.uid; });
        } else {
            notifyUsersChecklist.find('.notify-user-chk:checked').each(function () {
                targetUids.push($(this).val());
            });
        }

        if (targetUids.length === 0) {
            alert('יש לבחור לפחות נמען אחד להודעה.');
            return;
        }

        // UI state: sending
        notifySubmitBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm ml-1" role="status" aria-hidden="true"></span> שולח...');
        notifyCancelBtn.prop('disabled', true);
        notifyProgressBox.removeClass('d-none');
        notifyResultAlert.addClass('d-none');
        notifyProgressBar.css('width', '15%');
        notifyProgressPercent.text('15%');
        notifyProgressLabel.text('שומר התראות במסד הנתונים...');

        // 1. Commit notifications to Firestore in chunks of 400
        var now = Date.now();
        var chunks = [];
        for (var i = 0; i < targetUids.length; i += 400) {
            chunks.push(targetUids.slice(i, i + 400));
        }

        var firestorePromises = chunks.map(function (chunk) {
            var batch = db.batch();
            chunk.forEach(function (tUid) {
                var notifRef = db.collection('users').doc(tUid).collection('notifications').doc();
                batch.set(notifRef, {
                    type: type,
                    fromUid: currentUser ? currentUser.uid : 'admin',
                    fromUsername: sender,
                    message: msg,
                    timestamp: now,
                    read: false
                });
            });
            return batch.commit();
        });

        Promise.all(firestorePromises).then(function () {
            notifyProgressBar.css('width', shouldSendPush ? '50%' : '100%');
            notifyProgressPercent.text(shouldSendPush ? '50%' : '100%');

            if (!shouldSendPush) {
                return { pushSent: 0 };
            }

            notifyProgressLabel.text('שולח התראות Push למכשירים רשומים...');

            var pushWorkerUrl = (typeof NotificationsManager !== 'undefined' && NotificationsManager.WORKER_URL) ?
                NotificationsManager.WORKER_URL : 'https://cheesemate-push.yuvalkalan.workers.dev';

            var pushPromises = targetUids.map(function (tUid, idx) {
                return fetch(pushWorkerUrl + '/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        targetUid: tUid,
                        title: sender,
                        body: msg,
                        icon: '/icons/android-chrome-192x192.png',
                        badge: '/icons/favicon-32x32.png',
                        url: '/'
                    })
                }).then(function (res) {
                    return res.json();
                }).catch(function (err) {
                    console.warn('Push error for ' + tUid, err);
                    return null;
                }).finally(function () {
                    var completed = idx + 1;
                    var pct = 50 + Math.floor((completed / targetUids.length) * 50);
                    notifyProgressBar.css('width', pct + '%');
                    notifyProgressPercent.text(pct + '%');
                });
            });

            return Promise.all(pushPromises);
        }).then(function () {
            notifyProgressBar.css('width', '100%');
            notifyProgressPercent.text('100%');
            notifyProgressLabel.text('השליחה הושלמה בהצלחה!');

            var modeText = (targetMode === 'broadcast') ? 'בשידור לכל ' + targetUids.length + ' המשתמשים' : 'ל-' + targetUids.length + ' משתמשים נבחרים';
            notifyResultAlert.removeClass('d-none alert-danger')
                .addClass('alert-success')
                .html('<i class="fas fa-check-circle ml-1"></i> ההודעה נשלחה בהצלחה ' + modeText + '!');

            notifySubmitBtn.html('<i class="fas fa-check ml-1"></i> נשלח בהצלחה!');

            setTimeout(function () {
                notifyModal.modal('hide');
                notifySubmitBtn.prop('disabled', false).html('<i class="fas fa-paper-plane ml-1"></i> שלח הודעה');
                notifyCancelBtn.prop('disabled', false);
            }, 1800);
        }).catch(function (err) {
            console.error('Error sending system notifications:', err);
            notifyProgressLabel.text('אירעה שגיאה בשליחה');
            notifyResultAlert.removeClass('d-none alert-success')
                .addClass('alert-danger')
                .html('<i class="fas fa-exclamation-triangle ml-1"></i> שגיאה בשליחת ההודעות: ' + (err.message || err));
            notifySubmitBtn.prop('disabled', false).html('<i class="fas fa-paper-plane ml-1"></i> שלח שוב');
            notifyCancelBtn.prop('disabled', false);
        });
    });

})();
