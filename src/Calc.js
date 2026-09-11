/**
 * Calc.js - underwriting, the Numbers formulas (6.4), work-queue classification,
 * tool streaks (6.10), staleness (6.6) and duplicate detection (6.7).
 *
 * PURE FILE (4.1). Loaded after Dates.js and Validate.js.
 *
 * Two rules run through everything here:
 *   - Blank is not zero (3.2.5). A blank minutes_to_first_call is excluded from
 *     the average; a blank new_leads is not counted as a zero.
 *   - Division by zero returns null, never 0 and never NaN. The client renders
 *     null as "-" (6.4).
 */

/* ------------------------------------------------------------ arithmetic */

/** null when the denominator is missing or zero (6.4 "division by zero shows -"). */
function ratio_(numerator, denominator) {
  var n = toNumberOrNull_(numerator);
  var d = toNumberOrNull_(denominator);
  if (n === null || d === null || d === 0) return null;
  return n / d;
}

/** Sums a field across rows, skipping blanks. Returns 0 when nothing was entered. */
function sumField_(rows, field) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = toNumberOrNull_(rows[i][field]);
    if (n !== null) total += n;
  }
  return total;
}

/** Mean over rows where the field is NOT blank. null when no row has a value. */
function meanNonBlank_(rows, field) {
  var total = 0;
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = toNumberOrNull_(rows[i][field]);
    if (n !== null) { total += n; count++; }
  }
  return count === 0 ? null : total / count;
}

function countNonBlank_(rows, field) {
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (toNumberOrNull_(rows[i][field]) !== null) count++;
  }
  return count;
}

function roundTo_(value, places) {
  if (value === null || value === undefined || !isFinite(value)) return null;
  var factor = Math.pow(10, places || 0);
  return Math.round(value * factor) / factor;
}

/* --------------------------------------------------------- underwriting */

/**
 * MAO = ARV x mao_percentage / 100 - Repairs (6.5).
 * null when ARV was never entered - we do not pretend a blank ARV is $0.
 */
function mao_(arv, maoPercentage, repairs) {
  var a = toNumberOrNull_(arv);
  if (a === null) return null;
  var pct = toNumberOrNull_(maoPercentage);
  if (pct === null) return null;
  var r = toNumberOrNull_(repairs) || 0;
  return a * pct / 100 - r;
}

/** Offer room = MAO - asking price when asking is entered, else MAO (6.5). */
function offerRoom_(maoValue, askingPrice) {
  if (maoValue === null || maoValue === undefined) return null;
  var ask = toNumberOrNull_(askingPrice);
  return ask === null ? maoValue : maoValue - ask;
}

/** Convenience for the card and the "offer room" sort. */
function leadOfferRoom_(lead, maoPercentage) {
  return offerRoom_(mao_(lead.arv, maoPercentage, lead.repairs), lead.asking_price);
}

/* ------------------------------------------------------------- windows */

/** Rows whose business_date is on or after the first of the current month (6.4). */
function rowsInMonth_(rows, isoToday) {
  var start = monthWindowStart_(isoToday);
  return rows.filter(function (row) {
    return isWithin_(datePartOf_(row.business_date), start, isoToday);
  });
}

/** Rows whose business_date is within businessToday - 30 days (6.4). */
function rowsInWindow30_(rows, isoToday) {
  var start = window30Start_(isoToday);
  return rows.filter(function (row) {
    return isWithin_(datePartOf_(row.business_date), start, isoToday);
  });
}

/** Spend (day) = tv + ppc + ppl + other (6.4). */
function spendOfDay_(row) {
  return (toNumberOrNull_(row.tv_spend) || 0) +
    (toNumberOrNull_(row.ppc_spend) || 0) +
    (toNumberOrNull_(row.ppl_spend) || 0) +
    (toNumberOrNull_(row.other_spend) || 0);
}

function totalSpend_(rows) {
  var total = 0;
  for (var i = 0; i < rows.length; i++) total += spendOfDay_(rows[i]);
  return total;
}

/* ------------------------------------------------------- pace this month */

/**
 * Expected pace = target x dayOfMonth / daysInMonth (6.4).
 * @return {{closed:number, target:number, expected:number, ahead:boolean,
 *           message:string, barPercent:number}}
 */
function pace_(closed, target, isoToday) {
  var closedCount = toNumberOrNull_(closed) || 0;
  var targetCount = toNumberOrNull_(target) || 0;
  var day = dayOfMonth_(isoToday);
  var inMonth = daysInMonth_(isoToday);
  var expected = targetCount * day / inMonth;
  var ahead = closedCount >= expected;
  var expectedShown = roundTo_(expected, 1);
  var message = ahead
    ? 'Pace for day ' + day + ' is ' + expectedShown + '. On or ahead of pace.'
    : 'Behind pace by ' + roundTo_(expected - closedCount, 1) + ' deals.';
  return {
    closed: closedCount,
    target: targetCount,
    expected: expectedShown,
    ahead: ahead,
    message: message,
    barPercent: targetCount > 0 ? Math.min(100, closedCount / targetCount * 100) : 0
  };
}

