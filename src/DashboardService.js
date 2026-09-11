/**
 * DashboardService.js - the Today tab and Juan's management view (4.10, 5.8, 6.9).
 *
 * Everything here is derived from what people actually did. Nobody fills in a
 * status report (rule 1.10).
 */

/**
 * getTodayDashboard - one call that fills the whole Today tab (5.8).
 */
function getTodayDashboard_(ctx, payload) {
  var today = businessToday_();
  var leads = filterVisibleLeads_(ctx, readAll_(SHEET_NAMES_.LEADS));
  var names = userNamesById_();
  var tools = readAll_(SHEET_NAMES_.TOOL_INVENTORY);
  var runs = getRunsToday_(ctx);

  var daily = dailyTools_(tools).filter(function (tool) {
    return isToolDueOn_(tool.cadence, today);
  });
  var runByToolId = {};
  runs.forEach(function (run) { runByToolId[run.tool_id] = run; });

  return {
    businessToday: today,
    businessTodayLabel: formatLongDate_(today),
    metricsToday: getDailyMetrics_(ctx, { date: today }),
    dailyTools: daily.map(function (tool) {
      var run = runByToolId[tool.tool_id];
      return {
        tool_id: tool.tool_id,
        name: tool.name,
        operator: String(tool.operator || ''),
        expected_output: String(tool.expected_output || ''),
        cadence: tool.cadence,
        done: !!run,
        done_by: run ? run.run_by_name : '',
        done_at: run ? run.run_at : ''
      };
    }),
    runsToday: runs,
    dailyToolsDone: daily.filter(function (tool) { return !!runByToolId[tool.tool_id]; }).length,
    dailyToolsTotal: daily.length,
    streak: toolStreak_(tools, doneRunsByDate_(), today),
    workQueue: presentQueue_(classifyQueue_(leads, today), names, today),
    waitingOnJuan: waitingOnJuan_(leads, names),
    teamActivity: teamActivity_(ctx, today, leads)
  };
}

/** Each queue item carries what the row needs, and nothing more (5.8). */
function presentQueue_(queue, names, today) {
  function present(lead) {
    var due = String(lead.due_date || '');
    return {
      lead_id: lead.lead_id,
      address: lead.address,
      next_action: lead.next_action,
      due_date: due,
      due_label: isIsoDate_(due) ? formatShortDate_(due) : '',
      assigned_to: lead.assigned_to,
      assignee_name: names[lead.assigned_to] ||
        (isTeamQueue_(lead.assigned_to) ? lead.assigned_to.slice(5) + ' team' : ''),
      status: lead.status,
      status_label: STATUS_LABELS_[lead.status] || lead.status,
      version: toNumberOrNull_(lead.version) || 0,
      days_overdue: isIsoDate_(due) ? Math.max(0, daysBetween_(due, today)) : 0
    };
  }
  return {
    overdue: queue.overdue.map(present),
    dueToday: queue.dueToday.map(present),
    upcoming: queue.upcoming.map(present),
    noNextAction: queue.noNextAction.map(present),
    noDueDate: queue.noDueDate.map(present)
  };
}

/**
 * Waiting on Juan (5.8): live leads carrying either flag, with the assigned rep,
 * the reason, when it was flagged, and the most recent note. Compliance leads are
 * marked so the client can make them visually unmistakable (6.2).
 */
function waitingOnJuan_(leads, names) {
  return leads.filter(function (lead) {
    return isLiveStatus_(lead.status) &&
      (toBool_(lead.flag_juan) || toBool_(lead.compliance_mailer_check));
  }).map(function (lead) {
    var notes = parseRecentNotes_(lead.recent_notes_json);
    var latest = notes.length ? notes[notes.length - 1] : null;
    var compliance = toBool_(lead.compliance_mailer_check);
    return {
      lead_id: lead.lead_id,
      address: lead.address,
      seller_name: lead.seller_name,
      status: lead.status,
      status_label: STATUS_LABELS_[lead.status] || lead.status,
      assigned_to: lead.assigned_to,
      assignee_name: names[lead.assigned_to] ||
        (isTeamQueue_(lead.assigned_to) ? lead.assigned_to.slice(5) + ' team' : ''),
      compliance_mailer_check: compliance,
      flag_juan: toBool_(lead.flag_juan),
      reason: compliance ? 'Mailer or check mentioned' : 'Flagged',
      flagged_at: compliance
        ? String(lead.compliance_flagged_at || lead.flagged_at || '')
        : String(lead.flagged_at || ''),
      latest_note: latest ? latest.text : '',
      latest_note_by: latest ? latest.by : '',
      latest_note_at: latest ? latest.at : ''
    };
  }).sort(function (a, b) {
    // Compliance first, then oldest flag first - the ones waiting longest.
    if (a.compliance_mailer_check !== b.compliance_mailer_check) {
      return a.compliance_mailer_check ? -1 : 1;
    }
    return String(a.flagged_at).localeCompare(String(b.flagged_at));
  });
}

