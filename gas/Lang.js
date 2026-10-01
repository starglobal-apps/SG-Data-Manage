// Lang.js — the phone app sends lang: 'en'; its replies then carry English messages. The web keeps the original text.
// Each rule: [pattern on the original message, English replacement ($1… = captured parts)].
var EN_RULES_ = [
  [/^Session khatam — dobara login karo$/, 'Session expired — log in again'],
  [/^Request body JSON nahi hai$/, 'Request body is not JSON'],
  [/^Count 1 ya zyada$/, 'Count must be 1 or more'],
  [/^Date galat$/, 'Wrong date'],
  [/^Date yyyy-mm-dd me bhejo$/, 'Send the date as yyyy-mm-dd'],
  [/^(\d+) reject → \d+ defect chuno \(abhi (\d+)\)$/, '$1 rejects → select $1 defects (now $2)'],
  [/^Dept chuno$/, 'Select dept'],
  [/^Line chuno$/, 'Select line'],
  [/^Role do baar aaya: (.*)$/, 'Role entered twice: $1'],
  [/^Kuch badla nahi$/, 'Nothing changed'],
  [/^Kuch bhara nahi$/, 'Nothing filled'],
  [/^Factory galat(: .*)?$/, 'Wrong factory$1'],
  [/^Kuch select karo$/, 'Select something'],
  [/^Dept aur SRN dono chahiye$/, 'Dept and SRN both needed'],
  [/^Dept aur role chahiye$/, 'Dept and role needed'],
  [/^Line aur manpower type chahiye$/, 'Line and manpower type needed'],
  [/^SRN chuno$/, 'Select SRN'],
  [/^Attendance submit ho chuki$/, 'Attendance already submitted'],
  [/^Bahut galat PIN — (\d+) minute baad try karo$/, 'Too many wrong PINs — try after $1 minutes'],
  [/^Ye attendance admin ke paas hai — approve \/ reject hone ke baad update karo$/, 'This attendance is with the admin — update after it is approved / rejected'],
  [/^Ye din (.*) hai — manager se reject karwao tab edit hoga$/, 'This day is $1 — ask the manager to reject it to edit'],
  [/^(.*): attendance submit ho chuki — manager se reject karwao$/, '$1: attendance already submitted — ask the manager to reject it'],
  [/^(.*) hai — edit band$/, '$1 — editing closed'],
  [/^Galat PIN$/, 'Wrong PIN'],
  [/^Ye PIN ek se zyada users ka hai — USERS tab me PIN unique karo$/, 'This PIN belongs to more than one user — make it unique in the USERS tab'],
  [/^Event nahi mila$/, 'Update not found'],
  [/^Is din is line ki attendance nahi mili$/, 'No attendance found for this line on this date'],
  [/^Transfer nahi mila$/, 'Transfer not found'],
  [/^Is date ki attendance nahi mili \(ya pehle se Sent hai\)$/, 'No attendance found for this date (or already Sent)'],
  [/^Is dept me entry ki permission nahi hai$/, 'No permission for this dept'],
  [/^Is line ki permission nahi$/, 'No permission for this line'],
  [/^Permission nahi$/, 'No permission'],
  [/^Sirf admin$/, 'Admin only'],
  [/^Ye transfer aapke liye nahi hai$/, 'This transfer is not for you'],
  [/^(.*) aapki line nahi hai$/, '$1 is not your line'],
  [/^(.*): permission nahi$/, '$1: no permission'],
  [/^PIN daalo$/, 'Enter PIN'],
  [/^Reject ka reason likho$/, 'Enter the reject reason'],
  [/^Shift galat: (.*)$/, 'Wrong shift: $1'],
  [/^Slot galat(: .*)?$/, 'Wrong slot$1'],
  [/^Type galat$/, 'Wrong type'],
  [/^Checked \((\d+)\) = pass \+ reject hona chahiye \((\d+)\)$/, 'Checked ($1) must equal pass + reject ($2)'],
  [/^Checker ka naam likho$/, 'Enter checker name'],
  [/^Floor aur SRN chahiye$/, 'Floor and SRN needed'],
  [/^Galat hours\/count: (.*)$/, 'Wrong hours/count: $1'],
  [/^Half day \/ absent me kitne log — poora number$/, 'Half day / absent — enter a whole number'],
  [/^Half day ke working hour chuno$/, 'Select working hours for half day'],
  [/^Incharge ka naam zaroori hai$/, 'Incharge name is required'],
  [/^Supervisor ka naam zaroori hai$/, 'Supervisor name is required'],
  [/^Kam se kam ek line \/ floor chuno$/, 'Select at least one line / floor'],
  [/^Kam se kam ek role ki qty daalo$/, 'Enter qty for at least one role'],
  [/^Line aur SRN chahiye$/, 'Line and SRN needed'],
  [/^Naam likho$/, 'Enter a name'],
  [/^Negative nahi chalega$/, 'Negative not allowed'],
  [/^SAM minutes me daalo \(jaise 12\.5\)$/, 'Enter SAM in minutes (e.g. 12.5)'],
  [/^SRN aur defect dono chahiye$/, 'SRN and defect both needed'],
  [/^SRN chahiye$/, 'SRN needed'],
  [/^Time HH:MM( me daalo)?$/, 'Enter time as HH:MM'],
  [/^Ye PIN pehle se (.*) ka hai — dusra PIN do$/, 'This PIN is already used by $1 — choose another'],
  [/^(.*) is line me nahi hai$/, 'No $1 on this line'],
  [/^(.*) sirf (\d+) hain \(half day \+ absent (\d+)\)$/, 'Only $2 $1 on this line (half day + absent = $3)'],
  [/^(.*) attendance nahi bhari — pehle attendance bharo, phir output$/, '$1 attendance not filled — fill attendance first, then output'],
  [/^(.*) ki loading is line par nahi mili — loading sheet check karo$/, 'No loading of $1 on this line — check the loading sheet'],
  [/^Loading se zyada: (.*)$/, 'More than loading: $1'],
  [/^(.*) ki loading (\d+) hai, (\d+) ban chuka — ab sirf (-?\d+) aur ho sakta hai$/, 'Loading of $1 is $2, $3 made — only $4 more possible'],
  [/^Network nahi mila — internet check karo$/, 'No network — check internet'],
  [/^Main sheet me nahi gaya: (.*)$/, 'Saved in app, but not written to the main sheet: $1']
];
function enMsg_(s) {
  s = String(s || ''); if (!s) return s;
  for (var i = 0; i < EN_RULES_.length; i++) if (EN_RULES_[i][0].test(s)) return s.replace(EN_RULES_[i][0], EN_RULES_[i][1]);
  return s;
}
// translates message / warn of a reply and of its per-item results
function enReply_(o) {
  if (!o || typeof o !== 'object') return o;
  if (o.message) o.message = enMsg_(o.message);
  if (o.warn && typeof o.warn === 'string') o.warn = enMsg_(o.warn);
  if (Array.isArray(o.results)) o.results.forEach(function(r) { if (r && r.message) r.message = enMsg_(r.message); if (r && typeof r.warn === 'string' && r.warn) r.warn = enMsg_(r.warn); });
  return o;
}
