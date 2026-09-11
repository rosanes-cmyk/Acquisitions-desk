/**
 * AdminService.js - the Admin tab (5.8): users, settings, audit, errors (4.10).
 *
 * This tab exists because rule 1.2 says every job must be doable from the
 * dashboard. Without it an admin would be editing the raw Sheet, which rule
 * 3.2.9 forbids (finding A4).
 *
 * Nobody is ever deleted. A user is deactivated (rule 1.6).
 */

/** Each setting says how it is validated, so a typo cannot break the app. */
var SETTING_SPECS_ = {
  monthly_deal_target: { type: 'number', min: 0, managerMayEdit: true },
  monthly_marketing_budget: { type: 'number', min: 0, managerMayEdit: true },
  mao_percentage: { type: 'number', min: 1, max: 100 },
  stale_lead_days: { type: 'number', min: 1, max: 365 },
  business_timezone: { type: 'timezone' },
  auto_refresh_seconds: { type: 'number', min: 10, max: 600 },
  app_version: { type: 'text' },
  live_list_target: { type: 'number', min: 1 },
  team_queues: { type: 'text' },
  rep_sees_all_leads: { type: 'boolean' },
  backup_retention_days: { type: 'number', min: 7, max: 3650 },
  schema_version: { type: 'readonly' }
};

/** Offered in the Admin tab's timezone picker (5.8 "timezone from a list"). */
var ALLOWED_TIMEZONES_ = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix',
  'America/Chicago', 'America/New_York', 'America/Mexico_City', 'Asia/Manila', 'UTC'];

/* ------------------------------------------------------------------ users */

function getUsers_(ctx) {
  requireCapability_(ctx, 'manageUsers', 'manage users');
  return readAll_(SHEET_NAMES_.USERS).map(function (user) {
    return {
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      team: user.team,
      role: normalizeRole_(user.role),
      active: toBool_(user.active),
      permission_level: user.permission_level,
      needs_email: !normalizeEmail_(user.email),
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  });
}

function validateUserFields_(data, options) {
  var opts = options || {};
  var clean = {
    name: requireText_('name', data.name, { required: !opts.partial }),
    email: normalizeEmail_(requireText_('email', data.email)),
    team: trimString_(data.team).toUpperCase(),
    role: requireEnum_('role', data.role || ROLE_REP_, ROLES_)
  };

  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) {
    throw validationError_('email', 'That does not look like an email address.');
  }
  if (clean.team && teamQueues_().indexOf(clean.team) < 0) {
    throw validationError_('team', 'Team must be one of: ' + teamQueues_().join(', ') + '.');
  }
  return clean;
}

function createUser_(ctx, payload) {
  requireCapability_(ctx, 'manageUsers', 'add users');
  var data = payload.data || payload;
  var clean = validateUserFields_(data);
  var active = data.active === undefined ? false : requireBoolean_('active', data.active);

  return withLock_(function () {
    if (clean.email && findUserByEmail_(clean.email)) {
      throw duplicateError_('That email already has an account.', { email: clean.email });
    }

    var nowIso = nowIsoUtc_();
    var row = {
      user_id: newUniqueId_(ID_PREFIX_.USER, compactStamp_(nowIso)),
      name: clean.name,
      email: clean.email,
      team: clean.team,
      role: clean.role,
      active: active && !!clean.email,
      permission_level: clean.email ? '' : 'needs_email',
      created_at: nowIso,
      updated_at: nowIso
    };
    appendRow_(SHEET_NAMES_.USERS, row, columnKinds_(SHEET_NAMES_.USERS));
    commitAndStamp_();

    auditSafely_(ctx.user_id, ctx.email, 'USER_CREATED', 'user', row.user_id,
      clean.name + ' <' + (clean.email || 'no email') + '> ' + clean.role);
    return row;
  });
}

function updateUser_(ctx, payload) {
  requireCapability_(ctx, 'manageUsers', 'edit users');
  var data = payload.data || payload;
  var clean = validateUserFields_(data, { partial: true });

  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.USERS, 'user_id', payload.userId);
    if (!found) throw notFoundError_('user', payload.userId);

    if (clean.email) {
      var other = findUserByEmail_(clean.email);
      if (other && String(other.user_id) !== String(payload.userId)) {
        throw duplicateError_('Another account already uses that email.', { email: clean.email });
      }
    }

    var patch = {
      name: clean.name || found.record.name,
      email: clean.email,
      team: clean.team,
      role: clean.role,
      permission_level: clean.email ? '' : 'needs_email',
      updated_at: nowIsoUtc_()
    };
    if (data.active !== undefined) {
      // An account with no email can never be active: identity is the email.
      patch.active = requireBoolean_('active', data.active) && !!clean.email;
    }

    writeRowCells_(SHEET_NAMES_.USERS, found.rowIndex, patch, columnKinds_(SHEET_NAMES_.USERS));
    commitAndStamp_();

    auditSafely_(ctx.user_id, ctx.email, 'USER_UPDATED', 'user', payload.userId,
      Object.keys(patch).join(', '));
    return findRowById_(SHEET_NAMES_.USERS, 'user_id', payload.userId).record;
  });
}