/* ------------------------------------------------------- last 30 days */

/** The six funnel totals and the four "carried through" conversions (6.4). */
function funnel30_(rows) {
  var funnel = {
    newLeads: sumField_(rows, 'new_leads'),
    inboundCalls: sumField_(rows, 'inbound_calls'),
    sellersReached: sumField_(rows, 'sellers_reached'),
    appointments: sumField_(rows, 'appointments_set'),
    contracts: sumField_(rows, 'contracts_signed'),
    closed: sumField_(rows, 'deals_closed')
  };
  funnel.conversions = {
    reachedOfNew: ratio_(funnel.sellersReached, funnel.newLeads),
    appointmentsOfReached: ratio_(funnel.appointments, funnel.sellersReached),
    contractsOfAppointments: ratio_(funnel.contracts, funnel.appointments),
    closedOfContracts: ratio_(funnel.closed, funnel.contracts)
  };
  return funnel;
}

/** The eight cost cells (6.4). */
function costs_(spend30, funnel, rows) {
  return {
    spend: spend30,
    perLead: ratio_(spend30, funnel.newLeads),
    perAppointment: ratio_(spend30, funnel.appointments),
    perContract: ratio_(spend30, funnel.contracts),
    perClosedDeal: ratio_(spend30, funnel.closed),
    contractToClose: ratio_(funnel.closed, funnel.contracts),
    fellOutAfterContract: ratio_(sumField_(rows, 'contracts_fell_out'), funnel.contracts),
    averageSpeedToFirstCall: meanNonBlank_(rows, 'minutes_to_first_call'),
    inboundCallsMissed: missedRate_(rows)
  };
}

/**
 * missed / (inbound + missed) (6.4). The prototype treats "Inbound calls" as
 * answered calls, so missed calls are added back to form the denominator.
 */
function missedRate_(rows) {
  var missed = sumField_(rows, 'missed_calls');
  var inbound = sumField_(rows, 'inbound_calls');
  return ratio_(missed, inbound + missed);
}

/* -------------------------------------------------- where the money went */

/**
 * Channel table over the SAME 30-day window on both sides (6.4).
 *
 * Deliberate change from the prototype, which compared 30-day spend against
 * all-time lead counts (finding A6 / C6). Lead counts here are bounded by
 * created_at inside the window; the UI hint line says so.
 */
function channelTable_(metricRows, leads, isoToday) {
  var start = window30Start_(isoToday);
  var spendFields = { TV: 'tv_spend', PPC: 'ppc_spend', PPL: 'ppl_spend', Other: 'other_spend' };
  var apptStatuses = [STATUS_.APPOINTMENT_SET, STATUS_.UNDER_CONTRACT, STATUS_.CLOSED];
  var contractStatuses = [STATUS_.UNDER_CONTRACT, STATUS_.CLOSED];

  return CHANNELS_.map(function (channel) {
    var spend = sumField_(metricRows, spendFields[channel]);
    var channelLeads = leads.filter(function (lead) {
      if (trimString_(lead.source).toLowerCase() !== channel.toLowerCase()) return false;
      return isWithin_(datePartOf_(lead.created_at), start, isoToday);
    });
    var appts = channelLeads.filter(function (l) { return apptStatuses.indexOf(l.status) >= 0; }).length;
    var contracts = channelLeads.filter(function (l) { return contractStatuses.indexOf(l.status) >= 0; }).length;
    var closed = channelLeads.filter(function (l) { return l.status === STATUS_.CLOSED; }).length;
    return {
      channel: channel,
      spend: spend,
      leads: channelLeads.length,
      perLead: ratio_(spend, channelLeads.length),
      appointments: appts,
      contracts: contracts,
      closed: closed,
      perDeal: ratio_(spend, closed)
    };
  });
}

/* --------------------------------------------------------- day by day */

/** Last N logged days, newest first (6.4). "By" is the updating user's name. */
function dayByDay_(rows, limit, nameByUserId) {
  var names = nameByUserId || {};
  return rows.slice()
    .sort(function (a, b) { return compareIso_(String(b.business_date), String(a.business_date)); })
    .slice(0, limit || 20)
    .map(function (row) {
      var by = row.updated_by || row.created_by || '';
      return {
        business_date: row.business_date,
        spend: spendOfDay_(row),
        new_leads: toNumberOrNull_(row.new_leads),
        inbound_calls: toNumberOrNull_(row.inbound_calls),
        missed_calls: toNumberOrNull_(row.missed_calls),
        sellers_reached: toNumberOrNull_(row.sellers_reached),
        appointments_set: toNumberOrNull_(row.appointments_set),
        contracts_signed: toNumberOrNull_(row.contracts_signed),
        deals_closed: toNumberOrNull_(row.deals_closed),
        by: names[by] || by
      };
    });
}

/* --------------------------------------------------------- work queue */

