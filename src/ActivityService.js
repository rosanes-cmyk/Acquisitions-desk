/**
 * ActivityService.js - the activity engine (4.11) and the two system logs (4.12).
 *
 * Activity is automatic (rule 1.10). Every meaningful action writes one typed
 * LEAD_ACTIVITY row as part of the same locked write that changed the record, so
 * nobody ever compiles a separate activity report - Juan just opens the app.
 *
 * These sheets are append-only. Nothing here rewrites or deletes a row.
 */

/** action_type values (3.3 LEAD_ACTIVITY). */
var ACTION_ = {
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_IMPORTED: 'LEAD_IMPORTED',
  CALL_ATTEMPT: 'CALL_ATTEMPT',
  NOTE_ADDED: 'NOTE_ADDED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ASSIGNED: 'ASSIGNED',
  NEXT_ACTION_CHANGED: 'NEXT_ACTION_CHANGED',
  NEXT_ACTION_COMPLETED: 'NEXT_ACTION_COMPLETED',
  DUE_DATE_CHANGED: 'DUE_DATE_CHANGED',
  APPOINTMENT_SET: 'APPOINTMENT_SET',
  APPOINTMENT_UPDATED: 'APPOINTMENT_UPDATED',
  UNDERWRITING_CHANGED: 'UNDERWRITING_CHANGED',
  OFFER_CHANGED: 'OFFER_CHANGED',
  FLAGGED_FOR_JUAN: 'FLAGGED_FOR_JUAN',
  JUAN_FLAG_CLEARED: 'JUAN_FLAG_CLEARED',
  COMPLIANCE_FLAGGED: 'COMPLIANCE_FLAGGED',
  COMPLIANCE_CLEARED: 'COMPLIANCE_CLEARED',
  ARCHIVED: 'ARCHIVED',
  RESTORED: 'RESTORED',
  LEAD_UPDATED: 'LEAD_UPDATED',
  LEAD_DUPLICATE_SUSPECTED: 'LEAD_DUPLICATE_SUSPECTED'
};

var ALL_ACTION_TYPES_ = Object.keys(ACTION_).map(function (key) { return ACTION_[key]; });

/**
 * NOTE: `APPOINTMENT_SET` is BOTH a lead status and an activity action_type
 * (kept from v1, 4.11). Wherever one appears, the surrounding code says which.
 * Here it is always the action_type.
 */

/** The prototype's auto-note wording, preserved verbatim (2.1). */
function autoNoteText_(actionType, value) {
  switch (actionType) {
    case ACTION_.STATUS_CHANGED: return 'Moved to ' + (STATUS_LABELS_[value] || value);
    case ACTION_.APPOINTMENT_UPDATED: return 'Visit outcome: ' + value;
    case ACTION_.DUE_DATE_CHANGED: return 'Next action due ' + value;
    case ACTION_.FLAGGED_FOR_JUAN: return 'Flagged for Juan';
    case ACTION_.JUAN_FLAG_CLEARED: return 'Flag cleared';
    case ACTION_.COMPLIANCE_FLAGGED:
      return 'Seller mentioned a mailer or check. Conversation stopped, routed to Juan.';
    case ACTION_.COMPLIANCE_CLEARED: return 'Mailer note cleared';
    case ACTION_.CALL_ATTEMPT: return 'Contact attempt ' + value;
    case ACTION_.NEXT_ACTION_COMPLETED: return 'Done: ' + value;
    default: return '';
  }
}

/* -------------------------------------------------------- lead activity */

var RECENT_NOTES_LIMIT_ = 4;

/**
 * Builds one LEAD_ACTIVITY row. It is appended by the caller inside the same
 * locked write as the record change (4.5 step 7).
 *
 * @param {!Object} ctx acting user
 * @param {string} leadId
 * @param {string} actionType
 * @param {{field:string=, oldValue:*=, newValue:*=, note:string=,
 *          clientRequestId:string=, businessDate:string=, nowIso:string=}=} options
 */
function buildActivityRow_(ctx, leadId, actionType, options) {
  var opts = options || {};
  var nowIso = opts.nowIso || nowIsoUtc_();
  var businessDate = opts.businessDate || businessToday_();
  return {
    activity_id: newUniqueId_(ID_PREFIX_.ACTIVITY, compactStamp_(nowIso)),
    lead_id: leadId,
    user_id: ctx.user_id,
    user_name: ctx.name,
    user_email: ctx.email,
    business_date: businessDate,
    timestamp_utc: nowIso,
    action_type: actionType,
    field_changed: opts.field === undefined ? '' : String(opts.field),
    old_value: opts.oldValue === undefined || opts.oldValue === null ? '' : String(opts.oldValue),
    new_value: opts.newValue === undefined || opts.newValue === null ? '' : String(opts.newValue),
    note: opts.note === undefined ? '' : String(opts.note),
    client_request_id: opts.clientRequestId === undefined ? '' : String(opts.clientRequestId)
  };
}

