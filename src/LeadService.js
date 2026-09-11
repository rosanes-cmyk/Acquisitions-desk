/**
 * LeadService.js - every lead action (4.10 LEADS).
 *
 * Each exported action maps to exactly ONE control on the card (2.1) and follows
 * the write order in 4.5: lock, read one row by id, version check, permission,
 * validate, targeted write, append history, flush, stamp, release.
 *
 * There is no generic "write any field" path. The field whitelist lives in
 * UPDATE_LEAD_FIELDS_ and everything else is owned by a dedicated action (4.6).
 */

/* --------------------------------------------------------------- helpers */

/** The card needs these computed; the client never recomputes money rules. */
function presentLead_(lead) {
  var maoPercentage = settingNumber_('mao_percentage', 70);
  var today = businessToday_();
  var maoValue = mao_(lead.arv, maoPercentage, lead.repairs);

  var view = {};
  for (var key in lead) {
    if (Object.prototype.hasOwnProperty.call(lead, key)) view[key] = lead[key];
  }

  view.flag_juan = toBool_(lead.flag_juan);
  view.compliance_mailer_check = toBool_(lead.compliance_mailer_check);
  view.contact_attempts = toNumberOrNull_(lead.contact_attempts) || 0;
  view.version = toNumberOrNull_(lead.version) || 0;
  view.status_label = STATUS_LABELS_[lead.status] || lead.status;
  view.mao = maoValue;
  view.mao_percentage = maoPercentage;
  view.offer_room = offerRoom_(maoValue, lead.asking_price);
  view.days_untouched = daysUntouched_(lead.last_touched_at, today);
  view.is_stale = isStale_(lead.last_touched_at, today, settingNumber_('stale_lead_days', 7));
  view.recent_notes = parseRecentNotes_(lead.recent_notes_json);
  return view;
}

function leadKinds_() {
  return columnKinds_(SHEET_NAMES_.LEADS);
}

/**
 * The 4.5 write sequence, in one place so no action can forget a step.
 *
 * @param {!Object} ctx
 * @param {string} leadId
 * @param {*} expectedVersion may be blank for actions that do not send one
 * @param {function(!Object, !Object): {patch: !Object, activities: !Array<!Object>,
 *         message: string=}} build receives (lead, {nowIso, businessDate})
 * @return {!Object} the fresh record, as the client should now display it
 */
function mutateLead_(ctx, leadId, expectedVersion, build) {
  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.LEADS, 'lead_id', leadId);
    if (!found) throw notFoundError_('lead', leadId);

    var lead = found.record;
    var currentVersion = toNumberOrNull_(lead.version) || 0;

    // 4.5 step 3 - write nothing when someone else got there first.
    if (!isBlank_(expectedVersion) && Number(expectedVersion) !== currentVersion) {
      throw conflictError_(presentLead_(lead));
    }

    var nowIso = nowIsoUtc_();
    var businessDate = businessToday_();
    var result = build(lead, { nowIso: nowIso, businessDate: businessDate }) || {};
    var patch = result.patch || {};
    var activities = result.activities || [];

    // recent_notes_json / last_note_at / last_touched_at follow from the activity.
    var touch = leadTouchPatch_(ctx, lead, activities, nowIso);
    for (var key in touch) {
      if (patch[key] === undefined) patch[key] = touch[key];
    }

    patch.version = currentVersion + 1;
    patch.updated_by = ctx.user_id;
    patch.updated_at = nowIso;

    writeRowCells_(SHEET_NAMES_.LEADS, found.rowIndex, patch, leadKinds_());
    if (activities.length) appendActivityRows_(activities);
    commitAndStamp_();

    var refreshed = findRowById_(SHEET_NAMES_.LEADS, 'lead_id', leadId);
    var view = presentLead_(refreshed.record);
    if (result.message) view.message = result.message;
    return view;
  });
}

function loadLeadOrThrow_(ctx, leadId) {
  var found = findRowById_(SHEET_NAMES_.LEADS, 'lead_id', leadId);
  if (!found) throw notFoundError_('lead', leadId);
  if (!canSeeLead_(ctx, found.record)) throw notFoundError_('lead', leadId);
  return found.record;
}

/* ------------------------------------------------------------------ reads */

var LEAD_FILTERS_ = ['live', 'due', 'juan', 'stale', 'appointments', 'archived', 'everything',
  'mine'];
