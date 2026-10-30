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
        if (!user) return false;
        var emailLower = (user.email || '').toLowerCase();
        if (emailLower === 'yuvalkalan@gmail.com') {
            return true;
        }
        if (data && (data.role === 'Administrator' || data.role === 'admin')) {
            return true;
        }
        return false;
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
                var emailLower = (user.email || '').toLowerCase();

                if (isAdministrator(user, data)) {
                    // Bootstrap admin role in Firestore if missing
                    if (data.role !== 'Administrator' && data.role !== 'admin') {
                        db.collection('users').doc(user.uid).set({
                            role: 'Administrator'
                        }, { merge: true }).catch(function (e) {
                            console.warn('Could not auto-set admin role:', e);
                        });
                    }

                    var displayName = data.username || data.displayName || user.displayName || user.email || 'מנהל';
                    userNameHeader.text(displayName);
                    switchView('dashboard');
                    loadAllUsers();
                } else {
                    deniedUserEmail.text(user.email || user.uid);
                    switchView('denied');
                }
            })
            .catch(function (err) {
                console.error('Error fetching user document:', err);
                // Fallback check for project owner email
                if (user.email && user.email.toLowerCase() === 'yuvalkalan@gmail.com') {
                    userNameHeader.text(user.email);
                    switchView('dashboard');
                    loadAllUsers();
                } else {
                    deniedUserEmail.text(user.email || user.uid);
                    switchView('denied');
                }
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

        db.collection('users').get()
            .then(function (snapshot) {
                allUsers = [];
                snapshot.forEach(function (doc) {
                    var d = doc.data() || {};
                    var role = d.role || 'user';
                    if (role === 'admin') role = 'Administrator';

                    var email = d.email || '';
                    if (!email && doc.id === (currentUser ? currentUser.uid : '')) {
                        email = currentUser.email || '';
                    }

                    allUsers.push({
                        uid: doc.id,
                        username: d.username || d.displayName || (email ? email.split('@')[0] : 'ללא שם'),
                        email: email,
                        role: role,
                        friends: Array.isArray(d.friends) ? d.friends : [],
                        incomingRequests: Array.isArray(d.incomingRequests) ? d.incomingRequests : [],
                        outgoingRequests: Array.isArray(d.outgoingRequests) ? d.outgoingRequests : [],
                        data: d
                    });
                });

                allUsers.sort(function (a, b) {
                    if (a.role === 'Administrator' && b.role !== 'Administrator') return -1;
                    if (a.role !== 'Administrator' && b.role === 'Administrator') return 1;
                    return a.username.localeCompare(b.username, 'he', { sensitivity: 'base' });
                });

                updateStats();
                renderUsersTable();
                refreshBtn.prop('disabled', false).find('i').removeClass('fa-spin');
            })
            .catch(function (err) {
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
            if (u.role === 'Administrator' || u.role === 'admin') {
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

    function renderUsersTable() {
        var q = (searchInput.val() || '').trim().toLowerCase();
        var selectedRole = roleFilter.val();

        var filtered = allUsers.filter(function (u) {
            var matchesRole = true;
            if (selectedRole === 'Administrator') {
                matchesRole = (u.role === 'Administrator' || u.role === 'admin');
            } else if (selectedRole === 'user') {
                matchesRole = (u.role === 'user');
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
            var isAdmin = (u.role === 'Administrator' || u.role === 'admin');

            var avatarChar = u.username ? u.username.charAt(0).toUpperCase() : '?';
            var avatarBg = isAdmin ? '#e74a3b' : '#4e73df';

            var tr = $('<tr></tr>');

            // 1. User column
            var userTd = $('<td></td>');
            var userFlex = $('<div class="d-flex align-items-center"></div>');
            var avatar = $('<div class="user-avatar ml-2" style="background-color: ' + avatarBg + '"></div>').text(avatarChar);
            var userMeta = $('<div></div>');
            var nameEl = $('<div class="font-weight-bold text-dark"></div>').text(u.username);
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

            // 4. Role column with dropdown selector
            var roleTd = $('<td></td>');
            var roleSelect = $('<select class="custom-select custom-select-sm" style="width: auto; min-width: 140px;"></select>');
            roleSelect.append('<option value="user"' + (!isAdmin ? ' selected' : '') + '>משתמש (user)</option>');
            roleSelect.append('<option value="Administrator"' + (isAdmin ? ' selected' : '') + '>מנהל (Administrator)</option>');

            if (isCurrent) {
                roleSelect.prop('disabled', true).attr('title', 'לא ניתן לשנות את הרשאת החשבון המחובר');
            } else {
                roleSelect.change(function () {
                    var newRole = $(this).val();
                    changeUserRole(u.uid, newRole, roleSelect);
                });
            }

            var roleBadge = $('<span class="badge mr-2 ' + (isAdmin ? 'badge-role-admin' : 'badge-role-user') + '"></span>')
                .text(isAdmin ? 'Administrator' : 'user');

            var roleWrapper = $('<div class="d-flex align-items-center"></div>');
            roleWrapper.append(roleBadge, roleSelect);
            roleTd.append(roleWrapper);

            // 5. Friends count column
            var friendsTd = $('<td></td>');
            var fCount = u.friends.length;
            friendsTd.html('<span class="badge badge-light border"><i class="fas fa-user-friends ml-1 text-primary"></i> ' + fCount + '</span>');

            // 6. Actions column (Delete button)
            var actionsTd = $('<td class="text-center"></td>');
            var deleteBtn = $('<button class="btn btn-outline-danger btn-sm" title="מחק משתמש לצמיתות"></button>')
                .html('<i class="fas fa-trash-alt ml-1"></i> מחק');

            if (isCurrent) {
                deleteBtn.prop('disabled', true).attr('title', 'לא ניתן למחוק את החשבון המחובר מלוח הניהול');
            } else {
                deleteBtn.click(function () {
                    openDeleteModal(u);
                });
            }

            actionsTd.append(deleteBtn);

            tr.append(userTd, emailTd, uidTd, roleTd, friendsTd, actionsTd);
            usersTableBody.append(tr);
        });
    }

    searchInput.on('input', renderUsersTable);
    roleFilter.change(renderUsersTable);

    // Change User Role
    function changeUserRole(targetUid, newRole, selectEl) {
        selectEl.prop('disabled', true);
        db.collection('users').doc(targetUid).update({
            role: newRole
        }).then(function () {
            selectEl.prop('disabled', false);
            // Update in memory
            var userObj = allUsers.find(function (u) { return u.uid === targetUid; });
            if (userObj) {
                userObj.role = newRole;
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

})();