/** Appends activity rows in one batch write. */
function appendActivityRows_(rows) {
  return appendRows_(SHEET_NAMES_.LEAD_ACTIVITY, rows,
    columnKinds_(SHEET_NAMES_.LEAD_ACTIVITY));
}

/**
 * The last 4 notes shown on the card, kept denormalized on LEADS so the board
 * never reads LEAD_ACTIVITY (A5 / 4.7). The full thread stays in LEAD_ACTIVITY
 * and is served by getLeadActivity.
 *
 * @param {string} existingJson current recent_notes_json
 * @param {!Array<!Object>} entries new {by, at, text} entries, oldest first
 * @return {string} JSON for the newest RECENT_NOTES_LIMIT_ entries
 */
function appendRecentNotes_(existingJson, entries) {
  var notes = parseRecentNotes_(existingJson);
  for (var i = 0; i < entries.length; i++) notes.push(entries[i]);
  return JSON.stringify(notes.slice(-RECENT_NOTES_LIMIT_));
}

function parseRecentNotes_(json) {
  if (!json) return [];
  try {
    var parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // A hand-edited cell must not break the board.
    return [];
  }
}

function noteEntry_(ctx, text, nowIso) {
  return { by: ctx.name || ctx.email, at: nowIso || nowIsoUtc_(), text: String(text) };
}

/**
 * Turns activity rows into the lead-row fields they imply: recent_notes_json,
 * last_note_at and last_touched_at. Returns {} when nothing carried note text.
 */
function leadTouchPatch_(ctx, lead, activityRows, nowIso) {
  var patch = { last_touched_at: nowIso };
  var entries = [];
  for (var i = 0; i < activityRows.length; i++) {
    if (activityRows[i].note) {
      entries.push(noteEntry_(ctx, activityRows[i].note, activityRows[i].timestamp_utc));
    }
  }
  if (entries.length) {
    patch.recent_notes_json = appendRecentNotes_(lead.recent_notes_json, entries);
    patch.last_note_at = nowIso;
  }
  return patch;
}

/**
 * The full thread for one lead, newest first (4.7). Only read when the user opens
 * "Show history" - never for the board.
 */
function readLeadActivity_(leadId, limit) {
  var wanted = String(leadId);
  var rows = readAll_(SHEET_NAMES_.LEAD_ACTIVITY).filter(function (row) {
    return String(row.lead_id) === wanted;
  });
  rows.sort(function (a, b) {
    return String(b.timestamp_utc).localeCompare(String(a.timestamp_utc));
  });
  return rows.slice(0, limit || 200);
}

/**
 * Today's activity, read by scanning UP from the bottom and stopping at the first
 * earlier business date (4.7). LEAD_ACTIVITY grows fast and is appended in order,
 * so today's rows are always the last ones; this never reads the whole sheet.
 */
function readActivityForDate_(businessDate) {
  var target = sheet_(SHEET_NAMES_.LEAD_ACTIVITY);
  var lastRow = target.getLastRow();
  if (lastRow < 2) return [];

  var headers = headersOf_(target);
  var dateIndex = headers.indexOf('business_date');
  if (dateIndex < 0) return [];

  var wanted = String(businessDate);
  var chunkSize = 500;
  var collected = [];
  var cursor = lastRow;

  while (cursor >= 2) {
    var start = Math.max(2, cursor - chunkSize + 1);
    var values = target.getRange(start, 1, cursor - start + 1, headers.length).getValues();
    var reachedEarlierDate = false;

    for (var i = values.length - 1; i >= 0; i--) {
      var rowDate = String(normalizeCellValue_(values[i][dateIndex]));
      if (rowDate === wanted) {
        collected.push(rowToObject_(headers, values[i]));
      } else if (rowDate && rowDate < wanted) {
        reachedEarlierDate = true;
        break;
      }
    }

    if (reachedEarlierDate) break;
    cursor = start - 1;
  }

  return collected.reverse();
}

/* -------------------------------------------------------- rep snapshot */

/**
 * Per user, for one business date (4.11). This is the Juan view: who worked, what
 * they touched, and what moved - all derived from activity, never from anyone
 * filling in a form.
 *
 * @param {!Array<!Object>} activityRows today's LEAD_ACTIVITY rows
 * @param {!Array<!Object>} leads all leads, for the assigned/overdue columns
 * @param {string} businessDate
 */