var LEAD_SORTS_ = ['next_action', 'last_touched', 'offer_room'];
var PAGE_SIZE_MAX_ = 200;

/**
 * listLeads {filter, sort, search, page, pageSize} (4.7).
 *
 * LEADS is read ONCE per request and filtered in memory. Tallies are computed
 * over the whole sheet in that same pass, never from the page the client holds.
 */
function listLeads_(ctx, payload) {
  var filter = payload.filter || 'live';
  if (LEAD_FILTERS_.indexOf(filter) < 0) {
    throw validationError_('filter', 'Unknown filter: ' + filter);
  }
  var sort = payload.sort || 'next_action';
  if (LEAD_SORTS_.indexOf(sort) < 0) throw validationError_('sort', 'Unknown sort: ' + sort);

  var page = Math.max(1, toNumberOrNull_(payload.page) || 1);
  var pageSize = Math.min(PAGE_SIZE_MAX_, Math.max(1, toNumberOrNull_(payload.pageSize) || PAGE_SIZE_MAX_));

  var today = businessToday_();
  var staleDays = settingNumber_('stale_lead_days', 7);
  var all = filterVisibleLeads_(ctx, readAll_(SHEET_NAMES_.LEADS));
  var namesById = userNamesById_();

  var tallies = {
    live: 0,
    dueOrOverdue: 0,
    archived: 0,
    waitingOnJuan: 0,
    liveListTarget: settingNumber_('live_list_target', 200)
  };

  for (var i = 0; i < all.length; i++) {
    var lead = all[i];
    var live = isLiveStatus_(lead.status);
    if (live) tallies.live++;
    if (isArchivedStatus_(lead.status)) tallies.archived++;
    if (live && isIsoDate_(String(lead.due_date)) && compareIso_(String(lead.due_date), today) <= 0) {
      tallies.dueOrOverdue++;
    }
    if (live && (toBool_(lead.flag_juan) || toBool_(lead.compliance_mailer_check))) {
      tallies.waitingOnJuan++;
    }
  }

  var matched = all.filter(function (lead) {
    return matchesFilter_(ctx, lead, filter, today, staleDays);
  });

  var search = normalizeWhitespace_(payload.search || '').toLowerCase();
  if (search) {
    var digits = search.replace(/\D/g, '');
    matched = matched.filter(function (lead) {
      var assignee = (namesById[lead.assigned_to] || String(lead.assigned_to || '')).toLowerCase();
      return String(lead.address || '').toLowerCase().indexOf(search) >= 0 ||
        String(lead.seller_name || '').toLowerCase().indexOf(search) >= 0 ||
        assignee.indexOf(search) >= 0 ||
        (digits.length >= 3 && normalizePhone_(lead.phone).indexOf(digits) >= 0);
    });
  }

  sortLeads_(matched, sort);

  var total = matched.length;
  var start = (page - 1) * pageSize;
  var pageRows = matched.slice(start, start + pageSize).map(presentLead_);

  return {
    leads: pageRows,
    tallies: tallies,
    page: page,
    pageSize: pageSize,
    total: total,
    has_more: start + pageRows.length < total,
    filter: filter,
    sort: sort,
    businessToday: today
  };
}

function matchesFilter_(ctx, lead, filter, today, staleDays) {
  var live = isLiveStatus_(lead.status);
  var due = String(lead.due_date || '');
  switch (filter) {
    case 'live': return live;
    case 'due': return live && isIsoDate_(due) && compareIso_(due, today) <= 0;
    case 'juan': return live && (toBool_(lead.flag_juan) || toBool_(lead.compliance_mailer_check));
    case 'stale': return live && isStale_(lead.last_touched_at, today, staleDays);
    case 'appointments': return lead.status === STATUS_.APPOINTMENT_SET;
    case 'archived': return isArchivedStatus_(lead.status);
    case 'mine': return live && String(lead.assigned_to || '') === ctx.user_id;
    case 'everything': return true;
    default: return false;
  }
}