/**
 * Who worked the board today (5.8). Everyone sees the per-user counts; only
 * MANAGER+ get the full snapshot table.
 */
function teamActivity_(ctx, today, leads) {
  var activity = readActivityForDate_(today);
  var snapshot = repSnapshot_(activity, leads, today);

  if (can_(ctx, 'viewRepSnapshot')) {
    return { detailed: true, rows: snapshot };
  }

  return {
    detailed: false,
    rows: snapshot.map(function (row) {
      return {
        user_id: row.user_id,
        name: row.name,
        leadsTouched: row.leadsTouched,
        attempts: row.attempts,
        notes: row.notes,
        statusChanges: row.statusChanges
      };
    })
  };
}

/** getWorkQueue - the queue on its own, for a cheap refresh. */
function getWorkQueue_(ctx) {
  var today = businessToday_();
  var leads = filterVisibleLeads_(ctx, readAll_(SHEET_NAMES_.LEADS));
  return presentQueue_(classifyQueue_(leads, today), userNamesById_(), today);
}

/** getRepSnapshot {date} - MANAGER+ only (4.3). */
function getRepSnapshot_(ctx, payload) {
  requireCapability_(ctx, 'viewRepSnapshot', 'see the rep snapshot');
  var date = payload && payload.date ? requireIsoDate_('date', payload.date) : businessToday_();
  var leads = readAll_(SHEET_NAMES_.LEADS);
  return { date: date, rows: repSnapshot_(readActivityForDate_(date), leads, date) };
}

/**
 * getJuanDashboard - the questions in 6.9, answered from real data in one call.
 *
 * Counts derived from LEADS are labelled separately from the ones that come from
 * the daily log, so the two are never confused (6.4).
 */
function getJuanDashboard_(ctx, payload) {
  requireCapability_(ctx, 'viewJuanDashboard', 'see the management dashboard');

  var today = businessToday_();
  var leads = readAll_(SHEET_NAMES_.LEADS);
  var names = userNamesById_();
  var activity = readActivityForDate_(today);
  var queue = classifyQueue_(leads, today);

  var statusMovesToday = { appointmentsSet: 0, contracts: 0, closes: 0 };
  activity.forEach(function (row) {
    if (row.action_type !== ACTION_.STATUS_CHANGED) return;
    if (row.new_value === STATUS_.APPOINTMENT_SET) statusMovesToday.appointmentsSet++;
    if (row.new_value === STATUS_.UNDER_CONTRACT) statusMovesToday.contracts++;
    if (row.new_value === STATUS_.CLOSED) statusMovesToday.closes++;
  });

  return {
    businessToday: today,
    repSnapshot: repSnapshot_(activity, leads, today),
    queueCounts: {
      overdue: queue.overdue.length,
      dueToday: queue.dueToday.length,
      upcoming: queue.upcoming.length,
      noNextAction: queue.noNextAction.length,
      noDueDate: queue.noDueDate.length
    },
    waitingOnJuan: waitingOnJuan_(leads, names),
    upcomingAppointments: listAppointments_(ctx, { from: today, to: addDays_(today, 14) }),
    // Source-labelled on purpose: these come from lead statuses changing today,
    // NOT from the daily log that drives the Numbers tab (6.4).
    fromLeadStatusesToday: statusMovesToday,
    fromDailyLog: getNumbersDashboard_(ctx, {}),
    changedToday: activity.length
  };
}
