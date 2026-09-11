/**
 * ToolService.js - the Tools We Own tab (4.10 TOOLS).
 *
 * Editing the inventory is TECHNICAL / MANAGER / ADMIN; a REP views it and marks
 * runs (5.8). Every write is versioned and targeted like a lead write.
 */

/** The fields a person can edit on a tool card (5.8). */
var TOOL_PATCH_FIELDS_ = ['name', 'description', 'built_by', 'operator', 'backup_operator',
  'status', 'steps', 'expected_output', 'cadence', 'link', 'recommendation', 'handoff_date',
  'verdict', 'proof_last_week', 'asked_builder_date'];

/** Cards are sorted by status order, as the prototype did (5.8). */
function toolStatusRank_(status) {
  var rank = TOOL_STATUSES_.indexOf(status);
  return rank < 0 ? TOOL_STATUSES_.length : rank;
}

function presentTool_(tool, trainingByTool) {
  var view = {};
  for (var key in tool) {
    if (Object.prototype.hasOwnProperty.call(tool, key)) view[key] = tool[key];
  }
  view.is_seeded = toBool_(tool.is_seeded);
  view.version = toNumberOrNull_(tool.version) || 0;

  // A link that failed validation is handed over as plain text with a flag, so
  // the client renders it without ever making it clickable (2.2 #6).
  var link = validateHttpLink_(tool.link);
  view.link_is_valid = link.ok;
  view.link = link.value;

  view.trained_user_ids = (trainingByTool && trainingByTool[tool.tool_id]) || [];
  view.is_daily = DAILY_CADENCES_.indexOf(tool.cadence) >= 0;
  return view;
}

function trainingByTool_() {
  var map = {};
  readAll_(SHEET_NAMES_.TOOL_TRAINING).forEach(function (row) {
    if (!toBool_(row.trained)) return;
    var toolId = String(row.tool_id);
    if (!map[toolId]) map[toolId] = [];
    map[toolId].push(String(row.user_id));
  });
  return map;
}

function getTools_(ctx) {
  var training = trainingByTool_();
  var tools = readAll_(SHEET_NAMES_.TOOL_INVENTORY).map(function (tool) {
    return presentTool_(tool, training);
  });
  tools.sort(function (a, b) {
    return toolStatusRank_(a.status) - toolStatusRank_(b.status) ||
      String(a.name).localeCompare(String(b.name));
  });

  return {
    tools: tools,
    pillars: readAll_(SHEET_NAMES_.PILLARS),
    rollcall: readAll_(SHEET_NAMES_.BUILDER_ROLLCALL),
    canEdit: can_(ctx, 'editTools'),
    runsToday: getRunsToday_(ctx)
  };
}

function createTool_(ctx, payload) {
  requireCapability_(ctx, 'editTools', 'add tools');
  var data = payload.data || payload;
  var name = requireText_('name', data.name, { required: true });
  var builtBy = requireText_('built_by', data.built_by);
  var link = requireHttpLink_('link', data.link);
  var description = requireText_('description', data.description);

  return withLock_(function () {
    var nowIso = nowIsoUtc_();
    var taken = {};
    readAll_(SHEET_NAMES_.TOOL_INVENTORY).forEach(function (tool) { taken[tool.tool_id] = true; });
    var toolId = newUniqueId_(ID_PREFIX_.TOOL, compactStamp_(nowIso),
      function (candidate) { return !!taken[candidate]; });

    var row = {
      tool_id: toolId, name: name, description: description, built_by: builtBy,
      operator: '', backup_operator: '', status: TOOL_STATUSES_[0], steps: '',
      expected_output: '', cadence: CADENCES_[0], link: link,
      recommendation: TOOL_RECOMMENDATIONS_[0], handoff_date: '', verdict: VERDICTS_[0],
      proof_last_week: '', created_at: nowIso, updated_at: nowIso, asked_builder_date: '',
      is_seeded: false, version: 1
    };
    appendRow_(SHEET_NAMES_.TOOL_INVENTORY, row, columnKinds_(SHEET_NAMES_.TOOL_INVENTORY));
    commitAndStamp_();

    auditSafely_(ctx.user_id, ctx.email, 'TOOL_CREATED', 'tool', toolId, name);
    return presentTool_(row, {});
  });
}