/** The prototype's three orders (5.8), with the "missing value last" rules kept. */
function sortLeads_(leads, sort) {
  if (sort === 'last_touched') {
    // Most stale first - the prototype's default order.
    leads.sort(function (a, b) {
      return String(a.last_touched_at || '').localeCompare(String(b.last_touched_at || ''));
    });
    return;
  }

  if (sort === 'offer_room') {
    var maoPercentage = settingNumber_('mao_percentage', 70);
    leads.sort(function (a, b) {
      var roomA = leadOfferRoom_(a, maoPercentage);
      var roomB = leadOfferRoom_(b, maoPercentage);
      if (roomA === null && roomB === null) return 0;
      if (roomA === null) return 1;   // no ARV sorts last
      if (roomB === null) return -1;
      return roomB - roomA;           // highest first
    });
    return;
  }

  leads.sort(function (a, b) {
    var dueA = isIsoDate_(String(a.due_date)) ? String(a.due_date) : '';
    var dueB = isIsoDate_(String(b.due_date)) ? String(b.due_date) : '';
    if (!dueA && !dueB) return 0;
    if (!dueA) return 1;              // no due date sorts last
    if (!dueB) return -1;
    return compareIso_(dueA, dueB);
  });
}

function getLead_(ctx, payload) {
  return presentLead_(loadLeadOrThrow_(ctx, payload.leadId));
}

/** The full note thread, loaded only when the user opens "Show history" (4.7). */
function getLeadActivity_(ctx, payload) {
  loadLeadOrThrow_(ctx, payload.leadId);
  var limit = Math.min(500, Math.max(1, toNumberOrNull_(payload.limit) || 200));
  return { leadId: payload.leadId, activity: readLeadActivity_(payload.leadId, limit) };
}

function userNamesById_() {
  var names = {};
  readAll_(SHEET_NAMES_.USERS).forEach(function (user) {
    names[String(user.user_id)] = String(user.name || '');
  });
  return names;
}

/* ----------------------------------------------------------------- create */

/** Validates and normalizes the five fields a new lead can carry. */
function validateNewLead_(row) {
  return {
    address: requireText_('address', row.address, { required: true }),
    seller_name: requireText_('seller_name', row.seller_name),
    phone: requireText_('phone', row.phone),
    source: requireText_('source', row.source),
    equity_note: requireText_('equity_note', row.equity_note)
  };
}

function buildLeadRow_(ctx, clean, options) {
  var opts = options || {};
  var nowIso = opts.nowIso || nowIsoUtc_();
  return {
    lead_id: opts.leadId,
    address: clean.address,
    seller_name: clean.seller_name,
    phone: clean.phone,
    source: clean.source,
    equity_note: clean.equity_note,
    status: STATUS_.NEW,
    assigned_to: '',
    team: '',
    flag_juan: false,
    compliance_mailer_check: false,
    contact_attempts: 0,
    next_action: '',
    due_date: '',
    arv: '',
    repairs: '',
    asking_price: '',
    offer: '',
    appointment_date: '',
    appointment_outcome: '',
    archive_reason: '',
    created_by: ctx.user_id,
    created_at: nowIso,
    updated_by: ctx.user_id,
    updated_at: nowIso,
    last_touched_at: nowIso,
    version: 1,
    address_normalized: normalizeAddress_(clean.address),
    phone_normalized: normalizePhone_(clean.phone),
    recent_notes_json: '[]',
    last_note_at: '',
    flagged_at: '',
    compliance_flagged_at: '',
    appointment_time: '',
    possible_duplicate_of: opts.possibleDuplicateOf || '',
    legacy_id: opts.legacyId || ''
  };
}

