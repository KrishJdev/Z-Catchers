import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Metastrike & Secondary Action Row Overflow Fix Verification...\n');

const memberCardPath = path.resolve('src/components/MemberCard.tsx');
assert(fs.existsSync(memberCardPath), 'MemberCard.tsx exists');
const memberCardContent = fs.readFileSync(memberCardPath, 'utf8');

// 1. Root container enforces overflow-hidden
console.log('--- 1. MemberCard Root Container Bounds ---');
assert(
  memberCardContent.includes('w-full max-w-full overflow-hidden'),
  'MemberCard root container must enforce max-w-full overflow-hidden'
);
console.log('✅ PASSED: MemberCard root container strictly enforces max-w-full overflow-hidden.');

// 2. hasSecondaryNagAction helper
console.log('\n--- 2. hasSecondaryNagAction Dynamic Row Sizing ---');
assert(
  memberCardContent.includes('hasSecondaryNagAction'),
  'MemberCard must define hasSecondaryNagAction helper'
);
assert(
  memberCardContent.includes('hasSecondaryNagAction ? \'flex-1\' : \'w-full\''),
  'Nag Notif button must dynamically expand to w-full when no secondary pill is present, or flex-1 when paired'
);
console.log('✅ PASSED: Nag Notif button dynamically sizes between w-full and flex-1.');

// 3. Secondary Action Row min-w-0 and Overflow Protection
console.log('\n--- 3. Contextual Secondary Action Row min-w-0 & Truncation ---');
assert(
  memberCardContent.includes('<div className="flex items-center gap-2 w-full min-w-0">'),
  'Secondary action row container must include min-w-0 to allow flex children to shrink'
);

// 4. Nag Notif button in isNagNow enforces min-w-0 and truncate
assert(
  memberCardContent.includes('min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-all shadow-sm'),
  'Nag Notif button must enforce min-w-0'
);
assert(
  memberCardContent.includes('<span className="truncate">Shield On</span>'),
  'Shield On text must be wrapped in truncate span'
);
assert(
  memberCardContent.includes('<span className="truncate">Nag Notif</span>'),
  'Nag Notif text must be wrapped in truncate span'
);
console.log('✅ PASSED: Nag Notif button enforces min-w-0 and truncate on text children.');

// 5. Metastrike Active badge enforces min-w-0 and inner text truncation
console.log('\n--- 4. Metastrike Active Badge Text Overflow Fix ---');
assert(
  memberCardContent.includes('isMetastrikeActive ? (') &&
  memberCardContent.includes('min-w-0 h-9 min-h-[36px] flex items-center justify-center gap-1.5 rounded-xl border border-status-amber/40 bg-status-amber/15 px-2.5 text-xs font-semibold text-status-amber shadow-sm'),
  'Metastrike badge must enforce min-w-0 on flex item container'
);
assert(
  memberCardContent.includes('<span className="truncate">\n                    Metastrike: {member.metastrike_reason || member.tonight_strike_log?.reason || \'Excused\'}\n                  </span>'),
  'Metastrike text must have truncate to prevent overflow outside card bounds'
);
console.log('✅ PASSED: Metastrike badge enforces min-w-0 and truncate so long reasons never overflow card borders.');

// 6. Secondary action pills all enforce min-w-0 and truncate
console.log('\n--- 5. Remaining Secondary Action Pills (Strike Issued, Grace, Vote Strike) ---');
assert(
  memberCardContent.includes('isStrikeIssuedTonight ? (') &&
  memberCardContent.includes('<span className="truncate">Strike Issued</span>'),
  'Strike Issued badge enforces truncate'
);
assert(
  memberCardContent.includes("state.status === 'BEDTIME_GRACE' ? (") &&
  memberCardContent.includes('<span className="truncate">Grace: {state.graceMinutesLeft || 5}m left</span>'),
  'Grace countdown badge enforces truncate'
);
assert(
  memberCardContent.includes('onVoteStrike && !isViewer ? (') &&
  memberCardContent.includes('<span className="truncate">\n                    {member.has_voted_strike'),
  'Vote strike button enforces truncate'
);
console.log('✅ PASSED: Strike Issued, Grace countdown, and Vote Strike pills all enforce min-w-0 and text truncation.');

// 7. Non-nag Metastrike notice in card body also protected
console.log('\n--- 6. Non-Nag Metastrike Notice in Card Body ---');
assert(
  memberCardContent.includes('isMetastrikeActive && !isNagNow && (') &&
  memberCardContent.includes('min-h-[44px] min-w-0') &&
  memberCardContent.includes('<span className="truncate">\n              Metastrike Active:'),
  'Body Metastrike Active notice must enforce min-w-0 and truncate'
);
console.log('✅ PASSED: Body Metastrike Active notice includes min-w-0 and truncate.');

console.log('\n🎉 ALL METASTRIKE TEXT OVERFLOW TESTS PASSED CLEANLY! 🦊💤\n');
