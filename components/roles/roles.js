'use strict';

/* global $ */

/**
 * CheeseMate Modular Role and Permission System
 *
 * Permission Hierarchy:
 * - "מנהל מערכת" (Level 1): Highest level in the system. Built-in default with full access
 *   (access admin panel, create/edit/delete permission levels, modify users' permission levels,
 *   send system messages, delete users).
 * - "User" (Level 0): Lowest level in the system. Built-in default standard user.
 * - Custom Levels: Dynamically created and managed via the Admin Panel, stored in Firestore 'permissionLevels'.
 *   Each level includes:
 *     1. Unique serial ID (numeric, auto-generated)
 *     2. Name (displayed on mouse hover over user names)
 *     3. Identification color (color or gradient expression defining user's display color)
 *     4. Inheritance from other permission levels (inheriting all capabilities)
 *     5. Specific action permissions (access_admin, send_system_messages, modify_user_roles, manage_roles, delete_users)
 */
var RoleManager = (function () {
    var SYSTEM_GOD_LEVEL = 1;
    var USER_LEVEL = 0;

    // Available specific action permissions across the system
    var AVAILABLE_PERMISSIONS = [
        { id: 'access_admin', label: 'גישה ללוח הניהול (Access Admin Panel)', description: 'הרשאה לפתוח ולצפות בלוח הניהול של CheeseMate' },
        { id: 'send_system_messages', label: 'שליחת הודעות מערכת (Send System Notifications)', description: 'הרשאה לשדר הודעות מערכת והתראות Push לכל המשתמשים או למשתמשים נבחרים' },
        { id: 'modify_user_roles', label: 'שינוי דרגות משתמשים (Modify Users\' Permission Levels)', description: 'הרשאה לערוך ולשנות רמת הרשאה של משתמשים קיימים' },
        { id: 'manage_roles', label: 'ניהול רמות הרשאה (Manage Permission Levels)', description: 'הרשאה ליצור, לערוך ולמחוק רמות הרשאה במערכת' },
        { id: 'delete_users', label: 'מחיקת משתמשים (Delete Users)', description: 'הרשאה למחוק משתמשים ונתוניהם לצמיתות מלוח הניהול' }
    ];

    // Registry of permission levels. ONLY מנהל מערכת and User are defined directly within the system.
    var rolesMap = {
        0: {
            level: USER_LEVEL,
            name: 'User',
            color: '',
            isStandard: true,
            isSystemGod: false,
            badgeClass: 'badge-role-user',
            gradientClass: null,
            inheritsFrom: [],
            permissions: []
        },
        1: {
            level: SYSTEM_GOD_LEVEL,
            name: 'מנהל מערכת',
            color: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
            isStandard: false,
            isSystemGod: true,
            badgeClass: 'badge-role-system-god',
            gradientClass: 'admin-golden-gradient',
            inheritsFrom: [],
            permissions: [
                'access_admin',
                'send_system_messages',
                'modify_user_roles',
                'manage_roles',
                'delete_users'
            ]
        }
    };

    // Mapping from lowercase role slug/alias to numeric level
    var roleNamesMap = {
        'user': USER_LEVEL,
        'regular': USER_LEVEL,
        'standard': USER_LEVEL,
        'משתמש': USER_LEVEL,
        'מנהל מערכת': SYSTEM_GOD_LEVEL,
        'מנהל': SYSTEM_GOD_LEVEL,
        'system god': SYSTEM_GOD_LEVEL,
        'systemgod': SYSTEM_GOD_LEVEL,
        'god': SYSTEM_GOD_LEVEL,
        'אל המערכת': SYSTEM_GOD_LEVEL,
        'admin': SYSTEM_GOD_LEVEL,
        'administrator': SYSTEM_GOD_LEVEL
    };

    /**
     * Registers or updates a role in the modular registry.
     * @param {Object} role - Role definition.
     */
    function registerRole(role) {
        if (!role || typeof role.level !== 'number' || isNaN(role.level)) {
            return;
        }
        var lvl = role.level;
        var isSystemGod = (lvl === SYSTEM_GOD_LEVEL) || Boolean(role.isSystemGod);
        var isStandard = (lvl === USER_LEVEL) || (typeof role.isStandard === 'boolean' ? role.isStandard : false);

        var name = role.name || role.systemName || (isSystemGod ? 'מנהל מערכת' : (isStandard ? 'User' : 'role_' + lvl));

        var color = (typeof role.color === 'string') ? role.color.trim() : '';
        if (!color && isSystemGod) {
            color = 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)';
        }

        var inheritsFrom = Array.isArray(role.inheritsFrom)
            ? role.inheritsFrom.map(function (n) { return parseInt(n, 10); }).filter(function (n) {
                return !isNaN(n) && n !== lvl && n !== SYSTEM_GOD_LEVEL && !wouldCreateCycle(lvl, n);
            })
            : [];

        var permissions = isSystemGod
            ? ['access_admin', 'send_system_messages', 'modify_user_roles', 'manage_roles', 'delete_users']
            : (Array.isArray(role.permissions)
                ? role.permissions.filter(function (p) {
                    var k = typeof p === 'string' ? p.trim() : (p && p.id ? String(p.id).trim() : '');
                    return k && k !== 'undefined';
                })
                : []);

        var badgeClass = role.badgeClass || (isSystemGod ? 'badge-role-system-god' : (isStandard ? 'badge-role-user' : 'badge-role-custom'));
        var gradientClass = role.gradientClass !== undefined ? role.gradientClass : (isSystemGod ? 'admin-golden-gradient' : null);

        rolesMap[lvl] = {
            level: lvl,
            name: name,
            color: color,
            inheritsFrom: inheritsFrom,
            permissions: permissions,
            isStandard: isStandard,
            isSystemGod: isSystemGod,
            badgeClass: badgeClass,
            gradientClass: gradientClass
        };

        if (name) {
            roleNamesMap[String(name).toLowerCase().trim()] = lvl;
        }
    }

    /**
     * Removes a role from the registry and cascade-removes its level from any other role's inheritsFrom list.
     * @param {number|string} userOrLevel
     * @returns {boolean} True if a role was removed
     */
    function removeRole(userOrLevel) {
        var lvl = resolveLevel(userOrLevel);
        if (lvl === SYSTEM_GOD_LEVEL || lvl === USER_LEVEL) {
            return false; // Cannot remove built-in system levels
        }
        if (!rolesMap[lvl]) {
            return false;
        }

        var roleName = rolesMap[lvl].name;
        delete rolesMap[lvl];
        if (roleName) {
            delete roleNamesMap[String(roleName).toLowerCase().trim()];
        }

        // Cascade-remove lvl from all remaining roles' inheritsFrom
        Object.keys(rolesMap).forEach(function (k) {
            var r = rolesMap[k];
            if (r && Array.isArray(r.inheritsFrom)) {
                r.inheritsFrom = r.inheritsFrom.filter(function (pid) {
                    return resolveLevel(pid) !== lvl;
                });
            }
        });

        return true;
    }

    /**
     * Resolves a numeric permission level from various input types:
     * - number: 0, 1, 2, ...
     * - string: numeric string '1' or role alias 'admin'
     * - object: user profile or user doc data ({ level: 1, ... } or { role: 'admin' })
     * @param {*} input
     * @returns {number}
     */
    function resolveLevel(input) {
        if (input === null || input === undefined) {
            return USER_LEVEL;
        }
        if (typeof input === 'number') {
            return isNaN(input) ? USER_LEVEL : input;
        }
        if (typeof input === 'string') {
            var trimmed = input.trim();
            var parsed = parseInt(trimmed, 10);
            if (!isNaN(parsed)) {
                return parsed;
            }
            var lower = trimmed.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(roleNamesMap, lower)) {
                return roleNamesMap[lower];
            }
            return USER_LEVEL;
        }
        if (typeof input === 'object') {
            if (typeof input.level === 'number' && !isNaN(input.level)) {
                return input.level;
            }
            if (typeof input.level === 'string') {
                var p = parseInt(input.level, 10);
                if (!isNaN(p)) {
                    return p;
                }
            }
            if (input.role) {
                var rStr = String(input.role).toLowerCase().trim();
                if (Object.prototype.hasOwnProperty.call(roleNamesMap, rStr)) {
                    return roleNamesMap[rStr];
                }
            }
            if (input.isAdmin === true || input.isSystemGod === true) {
                return SYSTEM_GOD_LEVEL;
            }
        }
        return USER_LEVEL;
    }

    /**
     * Returns the role definition object for a user or level.
     * @param {*} userOrLevel
     * @returns {Object}
     */
    function getRole(userOrLevel) {
        var lvl = resolveLevel(userOrLevel);
        if (rolesMap[lvl]) {
            return rolesMap[lvl];
        }
        return {
            level: lvl,
            name: 'role_' + lvl,
            color: '',
            inheritsFrom: [],
            permissions: [],
            isStandard: (lvl === USER_LEVEL),
            isSystemGod: (lvl === SYSTEM_GOD_LEVEL),
            badgeClass: (lvl === SYSTEM_GOD_LEVEL ? 'badge-role-system-god' : (lvl === USER_LEVEL ? 'badge-role-user' : 'badge-role-custom')),
            gradientClass: null
        };
    }

    /**
     * Determines whether the given user or level is System Administrator / מנהל מערכת (highest level).
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function isSystemGod(userOrLevel) {
        return resolveLevel(userOrLevel) === SYSTEM_GOD_LEVEL;
    }

    /**
     * Determines whether the given user or level is a standard user (level 0).
     * Standard users do not display special role styling or hover tooltip.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function isStandardUser(userOrLevel) {
        var lvl = resolveLevel(userOrLevel);
        var role = rolesMap[lvl];
        if (role && typeof role.isStandard === 'boolean') {
            return role.isStandard;
        }
        return lvl === USER_LEVEL;
    }

    /**
     * Checks if destinationLevel can be reached from startLevel by traversing the inheritsFrom chain.
     * Used for circular inheritance protection.
     * @param {number|string} startLevel
     * @param {number|string} destinationLevel
     * @param {Object} [customRolesMap] - Optional map of roles to use instead of internal rolesMap
     * @returns {boolean} True if destinationLevel is reachable from startLevel
     */
    function canReach(startLevel, destinationLevel, customRolesMap) {
        var start = resolveLevel(startLevel);
        var dest = resolveLevel(destinationLevel);
        if (start === dest) return true;

        var roles = customRolesMap || rolesMap;
        var visited = {};
        visited[start] = true;
        var queue = [start];

        while (queue.length > 0) {
            var curr = queue.shift();
            var role = roles[curr];
            if (role && Array.isArray(role.inheritsFrom)) {
                for (var i = 0; i < role.inheritsFrom.length; i++) {
                    var parentId = resolveLevel(role.inheritsFrom[i]);
                    if (parentId === dest) {
                        return true;
                    }
                    if (!visited[parentId]) {
                        visited[parentId] = true;
                        queue.push(parentId);
                    }
                }
            }
        }
        return false;
    }

    /**
     * Determines whether making targetLevel inherit from candidateParentId would create a circular inheritance cycle.
     * A cycle is created if targetLevel === candidateParentId, or if candidateParentId can already reach targetLevel.
     * @param {number|string} targetLevel
     * @param {number|string} candidateParentId
     * @param {Object} [customRolesMap]
     * @returns {boolean} True if a circular dependency would be created
     */
    function wouldCreateCycle(targetLevel, candidateParentId, customRolesMap) {
        var target = resolveLevel(targetLevel);
        var candidate = resolveLevel(candidateParentId);
        if (target === candidate) return true;

        return canReach(candidate, target, customRolesMap);
    }

    /**
     * Returns an array of numeric level IDs that inherit from targetLevel directly or transitively.
     * All returned levels cannot be chosen as parents for targetLevel without causing circular inheritance.
     * @param {number|string} targetLevel
     * @param {Object} [customRolesMap]
     * @returns {Array<number>}
     */
    function getDescendants(targetLevel, customRolesMap) {
        var target = resolveLevel(targetLevel);
        var roles = customRolesMap || rolesMap;
        var descendants = [];

        Object.keys(roles).forEach(function (key) {
            var lvl = parseInt(key, 10);
            if (!isNaN(lvl) && lvl !== target) {
                if (canReach(lvl, target, roles)) {
                    descendants.push(lvl);
                }
            }
        });

        return descendants;
    }

    /**
     * Calculates the complete list of effective permissions for a role,
     * traversing inheritance recursively.
     * @param {*} userOrLevel
     * @returns {Array<string>}
     */
    function getEffectivePermissions(userOrLevel) {
        var lvl = resolveLevel(userOrLevel);
        if (lvl === SYSTEM_GOD_LEVEL) {
            return AVAILABLE_PERMISSIONS.map(function (p) { return p.id; });
        }
        var role = getRole(lvl);
        var permsMap = {};

        function addPermKey(p) {
            var k = (typeof p === 'string') ? p.trim() : (p && typeof p.id === 'string' ? p.id.trim() : '');
            if (k && k !== 'undefined') {
                permsMap[k] = true;
            }
        }

        (role.permissions || []).forEach(addPermKey);

        var visited = {};
        visited[lvl] = true;

        function traverseInherited(parentIds) {
            if (!Array.isArray(parentIds)) return;
            parentIds.forEach(function (pid) {
                var pNum = resolveLevel(pid);
                if (visited[pNum]) return;
                visited[pNum] = true;

                // Cannot inherit from SYSTEM_GOD_LEVEL (מנהל מערכת)
                if (pNum === SYSTEM_GOD_LEVEL) {
                    return;
                }

                var pRole = rolesMap[pNum] || getRole(pNum);
                if (pRole) {
                    (pRole.permissions || []).forEach(addPermKey);
                    if (Array.isArray(pRole.inheritsFrom)) {
                        traverseInherited(pRole.inheritsFrom);
                    }
                }
            });
        }

        if (Array.isArray(role.inheritsFrom)) {
            traverseInherited(role.inheritsFrom);
        }

        return Object.keys(permsMap);
    }

    /**
     * Checks whether a user or level has a specific permission.
     * מנהל מערכת always has all permissions.
     * @param {*} userOrLevel
     * @param {string} permissionKey
     * @returns {boolean}
     */
    function hasPermission(userOrLevel, permissionKey) {
        var lvl = resolveLevel(userOrLevel);
        if (lvl === SYSTEM_GOD_LEVEL) {
            return true;
        }
        var effective = getEffectivePermissions(lvl);
        return effective.indexOf(permissionKey) !== -1;
    }

    /**
     * Checks if a user has access to the admin dashboard.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function canAccessAdmin(userOrLevel) {
        return isSystemGod(userOrLevel) || hasPermission(userOrLevel, 'access_admin');
    }

    /**
     * Legacy alias: returns true if the user has administrator privileges or admin panel access.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function isAdmin(userOrLevel) {
        return canAccessAdmin(userOrLevel);
    }

    /**
     * Checks if a user has permission to manage (create, edit, delete) permission levels.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function canManageRoles(userOrLevel) {
        return isSystemGod(userOrLevel) || hasPermission(userOrLevel, 'manage_roles');
    }

    /**
     * Checks if a user has permission to modify other users' permission levels.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function canModifyUserRoles(userOrLevel) {
        return isSystemGod(userOrLevel) || hasPermission(userOrLevel, 'modify_user_roles');
    }

    /**
     * Checks if a user has permission to send system messages.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function canSendSystemMessages(userOrLevel) {
        return isSystemGod(userOrLevel) || hasPermission(userOrLevel, 'send_system_messages');
    }

    /**
     * Checks if a user has permission to delete users.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function canDeleteUsers(userOrLevel) {
        return isSystemGod(userOrLevel) || hasPermission(userOrLevel, 'delete_users');
    }

    /**
     * Returns the name of the role to display when hovering over the name of a user belonging to this level.
     * Returns empty string for standard users.
     * @param {*} userOrLevel
     * @returns {string}
     */
    function getRoleName(userOrLevel) {
        if (isStandardUser(userOrLevel)) {
            return '';
        }
        var role = getRole(userOrLevel);
        return (role && role.name) || '';
    }

    /**
     * Backward-compatibility alias for getRoleName.
     */
    function getRoleSystemName(userOrLevel) {
        return getRoleName(userOrLevel);
    }

    /**
     * Backward-compatibility alias for getRoleName.
     */
    function getRoleDescription(userOrLevel) {
        return getRoleName(userOrLevel);
    }

    /**
     * Checks if the user has a role name to display on hover.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function hasRoleDescription(userOrLevel) {
        return !isStandardUser(userOrLevel) && Boolean(getRoleName(userOrLevel));
    }

    /**
     * Applies identification color and hover tooltip to an element displaying a user's name.
     *
     * Behavior:
     * - If the user is non-standard (e.g. מנהל מערכת or custom level):
     *   - Displays the level's name in a tooltip on mouse hover.
     *   - Applies the identification color expression (solid color or CSS gradient).
     * - If the user is standard (level 0):
     *   - Clears any previous tooltip and role styling.
     *
     * @param {jQuery|HTMLElement} element
     * @param {*} userOrLevel
     * @param {Object} [options]
     * @returns {jQuery}
     */
    function applyRoleHover(element, userOrLevel, options) {
        if (!element || typeof $ === 'undefined') {
            return $(element);
        }
        var $el = $(element);
        options = options || {};
        var placement = options.placement || 'top';
        var initTooltip = (options.initTooltip !== false);
        var applyColor = (options.applyColor !== false);

        var lvl = resolveLevel(userOrLevel);
        var role = getRole(lvl);
        var rName = getRoleName(userOrLevel);

        // Reset previous inline styles and role classes
        $el.css({
            'color': '',
            'background': '',
            '-webkit-background-clip': '',
            '-webkit-text-fill-color': '',
            'background-clip': '',
            'display': '',
            'font-weight': ''
        });
        $el.removeClass('admin-golden-gradient role-atmosphere-gradient role-custom-gradient');

        if (rName) {
            // Non-standard user: set role name tooltip on hover
            $el.attr('title', rName);
            $el.attr('data-toggle', 'tooltip');
            $el.attr('data-placement', placement);
            $el.attr('data-role-level', lvl);

            // Apply identification color expression if requested
            if (applyColor) {
                var colorExpr = (role && role.color) ? role.color.trim() : '';
                if (colorExpr) {
                    var isGradient = colorExpr.indexOf('gradient') !== -1;
                    if (isGradient) {
                        $el.css({
                            'background': colorExpr,
                            '-webkit-background-clip': 'text',
                            '-webkit-text-fill-color': 'transparent',
                            'background-clip': 'text',
                            'color': 'transparent',
                            'display': 'inline-block',
                            'font-weight': '700'
                        });
                    } else {
                        $el.css({
                            'color': colorExpr,
                            '-webkit-text-fill-color': colorExpr,
                            'font-weight': '600'
                        });
                    }
                } else if (role.gradientClass) {
                    $el.addClass(role.gradientClass);
                }
            }

            if (initTooltip && typeof $el.tooltip === 'function') {
                try {
                    $el.tooltip('dispose');
                } catch (e) {}
                try {
                    $el.tooltip({
                        placement: placement,
                        trigger: 'hover',
                        boundary: 'window'
                    });
                } catch (e) {}
            }
        } else {
            // Standard user: clear role hover tooltip and title
            if ($el.attr('data-role-level') !== undefined) {
                $el.removeAttr('data-role-level');
                $el.removeAttr('data-toggle');
                $el.removeAttr('title');
                if (typeof $el.tooltip === 'function') {
                    try {
                        $el.tooltip('dispose');
                    } catch (e) {}
                }
            }
        }

        return $el;
    }

    /**
     * Loads dynamic permission levels from Firestore's 'permissionLevels' collection
     * and updates the registry in real-time.
     * Also seeds מנהל מערכת (1) and User (0) defaults if missing in Firestore.
     * @param {firebase.firestore.Firestore} db
     * @returns {Promise<Object>}
     */
    function loadFromFirestore(db) {
        if (!db || typeof db.collection !== 'function') {
            return Promise.resolve(rolesMap);
        }

        return db.collection('permissionLevels').get()
            .then(function (snapshot) {
                var loadedLevels = { 0: true, 1: true };
                if (snapshot && !snapshot.empty) {
                    snapshot.forEach(function (doc) {
                        var data = doc.data() || {};
                        var lvl = (typeof data.level === 'number') ? data.level : parseInt(doc.id, 10);
                        if (!isNaN(lvl)) {
                            loadedLevels[lvl] = true;
                            var isGod = (lvl === SYSTEM_GOD_LEVEL) || Boolean(data.isSystemGod);
                            var isStd = (lvl === USER_LEVEL) || Boolean(data.isStandard);

                            var rName = data.name || data.systemName;
                            if (isGod && (!rName || rName.toLowerCase() === 'admin' || rName === 'System God')) {
                                rName = 'מנהל מערכת';
                            }
                            if (!rName) {
                                rName = isGod ? 'מנהל מערכת' : (isStd ? 'User' : 'role_' + lvl);
                            }

                            registerRole({
                                level: lvl,
                                name: rName,
                                color: data.color || (isGod ? 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' : (lvl === 2 ? 'linear-gradient(135deg, #c02424 0%, #e83e8c 25%, #dc3545 50%, #f85032 75%, #b31217 100%)' : '')),
                                inheritsFrom: Array.isArray(data.inheritsFrom)
                                    ? data.inheritsFrom.map(function (n) { return parseInt(n, 10); }).filter(function (n) { return !isNaN(n) && n !== lvl && n !== SYSTEM_GOD_LEVEL; })
                                    : [],
                                permissions: Array.isArray(data.permissions)
                                    ? data.permissions.filter(function (p) { return typeof p === 'string' && p.trim() && p !== 'undefined'; })
                                    : (isGod ? ['access_admin', 'send_system_messages', 'modify_user_roles', 'manage_roles', 'delete_users'] : []),
                                isStandard: isStd,
                                isSystemGod: isGod,
                                badgeClass: data.badgeClass || (isGod ? 'badge-role-system-god' : (isStd ? 'badge-role-user' : 'badge-role-custom')),
                                gradientClass: data.gradientClass || (isGod ? 'admin-golden-gradient' : (lvl === 2 ? 'role-atmosphere-gradient' : null))
                            });
                        }
                    });

                    // Clean up any roles in rolesMap that no longer exist in Firestore
                    Object.keys(rolesMap).forEach(function (k) {
                        var lvlNum = parseInt(k, 10);
                        if (!loadedLevels[lvlNum]) {
                            removeRole(lvlNum);
                        }
                    });

                    // Ensure all remaining roles' inheritsFrom lists have deleted levels pruned
                    Object.keys(rolesMap).forEach(function (k) {
                        var r = rolesMap[k];
                        if (r && Array.isArray(r.inheritsFrom)) {
                            r.inheritsFrom = r.inheritsFrom.filter(function (pid) {
                                return loadedLevels[resolveLevel(pid)];
                            });
                        }
                    });
                }
                return rolesMap;
            })
            .catch(function (err) {
                console.warn('[RoleManager] Failed to load permissionLevels collection:', err);
                return rolesMap;
            });
    }

    /**
     * Calculates the next available unique numeric serial ID.
     * @returns {number}
     */
    function getNextSerialId() {
        var keys = Object.keys(rolesMap).map(function (k) { return parseInt(k, 10); }).filter(function (n) { return !isNaN(n); });
        if (keys.length === 0) return 2;
        var maxId = Math.max.apply(null, keys);
        return maxId < 2 ? 2 : maxId + 1;
    }

    /**
     * Returns an immutable copy of all registered roles.
     * @returns {Object}
     */
    function getAllRoles() {
        if (typeof $ !== 'undefined' && typeof $.extend === 'function') {
            return $.extend(true, {}, rolesMap);
        }
        return JSON.parse(JSON.stringify(rolesMap));
    }

    /**
     * Returns the list of system available action permissions.
     * @returns {Array<Object>}
     */
    function getAvailablePermissions() {
        return AVAILABLE_PERMISSIONS.slice();
    }

    return {
        SYSTEM_GOD_LEVEL: SYSTEM_GOD_LEVEL,
        USER_LEVEL: USER_LEVEL,
        registerRole: registerRole,
        removeRole: removeRole,
        resolveLevel: resolveLevel,
        getRole: getRole,
        isSystemGod: isSystemGod,
        isStandardUser: isStandardUser,
        getEffectivePermissions: getEffectivePermissions,
        hasPermission: hasPermission,
        canAccessAdmin: canAccessAdmin,
        isAdmin: isAdmin,
        canManageRoles: canManageRoles,
        canModifyUserRoles: canModifyUserRoles,
        canSendSystemMessages: canSendSystemMessages,
        canDeleteUsers: canDeleteUsers,
        getRoleName: getRoleName,
        getRoleSystemName: getRoleSystemName,
        getRoleDescription: getRoleDescription,
        hasRoleDescription: hasRoleDescription,
        applyRoleHover: applyRoleHover,
        loadFromFirestore: loadFromFirestore,
        getNextSerialId: getNextSerialId,
        getAllRoles: getAllRoles,
        getAvailablePermissions: getAvailablePermissions,
        canReach: canReach,
        wouldCreateCycle: wouldCreateCycle,
        getDescendants: getDescendants
    };
})();

if (typeof window !== 'undefined') {
    window.RoleManager = RoleManager;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RoleManager;
}