function createLead_(ctx, payload) {
  requireCapability_(ctx, 'createLead', 'add leads');
  var clean = validateNewLead_(payload.data || payload);

  return withLock_(function () {
    var existing = readAll_(SHEET_NAMES_.LEADS);
    var duplicate = classifyDuplicate_(clean, existing);
    if (duplicate.kind === 'EXACT') {
      throw duplicateError_(
        'That address is already on the board.',
        { lead_id: duplicate.leadId, address: clean.address }
      );
    }

    var nowIso = nowIsoUtc_();
    var businessDate = businessToday_();
    var taken = {};
    existing.forEach(function (lead) { taken[lead.lead_id] = true; });
    var leadId = newLeadId_(businessDate, function (candidate) { return !!taken[candidate]; });

    var row = buildLeadRow_(ctx, clean, {
      leadId: leadId,
      nowIso: nowIso,
      possibleDuplicateOf: duplicate.kind === 'POSSIBLE' ? duplicate.leadId : ''
    });
    appendRow_(SHEET_NAMES_.LEADS, row, leadKinds_());

    var activities = [buildActivityRow_(ctx, leadId, ACTION_.LEAD_CREATED, {
      note: 'Lead added: ' + clean.address, nowIso: nowIso, businessDate: businessDate
    })];
    if (duplicate.kind === 'POSSIBLE') {
      activities.push(buildActivityRow_(ctx, leadId, ACTION_.LEAD_DUPLICATE_SUSPECTED, {
        field: 'phone_normalized',
        newValue: duplicate.leadId,
        note: 'Same phone number as an existing lead at a different address.',
        nowIso: nowIso,
        businessDate: businessDate
      }));
    }
    appendActivityRows_(activities);
    commitAndStamp_();

    auditSafely_(ctx.user_id, ctx.email, 'LEAD_CREATED', 'lead', leadId, clean.address);
    return presentLead_(row);
  });
}

/* ------------------------------------------------------------ bulk import */

/**
 * addBulkLeads {rows[], client_request_id} (5.8).
 *
 * Every row is accounted for: added, skipped as a duplicate, flagged as a
 * possible duplicate, or failed with a reason and its line number. Nothing is
 * silently discarded.
 */
function addBulkLeads_(ctx, payload) {
  requireCapability_(ctx, 'bulkImport', 'import leads');
  var rows = payload.rows || [];
  if (!rows.length) throw validationError_('rows', 'There were no leads to add.');
  if (rows.length > BULK_IMPORT_MAX_ROWS_) {
    throw validationError_('rows',
      'Send at most ' + BULK_IMPORT_MAX_ROWS_ + ' leads at a time.');
  }

  return idempotent_(ctx, payload.client_request_id, function () {
    return withLock_(function () {
      var existing = readAll_(SHEET_NAMES_.LEADS);
      var taken = {};
      existing.forEach(function (lead) { taken[lead.lead_id] = true; });

      var nowIso = nowIsoUtc_();
      var businessDate = businessToday_();
      var summary = { added: 0, duplicatesSkipped: 0, possibleDuplicates: 0, failed: 0, rows: [] };
      var newRows = [];
      var activities = [];

      for (var i = 0; i < rows.length; i++) {
        var source = rows[i] || {};
        var line = toNumberOrNull_(source.line) || (i + 1);
        var clean;

        try {
          clean = validateNewLead_(source);
        } catch (err) {
          summary.failed++;
          summary.rows.push({ line: line, result: 'FAILED', reason: err.message,
            address: String(source.address || '') });
          continue;
        }

        // Compare against what is already on the board AND what this batch has
        // added so far, so one paste cannot insert the same address twice.
        var duplicate = classifyDuplicate_(clean, existing.concat(newRows));
        if (duplicate.kind === 'EXACT') {
          summary.duplicatesSkipped++;
          summary.rows.push({ line: line, result: 'DUPLICATE_SKIPPED',
            reason: 'Already on the board as ' + duplicate.leadId, address: clean.address });
          continue;
        }

        var leadId = newLeadId_(businessDate, function (candidate) { return !!taken[candidate]; });
        taken[leadId] = true;

        var row = buildLeadRow_(ctx, clean, {
          leadId: leadId,
          nowIso: nowIso,
          possibleDuplicateOf: duplicate.kind === 'POSSIBLE' ? duplicate.leadId : ''
        });
        newRows.push(row);

        activities.push(buildActivityRow_(ctx, leadId, ACTION_.LEAD_IMPORTED, {
          note: 'Imported from a pasted list: ' + clean.address,
          clientRequestId: payload.client_request_id,
          nowIso: nowIso,
          businessDate: businessDate
        }));

        if (duplicate.kind === 'POSSIBLE') {
          summary.possibleDuplicates++;
          activities.push(buildActivityRow_(ctx, leadId, ACTION_.LEAD_DUPLICATE_SUSPECTED, {
            field: 'phone_normalized',
            newValue: duplicate.leadId,
            note: 'Same phone number as an existing lead at a different address.',
            nowIso: nowIso,
            businessDate: businessDate
          }));
          summary.rows.push({ line: line, result: 'POSSIBLE_DUPLICATE',
            reason: 'Same phone as ' + duplicate.leadId, address: clean.address, lead_id: leadId });
        } else {
          summary.rows.push({ line: line, result: 'ADDED', reason: '', address: clean.address,
            lead_id: leadId });
        }
        summary.added++;
      }

      if (newRows.length) {
        appendRows_(SHEET_NAMES_.LEADS, newRows, leadKinds_());
        appendActivityRows_(activities);
        commitAndStamp_();
      }

      auditSafely_(ctx.user_id, ctx.email, 'BULK_IMPORT', 'lead', '',
        'added ' + summary.added + ', duplicates skipped ' + summary.duplicatesSkipped +
        ', possible duplicates ' + summary.possibleDuplicates + ', failed ' + summary.failed);

      return summary;
    });
  });
}

