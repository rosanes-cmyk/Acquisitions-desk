/**
 * AppointmentService.js - the APPOINTMENTS history behind the lead card (3.3).
 *
 * The rule from 3.3: setting an appointment date on the card upserts the lead's
 * current SCHEDULED row; entering a visit outcome completes it; a new date after
 * completion starts a new row. LEADS keeps appointment_date / appointment_time /
 * appointment_outcome as the current summary, so the board needs no join.
 */

/** The one SCHEDULED appointment for a lead, or null. */
function findScheduledAppointment_(leadId) {
  var rows = readAll_(SHEET_NAMES_.APPOINTMENTS);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].lead_id) === String(leadId) && rows[i].status === 'SCHEDULED') {
      return rows[i];
    }
  }
  return null;
}

function appointmentsForLead_(leadId) {
  return readAll_(SHEET_NAMES_.APPOINTMENTS).filter(function (row) {
    return String(row.lead_id) === String(leadId);
  });
}

/**
 * Upserts the lead's current SCHEDULED appointment. Called from the lead service
 * inside the lead's own lock, so no separate lock is taken here.
 */
function upsertScheduledAppointment_(ctx, lead, date, time, nowIso) {
  var existing = findScheduledAppointment_(lead.lead_id);
  var kinds = columnKinds_(SHEET_NAMES_.APPOINTMENTS);

  if (existing) {
    var found = findRowById_(SHEET_NAMES_.APPOINTMENTS, 'appointment_id', existing.appointment_id);
    writeRowCells_(SHEET_NAMES_.APPOINTMENTS, found.rowIndex, {
      appointment_date: date,
      appointment_time: time || '',
      assigned_to: String(lead.assigned_to || ''),
      updated_by: ctx.user_id,
      updated_at: nowIso
    }, kinds);
    return existing.appointment_id;
  }

  var appointmentId = newUniqueId_(ID_PREFIX_.APPOINTMENT, compactDate_(date || businessToday_()));
  appendRow_(SHEET_NAMES_.APPOINTMENTS, {
    appointment_id: appointmentId,
    lead_id: lead.lead_id,
    appointment_date: date,
    appointment_time: time || '',
    timezone: businessTimezone_(),
    assigned_to: String(lead.assigned_to || ''),
    status: 'SCHEDULED',
    outcome: '',
    notes: '',
    created_by: ctx.user_id,
    created_at: nowIso,
    updated_by: ctx.user_id,
    updated_at: nowIso
  }, kinds);
  return appointmentId;
}

/**
 * Records the visit outcome and completes the scheduled appointment. A later date
 * then creates a fresh SCHEDULED row rather than reopening this one.
 */
function completeScheduledAppointment_(ctx, lead, outcome, nowIso) {
  var existing = findScheduledAppointment_(lead.lead_id);
  if (!existing) return '';
  var found = findRowById_(SHEET_NAMES_.APPOINTMENTS, 'appointment_id', existing.appointment_id);
  writeRowCells_(SHEET_NAMES_.APPOINTMENTS, found.rowIndex, {
    status: 'COMPLETED',
    outcome: outcome,
    updated_by: ctx.user_id,
    updated_at: nowIso
  }, columnKinds_(SHEET_NAMES_.APPOINTMENTS));
  return existing.appointment_id;
}

/** listAppointments {from, to} - the upcoming-appointments question in 6.9. */
function listAppointments_(ctx, payload) {
  var from = requireIsoDate_('from', payload.from, true);
  var to = requireIsoDate_('to', payload.to, true);
  var leadsById = {};
  readAll_(SHEET_NAMES_.LEADS).forEach(function (lead) { leadsById[lead.lead_id] = lead; });

  var rows = readAll_(SHEET_NAMES_.APPOINTMENTS).filter(function (row) {
    var date = String(row.appointment_date || '');
    if (!isIsoDate_(date)) return false;
    if (from && compareIso_(date, from) < 0) return false;
    if (to && compareIso_(date, to) > 0) return false;
    var lead = leadsById[row.lead_id];
    return !lead || canSeeLead_(ctx, lead);
  });

  rows.sort(function (a, b) {
    return compareIso_(String(a.appointment_date), String(b.appointment_date)) ||
      String(a.appointment_time).localeCompare(String(b.appointment_time));
  });

  return rows.map(function (row) {
    var lead = leadsById[row.lead_id];
    return {
      appointment_id: row.appointment_id,
      lead_id: row.lead_id,
      address: lead ? lead.address : '',
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      status: row.status,
      outcome: row.outcome,
      assigned_to: row.assigned_to
    };
  });
}