function updateTool_(ctx, payload) {
  requireCapability_(ctx, 'editTools', 'edit tools');
  var picked = pickWhitelisted_(payload.patch || {}, TOOL_PATCH_FIELDS_);
  if (picked.rejected.length) {
    throw validationError_(picked.rejected[0],
      'A tool does not accept ' + picked.rejected.join(', ') + '.');
  }
  if (!Object.keys(picked.clean).length) {
    throw validationError_('patch', 'There was nothing to change.');
  }

  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.TOOL_INVENTORY, 'tool_id', payload.toolId);
    if (!found) throw notFoundError_('tool', payload.toolId);

    var tool = found.record;
    var currentVersion = toNumberOrNull_(tool.version) || 0;
    if (!isBlank_(payload.expectedVersion) && Number(payload.expectedVersion) !== currentVersion) {
      throw conflictError_(presentTool_(tool, trainingByTool_()));
    }

    var patch = {};
    for (var field in picked.clean) {
      if (!Object.prototype.hasOwnProperty.call(picked.clean, field)) continue;
      var value = validateToolField_(field, picked.clean[field]);
      // Do not write when the value did not change (finding C3).
      if (String(tool[field] === null || tool[field] === undefined ? '' : tool[field]) ===
        String(value)) {
        continue;
      }
      patch[field] = value;
    }

    if (!Object.keys(patch).length) return presentTool_(tool, trainingByTool_());

    var nowIso = nowIsoUtc_();
    patch.version = currentVersion + 1;
    patch.updated_at = nowIso;
    writeRowCells_(SHEET_NAMES_.TOOL_INVENTORY, found.rowIndex, patch,
      columnKinds_(SHEET_NAMES_.TOOL_INVENTORY));
    commitAndStamp_();

    auditSafely_(ctx.user_id, ctx.email, 'TOOL_UPDATED', 'tool', payload.toolId,
      Object.keys(patch).join(', '));

    var refreshed = findRowById_(SHEET_NAMES_.TOOL_INVENTORY, 'tool_id', payload.toolId);
    return presentTool_(refreshed.record, trainingByTool_());
  });
}

function validateToolField_(field, value) {
  switch (field) {
    case 'status': return requireEnum_('status', value, TOOL_STATUSES_);
    case 'recommendation': return requireEnum_('recommendation', value, TOOL_RECOMMENDATIONS_);
    case 'cadence': return requireEnum_('cadence', value, CADENCES_);
    case 'verdict': return requireEnum_('verdict', value, VERDICTS_);
    case 'link': return requireHttpLink_('link', value);
    case 'handoff_date': return requireIsoDate_('handoff_date', value, true);
    case 'asked_builder_date': return requireIsoDate_('asked_builder_date', value, true);
    default: return requireText_(field, value, { collapse: false });
  }
}

/** One row per tool x user - never a comma-separated list (3.3 TOOL_TRAINING). */
function setToolTraining_(ctx, payload) {
  requireCapability_(ctx, 'editTools', 'record training');
  var trained = requireBoolean_('trained', payload.trained);
  var toolId = String(payload.toolId || '');
  var userId = String(payload.userId || '');

  if (!rowExists_(SHEET_NAMES_.TOOL_INVENTORY, 'tool_id', toolId)) {
    throw notFoundError_('tool', toolId);
  }
  if (!findUserById_(userId)) throw validationError_('userId', 'That person is not a user.');

  return withLock_(function () {
    var nowIso = nowIsoUtc_();
    var kinds = columnKinds_(SHEET_NAMES_.TOOL_TRAINING);
    var rows = readAll_(SHEET_NAMES_.TOOL_TRAINING);
    var existing = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].tool_id) === toolId && String(rows[i].user_id) === userId) {
        existing = rows[i];
        break;
      }
    }

    if (existing) {
      var found = findRowById_(SHEET_NAMES_.TOOL_TRAINING, 'record_id', existing.record_id);
      writeRowCells_(SHEET_NAMES_.TOOL_TRAINING, found.rowIndex, {
        trained: trained,
        certified_date: trained ? businessToday_() : '',
        certified_by: ctx.user_id,
        updated_at: nowIso
      }, kinds);
    } else {
      appendRow_(SHEET_NAMES_.TOOL_TRAINING, {
        record_id: newUniqueId_(ID_PREFIX_.TRAINING, compactStamp_(nowIso)),
        tool_id: toolId,
        user_id: userId,
        trained: trained,
        certified_date: trained ? businessToday_() : '',
        certified_by: ctx.user_id,
        notes: '',
        updated_at: nowIso
      }, kinds);
    }

    commitAndStamp_();
    return { toolId: toolId, userId: userId, trained: trained };
  });
}

/* -------------------------------------------------------------- tool runs */

/** "Ran today" = a DONE row for (tool_id, business_date) (3.3 TOOL_RUNS). */
function findRunForDate_(toolId, businessDate) {
  var rows = readAll_(SHEET_NAMES_.TOOL_RUNS);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].tool_id) === String(toolId) &&
      String(rows[i].business_date) === String(businessDate) &&
      rows[i].status === 'DONE') {
      return rows[i];
    }
  }
  return null;
}

