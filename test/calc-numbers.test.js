'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

const TODAY = '2026-09-11'; // Friday. Month window from 09-01, 30-day window from 08-12.

/**
 * Four logged days chosen so that each window excludes something:
 *   09-01, 09-05  in the month AND in the 30 days
 *   08-20         in the 30 days only
 *   07-30         in neither
 * Day 09-05 leaves minutes_to_first_call BLANK, which is the blank-vs-zero case.
 */
const METRICS = [
  {
    business_date: '2026-09-01', tv_spend: 100, ppc_spend: 50, ppl_spend: 0, other_spend: 0,
    new_leads: 10, inbound_calls: 8, missed_calls: 2, sellers_reached: 5, appointments_set: 2,
    contracts_signed: 1, contracts_fell_out: 0, deals_closed: 1, minutes_to_first_call: 12,
    updated_by: 'USR-1'
  },
  {
    business_date: '2026-09-05', tv_spend: 0, ppc_spend: 150, ppl_spend: 25, other_spend: 25,
    new_leads: 6, inbound_calls: 4, missed_calls: 4, sellers_reached: 3, appointments_set: 1,
    contracts_signed: 1, contracts_fell_out: 1, deals_closed: 0, minutes_to_first_call: '',
    updated_by: 'USR-2'
  },
  {
    business_date: '2026-08-20', tv_spend: 200, ppc_spend: 0, ppl_spend: 0, other_spend: 0,
    new_leads: 4, inbound_calls: 8, missed_calls: 0, sellers_reached: 2, appointments_set: 1,
    contracts_signed: 0, contracts_fell_out: 0, deals_closed: 1, minutes_to_first_call: 30,
    updated_by: 'USR-1'
  },
  {
    business_date: '2026-07-30', tv_spend: 999, ppc_spend: 999, ppl_spend: 999, other_spend: 999,
    new_leads: 99, inbound_calls: 99, missed_calls: 99, sellers_reached: 99, appointments_set: 99,
    contracts_signed: 99, contracts_fell_out: 99, deals_closed: 99, minutes_to_first_call: 99,
    updated_by: 'USR-1'
  }
];

const LEADS = [
  { lead_id: 'L1', source: 'PPC', created_at: '2026-09-02T10:00:00Z', status: 'CLOSED' },
  { lead_id: 'L2', source: 'ppc', created_at: '2026-09-03T10:00:00Z', status: 'UNDER_CONTRACT' },
  { lead_id: 'L3', source: 'TV', created_at: '2026-08-01T10:00:00Z', status: 'NEW' },
  { lead_id: 'L4', source: 'TV', created_at: '2026-08-20T10:00:00Z', status: 'APPOINTMENT_SET' },
  { lead_id: 'L5', source: 'Other', created_at: '2026-09-10T10:00:00Z', status: 'NEW' }
];

test('the month window starts at the first of the business month', () => {
  const rows = C.rowsInMonth_(METRICS, TODAY);
  assert.deepEqual(rows.map((r) => r.business_date), ['2026-09-01', '2026-09-05']);
});

test('the 30-day window is businessToday - 30 days, inclusive', () => {
  const rows = C.rowsInWindow30_(METRICS, TODAY);
  assert.deepEqual(rows.map((r) => r.business_date),
    ['2026-09-01', '2026-09-05', '2026-08-20']);
  const edge = [{ business_date: '2026-08-12' }, { business_date: '2026-08-11' }];
  assert.deepEqual(C.rowsInWindow30_(edge, TODAY).map((r) => r.business_date), ['2026-08-12']);
});

test('spend is the four channels added together', () => {
  assert.equal(C.spendOfDay_(METRICS[0]), 150);
  assert.equal(C.spendOfDay_(METRICS[1]), 200);
  assert.equal(C.totalSpend_(C.rowsInWindow30_(METRICS, TODAY)), 550);
  assert.equal(C.totalSpend_(C.rowsInMonth_(METRICS, TODAY)), 350);
  assert.equal(C.spendOfDay_({}), 0, 'a day with nothing entered spent nothing');
});

test('deals closed for the month come from the daily log, not from lead statuses (6.4)', () => {
  const closed = C.sumField_(C.rowsInMonth_(METRICS, TODAY), 'deals_closed');
  assert.equal(closed, 1);
  const closedLeads = LEADS.filter((l) => l.status === 'CLOSED').length;
  assert.equal(closedLeads, 1);
  assert.equal(C.sumField_(C.rowsInWindow30_(METRICS, TODAY), 'deals_closed'), 2,
    'the 30-day count differs from the month count - the two must never be conflated');
});

test('pace = target x dayOfMonth / daysInMonth (6.4)', () => {
  const behind = C.pace_(1, 3, TODAY); // 3 x 11/30 = 1.1
  assert.equal(behind.expected, 1.1);
  assert.equal(behind.ahead, false);
  assert.equal(behind.message, 'Behind pace by 0.1 deals.');
  assert.equal(Math.round(behind.barPercent * 100) / 100, 33.33);

  const ahead = C.pace_(2, 3, TODAY);
  assert.equal(ahead.ahead, true);
  assert.equal(ahead.message, 'Pace for day 11 is 1.1. On or ahead of pace.');

  const exact = C.pace_(1.1, 3, TODAY);
  assert.equal(exact.ahead, true, 'exactly on pace counts as on pace');

  const capped = C.pace_(9, 3, TODAY);
  assert.equal(capped.barPercent, 100, 'the bar never exceeds 100%');

  const noTarget = C.pace_(2, 0, TODAY);
  assert.equal(noTarget.barPercent, 0, 'no target means no bar, not a divide by zero');
});

