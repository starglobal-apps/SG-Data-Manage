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
    HOURLY_LOG:      ['id', 'date', 'factory', 'line', 'dept', 'srn', 'floor', 'type', 'shift', 'slot', 'qty', 'checked', 'pass', 'reject', 'cartons', 'pcs_per_ctn', 'entered_by', 'entered_at'],
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
                  'End Line Checker', 'Final Checker', 'Data Collector', 'Line Qc.']
};
