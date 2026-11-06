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
    var currentUserData = null;
    var currentUserLevel = 0;
    var allUsers = [];
    var userToDelete = null;

    // Current user's capabilities
    var currentUserPermissions = {
        canAccessAdmin: false,
        canManageRoles: false,
        canModifyUserRoles: false,
        canSendNotifications: false,
        canDeleteUsers: false
    };

    // Mapping of permission levels: numeric level -> role object
    // Only מנהל מערכת (1) and User (0) are defined directly within the system.
    var permissionLevelsMap = {
        0: {
            level: 0,
            name: 'User',
            color: '',
            isStandard: true,
            isSystemGod: false,
            inheritsFrom: [],
            permissions: []
        },
        1: {
            level: 1,
            name: 'מנהל מערכת',
            color: 'linear-gradient(135deg, #d4af37 0%, #f6d365 25%, #fda085 60%, #cf8b17 100%)',
            isStandard: false,
            isSystemGod: true,
            inheritsFrom: [],
            permissions: ['access_admin', 'send_system_messages', 'modify_user_roles', 'manage_roles', 'delete_users']
        }
    };

    // Role modal editing state
    var editingRoleLevel = null;
    var editingRoleDirectPerms = [];
    var roleToDelete = null;

    // DOM Elements - General & Views
    var loadingState = $('#admin-loading-state');
    var loginState = $('#admin-login-state');
    var deniedState = $('#admin-denied-state');
    var dashboardState = $('#admin-dashboard-state');
    var userProfileHeader = $('#admin-user-profile');
    var userNameHeader = $('#admin-user-name');
    var adminUserRoleBadge = $('#admin-user-role-badge');
    var deniedUserEmail = $('#denied-user-email');

    // Stats Overview
    var statTotalUsers = $('#stat-total-users');
    var statAdminUsers = $('#stat-admin-users');
    var statRegularUsers = $('#stat-regular-users');
    var statTotalRoles = $('#stat-total-roles');

    // Users Tab Elements
    var searchInput = $('#admin-search-input');
    var roleFilter = $('#admin-role-filter');
    var usersTableBody = $('#admin-users-tbody');
    var noUsersPlaceholder = $('#admin-no-users');
    var refreshUsersBtn = $('#admin-refresh-users-btn');

    // User Delete Modal Elements
    var deleteModal = $('#deleteUserModal');
    var deleteModalUsername = $('#delete-modal-username');
    var deleteModalEmail = $('#delete-modal-email');
    var deleteModalUid = $('#delete-modal-uid');
    var confirmDeleteBtn = $('#confirm-delete-user-btn');

    // Roles Tab Elements
    var rolesTableBody = $('#admin-roles-tbody');
    var addRoleBtn = $('#admin-add-role-btn');
    var refreshRolesBtn = $('#admin-refresh-roles-btn');

    // Role Add/Edit Modal Elements
    var editRoleModal = $('#editRoleModal');
    var editRoleModalTitleText = $('#editRoleModalTitleText');
    var roleForm = $('#admin-role-form');
    var roleInputId = $('#role-input-id');
    var roleInputName = $('#role-input-name');
    var roleColorPicker = $('#role-color-picker');
    var roleInputColor = $('#role-input-color');
    var roleLivePreviewUser = $('#role-live-preview-user');
    var roleInheritsContainer = $('#role-inherits-container');
    var rolePermissionsChecklist = $('#role-permissions-checklist');
    var saveRoleBtn = $('#save-role-btn');

    // Role Delete Modal Elements
    var deleteRoleModal = $('#deleteRoleModal');
    var deleteRoleModalId = $('#delete-role-modal-id');
    var deleteRoleModalName = $('#delete-role-modal-name');
    var deleteRoleModalCount = $('#delete-role-modal-count');
    var confirmDeleteRoleBtn = $('#confirm-delete-role-btn');

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

    /**
     * Updates and enforces current user's capabilities across the admin dashboard.
     */
    function updateCurrentUserCapabilities(user, data) {
        currentUserData = data || {};
        currentUserLevel = (typeof currentUserData.level === 'number') ? currentUserData.level : (parseInt(currentUserData.level, 10) || 0);
        var isGod = (currentUserLevel === 1) || (typeof RoleManager !== 'undefined' && RoleManager.isSystemGod(currentUserLevel));

        currentUserPermissions.canAccessAdmin = isGod || (typeof RoleManager !== 'undefined' && RoleManager.canAccessAdmin(currentUserLevel));
        currentUserPermissions.canManageRoles = isGod || (typeof RoleManager !== 'undefined' && RoleManager.canManageRoles(currentUserLevel));
        currentUserPermissions.canModifyUserRoles = isGod || (typeof RoleManager !== 'undefined' && RoleManager.canModifyUserRoles(currentUserLevel));
        currentUserPermissions.canSendNotifications = isGod || (typeof RoleManager !== 'undefined' && RoleManager.canSendSystemMessages(currentUserLevel));
        currentUserPermissions.canDeleteUsers = isGod || (typeof RoleManager !== 'undefined' && RoleManager.canDeleteUsers(currentUserLevel));

        // Enforce permissions on top-level buttons
        if (!currentUserPermissions.canSendNotifications) {
            openNotifyModalBtn.prop('disabled', true).attr('title', 'אין לך הרשאה לשליחת הודעות מערכת');
        } else {
            openNotifyModalBtn.prop('disabled', false).attr('title', 'שליחת הודעת מערכת למשתמשים');
        }

        if (!currentUserPermissions.canManageRoles) {
            addRoleBtn.prop('disabled', true).attr('title', 'רק מנהל מערכת או מורשים יכולים להוסיף רמות הרשאה');
        } else {
            addRoleBtn.prop('disabled', false).attr('title', 'הוסף רמת הרשאה חדשה');
        }

        var roleName = (typeof RoleManager !== 'undefined' ? (RoleManager.getRoleName ? RoleManager.getRoleName(currentUserLevel) : RoleManager.getRoleSystemName(currentUserLevel)) : '') || (isGod ? 'מנהל מערכת' : 'Administrator');
        adminUserRoleBadge.text(roleName);
        if (isGod) {
            adminUserRoleBadge.attr('class', 'badge mr-2 badge-role-system-god');
        } else {
            adminUserRoleBadge.attr('class', 'badge mr-2 badge-role-custom');
        }
    }

    function isAdministrator(user, data) {
        if (!user || !data) return false;
        var lvl = (typeof data.level === 'number') ? data.level : (parseInt(data.level, 10) || 0);
        if (lvl === 1) return true;
        if (typeof RoleManager !== 'undefined') {
            return RoleManager.canAccessAdmin(lvl);
        }
        return false;
    }

    /**
     * Loads permission levels from Firestore 'permissionLevels' collection.
     * Seeds "מנהל מערכת" (1) and "User" (0) directly within Firestore if missing.
     * Updates RoleManager and renders the roles table and filter dropdown.
     */
    function loadPermissionLevels() {
        var canWrite = (currentUserLevel === 1) || (currentUserPermissions && currentUserPermissions.canManageRoles);
        return db.collection('permissionLevels').get()
            .then(function (snapshot) {
                var foundGod = false;
                var foundUser = false;
                var batch = db.batch();
                var needsCommit = false;

                if (!snapshot.empty) {
                    var existingLevels = { 0: true, 1: true };
                    snapshot.forEach(function (doc) {
                        var d = doc.data() || {};
                        var l = typeof d.level === 'number' ? d.level : parseInt(doc.id, 10);
                        if (!isNaN(l)) existingLevels[l] = true;
                    });

                    snapshot.forEach(function (doc) {
                        var data = doc.data() || {};
                        var lvl = typeof data.level === 'number' ? data.level : parseInt(doc.id, 10);

                        // Clean up deprecated "systemName" and "description" fields from Firestore
                        var updates = {};
                        if (data.systemName !== undefined) {
                            updates.systemName = firebase.firestore.FieldValue.delete();
                        }
                        if (data.description !== undefined) {
                            updates.description = firebase.firestore.FieldValue.delete();
                        }

                        // Remove deleted levels or invalid references from inheritsFrom
                        if (Array.isArray(data.inheritsFrom)) {
                            var validInherits = data.inheritsFrom.filter(function (pid) {
                                var pNum = parseInt(pid, 10);
                                return !isNaN(pNum) && existingLevels[pNum] && pNum !== 1 && pNum !== lvl;
                            });
                            if (validInherits.length !== data.inheritsFrom.length) {
                                updates.inheritsFrom = validInherits;
                            }
                        }

                        if (canWrite && Object.keys(updates).length > 0) {
                            batch.update(doc.ref, updates);
                            needsCommit = true;
                        }

                        if (lvl === 1) {
                            foundGod = true;
                            // Migrate legacy names "admin" or "System God" to "מנהל מערכת"
                            if (canWrite && (!data.name || data.name === 'admin' || data.name === 'System God')) {
                                batch.set(doc.ref, {
                                    level: 1,
                                    name: 'מנהל מערכת',
                                    color: data.color || 'linear-gradient(135deg, #d4af37 0%, #f6d365 25%, #fda085 60%, #cf8b17 100%)',
                                    inheritsFrom: [],
                                    permissions: ['access_admin', 'send_system_messages', 'modify_user_roles', 'manage_roles', 'delete_users'],
                                    isStandard: false,
                                    isSystemGod: true,
                                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                }, { merge: true });
                                needsCommit = true;
                            }
                        }
                        if (lvl === 0) {
                            foundUser = true;
                        }
                    });
                }

                if (canWrite && !foundGod) {
                    batch.set(db.collection('permissionLevels').doc('1'), {
                        level: 1,
                        name: 'מנהל מערכת',
                        color: 'linear-gradient(135deg, #d4af37 0%, #f6d365 25%, #fda085 60%, #cf8b17 100%)',
                        inheritsFrom: [],
                        permissions: ['access_admin', 'send_system_messages', 'modify_user_roles', 'manage_roles', 'delete_users'],
                        isStandard: false,
                        isSystemGod: true,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    needsCommit = true;
                }

                if (canWrite && !foundUser) {
                    batch.set(db.collection('permissionLevels').doc('0'), {
                        level: 0,
                        name: 'User',
                        color: '',
                        inheritsFrom: [],
                        permissions: [],
                        isStandard: true,
                        isSystemGod: false,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    needsCommit = true;
                }

                var commitPromise = needsCommit ? batch.commit().catch(function (e) {
                    console.warn('Batch commit seed note:', e.message);
                }) : Promise.resolve();

                return commitPromise.then(function () {
                    if (typeof RoleManager !== 'undefined') {
                        return RoleManager.loadFromFirestore(db);
                    }
                    return permissionLevelsMap;
                });
            })
            .then(function () {
                if (typeof RoleManager !== 'undefined') {
                    permissionLevelsMap = RoleManager.getAllRoles();
                }
                updateRoleFilterOptions();
                renderRolesTable();
            })
            .catch(function (err) {
                console.warn('Error fetching permissionLevels, using local registry:', err);
                if (typeof RoleManager !== 'undefined') {
                    permissionLevelsMap = RoleManager.getAllRoles();
                }
                updateRoleFilterOptions();
                renderRolesTable();
            });
    }

    /**
     * Updates the role filter select dropdown in the Users tab.
     */
    function updateRoleFilterOptions() {
        var currentSelected = roleFilter.val() || 'all';
        roleFilter.empty();
        roleFilter.append($('<option value="all">כל רמות ההרשאה</option>'));

        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;
        var sortedLevels = Object.keys(allRoles).map(Number).sort(function (a, b) {
            if (a === 1) return -1;
            if (b === 1) return 1;
            if (a === 0) return -1;
            if (b === 0) return 1;
            return a - b;
        });

        sortedLevels.forEach(function (lvl) {
            var role = allRoles[lvl] || {};
            var label = lvl + ' - ' + (role.name || ('דרגה ' + lvl));
            if (lvl === 1) label += ' (מנהל מערכת)';
            else if (lvl === 0) label += ' (User)';
            roleFilter.append($('<option></option>').val(lvl).text(label));
        });

        roleFilter.val(currentSelected);
    }

    // Auth State Observer
    auth.onAuthStateChanged(function (user) {
        currentUser = user;
        if (!user) {
            switchView('login');
            return;
        }

        switchView('loading');

        Promise.all([
            db.collection('users').doc(user.uid).get(),
            loadPermissionLevels()
        ])
            .then(function (results) {
                var doc = results[0];
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

                    updateCurrentUserCapabilities(user, data);

                    if (typeof RoleManager !== 'undefined') {
                        RoleManager.applyRoleHover(userNameHeader, data);
                    } else {
                        userNameHeader.addClass('admin-golden-gradient');
                    }

                    switchView('dashboard');
                    loadAllUsers();
                } else {
                    deniedUserEmail.text(user.email || user.uid);
                    switchView('denied');
                }
            })
            .catch(function (err) {
                console.error('Error fetching user document or permission levels:', err);
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
        refreshUsersBtn.prop('disabled', true).find('i').addClass('fa-spin');

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
            renderRolesTable();
            refreshUsersBtn.prop('disabled', false).find('i').removeClass('fa-spin');
        }).catch(function (err) {
            refreshUsersBtn.prop('disabled', false).find('i').removeClass('fa-spin');
            alert('שגיאה בטעינת המשתמשים: ' + err.message);
        });
    }

    refreshUsersBtn.click(loadAllUsers);

    function updateStats() {
        var total = allUsers.length;
        var admins = 0;
        var regulars = 0;

        allUsers.forEach(function (u) {
            if (u.level === 1) {
                admins++;
            } else if (u.level === 0) {
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
            var d = new Date(val);
            return isNaN(d.getTime()) ? null : d;
        }
        if (typeof val === 'string') {
            var parsed = new Date(val);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    }

    function extractUserLastSeen(d) {
        if (!d) return null;
        if (d.lastSeen) {
            var d1 = parseDate(d.lastSeen);
            if (d1) return d1;
        }
        if (d.updatedAt) {
            var d2 = parseDate(d.updatedAt);
            if (d2) return d2;
        }
        if (d.createdAt) {
            var d3 = parseDate(d.createdAt);
            if (d3) return d3;
        }
        return null;
    }

    function formatLastSeen(dateObj) {
        if (!dateObj) {
            return {
                html: '<span class="text-muted small">לא ידוע</span>',
                title: 'לא נרשמה פעילות'
            };
        }

        var day = padZero(dateObj.getDate());
        var month = padZero(dateObj.getMonth() + 1);
        var year = dateObj.getFullYear();
        var hours = padZero(dateObj.getHours());
        var mins = padZero(dateObj.getMinutes());

        var fullDateStr = day + '/' + month + '/' + year;
        var timeStr = hours + ':' + mins;
        var fullFormatted = fullDateStr + ' ' + timeStr;

        var now = new Date();
        var diffMs = now.getTime() - dateObj.getTime();
        if (diffMs < 0) diffMs = 0;

        if (diffMs < 2 * 60 * 1000) {
            return {
                html: '<span class="badge badge-success pulse-badge ml-1"><i class="fas fa-circle mr-1" style="font-size: 8px;"></i> פעיל כעת</span>',
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
            if (selectedRole !== 'all') {
                matchesRole = (u.level === parseInt(selectedRole, 10));
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

        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;
        var sortedLevels = Object.keys(allRoles).map(Number).sort(function (a, b) {
            if (a === 1) return -1;
            if (b === 1) return 1;
            if (a === 0) return -1;
            if (b === 0) return 1;
            return a - b;
        });

        filtered.forEach(function (u) {
            var isCurrent = currentUser && currentUser.uid === u.uid;
            var roleInfo = allRoles[u.level] || (typeof RoleManager !== 'undefined' ? RoleManager.getRole(u.level) : { level: u.level, name: 'דרגה ' + u.level });

            var avatarChar = u.username ? u.username.charAt(0).toUpperCase() : '?';
            var avatarBg = (u.level === 1) ? '#d97706' : ((u.level === 0) ? '#4e73df' : '#4f46e5');

            var tr = $('<tr></tr>');

            // 1. User column
            var userTd = $('<td></td>');
            var userFlex = $('<div class="d-flex align-items-center"></div>');
            var avatar = $('<div class="user-avatar ml-2" style="background-color: ' + avatarBg + '"></div>').text(avatarChar);
            var userMeta = $('<div></div>');
            var nameSpan = $('<span></span>').text(u.username);

            if (typeof RoleManager !== 'undefined') {
                RoleManager.applyRoleHover(nameSpan, u);
            } else if (u.level === 1) {
                nameSpan.addClass('admin-golden-gradient');
            } else {
                nameSpan.addClass('user-name-standard');
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

            sortedLevels.forEach(function (lvlNum) {
                var pInfo = allRoles[lvlNum] || { name: 'רמה ' + lvlNum };
                var isSelected = (u.level === lvlNum);
                var label = lvlNum + ' - ' + (pInfo.name || ('רמה ' + lvlNum));
                roleSelect.append($('<option></option>').val(lvlNum).text(label).prop('selected', isSelected));
            });

            if (isCurrent) {
                roleSelect.prop('disabled', true).attr('title', 'לא ניתן לשנות את הרשאת החשבון המחובר');
            } else if (!currentUserPermissions.canModifyUserRoles) {
                roleSelect.prop('disabled', true).attr('title', 'אין לך הרשאה לשנות דרגות של משתמשים');
            } else {
                roleSelect.change(function () {
                    var newLevel = parseInt($(this).val(), 10);
                    changeUserLevel(u.uid, newLevel, roleSelect);
                });
            }

            var badgeClass = 'badge-role-user';
            if (u.level === 1) {
                badgeClass = 'badge-role-system-god';
            } else if (u.level === 2) {
                badgeClass = 'badge-role-atmosphere';
            } else if (typeof RoleManager !== 'undefined') {
                badgeClass = RoleManager.getRole(u).badgeClass || 'badge-role-custom';
            }

            var roleBadgeText = (roleInfo.name || 'דרגה ' + u.level) + ' (' + u.level + ')';
            var roleBadge = $('<span class="badge mr-2 ' + badgeClass + '"></span>').text(roleBadgeText);

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

            if (!currentUserPermissions.canSendNotifications) {
                sendNotifyBtn.prop('disabled', true).attr('title', 'אין לך הרשאה לשליחת הודעות מערכת');
            }

            var deleteBtn = $('<button class="btn btn-outline-danger btn-sm" title="מחק משתמש לצמיתות"></button>')
                .html('<i class="fas fa-trash-alt ml-1"></i> מחק');

            if (isCurrent) {
                deleteBtn.prop('disabled', true).attr('title', 'לא ניתן למחוק את החשבון המחובר מלוח הניהול');
            } else if (!currentUserPermissions.canDeleteUsers) {
                deleteBtn.prop('disabled', true).attr('title', 'אין לך הרשאה למחיקת משתמשים');
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
        if (!currentUserPermissions.canModifyUserRoles) {
            alert('אין לך הרשאה לשנות רמת הרשאה של משתמשים.');
            renderUsersTable();
            return;
        }

        selectEl.prop('disabled', true);
        var numLevel = parseInt(newLevel, 10);

        db.collection('users').doc(targetUid).update({
            level: numLevel
        }).then(function () {
            selectEl.prop('disabled', false);
            var userObj = allUsers.find(function (u) { return u.uid === targetUid; });
            if (userObj) {
                userObj.level = numLevel;
            }
            updateStats();
            renderUsersTable();
            renderRolesTable();
        }).catch(function (err) {
            selectEl.prop('disabled', false);
            alert('שגיאה בעדכון הרשאת המשתמש: ' + err.message);
            renderUsersTable();
        });
    }

    // Open User Delete Modal
    function openDeleteModal(u) {
        userToDelete = u;
        deleteModalUsername.text(u.username);
        if (typeof RoleManager !== 'undefined') {
            RoleManager.applyRoleHover(deleteModalUsername, u);
        } else if (u.level === 1) {
            deleteModalUsername.addClass('admin-golden-gradient');
        } else {
            deleteModalUsername.removeClass('admin-golden-gradient role-atmosphere-gradient');
        }
        deleteModalEmail.text(u.email || 'לא צוין');
        deleteModalUid.text(u.uid);
        confirmDeleteBtn.prop('disabled', false).html('<i class="fas fa-trash-alt ml-1"></i> מחק משתמש');
        deleteModal.modal('show');
    }

    // Confirm Delete User
    confirmDeleteBtn.click(function () {
        if (!userToDelete) return;
        if (!currentUserPermissions.canDeleteUsers) {
            alert('אין לך הרשאה למחיקת משתמשים.');
            return;
        }

        var targetUid = userToDelete.uid;
        confirmDeleteBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm ml-1" role="status" aria-hidden="true"></span> מוחק נתונים...');

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

        var semestersPromise = db.collection('users').doc(targetUid).collection('semesters').get()
            .then(function (semSnap) {
                semSnap.forEach(function (sDoc) {
                    batch.delete(sDoc.ref);
                });
            }).catch(function (e) {
                console.warn('Could not list semesters:', e);
            });

        var notifsPromise = db.collection('users').doc(targetUid).collection('notifications').get()
            .then(function (notifSnap) {
                notifSnap.forEach(function (nDoc) {
                    batch.delete(nDoc.ref);
                });
            }).catch(function (e) {
                console.warn('Could not list notifications:', e);
            });

        Promise.all([semestersPromise, notifsPromise]).then(function () {
            batch.delete(db.collection('users').doc(targetUid));
            return batch.commit();
        }).then(function () {
            deleteModal.modal('hide');
            allUsers = allUsers.filter(function (u) { return u.uid !== targetUid; });
            updateStats();
            renderUsersTable();
            renderRolesTable();
            alert('המשתמש ' + userToDelete.username + ' נמחק בהצלחה לצמיתות.');
            userToDelete = null;
        }).catch(function (err) {
            confirmDeleteBtn.prop('disabled', false).html('<i class="fas fa-trash-alt ml-1"></i> מחק משתמש');
            alert('שגיאה במחיקת המשתמש: ' + err.message);
        });
    });

    // ==========================================
    // Permission Levels (Roles) Management Logic
    // ==========================================

    function renderRolesTable() {
        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;
        var roleKeys = Object.keys(allRoles).map(Number).sort(function (a, b) {
            if (a === 1) return -1;
            if (b === 1) return 1;
            if (a === 0) return -1;
            if (b === 0) return 1;
            return a - b;
        });

        rolesTableBody.empty();
        statTotalRoles.text(roleKeys.length);

        roleKeys.forEach(function (lvl) {
            var role = allRoles[lvl] || {};
            var isGod = (lvl === 1);
            var isStd = (lvl === 0);
            var assignedCount = allUsers.filter(function (u) { return u.level === lvl; }).length;

            var tr = $('<tr></tr>');

            // 1. Serial ID column
            var idTd = $('<td></td>');
            var idBadgeClass = isGod ? 'badge-warning text-dark' : (isStd ? 'badge-secondary' : 'badge-primary');
            idTd.html('<span class="badge ' + idBadgeClass + ' font-weight-bold" style="font-size: 0.95rem;">' + lvl + '</span>');

            // 2. Name column with hover preview
            var nameTd = $('<td></td>');
            var nameSpan = $('<span class="font-weight-bold ml-2"></span>').text(role.name || ('דרגה ' + lvl));
            if (typeof RoleManager !== 'undefined') {
                RoleManager.applyRoleHover(nameSpan, lvl);
            }
            nameTd.append(nameSpan);

            // 3. Identification Color Expression column
            var colorTd = $('<td></td>');
            var colorExpr = (role.color || '').trim();
            if (colorExpr) {
                var isGrad = colorExpr.indexOf('gradient') !== -1;
                var swatch = $('<span class="color-swatch-circle ml-2"></span>');
                if (isGrad) {
                    swatch.css('background', colorExpr);
                } else {
                    swatch.css('background-color', colorExpr);
                }
                var colorCode = $('<code class="small text-muted font-monospace" style="max-width: 140px; display: inline-block; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;"></code>')
                    .text(colorExpr)
                    .attr('title', colorExpr);
                colorTd.append(swatch, colorCode);
            } else {
                colorTd.html('<span class="text-muted small">ברירת מחדל (ללא צבע)</span>');
            }

            // 4. Inherited From column
            var inheritTd = $('<td></td>');
            if (Array.isArray(role.inheritsFrom) && role.inheritsFrom.length > 0) {
                role.inheritsFrom.forEach(function (parentId) {
                    var pRole = allRoles[parentId] || { name: 'רמה ' + parentId };
                    inheritTd.append($('<span class="inherited-role-badge"></span>').html('<i class="fas fa-level-up-alt ml-1 text-primary"></i>' + escapeHtml(pRole.name || ('רמה ' + parentId)) + ' (' + parentId + ')'));
                });
            } else {
                inheritTd.html('<span class="text-muted small">ללא הורשה</span>');
            }

            // 5. Specific Action Permissions column
            var permsTd = $('<td></td>');
            var effective = (typeof RoleManager !== 'undefined') ? RoleManager.getEffectivePermissions(lvl) : (role.permissions || []);
            if (isGod) {
                permsTd.html('<span class="badge badge-warning text-dark font-weight-bold"><i class="fas fa-infinity ml-1"></i> כל הסמכויות (שליטה מלאה)</span>');
            } else if (effective.length === 0) {
                permsTd.html('<span class="text-muted small">ללא סמכויות מיוחדות</span>');
            } else {
                effective.forEach(function (permKey) {
                    var permObj = (typeof RoleManager !== 'undefined') ? RoleManager.getAvailablePermissions().find(function (p) { return p.id === permKey; }) : null;
                    var pLabel = permObj ? (permObj.label ? permObj.label.split(' (')[0] : permObj.id) : permKey;
                    var isDirect = Array.isArray(role.permissions) && role.permissions.indexOf(permKey) !== -1;
                    var pill = $('<span class="permission-pill"></span>').text(pLabel);
                    if (!isDirect) {
                        pill.addClass('border-info text-info').attr('title', 'מורש מדרגת אב');
                    }
                    permsTd.append(pill);
                });
            }

            // 6. Assigned users count
            var usersTd = $('<td></td>');
            usersTd.html('<span class="badge badge-light border"><i class="fas fa-users ml-1 text-secondary"></i> ' + assignedCount + '</span>');

            // 7. Status / Type column
            var statusTd = $('<td></td>');
            if (isGod) {
                statusTd.html('<span class="badge badge-dark">מובנה (מנהל מערכת)</span>');
            } else if (isStd) {
                statusTd.html('<span class="badge badge-secondary">מובנה (User)</span>');
            } else {
                statusTd.html('<span class="badge badge-info">מותאם אישית</span>');
            }

            // 8. Actions column
            var actionsTd = $('<td class="text-center"></td>');
            var editBtn = $('<button class="btn btn-outline-primary btn-sm ml-1" title="ערוך רמת הרשאה"></button>')
                .html('<i class="fas fa-edit ml-1"></i> ערוך')
                .click(function () {
                    openEditRoleModal(role);
                });

            var delBtn = $('<button class="btn btn-outline-danger btn-sm" title="מחק רמת הרשאה"></button>')
                .html('<i class="fas fa-trash-alt ml-1"></i> מחק');

            if (!currentUserPermissions.canManageRoles) {
                editBtn.prop('disabled', true).attr('title', 'אין לך הרשאה לערוך רמות הרשאה');
                delBtn.prop('disabled', true).attr('title', 'אין לך הרשאה למחוק רמות הרשאה');
            } else if (isGod || isStd) {
                delBtn.prop('disabled', true).attr('title', 'לא ניתן למחוק דרגת מערכת מובנית');
            } else {
                delBtn.click(function () {
                    openDeleteRoleModal(role, assignedCount);
                });
            }

            actionsTd.append(editBtn, delBtn);
            tr.append(idTd, nameTd, colorTd, inheritTd, permsTd, usersTd, statusTd, actionsTd);
            rolesTableBody.append(tr);
        });
    }

    refreshRolesBtn.click(function () {
        refreshRolesBtn.prop('disabled', true).find('i').addClass('fa-spin');
        loadPermissionLevels().finally(function () {
            refreshRolesBtn.prop('disabled', false).find('i').removeClass('fa-spin');
        });
    });

    addRoleBtn.click(function () {
        openEditRoleModal(null);
    });

    /**
     * Updates the live preview box in the Edit/Add Role modal.
     */
    function updateRoleLivePreview() {
        var sName = (roleInputName.val() || '').trim() || 'שם משתמש';
        var color = (roleInputColor.val() || '').trim();

        roleLivePreviewUser.text(sName);
        roleLivePreviewUser.css({
            'color': '',
            'background': '',
            '-webkit-background-clip': '',
            '-webkit-text-fill-color': '',
            'background-clip': '',
            'display': '',
            'font-weight': ''
        });

        if (color) {
            if (color.indexOf('gradient') !== -1) {
                roleLivePreviewUser.css({
                    'background': color,
                    '-webkit-background-clip': 'text',
                    '-webkit-text-fill-color': 'transparent',
                    'background-clip': 'text',
                    'color': 'transparent',
                    'display': 'inline-block',
                    'font-weight': '700'
                });
            } else {
                roleLivePreviewUser.css({
                    'color': color,
                    '-webkit-text-fill-color': color,
                    'font-weight': '600'
                });
            }
        } else {
            roleLivePreviewUser.css({
                'color': '',
                '-webkit-text-fill-color': ''
            });
        }

        roleLivePreviewUser.attr('title', sName);
        if (typeof roleLivePreviewUser.tooltip === 'function') {
            try { roleLivePreviewUser.tooltip('dispose'); } catch (e) {}
            try {
                roleLivePreviewUser.tooltip({
                    placement: 'top',
                    trigger: 'hover',
                    boundary: 'window'
                });
            } catch (e) {}
        }
    }

    // Input handlers for live preview
    roleInputName.on('input', updateRoleLivePreview);
    roleInputColor.on('input', function () {
        var val = $(this).val().trim();
        if (val.startsWith('#') && (val.length === 7 || val.length === 4)) {
            roleColorPicker.val(val);
        }
        updateRoleLivePreview();
    });
    roleColorPicker.on('input change', function () {
        roleInputColor.val($(this).val());
        updateRoleLivePreview();
    });
    $(document).on('click', '.color-preset-pill', function () {
        var preset = $(this).data('preset') || '';
        roleInputColor.val(preset);
        if (preset.startsWith('#')) {
            roleColorPicker.val(preset);
        }
        updateRoleLivePreview();
    });

    /**
     * Opens the modal to add a new role or edit an existing one.
     */
    function openEditRoleModal(role) {
        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;
        var availablePerms = (typeof RoleManager !== 'undefined') ? RoleManager.getAvailablePermissions() : [];

        if (role) {
            // Editing existing role
            editingRoleLevel = role.level;
            editingRoleDirectPerms = Array.isArray(role.permissions)
                ? role.permissions.filter(function (p) { return p && p !== 'undefined'; }).slice()
                : [];
            editRoleModalTitleText.text('עריכת רמת הרשאה: ' + (role.name || ''));
            roleInputId.val(role.level);
            roleInputName.val(role.name || '');
            roleInputColor.val(role.color || '');
            if (role.color && role.color.startsWith('#')) {
                roleColorPicker.val(role.color);
            } else {
                roleColorPicker.val('#4e73df');
            }
        } else {
            // Adding new role - automatically calculate next unique serial ID
            var nextId = (typeof RoleManager !== 'undefined') ? RoleManager.getNextSerialId() : 2;
            editingRoleLevel = null;
            editingRoleDirectPerms = [];
            editRoleModalTitleText.text('הוספת רמת הרשאה חדשה');
            roleInputId.val(nextId);
            roleInputName.val('');
            roleInputColor.val('');
            roleColorPicker.val('#4e73df');
        }

        var isGod = (editingRoleLevel === 1);
        var isStd = (editingRoleLevel === 0);

        // Populate inheritance checklist
        roleInheritsContainer.empty();
        var inheritList = (role && Array.isArray(role.inheritsFrom)) ? role.inheritsFrom : [];
        var targetLvl = editingRoleLevel !== null ? editingRoleLevel : parseInt(roleInputId.val(), 10);

        // Cannot inherit from System Administrator (Level 1) or from the role itself
        var otherRoles = Object.keys(allRoles).map(Number).filter(function (l) { return l !== targetLvl && l !== 1; });
        if (otherRoles.length === 0) {
            roleInheritsContainer.html('<small class="text-muted">אין רמות הרשאה אחרות להורשה</small>');
        } else {
            otherRoles.sort(function (a, b) { return a - b; }).forEach(function (otherLvl) {
                var oRole = allRoles[otherLvl];
                var isChecked = inheritList.indexOf(otherLvl) !== -1;
                var row = $('<div class="custom-control custom-checkbox custom-control-inline mb-1 align-items-center"></div>');
                var chkId = 'chk-inherit-' + otherLvl;
                var chk = $('<input type="checkbox" class="custom-control-input role-inherit-chk">')
                    .attr('id', chkId)
                    .val(otherLvl)
                    .prop('checked', isChecked);

                // Circular inheritance protection: if otherLvl already inherits from targetLvl, selecting it would cause a cycle
                var isCycle = false;
                if (typeof RoleManager !== 'undefined' && targetLvl !== null && !isNaN(targetLvl)) {
                    isCycle = RoleManager.wouldCreateCycle(targetLvl, otherLvl, allRoles);
                }

                if (isGod || isCycle) {
                    chk.prop('disabled', true);
                    if (isCycle) {
                        chk.prop('checked', false);
                    }
                }

                var label = $('<label class="custom-control-label small"></label>')
                    .attr('for', chkId)
                    .text((oRole.name || ('רמה ' + otherLvl)) + ' (' + otherLvl + ')');

                if (isCycle) {
                    label.addClass('text-muted');
                    label.append(' <span class="badge badge-warning text-dark ml-1" title="רמה זו כבר מורישה מהרמה הנוכחית - בחירה בה תיצור מעגל הורשה"><i class="fas fa-ban ml-1"></i>יוצר מעגל</span>');
                }

                row.append(chk, label);
                roleInheritsContainer.append(row);
            });
        }

        // Listen for direct permission checkbox changes
        rolePermissionsChecklist.off('change').on('change', '.role-perm-chk:not(:disabled)', function () {
            var pVal = $(this).val();
            var isChk = $(this).is(':checked');
            if (isChk) {
                if (editingRoleDirectPerms.indexOf(pVal) === -1) {
                    editingRoleDirectPerms.push(pVal);
                }
            } else {
                editingRoleDirectPerms = editingRoleDirectPerms.filter(function (p) { return p !== pVal; });
            }
        });

        // Populate permissions checklist
        function refreshPermissionsChecklist() {
            rolePermissionsChecklist.empty();

            // Calculate which permissions are inherited from selected inheritance checkboxes
            var selectedInherits = [];
            roleInheritsContainer.find('.role-inherit-chk:checked').each(function () {
                selectedInherits.push(parseInt($(this).val(), 10));
            });

            var inheritedPerms = {};
            selectedInherits.forEach(function (pId) {
                var pPerms = (typeof RoleManager !== 'undefined') ? RoleManager.getEffectivePermissions(pId) : [];
                pPerms.forEach(function (k) {
                    if (k && k !== 'undefined') {
                        inheritedPerms[k] = true;
                    }
                });
            });

            availablePerms.forEach(function (perm) {
                var isDirect = editingRoleDirectPerms.indexOf(perm.id) !== -1;
                var isInherited = Boolean(inheritedPerms[perm.id]);
                var isChecked = isGod || isDirect || isInherited;

                var itemDiv = $('<div class="perm-checkbox-item custom-control custom-checkbox d-flex align-items-center justify-content-between"></div>');
                if (isInherited) {
                    itemDiv.addClass('is-inherited');
                }

                var leftDiv = $('<div></div>');
                var chkId = 'chk-perm-' + perm.id;
                var chk = $('<input type="checkbox" class="custom-control-input role-perm-chk">')
                    .attr('id', chkId)
                    .val(perm.id)
                    .prop('checked', isChecked);

                if (isGod || isInherited) {
                    chk.prop('disabled', true);
                }

                var label = $('<label class="custom-control-label font-weight-bold small"></label>')
                    .attr('for', chkId)
                    .text(perm.label);

                leftDiv.append(chk, label);
                if (perm.description) {
                    leftDiv.append($('<small class="text-muted d-block mr-4"></small>').text(perm.description));
                }

                var badgeDiv = $('<div></div>');
                if (isGod) {
                    badgeDiv.html('<span class="badge badge-warning text-dark">שליטה מלאה</span>');
                } else if (isInherited) {
                    badgeDiv.html('<span class="badge badge-info"><i class="fas fa-level-up-alt ml-1"></i> מורש</span>');
                }

                itemDiv.append(leftDiv, badgeDiv);
                rolePermissionsChecklist.append(itemDiv);
            });
        }

        refreshPermissionsChecklist();
        roleInheritsContainer.off('change').on('change', '.role-inherit-chk', refreshPermissionsChecklist);

        updateRoleLivePreview();
        editRoleModal.modal('show');
    }

    // Role Form Submit (Save / Edit)
    roleForm.submit(function (e) {
        e.preventDefault();
        if (!currentUserPermissions.canManageRoles) {
            alert('אין לך הרשאה לנהל רמות הרשאה.');
            return;
        }

        var level = parseInt(roleInputId.val(), 10);
        var name = (roleInputName.val() || '').trim();
        var color = (roleInputColor.val() || '').trim();

        if (!name) {
            alert('יש להזין שם לרמת ההרשאה.');
            return;
        }

        var isGod = (level === 1);
        var isStd = (level === 0);

        var selectedInherits = [];
        var cycleErrors = [];
        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;

        roleInheritsContainer.find('.role-inherit-chk:checked').each(function () {
            var val = parseInt($(this).val(), 10);
            if (!isNaN(val) && val !== level && val !== 1) {
                if (typeof RoleManager !== 'undefined' && RoleManager.wouldCreateCycle(level, val, allRoles)) {
                    var pRole = allRoles[val] || {};
                    cycleErrors.push(pRole.name || ('רמה ' + val));
                } else {
                    selectedInherits.push(val);
                }
            }
        });

        if (cycleErrors.length > 0) {
            alert('שגיאה: זוהתה הורשה מעגלית (Circular Inheritance) עם הרמות הבאות:\n' + cycleErrors.join(', ') + '\nרמות אלו כבר מורישות מרמה זו ישירות או בעקיפין. ההורשה בוטלה עבורן.');
            return;
        }

        var selectedPerms = [];
        var availablePerms = (typeof RoleManager !== 'undefined') ? RoleManager.getAvailablePermissions() : [];
        if (isGod) {
            selectedPerms = ['access_admin', 'send_system_messages', 'modify_user_roles', 'manage_roles', 'delete_users'];
        } else {
            // Only direct permissions are saved; inherited permissions are dynamically resolved
            selectedPerms = editingRoleDirectPerms.filter(function (p) {
                return p && p !== 'undefined' && (availablePerms.length === 0 || availablePerms.some(function (ap) { return ap.id === p; }));
            });
        }

        saveRoleBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm ml-1" role="status" aria-hidden="true"></span> שומר...');

        var docData = {
            level: level,
            name: name,
            color: color,
            inheritsFrom: selectedInherits,
            permissions: selectedPerms,
            isStandard: isStd,
            isSystemGod: isGod,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        db.collection('permissionLevels').doc(String(level)).set(docData, { merge: true })
            .then(function () {
                saveRoleBtn.prop('disabled', false).html('<i class="fas fa-save ml-1"></i> שמור רמת הרשאה');
                editRoleModal.modal('hide');

                if (typeof RoleManager !== 'undefined') {
                    RoleManager.registerRole(docData);
                    permissionLevelsMap = RoleManager.getAllRoles();
                } else {
                    permissionLevelsMap[level] = docData;
                }

                updateRoleFilterOptions();
                renderRolesTable();
                renderUsersTable();
            })
            .catch(function (err) {
                saveRoleBtn.prop('disabled', false).html('<i class="fas fa-save ml-1"></i> שמור רמת הרשאה');
                alert('שגיאה בשמירת רמת ההרשאה: ' + err.message);
            });
    });

    // Open Delete Role Modal
    function openDeleteRoleModal(role, userCount) {
        if (!currentUserPermissions.canManageRoles) {
            alert('אין לך הרשאה למחוק רמות הרשאה.');
            return;
        }
        if (role.level === 1 || role.level === 0) {
            alert('לא ניתן למחוק דרגת מערכת מובנית (מנהל מערכת / User).');
            return;
        }

        roleToDelete = role;
        deleteRoleModalId.text(role.level);
        deleteRoleModalName.text(role.name || ('דרגה ' + role.level));
        deleteRoleModalCount.text(userCount + ' משתמשים');

        // Check if any other roles inherit from this role
        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;
        var inheritingRoles = [];
        Object.keys(allRoles).forEach(function (k) {
            var l = parseInt(k, 10);
            if (l !== role.level) {
                var r = allRoles[l];
                if (r && Array.isArray(r.inheritsFrom)) {
                    var inherits = r.inheritsFrom.some(function (pid) {
                        return pid === role.level || String(pid) === String(role.level);
                    });
                    if (inherits) {
                        inheritingRoles.push(r.name || ('רמה ' + l));
                    }
                }
            }
        });

        if (inheritingRoles.length > 0) {
            $('#delete-role-inheritors-row').removeClass('d-none');
            $('#delete-role-modal-inheritors').text(inheritingRoles.length + ' (' + inheritingRoles.join(', ') + ')');
        } else {
            $('#delete-role-inheritors-row').addClass('d-none');
        }

        confirmDeleteRoleBtn.prop('disabled', false).html('<i class="fas fa-trash-alt ml-1"></i> מחק רמת הרשאה');
        deleteRoleModal.modal('show');
    }

    // Confirm Delete Role
    confirmDeleteRoleBtn.click(function () {
        if (!roleToDelete) return;
        if (!currentUserPermissions.canManageRoles) {
            alert('אין לך הרשאה למחוק רמות הרשאה.');
            return;
        }

        var targetLevel = roleToDelete.level;
        confirmDeleteRoleBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm ml-1" role="status" aria-hidden="true"></span> מוחק...');

        // 1. Reset all users currently with this level to 0 (User)
        var affectedUsers = allUsers.filter(function (u) { return u.level === targetLevel; });
        var batch = db.batch();

        affectedUsers.forEach(function (u) {
            batch.update(db.collection('users').doc(u.uid), { level: 0 });
        });

        // 2. Cascade-remove targetLevel from any other permission levels that inherit from it
        var allRoles = (typeof RoleManager !== 'undefined') ? RoleManager.getAllRoles() : permissionLevelsMap;
        var affectedRoles = [];
        Object.keys(allRoles).forEach(function (key) {
            var lvlNum = parseInt(key, 10);
            if (lvlNum !== targetLevel) {
                var r = allRoles[lvlNum];
                if (r && Array.isArray(r.inheritsFrom)) {
                    var hasInherit = r.inheritsFrom.some(function (pid) {
                        return pid === targetLevel || String(pid) === String(targetLevel);
                    });
                    if (hasInherit) {
                        var updatedInherits = r.inheritsFrom.filter(function (pid) {
                            return pid !== targetLevel && String(pid) !== String(targetLevel);
                        });
                        affectedRoles.push({
                            level: lvlNum,
                            inheritsFrom: updatedInherits
                        });
                        var roleRef = db.collection('permissionLevels').doc(String(lvlNum));
                        batch.update(roleRef, {
                            inheritsFrom: updatedInherits,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
            }
        });

        // 3. Delete role document from permissionLevels collection
        var roleDocRef = db.collection('permissionLevels').doc(String(targetLevel));
        batch.delete(roleDocRef);

        batch.commit().then(function () {
            deleteRoleModal.modal('hide');

            // Update in-memory user levels
            affectedUsers.forEach(function (u) { u.level = 0; });

            // Remove targetLevel and cascade-remove inheritance in RoleManager & local map
            if (typeof RoleManager !== 'undefined') {
                RoleManager.removeRole(targetLevel);
            }
            delete permissionLevelsMap[targetLevel];
            affectedRoles.forEach(function (ar) {
                if (permissionLevelsMap[ar.level]) {
                    permissionLevelsMap[ar.level].inheritsFrom = ar.inheritsFrom;
                }
            });

            loadPermissionLevels().then(function () {
                updateStats();
                renderUsersTable();
                var msg = 'רמת ההרשאה נמחקה בהצלחה.';
                if (affectedRoles.length > 0) {
                    msg += '\nההורשה מרמה זו הוסרה אוטומטית מ-' + affectedRoles.length + ' רמות הרשאה שהיו תלויות בה.';
                }
                alert(msg);
                roleToDelete = null;
            });
        }).catch(function (err) {
            confirmDeleteRoleBtn.prop('disabled', false).html('<i class="fas fa-trash-alt ml-1"></i> מחק רמת הרשאה');
            alert('שגיאה במחיקת רמת ההרשאה: ' + err.message);
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

            var avatarBg = (u.level === 1) ? '#d97706' : ((u.level === 0) ? '#4e73df' : '#4f46e5');
            var avatarLetter = u.username ? u.username.charAt(0).toUpperCase() : '?';
            var avatar = $('<div class="notify-user-avatar ml-2" style="background-color: ' + avatarBg + '"></div>').text(avatarLetter);

            var userMeta = $('<div></div>');
            var nameSpan = $('<span></span>').text(u.username);
            if (typeof RoleManager !== 'undefined') {
                RoleManager.applyRoleHover(nameSpan, u);
            } else if (u.level === 1) {
                nameSpan.addClass('admin-golden-gradient');
            } else {
                nameSpan.addClass('user-name-standard');
            }

            userMeta.append($('<div class="font-weight-bold small"></div>').append(nameSpan));
            if (u.email) {
                userMeta.append($('<small class="text-muted d-block"></small>').text(u.email));
            }
            leftFlex.append(chk, avatar, userMeta);

            var roleBadgeClass = (u.level === 1) ? 'badge-role-system-god' : ((u.level === 0) ? 'badge-role-user' : 'badge-role-custom');
            var rName = (typeof RoleManager !== 'undefined' ? (RoleManager.getRoleName ? RoleManager.getRoleName(u.level) : RoleManager.getRoleSystemName(u.level)) : '') || (u.level === 1 ? 'מנהל מערכת' : 'User');
            var rightBadge = $('<span class="badge ' + roleBadgeClass + '"></span>').text(rName + ' (' + u.level + ')');

            row.append(leftFlex, rightBadge);
            row.click(function (e) {
                if (e.target.tagName !== 'INPUT') {
                    chk.prop('checked', !chk.prop('checked')).trigger('change');
                }
            });
            chk.change(function () {
                if ($(this).is(':checked')) {
                    row.addClass('selected');
                } else {
                    row.removeClass('selected');
                }
                updateSelectedUsersCount();
            });

            notifyUsersChecklist.append(row);
        });

        updateSelectedUsersCount();
    }

    notifyUserSearch.on('input', function () {
        var q = $(this).val().trim().toLowerCase();
        notifyUsersChecklist.find('.notify-user-row').each(function () {
            var row = $(this);
            if (!q) {
                row.removeClass('d-none');
                return;
            }
            var uName = row.attr('data-username') || '';
            var uMail = row.attr('data-email') || '';
            var uUid = row.attr('data-uid') || '';
            if (uName.indexOf(q) !== -1 || uMail.indexOf(q) !== -1 || uUid.indexOf(q) !== -1) {
                row.removeClass('d-none');
            } else {
                row.addClass('d-none');
            }
        });
    });

    notifySelectAllBtn.click(function () {
        notifyUsersChecklist.find('.notify-user-row:not(.d-none) .notify-user-chk').prop('checked', true);
        notifyUsersChecklist.find('.notify-user-row:not(.d-none)').addClass('selected');
        updateSelectedUsersCount();
    });

    notifyDeselectAllBtn.click(function () {
        notifyUsersChecklist.find('.notify-user-chk').prop('checked', false);
        notifyUsersChecklist.find('.notify-user-row').removeClass('selected');
        updateSelectedUsersCount();
    });

    $('input[name="notifyTargetMode"]').change(function () {
        var mode = $('input[name="notifyTargetMode"]:checked').val();
        if (mode === 'broadcast') {
            notifyBroadcastInfo.removeClass('d-none');
            notifySpecificContainer.addClass('d-none');
        } else {
            notifyBroadcastInfo.addClass('d-none');
            notifySpecificContainer.removeClass('d-none');
        }
    });

    function updateNotificationPreview() {
        var type = notifyTypeSelect.val();
        var sender = notifySenderName.val().trim() || 'מערכת CheeseMate';
        var msg = notifyMessageText.val().trim() || '(תוכן ההודעה יוצג כאן...)';

        notifyPreviewSender.text(sender);
        notifyPreviewMsg.text(msg);
        notifyCharCounter.text(notifyMessageText.val().length);

        var badgeText = 'מערכת';
        var badgeClass = 'badge-warning text-dark';
        var iconHtml = '<i class="fas fa-bullhorn text-warning fa-lg"></i>';

        if (type === 'update') {
            badgeText = 'עדכון';
            badgeClass = 'badge-primary text-white';
            iconHtml = '<i class="fas fa-sparkles text-primary fa-lg"></i>';
        } else if (type === 'alert') {
            badgeText = 'התראה';
            badgeClass = 'badge-danger text-white';
            iconHtml = '<i class="fas fa-exclamation-triangle text-danger fa-lg"></i>';
        }

        notifyPreviewBadge.text(badgeText).attr('class', 'badge ml-2 ' + badgeClass);
        notifyPreviewIcon.html(iconHtml);
    }

    notifyTypeSelect.change(updateNotificationPreview);
    notifySenderName.on('input', updateNotificationPreview);
    notifyMessageText.on('input', updateNotificationPreview);

    function openSendNotificationModal(targetUid) {
        if (!currentUserPermissions.canSendNotifications) {
            alert('אין לך הרשאה לשליחת הודעות מערכת.');
            return;
        }

        notifyForm[0].reset();
        notifySenderName.val('מערכת CheeseMate');
        notifyTypeSelect.val('system');
        notifySendPush.prop('checked', true);
        notifyProgressBox.addClass('d-none');
        notifyResultAlert.addClass('d-none').text('');
        notifySubmitBtn.prop('disabled', false).html('<i class="fas fa-paper-plane ml-1"></i> שלח הודעה');
        notifyCancelBtn.prop('disabled', false);
        notifyBroadcastCount.text(allUsers.length);

        if (targetUid) {
            notifyRadioSpecific.prop('checked', true).trigger('change');
            populateUsersChecklist(targetUid);
        } else {
            notifyRadioBroadcast.prop('checked', true).trigger('change');
            populateUsersChecklist(null);
        }

        updateNotificationPreview();
        notifyModal.modal('show');
    }

    openNotifyModalBtn.click(function () {
        openSendNotificationModal(null);
    });

    notifyForm.submit(function (e) {
        e.preventDefault();
        if (!currentUserPermissions.canSendNotifications) {
            alert('אין לך הרשאה לשליחת הודעות מערכת.');
            return;
        }

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
            alert('יש לבחור לפחות משתמש אחד לקבלת ההודעה.');
            return;
        }

        var senderName = notifySenderName.val().trim() || 'מערכת CheeseMate';
        var notifType = notifyTypeSelect.val() || 'system';
        var message = notifyMessageText.val().trim();
        var sendPush = notifySendPush.is(':checked');

        if (!message) {
            alert('יש להזין תוכן להודעה.');
            return;
        }

        notifySubmitBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm ml-1" role="status" aria-hidden="true"></span> שולח...');
        notifyCancelBtn.prop('disabled', true);
        notifyProgressBox.removeClass('d-none');
        notifyResultAlert.addClass('d-none').text('');
        notifyProgressBar.css('width', '10%');
        notifyProgressPercent.text('10%');
        notifyProgressLabel.text('כותב התראות ב-Firestore...');

        var notifDocData = {
            type: notifType,
            fromUid: currentUser ? currentUser.uid : 'system',
            fromUsername: senderName,
            fromLevel: currentUserLevel,
            fromRole: (currentUserLevel === 1 ? 'מנהל מערכת' : 'admin'),
            message: message,
            timestamp: Date.now(),
            read: false
        };

        var BATCH_SIZE = 450;
        var batchPromises = [];
        var totalBatches = Math.ceil(targetUids.length / BATCH_SIZE);

        for (var b = 0; b < totalBatches; b++) {
            var chunk = targetUids.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
            var writeBatch = db.batch();
            chunk.forEach(function (uId) {
                var docRef = db.collection('users').doc(uId).collection('notifications').doc();
                writeBatch.set(docRef, notifDocData);
            });
            batchPromises.push(writeBatch.commit());
        }

        Promise.all(batchPromises).then(function () {
            notifyProgressBar.css('width', '50%');
            notifyProgressPercent.text('50%');
            notifyProgressLabel.text('התראות נשמרו ב-Firestore. שולח Web Push...');

            if (!sendPush) {
                return Promise.resolve();
            }

            var pushPayload = {
                title: senderName,
                body: message,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png',
                tag: 'system-broadcast-' + Date.now(),
                url: '/'
            };

            var pushPromises = targetUids.map(function (tUid, idx) {
                return fetch('https://cheesemate-notifications.yuvalkalan.workers.dev/api/send-push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: tUid,
                        notification: pushPayload
                    })
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
