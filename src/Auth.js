/**
 * Auth.js - who is calling, and what they are allowed to do (4.3).
 *
 * Identity is the signed-in Google Workspace account, resolved server-side, and
 * nothing else. There is no identity dropdown, no client-supplied user field and
 * no fallback to self-selection, so nobody can act as Juan or anyone else
 * (rule 1.5).
 */

var ROLE_ADMIN_ = 'ADMIN';
var ROLE_MANAGER_ = 'MANAGER';
var ROLE_REP_ = 'REP';
var ROLE_TECHNICAL_ = 'TECHNICAL';

var ALL_ROLES_ = [ROLE_ADMIN_, ROLE_MANAGER_, ROLE_REP_, ROLE_TECHNICAL_];
var MANAGER_UP_ = [ROLE_ADMIN_, ROLE_MANAGER_];

/** The permission matrix from 4.3, as data. G4 and G5 adjust the two noted below. */
var CAPABILITIES_ = {
  openApp: ALL_ROLES_,
  createLead: ALL_ROLES_,
  bulkImport: ALL_ROLES_,
  editLead: ALL_ROLES_,
  logAttempt: ALL_ROLES_,
  addNote: ALL_ROLES_,
  setNextAction: ALL_ROLES_,
  setJuanFlag: ALL_ROLES_,
  setComplianceFlag: ALL_ROLES_,          // setting it is open to everyone...
  clearComplianceFlag: MANAGER_UP_,       // ...clearing it is not (6.2)
  archiveLead: ALL_ROLES_,
  restoreLead: MANAGER_UP_,
  assignLead: ALL_ROLES_,                 // scope checked per record (G5)
  assignAnyLead: MANAGER_UP_,
  saveDailyMetrics: ALL_ROLES_,
  saveTargets: MANAGER_UP_,
  viewTools: ALL_ROLES_,
  editTools: [ROLE_ADMIN_, ROLE_MANAGER_, ROLE_TECHNICAL_],
  markToolRun: ALL_ROLES_,
  viewTeamActivity: ALL_ROLES_,
  viewRepSnapshot: MANAGER_UP_,
  viewJuanDashboard: MANAGER_UP_,
  manageUsers: [ROLE_ADMIN_],
  manageSettings: [ROLE_ADMIN_],
  viewAuditLog: [ROLE_ADMIN_],
  viewErrorLog: [ROLE_ADMIN_, ROLE_TECHNICAL_],
  viewBackups: [ROLE_ADMIN_, ROLE_TECHNICAL_],
  runBackupNow: [ROLE_ADMIN_],
  runSelfTests: [ROLE_ADMIN_]
  // Permanent delete is absent on purpose: nobody, in any role (rule 1.6).
};

function accessError_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

/* --------------------------------------------------------------- identity */

/**
 * The signed-in account's email, lower-cased and trimmed.
 *
 * Session.getActiveUser() - NEVER getEffectiveUser(). Under the required
 * deployment mode (executeAs: USER_DEPLOYING) the EFFECTIVE user is the owner
 * for every single browser call, so any check written against it would pass for
 * every rep on the team. This is finding B1a.
 */
function activeUserEmail_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (err) {
    email = '';
  }
  return normalizeEmail_(email);
}

/**
 * Resolves the caller against USERS (4.3).
 * @return {{user_id:string, name:string, email:string, role:string, team:string}}
 * @throws IDENTITY_UNAVAILABLE | ACCESS_DENIED
 */
function getCurrentUser_() {
  var email = activeUserEmail_();

  if (!email) {
    auditSafely_('', '', 'IDENTITY_UNAVAILABLE', 'user', '',
      'Google returned no email for the caller.');
    throw accessError_('IDENTITY_UNAVAILABLE',
      'We could not confirm which Google account you are signed in with. Open the desk with your ' +
      'company account.');
  }

  var found = findUserByEmail_(email);

  if (!found) {
    auditSafely_('', email, 'ACCESS_DENIED', 'user', '', 'Email not in USERS: ' + email);
    throw accessError_('ACCESS_DENIED',
      'This Google account is not set up for the Acquisitions Desk yet.');
  }

  if (!toBool_(found.active)) {
    auditSafely_(found.user_id, email, 'ACCESS_DENIED', 'user', found.user_id,
      'Inactive user attempted access.');
    throw accessError_('ACCESS_DENIED', 'This account has been deactivated.');
  }

  var ctx = {
    user_id: String(found.user_id),
    name: String(found.name || ''),
    email: email,
    role: normalizeRole_(found.role),
    team: String(found.team || '')
  };
  noteLoginOncePerDay_(ctx);
  return ctx;
}

function normalizeRole_(role) {
  var value = String(role || '').trim().toUpperCase();
  return ALL_ROLES_.indexOf(value) >= 0 ? value : ROLE_REP_;
}

/** Email is compared lower-cased and trimmed on both sides (3.3 USERS). */
function findUserByEmail_(email) {
  var wanted = normalizeEmail_(email);
  if (!wanted) return null;
  var users = readAll_(SHEET_NAMES_.USERS);
  for (var i = 0; i < users.length; i++) {
    if (normalizeEmail_(users[i].email) === wanted) return users[i];
  }
  return null;
}

