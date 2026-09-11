/**
 * Code.js - doGet, the include helper, and api(): the ONE client entry point.
 *
 * THE RULE THIS FILE EXISTS FOR (4.2, rule 1.11): in Apps Script every top-level
 * function is callable from the browser via google.script.run by anyone who can
 * open the web app. So there is exactly one callable action surface - api() -
 * driven by a whitelist. Everything else in the project ends in "_", and
 * tools/check-globals.js fails the build if that ever stops being true.
 */

/* -------------------------------------------------------------- the web app */

/**
 * Serves the app, or the Access page when identity cannot be resolved (5.1).
 * HtmlService ignores <meta> tags inside the HTML, so the viewport tag is added
 * here - without it the mobile layout silently fails (B5).
 */
function doGet(e) {
  try {
    // Resolve identity BEFORE rendering: an unknown or inactive account must get
    // the Access page, never the board (4.3).
    getCurrentUser_();
    return HtmlService.createTemplateFromFile('Index').evaluate()
      .setTitle('THB Acquisitions Desk')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return accessPage_(err);
  }
}

/**
 * The Access page shows the email Google actually reported, because "it does not
 * work" is almost always "you are signed into the wrong Google account" (4.3).
 */
function accessPage_(err) {
  var template = HtmlService.createTemplateFromFile('Access');
  template.detectedEmail = activeUserEmail_() || 'none';
  template.reason = err && err.code ? err.code : 'ACCESS_DENIED';
  template.message = err && err.message ? err.message : 'This account cannot open the desk.';
  return template.evaluate()
    .setTitle('THB Acquisitions Desk')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Inlines Styles.html / Scripts.html into Index.html (5.1). */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* --------------------------------------------------------- action registry */

/**
 * Every action the browser may invoke, with the capability it needs. An action
 * that is not in this table does not exist as far as the client is concerned.
 *
 * `role: null` means "any authenticated, active user" - the service still applies
 * its own record-level checks.
 */
function actionRegistry_() {
  return {
    // AUTH / BOOTSTRAP
    bootstrap: { fn: bootstrap_, role: null },
    getChangeStamp: { fn: getChangeStampAction_, role: null, cheap: true },

    // LEADS
    listLeads: { fn: listLeads_, role: null },
    getLead: { fn: getLead_, role: null },
    getLeadActivity: { fn: getLeadActivity_, role: null },
    createLead: { fn: createLead_, role: 'createLead' },
    addBulkLeads: { fn: addBulkLeads_, role: 'bulkImport' },
    updateLead: { fn: updateLead_, role: 'editLead' },
    assignLead: { fn: assignLead_, role: 'assignLead' },
    logAttempt: { fn: logAttempt_, role: 'logAttempt' },
    addLeadNote: { fn: addLeadNote_, role: 'addNote' },
    setNextAction: { fn: setNextAction_, role: 'setNextAction' },
    completeNextAction: { fn: completeNextAction_, role: 'setNextAction' },
    setJuanFlag: { fn: setJuanFlag_, role: 'setJuanFlag' },
    setComplianceFlag: { fn: setComplianceFlag_, role: null }, // on/off checked in the service
    archiveLead: { fn: archiveLead_, role: 'archiveLead' },
    restoreLead: { fn: restoreLead_, role: 'restoreLead' },

    // APPOINTMENTS
    listAppointments: { fn: listAppointments_, role: null },

    // DASHBOARD
    getTodayDashboard: { fn: getTodayDashboard_, role: null },
    getWorkQueue: { fn: getWorkQueue_, role: null },
    getRepSnapshot: { fn: getRepSnapshot_, role: 'viewRepSnapshot' },
    getJuanDashboard: { fn: getJuanDashboard_, role: 'viewJuanDashboard' },

    // METRICS
    getDailyMetrics: { fn: getDailyMetrics_, role: null },
    saveDailyMetrics: { fn: saveDailyMetrics_, role: 'saveDailyMetrics' },
    getNumbersDashboard: { fn: getNumbersDashboard_, role: null },
    saveTargets: { fn: saveTargets_, role: 'saveTargets' },

    // TOOLS
    getTools: { fn: getTools_, role: null },
    createTool: { fn: createTool_, role: 'editTools' },
    updateTool: { fn: updateTool_, role: 'editTools' },
    setToolTraining: { fn: setToolTraining_, role: 'editTools' },
    logToolRun: { fn: logToolRun_, role: 'markToolRun' },
    voidToolRun: { fn: voidToolRun_, role: 'markToolRun' },
    getRunsToday: { fn: getRunsToday_, role: null },
    setPillarState: { fn: setPillarState_, role: 'editTools' },
    setBuilderAsked: { fn: setBuilderAsked_, role: 'editTools' },

    // SETTINGS
    getSettings: { fn: getSettings_, role: 'manageSettings' },
    saveSetting: { fn: saveSetting_, role: null }, // per-key check in the service

    // ADMIN
    getUsers: { fn: getUsers_, role: 'manageUsers' },
    createUser: { fn: createUser_, role: 'manageUsers' },
    updateUser: { fn: updateUser_, role: 'manageUsers' },
    disableUser: { fn: disableUser_, role: 'manageUsers' },
    getAuditLog: { fn: getAuditLog_, role: 'viewAuditLog' },
    getErrorLog: { fn: getErrorLog_, role: 'viewErrorLog' },
    getBackups: { fn: getBackups_, role: 'viewBackups' },
    runBackupNow: { fn: runBackupNow_, role: 'runBackupNow' },
    runSelfTests: { fn: runSelfTestsAction_, role: 'runSelfTests' }
    // There is no generic write action, and no delete action for any role.
  };
}

/* ------------------------------------------------------------------- api() */

/**
 * THE ONLY CLIENT ENTRY POINT (4.2.1).
 *
 * Resolves the user, rejects unknown actions, checks the capability, calls the
 * service with an explicit ctx, and ALWAYS returns the standard envelope. It
 * never throws to the client: an unexpected error becomes SERVER_ERROR with a
 * short human message, and the detail goes to ERROR_LOG.
 */
function api(action, payload) {
  var actionName = String(action || '');
  var ctx = null;

  try {
    var registry = actionRegistry_();
    var definition = registry[actionName];
    if (!definition) {
      return errEnvelope_('VALIDATION_ERROR', 'Unknown action: ' + actionName);
    }

    ctx = getCurrentUser_();

    if (definition.role) {
      requireCapability_(ctx, definition.role, actionName);
    }

    // The client never sends identity. Any user field in the payload is dropped
    // and replaced from ctx, so nobody can act as somebody else (4.3).
    var safePayload = stripIdentityFields_(payload);

    var data = definition.fn(ctx, safePayload);
    return okEnvelope_(data, {
      changeStamp: changeStamp_(),
      serverTimeUtc: nowIsoUtc_()
    });
  } catch (err) {
    return handleApiError_(actionName, ctx, err);
  }
}

/**
 * Keys a payload may never carry, because each one reads as a claim about WHO IS
 * CALLING. The server already resolved that from the Google session (4.3), so
 * these are dropped before any service sees them.
 *
 * `userId` is deliberately NOT here. In 4.10 it names the person being acted ON -
 * the trainee in setToolTraining, the account in updateUser and disableUser - not
 * the caller. Those services validate it against USERS, which is the real control.
 * The guarantee that matters is structural: ctx is built only by getCurrentUser_,
 * and no service reads identity out of a payload.
 */
var CALLER_IDENTITY_KEYS_ = ['user', 'user_id', 'user_name', 'user_email', 'users', 'email',
  'role', 'ctx', 'context', 'me', 'identity', 'session', 'actingUser', 'acting_user',
  'currentUser', 'current_user'];

/** Strips the caller-identity keys above. Nobody can act as somebody else. */
function stripIdentityFields_(payload) {
  var source = payload || {};
  if (typeof source !== 'object') return {};
  var safe = {};
  for (var key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (CALLER_IDENTITY_KEYS_.indexOf(key) >= 0) continue;
    safe[key] = source[key];
  }
  return safe;
}

function handleApiError_(actionName, ctx, err) {
  var code = err && err.code ? err.code : '';

  if (code === 'IDENTITY_UNAVAILABLE' || code === 'ACCESS_DENIED' || code === 'NOT_FOUND' ||
    code === 'VALIDATION_ERROR' || code === 'LOCK_TIMEOUT') {
    return errEnvelope_(code, err.message, err.field ? { field: err.field } : err.data);
  }
  if (code === 'CONFLICT_RECORD_CHANGED' || code === 'DUPLICATE') {
    return errEnvelope_(code, err.message, err.data);
  }

  // Anything else is a bug. The client gets a short sentence; the stack goes to
  // ERROR_LOG, where it carries no seller data beyond the entity id (4.12).
  errorLog_(ctx ? ctx.user_id : '', actionName, 'action', '', err, '');
  return errEnvelope_('SERVER_ERROR',
    'Something went wrong saving that. The problem has been logged - try again, and tell an ' +
    'admin if it keeps happening.');
}

/* ----------------------------------------------------------- api handlers */

/**
 * bootstrap - everything the first paint needs, in one call (4.7).
 * Emails are included only for admins; everyone else gets names and roles.
 */
function bootstrap_(ctx) {
  var isAdmin = can_(ctx, 'manageUsers');
  var users = readAll_(SHEET_NAMES_.USERS)
    .filter(function (user) { return toBool_(user.active); })
    .map(function (user) {
      var entry = {
        user_id: user.user_id,
        name: user.name,
        team: user.team,
        role: normalizeRole_(user.role)
      };
      if (isAdmin) entry.email = user.email;
      return entry;
    })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  return {
    user: { user_id: ctx.user_id, name: ctx.name, email: ctx.email, role: ctx.role,
      team: ctx.team },
    permissions: permissionsForClient_(ctx),
    settings: publicSettings_(),
    businessToday: businessToday_(),
    timezone: businessTimezone_(),
    appVersion: settingText_('app_version', '1.0.0'),
    changeStamp: changeStamp_(),
    users: users,
    teamQueues: teamQueues_(),
    env: env_(),
    enums: clientEnums_()
  };
}

/** The settings the UI needs to render correctly. No secrets live in SETTINGS. */
function publicSettings_() {
  return {
    mao_percentage: settingNumber_('mao_percentage', 70),
    stale_lead_days: settingNumber_('stale_lead_days', 7),
    auto_refresh_seconds: settingNumber_('auto_refresh_seconds', 30),
    live_list_target: settingNumber_('live_list_target', 200),
    monthly_deal_target: settingNumber_('monthly_deal_target', 3),
    monthly_marketing_budget: settingNumber_('monthly_marketing_budget', 0),
    rep_sees_all_leads: settingBool_('rep_sees_all_leads', true)
  };
}

/** Enumerations are served from the server so the UI can never invent a label. */
function clientEnums_() {
  return {
    statuses: ALL_STATUSES_.map(function (status) {
      return { value: status, label: STATUS_LABELS_[status], live: isLiveStatus_(status),
        archived: isArchivedStatus_(status) };
    }),
    appointmentOutcomes: APPOINTMENT_OUTCOMES_,
    toolStatuses: TOOL_STATUSES_,
    toolRecommendations: TOOL_RECOMMENDATIONS_,
    cadences: CADENCES_,
    verdicts: VERDICTS_,
    pillarStates: PILLAR_STATES_,
    channels: CHANNELS_,
    roles: ROLES_
  };
}

/** The cheap poll (4.10). Reads Script Properties only - it touches no sheet. */
function getChangeStampAction_(ctx) {
  return { changeStamp: changeStamp_(), businessToday: businessToday_() };
}

/** The Admin tab's Run self-tests button. DEV only, enforced in Tests.js. */
function runSelfTestsAction_(ctx) {
  return runSelfTestsInternal_(ctx);
}