/* ----------------------------------------------------------------- update */

/**
 * updateLead {leadId, patch, expectedVersion} (4.6).
 *
 * Accepts only UPDATE_LEAD_FIELDS_. A field owned by a dedicated action is
 * rejected by name, so a client bug surfaces instead of silently doing nothing.
 */
function updateLead_(ctx, payload) {
  requireCapability_(ctx, 'editLead', 'edit leads');
  var picked = pickWhitelisted_(payload.patch || {}, UPDATE_LEAD_FIELDS_);

  if (picked.routed.length) {
    var field = picked.routed[0];
    throw validationError_(field,
      field + ' is changed with ' + routeForField_(field) + ', not updateLead.');
  }
  if (picked.rejected.length) {
    throw validationError_(picked.rejected[0],
      'That change was refused: ' +
      picked.rejected.map(rejectionReason_).join('; ') + '.');
  }
  if (!Object.keys(picked.clean).length) {
    throw validationError_('patch', 'There was nothing to change.');
  }

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    if (!canSeeLead_(ctx, lead)) throw notFoundError_('lead', payload.leadId);

    var patch = {};
    var activities = [];
    var underwritingChanged = [];

    for (var field in picked.clean) {
      if (!Object.prototype.hasOwnProperty.call(picked.clean, field)) continue;
      var oldValue = lead[field];
      var newValue = validateLeadField_(field, picked.clean[field], lead);

      // Blur handlers fire even when nothing changed; skip no-ops so production
      // does not fill up with spurious writes and activity rows (finding C3).
      if (String(oldValue === null || oldValue === undefined ? '' : oldValue) === String(newValue)) {
        continue;
      }

      patch[field] = newValue;

      if (field === 'status') {
        if (!canTransitionStatus_(lead.status, newValue, 'updateLead')) {
          throw validationError_('status',
            'A lead cannot move from ' + (STATUS_LABELS_[lead.status] || lead.status) +
            ' to ' + (STATUS_LABELS_[newValue] || newValue) + ' here.');
        }
        activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.STATUS_CHANGED, {
          field: 'status', oldValue: oldValue, newValue: newValue,
          note: autoNoteText_(ACTION_.STATUS_CHANGED, newValue),
          nowIso: moment.nowIso, businessDate: moment.businessDate
        }));
      } else if (field === 'offer') {
        activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.OFFER_CHANGED, {
          field: field, oldValue: oldValue, newValue: newValue,
          nowIso: moment.nowIso, businessDate: moment.businessDate
        }));
      } else if (['arv', 'repairs', 'asking_price'].indexOf(field) >= 0) {
        underwritingChanged.push(field);
      } else if (field === 'appointment_date' || field === 'appointment_time') {
        // Handled once below so one activity row covers a date+time change.
      } else if (field === 'appointment_outcome') {
        activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.APPOINTMENT_UPDATED, {
          field: field, oldValue: oldValue, newValue: newValue,
          note: autoNoteText_(ACTION_.APPOINTMENT_UPDATED, newValue),
          nowIso: moment.nowIso, businessDate: moment.businessDate
        }));
        completeScheduledAppointment_(ctx, lead, newValue, moment.nowIso);
      } else {
        activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.LEAD_UPDATED, {
          field: field, oldValue: oldValue, newValue: newValue,
          nowIso: moment.nowIso, businessDate: moment.businessDate
        }));
        if (field === 'address') patch.address_normalized = normalizeAddress_(newValue);
        if (field === 'phone') patch.phone_normalized = normalizePhone_(newValue);
      }
    }

    if (underwritingChanged.length) {
      activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.UNDERWRITING_CHANGED, {
        field: underwritingChanged.join(','),
        newValue: underwritingChanged.map(function (f) { return f + '=' + patch[f]; }).join(' '),
        nowIso: moment.nowIso, businessDate: moment.businessDate
      }));
    }

    if (patch.appointment_date !== undefined || patch.appointment_time !== undefined) {
      var date = patch.appointment_date !== undefined
        ? patch.appointment_date : String(lead.appointment_date || '');
      var time = patch.appointment_time !== undefined
        ? patch.appointment_time : String(lead.appointment_time || '');
      if (date) {
        upsertScheduledAppointment_(ctx, lead, date, time, moment.nowIso);
        activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.APPOINTMENT_SET, {
          field: 'appointment_date', oldValue: lead.appointment_date, newValue: date,
          note: 'Appointment set for ' + date + (time ? ' at ' + time : ''),
          nowIso: moment.nowIso, businessDate: moment.businessDate
        }));
      }
    }

    if (!Object.keys(patch).length) {
      // Everything in the patch matched what was already stored.
      return { patch: {}, activities: [] };
    }
    return { patch: patch, activities: activities };
  });
}