/** Deactivate, never delete (rule 1.6). History keeps pointing at a real person. */
function disableUser_(ctx, payload) {
  requireCapability_(ctx, 'manageUsers', 'deactivate users');

  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.USERS, 'user_id', payload.userId);
    if (!found) throw notFoundError_('user', payload.userId);

    if (String(found.record.user_id) === ctx.user_id) {
      throw validationError_('userId',
        'You cannot deactivate your own account - another admin must do it.');
    }
    if (normalizeRole_(found.record.role) === ROLE_ADMIN_ && countActiveAdmins_() <= 1) {
      throw validationError_('userId',
        'That is the last active admin. Make someone else an admin first.');
    }

    writeRowCells_(SHEET_NAMES_.USERS, found.rowIndex,
      { active: false, updated_at: nowIsoUtc_() }, columnKinds_(SHEET_NAMES_.USERS));
    commitAndStamp_();

    auditSafely_(ctx.user_id, ctx.email, 'USER_DEACTIVATED', 'user', payload.userId,
      String(found.record.email || ''));
    return { user_id: payload.userId, active: false };
  });
}

function countActiveAdmins_() {
  return readAll_(SHEET_NAMES_.USERS).filter(function (user) {
    return toBool_(user.active) && normalizeRole_(user.role) === ROLE_ADMIN_;
  }).length;
}

/* --------------------------------------------------------------- settings */

function getSettings_(ctx) {
  requireCapability_(ctx, 'manageSettings', 'see the settings');
  var map = settingsMap_();
  return {
    settings: Object.keys(SETTING_SPECS_).map(function (key) {
      return {
        setting_key: key,
        setting_value: map[key] === undefined ? '' : map[key],
        type: SETTING_SPECS_[key].type,
        editable: SETTING_SPECS_[key].type !== 'readonly'
      };
    }),
    allowedTimezones: ALLOWED_TIMEZONES_
  };
}

/**
 * saveSetting {key, value} - ADMIN, except the two targets a MANAGER owns (4.10).
 */
function saveSetting_(ctx, payload) {
  var key = trimString_(payload.key);
  var spec = SETTING_SPECS_[key];
  if (!spec) throw validationError_('key', 'There is no setting called "' + key + '".');
  if (spec.type === 'readonly') {
    throw validationError_('key', key + ' is maintained by setupDatabase(), not by hand.');
  }

  var mayEdit = can_(ctx, 'manageSettings') ||
    (spec.managerMayEdit && can_(ctx, 'saveTargets'));
  if (!mayEdit) {
    throw accessError_('ACCESS_DENIED', 'Your role cannot change ' + key + '.');
  }

  var value = validateSettingValue_(key, spec, payload.value);

  return withLock_(function () {
    var previous = settingText_(key, '');
    setSetting_(key, value, ctx.user_id);
    commitAndStamp_();
    auditSafely_(ctx.user_id, ctx.email, 'SETTING_CHANGED', 'setting', key,
      previous + ' -> ' + value);
    return { setting_key: key, setting_value: value };
  });
}

function validateSettingValue_(key, spec, rawValue) {
  if (spec.type === 'number') {
    var number = toNumberOrNull_(rawValue);
    if (number === null) throw validationError_(key, key + ' must be a number.');
    if (spec.min !== undefined && number < spec.min) {
      throw validationError_(key, key + ' cannot be below ' + spec.min + '.');
    }
    if (spec.max !== undefined && number > spec.max) {
      throw validationError_(key, key + ' cannot be above ' + spec.max + '.');
    }
    return String(number);
  }
  if (spec.type === 'boolean') {
    return toBool_(rawValue) ? 'TRUE' : 'FALSE';
  }
  if (spec.type === 'timezone') {
    return requireEnum_(key, trimString_(rawValue), ALLOWED_TIMEZONES_);
  }
  return requireText_(key, rawValue, { max: 500 });
}

/** Targets and budget, saved together from the Numbers tab (5.8). */
function saveTargets_(ctx, payload) {
  requireCapability_(ctx, 'saveTargets', 'save targets');
  var saved = {};
  if (payload.monthly_deal_target !== undefined) {
    saved.monthly_deal_target = saveSetting_(ctx,
      { key: 'monthly_deal_target', value: payload.monthly_deal_target }).setting_value;
  }
  if (payload.monthly_marketing_budget !== undefined) {
    saved.monthly_marketing_budget = saveSetting_(ctx,
      { key: 'monthly_marketing_budget', value: payload.monthly_marketing_budget }).setting_value;
  }
  if (!Object.keys(saved).length) throw validationError_('payload', 'There was nothing to save.');
  return saved;
}

/* ------------------------------------------------------------------- logs */

function getAuditLog_(ctx, payload) {
  requireCapability_(ctx, 'viewAuditLog', 'read the audit log');
  var limit = Math.min(500, Math.max(1, toNumberOrNull_(payload && payload.limit) || 200));
  return readAll_(SHEET_NAMES_.AUDIT_LOG).slice(-limit).reverse();
}

function getErrorLog_(ctx, payload) {
  requireCapability_(ctx, 'viewErrorLog', 'read the error log');
  var limit = Math.min(500, Math.max(1, toNumberOrNull_(payload && payload.limit) || 200));
  return readAll_(SHEET_NAMES_.ERROR_LOG).slice(-limit).reverse();
}