test('the 30-day funnel and its four carried-through conversions (6.4)', () => {
  const funnel = C.funnel30_(C.rowsInWindow30_(METRICS, TODAY));
  assert.deepEqual(
    {
      newLeads: funnel.newLeads, inboundCalls: funnel.inboundCalls,
      sellersReached: funnel.sellersReached, appointments: funnel.appointments,
      contracts: funnel.contracts, closed: funnel.closed
    },
    { newLeads: 20, inboundCalls: 20, sellersReached: 10, appointments: 4, contracts: 2, closed: 2 }
  );
  assert.equal(funnel.conversions.reachedOfNew, 0.5);
  assert.equal(funnel.conversions.appointmentsOfReached, 0.4);
  assert.equal(funnel.conversions.contractsOfAppointments, 0.5);
  assert.equal(funnel.conversions.closedOfContracts, 1);
});

test('the eight cost cells (6.4)', () => {
  const rows = C.rowsInWindow30_(METRICS, TODAY);
  const costs = C.costs_(C.totalSpend_(rows), C.funnel30_(rows), rows);
  assert.equal(costs.spend, 550);
  assert.equal(costs.perLead, 27.5);
  assert.equal(costs.perAppointment, 137.5);
  assert.equal(costs.perContract, 275);
  assert.equal(costs.perClosedDeal, 275);
  assert.equal(costs.contractToClose, 1);
  assert.equal(costs.fellOutAfterContract, 0.5);
});

// Finding A6: the average is taken only over days where a speed was entered.
test('average speed to first call excludes blank days, it does not treat them as 0', () => {
  const rows = C.rowsInWindow30_(METRICS, TODAY);
  assert.equal(C.meanNonBlank_(rows, 'minutes_to_first_call'), 21, '(12 + 30) / 2');
  assert.notEqual(C.meanNonBlank_(rows, 'minutes_to_first_call'), 14, 'which is (12 + 0 + 30) / 3');
  assert.equal(C.countNonBlank_(rows, 'minutes_to_first_call'), 2);
  assert.equal(C.meanNonBlank_([{ x: '' }, { x: null }], 'x'), null, 'no entries means no average');
});

test('inbound calls missed = missed / (inbound + missed) (6.4)', () => {
  assert.equal(C.missedRate_(C.rowsInWindow30_(METRICS, TODAY)), 6 / 26);
  assert.equal(C.missedRate_([{ inbound_calls: 0, missed_calls: 0 }]), null, 'no calls, no rate');
});

// Finding A6 / C6: the prototype compared 30-day spend with all-time lead counts.
test('the channel table bounds spend AND lead counts to the same 30 days (6.4)', () => {
  const table = C.channelTable_(C.rowsInWindow30_(METRICS, TODAY), LEADS, TODAY);
  const byChannel = Object.fromEntries(table.map((r) => [r.channel, r]));

  assert.deepEqual(table.map((r) => r.channel), ['TV', 'PPC', 'PPL', 'Other']);

  assert.equal(byChannel.TV.spend, 300);
  assert.equal(byChannel.TV.leads, 1, 'the 2026-08-01 TV lead is outside the window');
  assert.equal(byChannel.TV.perLead, 300);
  assert.equal(byChannel.TV.appointments, 1);
  assert.equal(byChannel.TV.contracts, 0);
  assert.equal(byChannel.TV.closed, 0);
  assert.equal(byChannel.TV.perDeal, null, 'no closings means no cost per deal, not $300');

  assert.equal(byChannel.PPC.spend, 200);
  assert.equal(byChannel.PPC.leads, 2, 'source matching is case-insensitive');
  assert.equal(byChannel.PPC.perLead, 100);
  assert.equal(byChannel.PPC.appointments, 2, 'under contract and closed both got that far');
  assert.equal(byChannel.PPC.contracts, 2);
  assert.equal(byChannel.PPC.closed, 1);
  assert.equal(byChannel.PPC.perDeal, 200);

  assert.equal(byChannel.PPL.leads, 0);
  assert.equal(byChannel.PPL.perLead, null, 'spend with no leads is not a divide by zero');
  assert.equal(byChannel.Other.leads, 1);
  assert.equal(byChannel.Other.perLead, 25);
});

test('day by day is the newest 20 logged days with the updating user resolved (6.4)', () => {
  const rows = C.dayByDay_(METRICS, 20, { 'USR-1': 'Juan', 'USR-2': 'Thea' });
  assert.deepEqual(rows.map((r) => r.business_date),
    ['2026-09-05', '2026-09-01', '2026-08-20', '2026-07-30']);
  assert.equal(rows[0].by, 'Thea');
  assert.equal(rows[1].by, 'Juan');
  assert.equal(rows[0].spend, 200);
  assert.equal(C.dayByDay_(METRICS, 2, {}).length, 2, 'the limit is honoured');
  assert.equal(C.dayByDay_(METRICS, 20, {})[0].by, 'USR-2', 'an unknown id falls back to the id');
});

test('a blank metric stays blank in day by day - it never renders as 0', () => {
  const rows = C.dayByDay_([{ business_date: '2026-09-11', new_leads: '', deals_closed: 0 }], 20, {});
  assert.equal(rows[0].new_leads, null, 'not entered');
  assert.equal(rows[0].deals_closed, 0, 'entered as zero');
});

test('sumField_ skips blanks without turning them into zeros', () => {
  assert.equal(C.sumField_([{ n: 5 }, { n: '' }, { n: 3 }, { n: null }], 'n'), 8);
  assert.equal(C.sumField_([], 'n'), 0);
});