/**
 * Work queue sections, in the Today tab's priority order (5.8):
 * Overdue -> Due today -> Upcoming (next 7 days) -> No next action -> No due date.
 *
 * Buckets are mutually exclusive: each live lead lands in the first one it
 * matches, so a lead is never chased twice in the same list.
 */
function classifyQueue_(leads, isoToday) {
  var queue = { overdue: [], dueToday: [], upcoming: [], noNextAction: [], noDueDate: [] };
  var horizon = addDays_(isoToday, 7);

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    if (!isLiveStatus_(lead.status)) continue;

    var due = isIsoDate_(trimString_(lead.due_date)) ? trimString_(lead.due_date) : '';
    var hasNextAction = !isBlank_(lead.next_action);

    if (due && compareIso_(due, isoToday) < 0) queue.overdue.push(lead);
    else if (due && due === isoToday) queue.dueToday.push(lead);
    else if (due && compareIso_(due, horizon) <= 0) queue.upcoming.push(lead);
    else if (!hasNextAction) queue.noNextAction.push(lead);
    else if (!due) queue.noDueDate.push(lead);
  }

  queue.overdue.sort(function (a, b) { return compareIso_(a.due_date, b.due_date); });
  queue.dueToday.sort(function (a, b) { return compareIso_(a.due_date, b.due_date); });
  queue.upcoming.sort(function (a, b) { return compareIso_(a.due_date, b.due_date); });
  return queue;
}

/** last_touched_at older than stale_lead_days (6.6). */
function isStale_(lastTouchedAt, isoToday, staleDays) {
  var touched = datePartOf_(lastTouchedAt);
  if (!touched) return true;
  return daysBetween_(touched, isoToday) >= (toNumberOrNull_(staleDays) || 7);
}

function daysUntouched_(lastTouchedAt, isoToday) {
  var touched = datePartOf_(lastTouchedAt);
  return touched ? daysBetween_(touched, isoToday) : null;
}

/* -------------------------------------------------------- tool streaks */

/** A tool is due on a date when its cadence says so. Weekday tools rest (6.10). */
function isToolDueOn_(cadence, isoDate) {
  if (cadence === 'Every day') return true;
  if (cadence === 'Every weekday') return !isWeekend_(isoDate);
  return false;
}

function dailyTools_(tools) {
  return tools.filter(function (tool) { return DAILY_CADENCES_.indexOf(tool.cadence) >= 0; });
}

/**
 * Consecutive days back from today where every daily tool DUE that day has a DONE
 * run (6.10). A weekend does not break a streak built on "Every weekday" tools -
 * the prototype's bug (finding C2) was that it did.
 *
 * @param {!Array<!Object>} tools every tool; non-daily cadences are ignored
 * @param {!Object<string, !Object<string, boolean>>} doneByDate date -> toolId -> true
 * @param {string} isoToday
 * @param {number=} maxDays default 60
 */
function toolStreak_(tools, doneByDate, isoToday, maxDays) {
  var daily = dailyTools_(tools);
  if (!daily.length) return 0;
  var limit = maxDays || 60;
  var done = doneByDate || {};
  var streak = 0;

  for (var back = 0; back < limit; back++) {
    var date = addDays_(isoToday, -back);
    var dueToday = daily.filter(function (tool) { return isToolDueOn_(tool.cadence, date); });
    var allDone = true;
    for (var i = 0; i < dueToday.length; i++) {
      if (!done[date] || !done[date][dueToday[i].tool_id]) { allDone = false; break; }
    }
    if (!allDone) break;
    streak++;
  }
  return streak;
}

/* ---------------------------------------------------------- duplicates */

/**
 * Duplicate classification for create and bulk import (6.7).
 *
 *   EXACT    same address_normalized among leads not in ARCHIVED_BAD_DATA
 *            -> skip the row, report the existing lead_id
 *   POSSIBLE same phone_normalized with a DIFFERENT address
 *            -> insert, set possible_duplicate_of, chip on the card
 *   NONE     insert normally
 *
 * Two sellers are never auto-merged.
 *
 * @return {{kind: string, leadId: string}}
 */
function classifyDuplicate_(candidate, existingLeads) {
  var address = normalizeAddress_(candidate.address);
  var phone = normalizePhone_(candidate.phone);

  for (var i = 0; i < existingLeads.length; i++) {
    var existing = existingLeads[i];
    if (existing.status === STATUS_.ARCHIVED_BAD_DATA) continue;
    if (address && normalizeAddress_(existing.address_normalized || existing.address) === address) {
      return { kind: 'EXACT', leadId: existing.lead_id };
    }
  }

  if (phone) {
    for (var j = 0; j < existingLeads.length; j++) {
      var other = existingLeads[j];
      if (other.status === STATUS_.ARCHIVED_BAD_DATA) continue;
      var otherPhone = normalizePhone_(other.phone_normalized || other.phone);
      var otherAddress = normalizeAddress_(other.address_normalized || other.address);
      if (otherPhone && otherPhone === phone && otherAddress !== address) {
        return { kind: 'POSSIBLE', leadId: other.lead_id };
      }
    }
  }

  return { kind: 'NONE', leadId: '' };
}
