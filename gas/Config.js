// Config.js — app-wide constants for the SG Data mobile app backend

var CFG = {
  // Blank = use the container-bound spreadsheet. Paste a spreadsheet ID here if the script is standalone.
  SS_ID: '',

  TOKEN_TTL_SEC: 21600, // 6 h (CacheService max)

  FACTORIES: ['666', '117'],

  TABS: {
    USERS: 'USERS',
    MASTERS: 'MASTERS',
    ATT_DAILY: 'ATT_DAILY',
    HOURLY_LOG: 'HOURLY_LOG',
    MANPOWER_EVENTS: 'MANPOWER_EVENTS',
    DAY_SUMMARY: 'DAY_SUMMARY',
    ACTIVE_ORDERS: 'ACTIVE_ORDERS',
    AUDIT_LOG: 'AUDIT_LOG'
  },

  HEADERS: {
    USERS:           ['user_id', 'name', 'pin', 'role', 'factory', 'depts', 'active', 'created_at'],
    MASTERS:         ['type', 'key', 'value', 'factory', 'extra', 'active'],
    ATT_DAILY:       ['id', 'date', 'factory', 'dept', 'shift', 'role', 'hours', 'count', 'entered_by', 'entered_at'],
    HOURLY_LOG:      ['id', 'date', 'factory', 'line', 'dept', 'srn', 'floor', 'type', 'shift', 'slot', 'qty', 'checked', 'pass', 'reject', 'cartons', 'pcs_per_ctn', 'checker', 'entered_by', 'entered_at'],
    MANPOWER_EVENTS: ['id', 'date', 'factory', 'dept', 'role', 'event', 'count', 'time', 'eff_hours', 'note', 'entered_by', 'entered_at'],
    DAY_SUMMARY:     ['id', 'date', 'factory', 'line', 'dept', 'type', 'srn', 'shift', 'payload', 'status', 'flags', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at', 'remark'],
    ACTIVE_ORDERS:   ['factory', 'line', 'dept', 'srn', 'loaded', 'stitched', 'balance', 'last_loading'],
    AUDIT_LOG:       ['at', 'user', 'action', 'ref', 'detail']
  },

  // Columns that must stay plain text (so Sheets does not auto-convert '2026-09-03' into a date)
  TEXT_COLS: {
    USERS: ['pin'],
    ATT_DAILY: ['date'],
    HOURLY_LOG: ['date', 'slot'],
    MANPOWER_EVENTS: ['date', 'time'],
    DAY_SUMMARY: ['date'],
    ACTIVE_ORDERS: ['last_loading']
  },

  USER_ROLES: ['Data Collector', 'Supervisor', 'Manager', 'Admin'],

  SHIFTS: [
    { key: 'Final', label: 'Day (9 AM – 6 PM)',  hours: 8, hourOptions: [8, 7, 4] },
    { key: 'OT',    label: 'OT (6 PM – 10 PM)',  hours: 2, hourOptions: [2, 4, 3, 1] },
    { key: 'Night', label: 'Night (10 PM onwards)', hours: 8, hourOptions: [8, 4] }
  ],

  // Hour slots for hourly output entry. key = 24h, label = what the user sees.
  SLOTS: [
    { key: '09-10', label: '9–10 AM',  shift: 'Final' },
    { key: '10-11', label: '10–11 AM', shift: 'Final' },
    { key: '11-12', label: '11–12',    shift: 'Final' },
    { key: '12-13', label: '12–1 PM',  shift: 'Final' },
    { key: '13-14', label: '1–2 PM',   shift: 'Final' },
    { key: '14-15', label: '2–3 PM',   shift: 'Final' },
    { key: '15-16', label: '3–4 PM',   shift: 'Final' },
    { key: '16-17', label: '4–5 PM',   shift: 'Final' },
    { key: '17-18', label: '5–6 PM',   shift: 'Final' },
    { key: '18-19', label: '6–7 PM',   shift: 'OT' },
    { key: '19-20', label: '7–8 PM',   shift: 'OT' },
    { key: '20-21', label: '8–9 PM',   shift: 'OT' },
    { key: '21-22', label: '9–10 PM',  shift: 'OT' },
    { key: '22-23', label: '10–11 PM', shift: 'Night' },
    { key: '23-00', label: '11–12',    shift: 'Night' },
    { key: '00-01', label: '12–1 AM',  shift: 'Night' },
    { key: '01-02', label: '1–2 AM',   shift: 'Night' },
    { key: '02-03', label: '2–3 AM',   shift: 'Night' },
    { key: '03-04', label: '3–4 AM',   shift: 'Night' },
    { key: '04-05', label: '4–5 AM',   shift: 'Night' },
    { key: '05-06', label: '5–6 AM',   shift: 'Night' }
  ],

  FLOORS: ['Ground', 'First', 'Second'],

  // Fallback role list; setupAppSheets() also pulls every role seen in MASTER DATA attendance
  DEFAULT_ROLES: ['Operator', 'Helper', 'Supervisor', 'Incharge', 'Feeder', 'Thread cutter', 'Checker',
                  'End Line Checker', 'Final Checker', 'Data Collector', 'Line Qc.'],

  // Each dept belongs to one category, and each category has a fixed designation list
  // (derived from attendance history). First matching pattern wins; no match -> CONTRACTOR.
  // MASTERS rows: DEPT.extra = category key, CAT_ROLE key = category, value = role, extra = order.
  DEPT_CATEGORIES: [
    { key: 'STITCH',     label: 'Stitching Line', match: /line/i,
      roles: ['Operator', 'Helper', 'Supervisor', 'Incharge', 'Feeder', 'Data Collector', 'Thread cutter', 'End Line Checker', 'Hand needle', 'Paster'] },
    { key: 'PACKING',    label: 'Packing',        match: /packing/i,
      roles: ['Supervisor', 'Incharge', 'Checker', 'Helper', 'Thread cutter', 'Press Man'] },
    { key: 'QUALITY',    label: 'Quality',        match: /quality/i,
      roles: ['Line Qc.', 'End Line Checker', 'Final Checker'] },
    { key: 'CUTTING',    label: 'Cutting',        match: /cutting/i,
      roles: ['Cutting master', 'Die cutter', 'Layer cutter', 'Helper', 'Incharge', 'Cutting QC'] },
    { key: 'STORE',      label: 'Store',          match: /store/i,
      roles: ['Incharge', 'Assistant', 'Helper', 'Store QC'] },
    { key: 'PREP',       label: 'Preparation',    match: /^(preparation|mi)$/i,
      roles: ['Supervisor', 'Operator', 'Helper'] },
    { key: 'CONTRACTOR', label: 'Contractor',     match: null,
      roles: ['Operator'] }
  ]
};

// ---- App-era boundary ----
// Cumulative checks (loading >= stitching >= endline >= packing) count MASTER DATA rows dated BEFORE this
// and app rows (HOURLY_LOG / DAY_SUMMARY) dated ON/AFTER it, so nothing is double counted after runAllImport.
CFG.APP_START_DATE = '2026-09-03';

CFG.HOURLY_TYPES = [
  { key: 'STITCH',  label: 'Stitching', cat: 'STITCH',  fields: ['qty'] },
  { key: 'ENDLINE', label: 'Endline',   cat: 'STITCH',  fields: ['checked', 'pass', 'reject'] },
  { key: 'PACKING', label: 'Packing',   cat: 'PACKING', fields: ['qty', 'cartons'] }
];

// Manpower change events. eff = how many hours that person effectively worked (null = computed from time)
CFG.MP_EVENTS = [
  { key: 'HALF_DAY',  label: 'Half day (4 hrs)',       eff: 4,    needsTime: false },
  { key: 'LEFT_AT',   label: 'Beech me chala gaya',    eff: null, needsTime: true,  from: 9 },
  { key: 'LATE_JOIN', label: 'Late aaya',              eff: null, needsTime: true,  to: 18 },
  { key: 'ABSENT',    label: 'Absent (attendance ke baad)', eff: 0, needsTime: false },
  { key: 'EXTRA',     label: 'Extra aaya (add)',       eff: 8,    needsTime: false, add: true }
];

// The 5 manpower-type columns (23-27) of the FAC666 stitching source sheet, in order.
// PLACEHOLDER until diagFinalTargets() confirms the real headers.
CFG.STITCH_ROLE_COLS = ['Operator', 'Helper', 'Thread cutter', 'End Line Checker', 'Feeder'];

// Where "Send to Final" appends rows. cols = { sheetColumnNumber: payloadField }.
// keyCol = column used to find the next empty row. minRow = first data row.
// Column positions come from Import.js ranges; run diagFinalTargets() to verify against real headers.
CFG.FINAL_TARGETS = {
  STITCH_666: { srcKey: 'ATT', sheet: 'Data', keyCol: 1, minRow: 2,
    cols: { 1: 'date', 2: 'line', 3: 'dept', 4: 'srn', 5: 'floor', 6: 'shift', 7: 'manpower', 8: 'hours', 9: 'output',
            10: 'supervisor', 11: 'incharge', 23: 'r1', 24: 'r2', 25: 'r3', 26: 'r4', 27: 'r5' } },
  STITCH_117: { srcKey: 'STITCH117', sheet: 'FAC117-Stitching Output', keyCol: 1, minRow: 2,
    cols: { 1: 'date', 2: 'floor', 3: 'line', 4: 'dept', 5: 'srn', 6: 'shift', 7: 'manpower', 8: 'hours', 9: 'output',
            10: 'supervisor', 11: 'incharge', 12: 'r1' } },
  ENDLINE:    { srcKey: 'ENDLINE', sheet: 'Quality Endline data', keyCol: 1, minRow: 3,
    cols: { 1: 'entryDate', 2: 'factoryName', 3: 'date', 4: 'srn', 5: 'item', 6: 'dept', 7: 'qfloor', 8: 'checker',
            9: 'hours', 10: 'checked', 11: 'pass', 12: 'reject' } },
  PACKING:    { srcKey: 'PACKING', sheet: 'Finishing_Res', keyCol: 2, minRow: 2,
    cols: { 2: 'srn', 3: 'date', 5: 'qty', 6: 'cartons', 7: 'pcs_per_ctn', 9: 'factory', 15: 'supervisor', 19: 'hours', 23: 'floor' } },
  ATT_666:    { srcKey: 'ATT', sheet: ' karigar att_666', keyCol: 3, minRow: 2,
    cols: { 3: 'date', 4: 'factory', 5: 'dept', 6: 'role', 7: 'hours', 8: 'count' } },
  ATT_117:    { srcKey: 'ATT', sheet: '117', keyCol: 3, minRow: 2,
    cols: { 3: 'date', 4: 'factory', 5: 'dept', 6: 'role', 7: 'hours', 8: 'count', 9: 'manhours' } },
  ATT_OT:     { srcKey: 'ATT', sheet: 'OT att', keyCol: 3, minRow: 2,
    cols: { 3: 'date', 4: 'factory', 5: 'dept', 6: 'ot', 7: 'role', 8: 'hours', 9: 'count', 10: 'manhours' } }
};

CFG.STATUS = { DRAFT: 'Draft', SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected', SENT: 'Sent' };

function deptCategory_(deptName) {
  var n = str_(deptName), cats = CFG.DEPT_CATEGORIES;
  for (var i = 0; i < cats.length; i++) if (cats[i].match && cats[i].match.test(n)) return cats[i].key;
  return cats[cats.length - 1].key;
}
