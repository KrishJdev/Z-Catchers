import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Phase 2: Mobile Navigation, Standalone Onboarding & Touch UX Verification...\n');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

// 1. Mobile Bottom Navigation (src/components/BottomNav.tsx)
console.log('--- 1. BottomNav Component (src/components/BottomNav.tsx) ---');
const bottomNavPath = path.resolve('src/components/BottomNav.tsx');
assert(fs.existsSync(bottomNavPath), 'BottomNav.tsx exists');
const bottomNavContent = fs.readFileSync(bottomNavPath, 'utf8');

assert(bottomNavContent.includes("id: 'roster'") && bottomNavContent.includes("label: 'Roster'"), 'Roster tab configured');
assert(bottomNavContent.includes("id: 'schedule'") && bottomNavContent.includes("label: 'My Time'"), 'My Time tab configured');
assert(bottomNavContent.includes("id: 'alerts'") && bottomNavContent.includes("label: 'Alerts'"), 'Alerts tab configured');
assert(bottomNavContent.includes("id: 'mod'") && bottomNavContent.includes("label: 'Mod'"), 'Mod tab configured conditionally');
assert(bottomNavContent.includes('isModerator ?') && bottomNavContent.includes('grid-cols-4') && bottomNavContent.includes('grid-cols-3'), 'Dynamic 3 vs 4 column layout for moderator status');
assert(bottomNavContent.includes('navigator.vibrate'), 'Haptic feedback on tab tap');
assert(bottomNavContent.includes('min-h-[44px] min-w-[44px]'), 'BottomNav tabs enforce >= 44x44px touch targets');
assert(bottomNavContent.includes('env(safe-area-inset-bottom)'), 'BottomNav respects safe-area-inset-bottom');

// 2. Viewport & Safe-Area Enforcements (src/app/layout.tsx & globals.css)
console.log('\n--- 2. Viewport & Safe-Area Enforcements ---');
const layoutPath = path.resolve('src/app/layout.tsx');
const layoutContent = fs.readFileSync(layoutPath, 'utf8');
assert(layoutContent.includes("viewportFit: 'cover'"), 'Viewport includes viewportFit: cover');
assert(layoutContent.includes("maximumScale: 1") || layoutContent.includes("userScalable: false") || layoutContent.includes("initialScale: 1"), 'Viewport prevents unwanted zoom resizing');
assert(layoutContent.includes('min-h-[100dvh]'), 'Root body enforces min-h-[100dvh]');

const cssPath = path.resolve('src/app/globals.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');
assert(cssContent.includes('--safe-area-bottom: env(safe-area-inset-bottom'), 'globals.css defines --safe-area-bottom');
assert(cssContent.includes('--safe-area-top: env(safe-area-inset-top'), 'globals.css defines --safe-area-top');
assert(cssContent.includes('font-size: 16px !important'), 'globals.css enforces font-size: 16px on input/select/textarea to prevent iOS zoom');

// 3. Mobile Sheet Conversion (PushModal, MyScheduleModal, ModDrawer)
console.log('\n--- 3. Mobile Slide-Up Bottom Sheet Indicators & Touch Targets ---');
const pushModalContent = fs.readFileSync(path.resolve('src/components/PushModal.tsx'), 'utf8');
assert(pushModalContent.includes('w-12') && pushModalContent.includes('h-1.5'), 'PushModal has sheet handle indicator');
assert(pushModalContent.includes('safe-area-inset-bottom'), 'PushModal has safe-area-inset-bottom padding');
assert(pushModalContent.includes('min-h-[44px]'), 'PushModal buttons have min-h-[44px] touch targets');

const scheduleModalContent = fs.readFileSync(path.resolve('src/components/MyScheduleModal.tsx'), 'utf8');
assert(scheduleModalContent.includes('w-12') && scheduleModalContent.includes('h-1.5'), 'MyScheduleModal has sheet handle indicator');
assert(scheduleModalContent.includes('safe-area-inset-bottom'), 'MyScheduleModal has safe-area-inset-bottom padding');
assert(scheduleModalContent.includes('min-h-[44px]'), 'MyScheduleModal buttons have min-h-[44px] touch targets');

const modDrawerContent = fs.readFileSync(path.resolve('src/components/ModDrawer.tsx'), 'utf8');
assert(modDrawerContent.includes('w-12') && modDrawerContent.includes('h-1.5'), 'ModDrawer has sheet handle indicator');
assert(modDrawerContent.includes('safe-area-inset-bottom'), 'ModDrawer has safe-area-inset-bottom padding');
assert(modDrawerContent.includes('min-h-[44px]'), 'ModDrawer buttons have min-h-[44px] touch targets');

// 4. Standalone Onboarding Route (src/app/join/page.tsx)
console.log('\n--- 4. Standalone Onboarding & Join Route (/join) ---');
const joinPath = path.resolve('src/app/join/page.tsx');
assert(fs.existsSync(joinPath), '/join route page exists');
const joinContent = fs.readFileSync(joinPath, 'utf8');
assert(joinContent.includes('FoxMascot'), 'Join route incorporates Sleepy Fox Mascot');
assert(joinContent.includes('min-h-[100dvh]'), 'Join route enforces 100dvh for mobile keyboards');
assert(joinContent.includes('4-digit PIN') || joinContent.includes('4-Digit PIN') || joinContent.includes('pin'), 'Join route provides PIN authentication flow');
assert(joinContent.includes('timezone') || joinContent.includes('viewerTimezone'), 'Join route provides timezone selection');
assert(joinContent.includes('navigator.vibrate'), 'Join route uses light haptic feedback');

// 5. MemberCard Optimistic UI & Haptics (src/components/MemberCard.tsx)
console.log('\n--- 5. MemberCard Optimistic UI, Touch Targets & Haptics ---');
const cardContent = fs.readFileSync(path.resolve('src/components/MemberCard.tsx'), 'utf8');
assert(cardContent.includes('triggerHaptic(15)'), 'MemberCard triggers 15ms light haptic feedback');
assert(cardContent.includes('optimisticInBed'), 'MemberCard implements optimistic "In Bed" state transitions');
assert(cardContent.includes('localNagCount') && cardContent.includes('hasNagged'), 'MemberCard implements optimistic "Nag / Assist" state transitions');
assert(cardContent.includes('min-h-[44px] min-w-[44px]'), 'MemberCard action buttons enforce 44x44px touch targets');

// 6. Root Page Integration (src/app/page.tsx)
console.log('\n--- 6. HomePage BottomNav Integration & Login Deprecation ---');
const homeContent = fs.readFileSync(path.resolve('src/app/page.tsx'), 'utf8');
assert(homeContent.includes('<BottomNav'), 'HomePage renders BottomNav component');
assert(homeContent.includes('handleMobileTabChange'), 'HomePage wires up mobile tab switching');
assert(!homeContent.includes('<LoginModal'), 'HomePage has replaced LoginModal with /join routing');

if (failed) {
  console.error('\n❌ SOME PHASE 2 TESTS FAILED');
  process.exit(1);
} else {
  console.log('\n-----------------------------------------------------------');
  console.log('🎉 ALL PHASE 2 MOBILE NAVIGATION & TOUCH UX TESTS PASSED!');
}