/** Per-field validation for the updateLead whitelist (4.6). */
function validateLeadField_(field, value, lead) {
  switch (field) {
    case 'status': return requireEnum_('status', value, ALL_STATUSES_);
    case 'appointment_outcome':
      return requireEnum_('appointment_outcome', value, APPOINTMENT_OUTCOMES_);
    case 'appointment_date': return requireIsoDate_('appointment_date', value, true);
    case 'appointment_time': return requireHhMm_('appointment_time', value, true);
    case 'arv': case 'repairs': case 'asking_price': case 'offer': {
      var number = requireNonNegativeNumberOrBlank_(field, value);
      return number === null ? '' : number;
    }
    case 'address': return requireText_('address', value, { required: true });
    default: return requireText_(field, value);
  }
}

/* ------------------------------------------------- assignment and actions */

function assignLead_(ctx, payload) {
  requireCapability_(ctx, 'assignLead', 'assign leads');
  var assignee = trimString_(payload.assignedTo);

  if (assignee && !isTeamQueue_(assignee)) {
    var user = findUserById_(assignee);
    if (!user || !toBool_(user.active)) {
      throw validationError_('assignedTo', 'That person is not an active user.');
    }
  } else if (assignee) {
    var code = assignee.slice(5);
    if (teamQueues_().indexOf(code) < 0) {
      throw validationError_('assignedTo', 'That team queue does not exist.');
    }
  }

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    if (!canReassign_(ctx, lead)) {
      throw accessError_('ACCESS_DENIED',
        'This lead belongs to someone else. A manager can reassign it.');
    }
    if (String(lead.assigned_to || '') === assignee) return { patch: {}, activities: [] };

    var patch = { assigned_to: assignee, team: teamForAssignee_(assignee) };
    return {
      patch: patch,
      activities: [buildActivityRow_(ctx, lead.lead_id, ACTION_.ASSIGNED, {
        field: 'assigned_to',
        oldValue: lead.assigned_to,
        newValue: assignee,
        note: assignee ? 'Assigned to ' + assigneeLabel_(assignee) : 'Assignment cleared',
        nowIso: moment.nowIso, businessDate: moment.businessDate
      })]
    };
  });
}

/** team is denormalized at assignment time (3.3 LEADS). */
function teamForAssignee_(assignee) {
  if (!assignee) return '';
  if (isTeamQueue_(assignee)) return assignee.slice(5);
  var user = findUserById_(assignee);
  return user ? String(user.team || '') : '';
}

function assigneeLabel_(assignee) {
  if (!assignee) return 'nobody';
  if (isTeamQueue_(assignee)) return 'the ' + assignee.slice(5) + ' team';
  var user = findUserById_(assignee);
  return user ? String(user.name || assignee) : assignee;
}

