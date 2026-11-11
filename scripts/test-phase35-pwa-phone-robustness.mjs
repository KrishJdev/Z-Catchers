import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Phase 35: PWA Phone Robustness & Mobile Ergonomics Verification...\n');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

// 1. Safe-Area Notch & Dynamic Island Handling
console.log('--- 1. Safe-Area Notch & Dynamic Island Handling ---');
const headerContent = fs.readFileSync(path.resolve('src/components/Header.tsx'), 'utf8');
assert(headerContent.includes('safe-area-inset-top'), 'Header.tsx includes safe-area-inset-top padding for iOS notch/Dynamic Island');

const joinContent = fs.readFileSync(path.resolve('src/app/join/page.tsx'), 'utf8');
assert(joinContent.includes('safe-area-inset-top'), 'join/page.tsx includes safe-area-inset-top padding');

// 2. Virtual Keyboard Avoidance (dvh) in Bottom Sheets
console.log('\n--- 2. Virtual Keyboard Avoidance (dvh) in Modal Sheets ---');
const pushModalContent = fs.readFileSync(path.resolve('src/components/PushModal.tsx'), 'utf8');
assert(pushModalContent.includes('90dvh'), 'PushModal uses 90dvh to avoid virtual keyboard overlap');

const scheduleModalContent = fs.readFileSync(path.resolve('src/components/MyScheduleModal.tsx'), 'utf8');
assert(scheduleModalContent.includes('90dvh'), 'MyScheduleModal uses 90dvh to avoid virtual keyboard overlap');

const modDrawerContent = fs.readFileSync(path.resolve('src/components/ModDrawer.tsx'), 'utf8');
assert(modDrawerContent.includes('92dvh'), 'ModDrawer uses 92dvh to avoid virtual keyboard overlap');

const metaModalContent = fs.readFileSync(path.resolve('src/components/MetastrikeModal.tsx'), 'utf8');
assert(metaModalContent.includes('90dvh'), 'MetastrikeModal uses 90dvh scrollable constraint');

// 3. Warm Dark Palette Compliance in BottomNav
console.log('\n--- 3. Warm Dark Palette Compliance in BottomNav ---');
const bottomNavContent = fs.readFileSync(path.resolve('src/components/BottomNav.tsx'), 'utf8');
assert(!bottomNavContent.includes('#12141c') && !bottomNavContent.includes('#262936'), 'BottomNav eliminates cool slate blue hex tokens');
assert(bottomNavContent.includes('#1C1714') && bottomNavContent.includes('#332B24'), 'BottomNav anchors to Warm Dark espresso surface and border tokens');

// 4. Touch Ergonomics & Double-Tap Latency Elimination
console.log('\n--- 4. Touch Ergonomics & Double-Tap Latency in globals.css ---');
const cssContent = fs.readFileSync(path.resolve('src/app/globals.css'), 'utf8');
assert(cssContent.includes('touch-action: manipulation'), 'globals.css applies touch-action: manipulation to eliminate 300ms tap delay');
assert(cssContent.includes('-webkit-tap-highlight-color: transparent'), 'globals.css eliminates mobile tap highlight flashes');
assert(cssContent.includes('overscroll-behavior-y: contain'), 'globals.css contains overscroll bounce to avoid white flashes');
assert(cssContent.includes('user-select: none'), 'globals.css prevents accidental text selection on buttons and nav');

// 5. Interactive Push Notification Actions in Service Worker
console.log('\n--- 5. Interactive Push Notification Actions in Service Worker ---');
const swContent = fs.readFileSync(path.resolve('public/sw.js'), 'utf8');
assert(swContent.includes('actions:') && swContent.includes('in_bed'), 'Service Worker defines in_bed notification action');
assert(swContent.includes('open_journal'), 'Service Worker defines open_journal notification action');
assert(swContent.includes('event.action'), 'Service Worker handles event.action clicks');

// 6. Manifest Shortcuts
console.log('\n--- 6. Expanded Web App Manifest Shortcuts ---');
const manifest = JSON.parse(fs.readFileSync(path.resolve('public/manifest.json'), 'utf8'));
assert(manifest.shortcuts.some((s) => s.url === '/?action=in-bed'), 'Manifest includes "I\'m In Bed" shortcut');
assert(manifest.shortcuts.some((s) => s.url === '/?action=schedule'), 'Manifest includes "My Schedule" shortcut');

// 7. Offline Roster Caching, Connectivity Banner & App Badging API
console.log('\n--- 7. Offline Roster Caching, Connectivity Banner & App Badging ---');
const pageContent = fs.readFileSync(path.resolve('src/app/page.tsx'), 'utf8');
assert(pageContent.includes('zcatchers_cached_roster'), 'page.tsx implements localStorage cached roster snapshot');
assert(pageContent.includes('isOffline'), 'page.tsx tracks offline network status');
assert(pageContent.includes('Showing cached Fox Den times'), 'page.tsx renders Warm Dark offline notification banner');
assert(pageContent.includes('setAppBadge'), 'page.tsx integrates mobile Home Screen App Badging API');
assert(pageContent.includes('action === \'schedule\''), 'page.tsx handles deep-link shortcut for schedule modal');

console.log('\n-----------------------------------------------------------');
if (failed) {
  console.error('❌ SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('🎉 ALL PHASE 35 PWA PHONE ROBUSTNESS CHECKS PASSED!\n');
  process.exit(0);
}