function logToolRun_(ctx, payload) {
  requireCapability_(ctx, 'markToolRun', 'mark a tool as run');
  var toolId = String(payload.toolId || '');
  if (!rowExists_(SHEET_NAMES_.TOOL_INVENTORY, 'tool_id', toolId)) {
    throw notFoundError_('tool', toolId);
  }

  return idempotent_(ctx, payload.client_request_id, function () {
    return withLock_(function () {
      var businessDate = businessToday_();
      var existing = findRunForDate_(toolId, businessDate);
      if (existing) return { toolId: toolId, businessDate: businessDate, alreadyDone: true };

      var nowIso = nowIsoUtc_();
      appendRow_(SHEET_NAMES_.TOOL_RUNS, {
        run_id: newUniqueId_(ID_PREFIX_.RUN, compactDate_(businessDate)),
        tool_id: toolId,
        business_date: businessDate,
        run_by: ctx.user_id,
        run_at: nowIso,
        status: 'DONE',
        result: '',
        proof: ''
      }, columnKinds_(SHEET_NAMES_.TOOL_RUNS));
      commitAndStamp_();
      return { toolId: toolId, businessDate: businessDate, alreadyDone: false };
    });
  });
}

/**
 * Undo (A7). Sets status to VOIDED - the row stays, so the history of who
 * marked what and when is never destroyed. The prototype deleted the entry.
 */
function voidToolRun_(ctx, payload) {
  requireCapability_(ctx, 'markToolRun', 'undo a tool run');
  var toolId = String(payload.toolId || '');

  return withLock_(function () {
    var businessDate = businessToday_();
    var existing = findRunForDate_(toolId, businessDate);
    if (!existing) throw notFoundError_('tool run', toolId);

    var found = findRowById_(SHEET_NAMES_.TOOL_RUNS, 'run_id', existing.run_id);
    writeRowCells_(SHEET_NAMES_.TOOL_RUNS, found.rowIndex, {
      status: 'VOIDED',
      result: 'Undone by ' + (ctx.name || ctx.email) + ' at ' + nowIsoUtc_()
    }, columnKinds_(SHEET_NAMES_.TOOL_RUNS));
    commitAndStamp_();
    return { toolId: toolId, businessDate: businessDate, status: 'VOIDED' };
  });
}

function getRunsToday_(ctx) {
  var businessDate = businessToday_();
  var names = userNamesById_();
  var runs = readAll_(SHEET_NAMES_.TOOL_RUNS).filter(function (row) {
    return String(row.business_date) === businessDate && row.status === 'DONE';
  });
  return runs.map(function (row) {
    return {
      tool_id: row.tool_id,
      run_by: row.run_by,
      run_by_name: names[row.run_by] || row.run_by,
      run_at: row.run_at
    };
  });
}

/** DONE runs as date -> toolId -> true, for the streak (6.10). */
function doneRunsByDate_() {
  var map = {};
  readAll_(SHEET_NAMES_.TOOL_RUNS).forEach(function (row) {
    if (row.status !== 'DONE') return;
    var date = String(row.business_date);
    if (!map[date]) map[date] = {};
    map[date][String(row.tool_id)] = true;
  });
  return map;
}

/* ------------------------------------------------------ pillars, rollcall */

function setPillarState_(ctx, payload) {
  requireCapability_(ctx, 'editTools', 'change a pillar');
  var state = requireEnum_('state', payload.state, PILLAR_STATES_);

  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.PILLARS, 'pillar_id', payload.pillarId);
    if (!found) throw notFoundError_('pillar', payload.pillarId);
    writeRowCells_(SHEET_NAMES_.PILLARS, found.rowIndex, {
      state: state, updated_by: ctx.user_id, updated_at: nowIsoUtc_()
    }, columnKinds_(SHEET_NAMES_.PILLARS));
    commitAndStamp_();
    return { pillar_id: payload.pillarId, state: state };
  });
}

/**
 * The "date you asked them" field per builder. The prototype kept this in a
 * separate store and mergeTools() dropped the per-tool copy on reload (C1); here
 * it is a real row that survives.
 */
function setBuilderAsked_(ctx, payload) {
  requireCapability_(ctx, 'editTools', 'update the builder rollcall');
  var date = requireIsoDate_('asked_date', payload.date, true);
  var builder = requireText_('builder_name', payload.builder, { required: true });

  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.BUILDER_ROLLCALL, 'builder_name', builder);
    var nowIso = nowIsoUtc_();
    var kinds = columnKinds_(SHEET_NAMES_.BUILDER_ROLLCALL);

    if (found) {
      writeRowCells_(SHEET_NAMES_.BUILDER_ROLLCALL, found.rowIndex,
        { asked_date: date, updated_by: ctx.user_id, updated_at: nowIso }, kinds);
    } else {
      appendRow_(SHEET_NAMES_.BUILDER_ROLLCALL,
        { builder_name: builder, asked_date: date, updated_by: ctx.user_id, updated_at: nowIso },
        kinds);
    }

    commitAndStamp_();
    return { builder_name: builder, asked_date: date };
  });
}