function logAttempt_(ctx, payload) {
  requireCapability_(ctx, 'logAttempt', 'log contact attempts');
  return idempotent_(ctx, payload.client_request_id, function () {
    return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
      var attempts = (toNumberOrNull_(lead.contact_attempts) || 0) + 1;
      return {
        patch: { contact_attempts: attempts },
        activities: [buildActivityRow_(ctx, lead.lead_id, ACTION_.CALL_ATTEMPT, {
          field: 'contact_attempts',
          oldValue: lead.contact_attempts,
          newValue: attempts,
          note: autoNoteText_(ACTION_.CALL_ATTEMPT, attempts),
          clientRequestId: payload.client_request_id,
          nowIso: moment.nowIso, businessDate: moment.businessDate
        })]
      };
    });
  });
}

function addLeadNote_(ctx, payload) {
  requireCapability_(ctx, 'addNote', 'post notes');
  var text = requireText_('note', payload.text, { required: true, collapse: false });

  return idempotent_(ctx, payload.client_request_id, function () {
    return mutateLead_(ctx, payload.leadId, null, function (lead, moment) {
      return {
        patch: {},
        activities: [buildActivityRow_(ctx, lead.lead_id, ACTION_.NOTE_ADDED, {
          note: text,
          clientRequestId: payload.client_request_id,
          nowIso: moment.nowIso, businessDate: moment.businessDate
        })]
      };
    });
  });
}

/** setNextAction owns BOTH next_action and due_date (4.6). */
function setNextAction_(ctx, payload) {
  requireCapability_(ctx, 'setNextAction', 'set next actions');
  var nextAction = requireText_('next_action', payload.nextAction);
  var dueDate = requireIsoDate_('due_date', payload.dueDate, true);

  // 4.6: a due date is required whenever a next action is set from the queue.
  if (payload.requireDueDate && nextAction && !dueDate) {
    throw validationError_('due_date', 'Give the next action a due date.');
  }

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    var patch = {};
    var activities = [];

    if (String(lead.next_action || '') !== nextAction) {
      patch.next_action = nextAction;
      activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.NEXT_ACTION_CHANGED, {
        field: 'next_action', oldValue: lead.next_action, newValue: nextAction,
        note: nextAction ? 'Next action: ' + nextAction : 'Next action cleared',
        nowIso: moment.nowIso, businessDate: moment.businessDate
      }));
    }

    if (String(lead.due_date || '') !== dueDate) {
      patch.due_date = dueDate;
      activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.DUE_DATE_CHANGED, {
        field: 'due_date', oldValue: lead.due_date, newValue: dueDate,
        note: dueDate ? autoNoteText_(ACTION_.DUE_DATE_CHANGED, dueDate) : 'Due date cleared',
        nowIso: moment.nowIso, businessDate: moment.businessDate
      }));
    }

    return { patch: patch, activities: activities };
  });
}

/**
 * Mark done (5.8). Logs the completion, clears the current next action and due
 * date, and optionally sets the next one in the same write so the lead never
 * falls off the queue between two requests.
 */
function completeNextAction_(ctx, payload) {
  requireCapability_(ctx, 'setNextAction', 'complete next actions');
  var nextAction = requireText_('next_action', payload.nextAction);
  var dueDate = requireIsoDate_('due_date', payload.dueDate, true);

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    var completed = String(lead.next_action || '');
    var activities = [buildActivityRow_(ctx, lead.lead_id, ACTION_.NEXT_ACTION_COMPLETED, {
      field: 'next_action',
      oldValue: completed,
      newValue: nextAction,
      note: autoNoteText_(ACTION_.NEXT_ACTION_COMPLETED, completed || '(no next action recorded)'),
      nowIso: moment.nowIso, businessDate: moment.businessDate
    })];

    var patch = { next_action: nextAction, due_date: dueDate };

    if (nextAction) {
      activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.NEXT_ACTION_CHANGED, {
        field: 'next_action', oldValue: completed, newValue: nextAction,
        note: 'Next action: ' + nextAction,
        nowIso: moment.nowIso, businessDate: moment.businessDate
      }));
    }
    if (dueDate) {
      activities.push(buildActivityRow_(ctx, lead.lead_id, ACTION_.DUE_DATE_CHANGED, {
        field: 'due_date', oldValue: lead.due_date, newValue: dueDate,
        note: autoNoteText_(ACTION_.DUE_DATE_CHANGED, dueDate),
        nowIso: moment.nowIso, businessDate: moment.businessDate
      }));
    }

    return { patch: patch, activities: activities };
  });
}

/* ------------------------------------------------------------------ flags */

