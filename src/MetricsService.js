/**
 * MetricsService.js - the daily log and the Numbers tab (4.10 METRICS, 6.4).
 *
 * Every formula lives in Calc.js and is covered by Tier 1 against hand-computed
 * values. Nothing on this tab is hard-coded, and no total is computed in the
 * browser (9.5).
 */

/** The 13 numbers a person can type into the daily log (3.3 DAILY_METRICS). */
var DAILY_METRIC_FIELDS_ = ['tv_spend', 'ppc_spend', 'ppl_spend', 'other_spend', 'new_leads',
  'inbound_calls', 'missed_calls', 'sellers_reached', 'appointments_set', 'contracts_signed',
  'contracts_fell_out', 'deals_closed', 'minutes_to_first_call'];

function getDailyMetrics_(ctx, payload) {
  var date = payload && payload.date ? requireIsoDate_('date', payload.date) : businessToday_();
  var found = findRowById_(SHEET_NAMES_.DAILY_METRICS, 'business_date', date);
  var names = userNamesById_();

  if (!found) {
    return { business_date: date, logged: false, version: 0, data: {}, logged_by: '' };
  }

  var data = {};
  DAILY_METRIC_FIELDS_.forEach(function (field) {
    // Blank stays blank so the input renders empty, not 0 (3.2.5).
    data[field] = toNumberOrNull_(found.record[field]);
  });

  var by = String(found.record.updated_by || found.record.created_by || '');
  return {
    business_date: date,
    logged: true,
    version: toNumberOrNull_(found.record.version) || 0,
    data: data,
    logged_by: names[by] || by,
    updated_at: found.record.updated_at
  };
}

/**
 * saveDailyMetrics {date, data, expectedVersion} - upsert by business_date under
 * lock (3.3). Saving today again updates today's row rather than adding one.
 */
function saveDailyMetrics_(ctx, payload) {
  requireCapability_(ctx, 'saveDailyMetrics', 'save the daily numbers');
  var date = requireIsoDate_('date', payload.date);
  var incoming = payload.data || {};

  var picked = pickWhitelisted_(incoming, DAILY_METRIC_FIELDS_);
  if (picked.rejected.length) {
    throw validationError_(picked.rejected[0],
      'The daily log does not accept ' + picked.rejected.join(', ') + '.');
  }

  var clean = {};
  DAILY_METRIC_FIELDS_.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(picked.clean, field)) return;
    var value = requireNonNegativeNumberOrBlank_(field, picked.clean[field]);
    clean[field] = value === null ? '' : value;
  });

  return withLock_(function () {
    var found = findRowById_(SHEET_NAMES_.DAILY_METRICS, 'business_date', date);
    var nowIso = nowIsoUtc_();
    var kinds = columnKinds_(SHEET_NAMES_.DAILY_METRICS);

    if (found) {
      var currentVersion = toNumberOrNull_(found.record.version) || 0;
      if (!isBlank_(payload.expectedVersion) && Number(payload.expectedVersion) !== currentVersion) {
        throw conflictError_(getDailyMetrics_(ctx, { date: date }));
      }
      var patch = {};
      for (var field in clean) {
        if (Object.prototype.hasOwnProperty.call(clean, field)) patch[field] = clean[field];
      }
      patch.version = currentVersion + 1;
      patch.updated_by = ctx.user_id;
      patch.updated_at = nowIso;
      writeRowCells_(SHEET_NAMES_.DAILY_METRICS, found.rowIndex, patch, kinds);
    } else {
      var row = { business_date: date, created_by: ctx.user_id, created_at: nowIso,
        updated_by: ctx.user_id, updated_at: nowIso, version: 1 };
      DAILY_METRIC_FIELDS_.forEach(function (field) {
        row[field] = Object.prototype.hasOwnProperty.call(clean, field) ? clean[field] : '';
      });
      appendRow_(SHEET_NAMES_.DAILY_METRICS, row, kinds);
    }

    commitAndStamp_();
    return getDailyMetrics_(ctx, { date: date });
  });
}

/**
 * getNumbersDashboard - every section of the Numbers tab, computed server-side
 * from DAILY_METRICS and LEADS (6.4).
 */
function getNumbersDashboard_(ctx, payload) {
  var today = businessToday_();
  var allMetrics = readAll_(SHEET_NAMES_.DAILY_METRICS);
  var leads = readAll_(SHEET_NAMES_.LEADS);
  var names = userNamesById_();

  var monthRows = rowsInMonth_(allMetrics, today);
  var window30 = rowsInWindow30_(allMetrics, today);

  var target = settingNumber_('monthly_deal_target', 3);
  var budget = settingNumber_('monthly_marketing_budget', 0);
  var closedThisMonth = sumField_(monthRows, 'deals_closed');
  var spend30 = totalSpend_(window30);
  var funnel = funnel30_(window30);

  return {
    businessToday: today,
    pace: pace_(closedThisMonth, target, today),
    monthSpend: totalSpend_(monthRows),
    monthlyDealTarget: target,
    monthlyMarketingBudget: budget,
    daysLoggedInWindow: window30.length,
    funnel: funnel,
    costs: costs_(spend30, funnel, window30),
    channels: channelTable_(window30, leads, today),
    dayByDay: dayByDay_(allMetrics, 20, names),
    canSaveTargets: can_(ctx, 'saveTargets')
  };
}