function repSnapshot_(activityRows, leads, businessDate) {
  var byUser = {};

  function bucket(userId, name) {
    if (!byUser[userId]) {
      byUser[userId] = {
        user_id: userId,
        name: name || userId,
        leadsTouched: 0,
        attempts: 0,
        notes: 0,
        statusChanges: 0,
        appointmentsSet: 0,
        contracts: 0,
        closes: 0,
        lastActivityAt: '',
        activeAssigned: 0,
        overdueAssigned: 0,
        touchedIds: {},
        appointmentLeadIds: {}
      };
    }
    return byUser[userId];
  }

  for (var i = 0; i < activityRows.length; i++) {
    var row = activityRows[i];
    var user = bucket(String(row.user_id), String(row.user_name));

    if (row.lead_id && !user.touchedIds[row.lead_id]) {
      user.touchedIds[row.lead_id] = true;
      user.leadsTouched++;
    }
    if (row.action_type === ACTION_.CALL_ATTEMPT) user.attempts++;
    if (row.action_type === ACTION_.NOTE_ADDED) user.notes++;
    if (row.action_type === ACTION_.STATUS_CHANGED) {
      user.statusChanges++;
      if (row.new_value === STATUS_.UNDER_CONTRACT) user.contracts++;
      if (row.new_value === STATUS_.CLOSED) user.closes++;
    }

    // An appointment counts once per lead, whether it arrived as a status move to
    // APPOINTMENT_SET or as an APPOINTMENT_SET activity row (4.11).
    var isStatusAppointment = row.action_type === ACTION_.STATUS_CHANGED &&
      row.new_value === STATUS_.APPOINTMENT_SET;
    var isAppointmentAction = row.action_type === ACTION_.APPOINTMENT_SET;
    if ((isStatusAppointment || isAppointmentAction) && row.lead_id &&
      !user.appointmentLeadIds[row.lead_id]) {
      user.appointmentLeadIds[row.lead_id] = true;
      user.appointmentsSet++;
    }

    if (String(row.timestamp_utc) > user.lastActivityAt) {
      user.lastActivityAt = String(row.timestamp_utc);
    }
  }

  for (var j = 0; j < leads.length; j++) {
    var lead = leads[j];
    var assignee = String(lead.assigned_to || '');
    if (!assignee || isTeamQueue_(assignee)) continue;
    if (!isLiveStatus_(lead.status)) continue;
    var target = byUser[assignee];
    if (!target) continue;
    target.activeAssigned++;
    var due = String(lead.due_date || '');
    if (isIsoDate_(due) && compareIso_(due, businessDate) < 0) target.overdueAssigned++;
  }

  return Object.keys(byUser).map(function (userId) {
    var entry = byUser[userId];
    delete entry.touchedIds;
    delete entry.appointmentLeadIds;
    return entry;
  }).sort(function (a, b) {
    return b.leadsTouched - a.leadsTouched || a.name.localeCompare(b.name);
  });
}

/* ------------------------------------------------------------ system logs */

/** AUDIT_LOG (3.3). Never records a password or a token. */
function auditLog_(userId, email, action, entityType, entityId, details) {
  var nowIso = nowIsoUtc_();
  appendRow_(SHEET_NAMES_.AUDIT_LOG, {
    event_id: newUniqueId_(ID_PREFIX_.EVENT, compactStamp_(nowIso)),
    timestamp_utc: nowIso,
    business_date: businessToday_(),
    user_id: String(userId || ''),
    user_email: String(email || ''),
    entity_type: String(entityType || ''),
    entity_id: String(entityId || ''),
    action: String(action || ''),
    details: trimTo_(details, 4000)
  }, columnKinds_(SHEET_NAMES_.AUDIT_LOG));
}

/**
 * ERROR_LOG (4.12). Carries a trimmed stack and no seller data beyond the
 * entity id, so an error log is never a back door to customer information.
 */
function errorLog_(userId, functionName, entityType, entityId, error, details) {
  try {
    var nowIso = nowIsoUtc_();
    var row = {
      error_id: newUniqueId_(ID_PREFIX_.ERROR, compactStamp_(nowIso)),
      timestamp_utc: nowIso,
      user_id: String(userId || ''),
      'function': String(functionName || ''),
      entity_type: String(entityType || ''),
      entity_id: String(entityId || ''),
      error: trimTo_(error && error.message ? error.message : error, 500),
      details: trimTo_(details || (error && error.stack) || '', 2000)
    };
    appendRow_(SHEET_NAMES_.ERROR_LOG, row, columnKinds_(SHEET_NAMES_.ERROR_LOG));
  } catch (loggingFailure) {
    // If even the error log is unreachable there is nothing useful left to do,
    // and throwing here would replace a real error with a misleading one.
  }
}

function trimTo_(value, max) {
  var text = value === null || value === undefined ? '' : String(value);
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}
