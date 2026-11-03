'use strict';

/* global $ */

/**
 * CheeseMate Modular Role and Permission System
 *
 * Provides a centralized registry and utilities for user permission levels,
 * role descriptions, and UI presentation (tooltips on hover, gradient colors, badges).
 *
 * New roles can be registered modularly via:
 *   RoleManager.registerRole({ level: 2, name: 'moderator', description: 'אחראי תוכן' });
 * Or loaded dynamically from Firestore's 'permissionLevels' collection:
 *   RoleManager.loadFromFirestore(db);
 */
var RoleManager = (function () {
    // Registry of permission levels: numeric level -> role definition
    var rolesMap = {
        0: {
            level: 0,
            name: 'user',
            description: 'משתמש רגיל',
            isStandard: true,
            badgeClass: 'badge-role-user',
            gradientClass: null,
            hasNameTag: false,
            nameTagText: ''
        },
        1: {
            level: 1,
            name: 'admin',
            description: 'מנהל מערכת',
            isStandard: false,
            badgeClass: 'badge-role-admin',
            gradientClass: 'admin-golden-gradient',
            hasNameTag: false,
            nameTagText: ''
        },
        2: {
            level: 2,
            name: 'atmosphere',
            description: 'א. אווירה',
            isStandard: false,
            badgeClass: 'badge-role-atmosphere',
            gradientClass: 'role-atmosphere-gradient',
            hasNameTag: false,
            nameTagText: ''
        }
    };

    // Mapping from lowercase role slug/alias to numeric level
    var roleNamesMap = {
        'user': 0,
        'regular': 0,
        'standard': 0,
        'admin': 1,
        'administrator': 1,
        'atmosphere': 2,
        'vibe': 2,
        'א. אווירה': 2,
        'אחראי אווירה': 2
    };

    /**
     * Registers or updates a role in the modular registry.
     * @param {Object} role - Role definition.
     * @param {number} role.level - Numeric permission level identifier.
     * @param {string} [role.name] - Internal name/slug.
     * @param {string} [role.description] - Human-readable permission/role description.
     * @param {boolean} [role.isStandard] - Whether this role represents a standard user (defaults to level === 0).
     * @param {string} [role.badgeClass] - CSS badge class.
     * @param {string} [role.gradientClass] - CSS gradient class for name styling.
     */
    function registerRole(role) {
        if (!role || typeof role.level !== 'number' || isNaN(role.level)) {
            return;
        }
        var lvl = role.level;
        var isStandard = (typeof role.isStandard === 'boolean') ? role.isStandard : (lvl === 0);
        var hasNameTag = Boolean(role.hasNameTag);
        var nameTagText = role.nameTagText || '';

        rolesMap[lvl] = {
            level: lvl,
            name: role.name || (lvl === 0 ? 'user' : (lvl === 1 ? 'admin' : (lvl === 2 ? 'atmosphere' : 'role_' + lvl))),
            description: role.description || (lvl === 0 ? 'משתמש רגיל' : (lvl === 1 ? 'מנהל מערכת' : (lvl === 2 ? 'א. אווירה' : 'דרגה ' + lvl))),
            isStandard: isStandard,
            badgeClass: role.badgeClass || (isStandard ? 'badge-role-user' : (lvl === 1 ? 'badge-role-admin' : (lvl === 2 ? 'badge-role-atmosphere' : 'badge-role-custom'))),
            gradientClass: role.gradientClass !== undefined ? role.gradientClass : (lvl === 1 ? 'admin-golden-gradient' : (lvl === 2 ? 'role-atmosphere-gradient' : null)),
            hasNameTag: hasNameTag,
            nameTagText: nameTagText
        };

        if (role.name) {
            roleNamesMap[String(role.name).toLowerCase().trim()] = lvl;
        }
        if (role.description) {
            roleNamesMap[String(role.description).toLowerCase().trim()] = lvl;
        }
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
            return 0;
        }
        if (typeof input === 'number') {
            return isNaN(input) ? 0 : input;
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
            return 0;
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
            if (input.isAdmin === true) {
                return 1;
            }
        }
        return 0;
    }

    /**
     * Determines whether the given user or level is an administrator (level === 1).
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function isAdmin(userOrLevel) {
        return resolveLevel(userOrLevel) === 1;
    }

    /**
     * Determines whether the given user or level is a standard user.
     * Standard users do not display a special role description on hover.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function isStandardUser(userOrLevel) {
        var lvl = resolveLevel(userOrLevel);
        var role = rolesMap[lvl];
        if (role && typeof role.isStandard === 'boolean') {
            return role.isStandard;
        }
        return lvl === 0;
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
            description: 'דרגה ' + lvl,
            isStandard: (lvl === 0),
            badgeClass: 'badge-role-user',
            gradientClass: null
        };
    }

    /**
     * Returns the role description (permission description) to display on hover.
     * Returns an empty string for standard users.
     * @param {*} userOrLevel
     * @returns {string}
     */
    function getRoleDescription(userOrLevel) {
        if (isStandardUser(userOrLevel)) {
            return '';
        }
        var role = getRole(userOrLevel);
        return (role && role.description) ? role.description : '';
    }

    /**
     * Checks if the user is a non-standard user with a description to display.
     * @param {*} userOrLevel
     * @returns {boolean}
     */
    function hasRoleDescription(userOrLevel) {
        return !isStandardUser(userOrLevel) && Boolean(getRoleDescription(userOrLevel));
    }

    /**
     * Modular DOM helper: applies role hover attributes (title / Bootstrap tooltip)
     * and optional visual styling to an element displaying a user's name.
     *
     * When hovering over a user's name:
     * - If the user is NOT a standard user, their role description is displayed on hover.
     * - If the user IS a standard user, any existing role hover tooltip is cleared.
     *
     * @param {jQuery|HTMLElement} element
     * @param {*} userOrLevel
     * @param {Object} [options]
     * @param {boolean} [options.initTooltip=true] - Whether to initialize Bootstrap tooltip.
     * @param {string} [options.placement='top'] - Tooltip placement.
     * @param {boolean} [options.applyGradient=true] - Whether to apply role's gradientClass.
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
        var applyGradient = (options.applyGradient !== false);
        var showNameTag = (options.showNameTag !== false);

        var lvl = resolveLevel(userOrLevel);
        var role = getRole(lvl);
        var desc = getRoleDescription(userOrLevel);

        // Clear existing role name tags attached to this element
        $el.find('.role-name-tag').remove();
        // Clear previous gradient classes
        $el.removeClass('admin-golden-gradient role-atmosphere-gradient');

        if (desc) {
            // Non-standard user: set role description on hover
            $el.attr('title', desc);
            $el.attr('data-toggle', 'tooltip');
            $el.attr('data-placement', placement);
            $el.attr('data-role-level', lvl);

            if (applyGradient && role.gradientClass) {
                $el.addClass(role.gradientClass);
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
     * @param {firebase.firestore.Firestore} db
     * @returns {Promise<Object>}
     */
    function loadFromFirestore(db) {
        if (!db || typeof db.collection !== 'function') {
            return Promise.resolve(rolesMap);
        }
        return db.collection('permissionLevels').get()
            .then(function (snapshot) {
                if (snapshot && !snapshot.empty) {
                    snapshot.forEach(function (doc) {
                        var data = doc.data() || {};
                        var lvl = (typeof data.level === 'number') ? data.level : parseInt(doc.id, 10);
                        if (!isNaN(lvl)) {
                            registerRole({
                                level: lvl,
                                name: data.name || (lvl === 0 ? 'user' : (lvl === 1 ? 'admin' : (lvl === 2 ? 'atmosphere' : 'role_' + lvl))),
                                description: data.description || (lvl === 0 ? 'משתמש רגיל' : (lvl === 1 ? 'מנהל מערכת' : (lvl === 2 ? 'א. אווירה' : 'דרגה ' + lvl))),
                                isStandard: (typeof data.isStandard === 'boolean') ? data.isStandard : (lvl === 0),
                                badgeClass: data.badgeClass || (lvl === 1 ? 'badge-role-admin' : (lvl === 2 ? 'badge-role-atmosphere' : 'badge-role-user')),
                                gradientClass: data.gradientClass || (lvl === 1 ? 'admin-golden-gradient' : (lvl === 2 ? 'role-atmosphere-gradient' : null)),
                                hasNameTag: Boolean(data.hasNameTag),
                                nameTagText: data.nameTagText || ''
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
     * Returns an immutable copy of all registered roles.
     * @returns {Object}
     */
    function getAllRoles() {
        return $.extend(true, {}, rolesMap);
    }

    return {
        registerRole: registerRole,
        resolveLevel: resolveLevel,
        isStandardUser: isStandardUser,
        isAdmin: isAdmin,
        getRole: getRole,
        getRoleDescription: getRoleDescription,
        hasRoleDescription: hasRoleDescription,
        applyRoleHover: applyRoleHover,
        loadFromFirestore: loadFromFirestore,
        getAllRoles: getAllRoles
    };
})();

if (typeof window !== 'undefined') {
    window.RoleManager = RoleManager;
}