function setJuanFlag_(ctx, payload) {
  requireCapability_(ctx, 'setJuanFlag', 'flag leads for Juan');
  var on = requireBoolean_('on', payload.on);

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    if (toBool_(lead.flag_juan) === on) return { patch: {}, activities: [] };

    // Compliance owns the flag while it is set: clearing the Juan flag must not
    // quietly remove a compliance lead from Juan's list (6.2).
    if (!on && toBool_(lead.compliance_mailer_check)) {
      throw validationError_('on',
        'This lead is flagged because the seller mentioned a mailer or check. Clear the mailer ' +
        'note instead.');
    }

    var actionType = on ? ACTION_.FLAGGED_FOR_JUAN : ACTION_.JUAN_FLAG_CLEARED;
    return {
      patch: { flag_juan: on, flagged_at: on ? moment.nowIso : '' },
      activities: [buildActivityRow_(ctx, lead.lead_id, actionType, {
        field: 'flag_juan', oldValue: toBool_(lead.flag_juan), newValue: on,
        note: autoNoteText_(actionType),
        nowIso: moment.nowIso, businessDate: moment.businessDate
      })]
    };
  });
}

/**
 * 6.2. Setting it also raises the Juan flag and stamps compliance_flagged_at.
 * Clearing it needs MANAGER+. It never auto-archives, hides or deletes the lead.
 */
function setComplianceFlag_(ctx, payload) {
  var on = requireBoolean_('on', payload.on);
  requireCapability_(ctx, on ? 'setComplianceFlag' : 'clearComplianceFlag',
    on ? 'set the mailer note' : 'clear the mailer note');

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    if (toBool_(lead.compliance_mailer_check) === on) return { patch: {}, activities: [] };

    var actionType = on ? ACTION_.COMPLIANCE_FLAGGED : ACTION_.COMPLIANCE_CLEARED;
    var patch = {
      compliance_mailer_check: on,
      compliance_flagged_at: on ? moment.nowIso : ''
    };
    if (on) {
      patch.flag_juan = true;
      patch.flagged_at = lead.flagged_at || moment.nowIso;
    }

    return {
      patch: patch,
      activities: [buildActivityRow_(ctx, lead.lead_id, actionType, {
        field: 'compliance_mailer_check',
        oldValue: toBool_(lead.compliance_mailer_check),
        newValue: on,
        note: autoNoteText_(actionType),
        nowIso: moment.nowIso, businessDate: moment.businessDate
      })]
    };
  });
}

/* ------------------------------------------------------ archive / restore */

function archiveLead_(ctx, payload) {
  requireCapability_(ctx, 'archiveLead', 'archive leads');
  var archivedStatus = requireEnum_('archivedStatus', payload.archivedStatus, ARCHIVED_STATUSES_);

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    if (!canTransitionStatus_(lead.status, archivedStatus, 'archiveLead')) {
      throw validationError_('archivedStatus', 'That lead is already archived.');
    }
    return {
      patch: { status: archivedStatus, archive_reason: ARCHIVE_REASONS_[archivedStatus] || '' },
      activities: [buildActivityRow_(ctx, lead.lead_id, ACTION_.ARCHIVED, {
        field: 'status', oldValue: lead.status, newValue: archivedStatus,
        note: 'Archived: ' + (ARCHIVE_REASONS_[archivedStatus] || archivedStatus),
        nowIso: moment.nowIso, businessDate: moment.businessDate
      })]
    };
  });
}

function restoreLead_(ctx, payload) {
  requireCapability_(ctx, 'restoreLead', 'restore archived leads');
  var toStatus = requireEnum_('toStatus', payload.toStatus || STATUS_.NEW, LIVE_STATUSES_);

  return mutateLead_(ctx, payload.leadId, payload.expectedVersion, function (lead, moment) {
    if (!canTransitionStatus_(lead.status, toStatus, 'restoreLead')) {
      throw validationError_('toStatus', 'That lead is not archived.');
    }
    return {
      patch: { status: toStatus, archive_reason: '' },
      activities: [buildActivityRow_(ctx, lead.lead_id, ACTION_.RESTORED, {
        field: 'status', oldValue: lead.status, newValue: toStatus,
        note: 'Restored to ' + (STATUS_LABELS_[toStatus] || toStatus),
        nowIso: moment.nowIso, businessDate: moment.businessDate
      })]
    };
  });
}