function findUserById_(userId) {
  var wanted = String(userId || '');
  if (!wanted) return null;
  var users = readAll_(SHEET_NAMES_.USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].user_id) === wanted) return users[i];
  }
  return null;
}

/**
 * One LOGIN row per user per business day (3.3 AUDIT_LOG). The marker lives in
 * Script Properties rather than the sheet, so the check costs no sheet read.
 */
function noteLoginOncePerDay_(ctx) {
  var today = businessToday_();
  var marks = {};
  try {
    marks = JSON.parse(getProp_('LOGIN_MARKS', '{}')) || {};
  } catch (err) {
    marks = {};
  }
  if (marks[ctx.email] === today) return;

  // Drop yesterday's marks so the property cannot grow without bound.
  var fresh = {};
  for (var email in marks) {
    if (marks[email] === today) fresh[email] = today;
  }
  fresh[ctx.email] = today;
  setProp_('LOGIN_MARKS', JSON.stringify(fresh));

  auditSafely_(ctx.user_id, ctx.email, 'LOGIN', 'user', ctx.user_id, 'Opened the desk.');
}

/** Audit writes must never be the reason an action fails. */
function auditSafely_(userId, email, action, entityType, entityId, details) {
  try {
    auditLog_(userId, email, action, entityType, entityId, details);
  } catch (err) {
    // Swallowed on purpose: a failed audit write must not deny a legitimate user,
    // and during ACCESS_DENIED the sheet may be exactly what is unreachable.
  }
}

/* ------------------------------------------------------------ authorization */

function hasRole_(ctx, roles) {
  return !!ctx && roles.indexOf(ctx.role) >= 0;
}

/** @return {boolean} whether this role may perform this capability. */
function can_(ctx, capability) {
  var allowed = CAPABILITIES_[capability];
  if (!allowed) return false;
  return hasRole_(ctx, allowed);
}

function requireCapability_(ctx, capability, what) {
  if (!can_(ctx, capability)) {
    throw accessError_('ACCESS_DENIED',
      'Your role (' + ctx.role + ') cannot ' + (what || capability) + '.');
  }
}

/**
 * Guard for the five editor-run admin globals (4.2.3).
 *
 * It resolves the ACTIVE user against USERS. When the owner runs the function
 * from the Apps Script editor, the active user IS the owner, who is an active
 * ADMIN, so the same guard works in both places - while a rep calling it from
 * the browser console is refused.
 */
function requireRole_(role) {
  var ctx = getCurrentUser_();
  if (role === ROLE_ADMIN_ && ctx.role !== ROLE_ADMIN_) {
    throw accessError_('ACCESS_DENIED',
      'Only an ADMIN in the USERS sheet can run this. You are ' + ctx.role + '.');
  }
  return ctx;
}

/* ----------------------------------------------------- record-level checks */

/** Team queue token for a team code, e.g. 'MX' -> 'TEAM:MX' (G3). */
function teamQueue_(teamCode) {
  return 'TEAM:' + String(teamCode || '').toUpperCase();
}

function isTeamQueue_(assignee) {
  return /^TEAM:[A-Z0-9_-]+$/.test(String(assignee || ''));
}

function teamQueues_() {
  return settingText_('team_queues', 'MX,PH,CA')
    .split(',')
    .map(function (code) { return String(code).trim().toUpperCase(); })
    .filter(function (code) { return !!code; });
}

/**
 * G5. MANAGER+ may reassign anything. A REP may claim an unassigned lead and
 * reassign one that is already theirs or their team's - never one belonging to
 * another rep.
 */
function canReassign_(ctx, lead) {
  if (can_(ctx, 'assignAnyLead')) return true;
  var current = String(lead.assigned_to || '');
  if (!current) return true;
  if (current === ctx.user_id) return true;
  return !!ctx.team && current === teamQueue_(ctx.team);
}

/**
 * G4. The default is the prototype rule: everyone sees the same board. When
 * rep_sees_all_leads is FALSE a REP sees only their own, their team's, and
 * unassigned leads - enforced here on the server, never in the browser.
 */
function canSeeLead_(ctx, lead) {
  if (settingBool_('rep_sees_all_leads', true)) return true;
  if (hasRole_(ctx, MANAGER_UP_)) return true;
  var assignee = String(lead.assigned_to || '');
  if (!assignee) return true;
  if (assignee === ctx.user_id) return true;
  return !!ctx.team && assignee === teamQueue_(ctx.team);
}

function filterVisibleLeads_(ctx, leads) {
  if (settingBool_('rep_sees_all_leads', true) || hasRole_(ctx, MANAGER_UP_)) return leads;
  return leads.filter(function (lead) { return canSeeLead_(ctx, lead); });
}

/**
 * What the client may show. The UI hides what a role cannot do; the server
 * refuses it regardless, so this is a convenience and never the control (4.3).
 */
function permissionsForClient_(ctx) {
  var permissions = {};
  for (var capability in CAPABILITIES_) {
    if (Object.prototype.hasOwnProperty.call(CAPABILITIES_, capability)) {
      permissions[capability] = can_(ctx, capability);
    }
  }
  return permissions;
}
