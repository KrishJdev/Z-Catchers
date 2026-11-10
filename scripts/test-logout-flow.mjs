import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Log Out Option & Auth De-identification Verification...\n');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  }
}

async function run() {
  // 1. Header Component Logout Option
  console.log('--- 1. Header Component Logout UI ---');
  const headerContent = fs.readFileSync(path.resolve('src/components/Header.tsx'), 'utf8');
  assert(headerContent.includes('LogOut') && headerContent.includes('lucide-react'), 'Header imports LogOut icon from lucide-react');
  assert(headerContent.includes('onLogout?: () => void'), 'HeaderProps defines onLogout callback');
  assert(headerContent.includes('title={`Log out of @${currentUser.discord_username}`}') || headerContent.includes('title="Log out'), 'Header renders accessible tooltip/title for logout');
  assert(headerContent.includes('aria-label="Log out"'), 'Header renders aria-label for accessibility');
  assert(headerContent.includes('onClick={onLogout}'), 'Header triggers onLogout on click');

  // 2. My Schedule / Profile Modal Logout Option
  console.log('\n--- 2. MyScheduleModal Logout UI & Session Card ---');
  const scheduleContent = fs.readFileSync(path.resolve('src/components/MyScheduleModal.tsx'), 'utf8');
  assert(scheduleContent.includes('LogOut') && scheduleContent.includes('lucide-react'), 'MyScheduleModal imports LogOut icon');
  assert(scheduleContent.includes('onLogout?: () => void'), 'MyScheduleModalProps defines onLogout callback');
  assert(scheduleContent.includes('Log Out of Fox Den'), 'MyScheduleModal provides prominent "Log Out of Fox Den" session card');
  assert(scheduleContent.includes('Signed in as @{currentUser.discord_username}'), 'MyScheduleModal clearly displays authenticated member name');
  assert(scheduleContent.includes('onClick={() => {\n                  onClose();\n                  onLogout();\n                }}'), 'MyScheduleModal header provides quick logout button adjacent to Close');

  // 3. Push Modal Quick Logout
  console.log('\n--- 3. PushModal Member Profile Logout ---');
  const pushContent = fs.readFileSync(path.resolve('src/components/PushModal.tsx'), 'utf8');
  assert(pushContent.includes('onLogout?: () => void'), 'PushModalProps defines onLogout callback');
  assert(pushContent.includes('onLogout();'), 'PushModal provides secondary logout trigger');

  // 4. Page Controller & Session Cleanup Orchestration
  console.log('\n--- 4. App Page Logout Orchestration ---');
  const pageContent = fs.readFileSync(path.resolve('src/app/page.tsx'), 'utf8');
  assert(pageContent.includes('clearAuthSession'), 'page.tsx imports clearAuthSession from @/lib/pushClient');
  assert(pageContent.includes('const handleLogout = async () =>'), 'page.tsx defines handleLogout handler');
  assert(pageContent.includes('/api/auth/logout'), 'handleLogout calls /api/auth/logout endpoint');
  assert(pageContent.includes('clearAuthSession()'), 'handleLogout wipes localStorage credentials');
  assert(pageContent.includes("router.replace('/join')"), 'handleLogout redirects user to /join onboarding');
  assert(pageContent.includes('onLogout={handleLogout}'), 'handleLogout passed to Header and modals');

  // 5. Auth API Logout Route Verification
  console.log('\n--- 5. API Auth Logout Route (/api/auth/logout) ---');
  const routeContent = fs.readFileSync(path.resolve('src/app/api/auth/logout/route.ts'), 'utf8');
  assert(routeContent.includes('zcatchers_session'), 'Route targets zcatchers_session cookie');
  assert(routeContent.includes('maxAge: 0'), 'Cookie maxAge set to 0 to invalidate');
  assert(routeContent.includes('expires: new Date(0)'), 'Cookie expires set to epoch for universal browser deletion');
  assert(routeContent.includes('export async function POST') && routeContent.includes('export async function GET'), 'Route supports both POST and GET methods');

  // 6. Live Local API Endpoint Check (if server running)
  console.log('\n--- 6. Live API Endpoint Verification ---');
  try {
    const res = await fetch('http://localhost:3000/api/auth/logout', { method: 'POST' });
    assert(res.status === 200, 'POST /api/auth/logout returns HTTP 200 OK');
    const setCookie = res.headers.get('set-cookie') || '';
    assert(setCookie.includes('zcatchers_session=') && (setCookie.includes('Max-Age=0') || setCookie.includes('Expires=Thu, 01 Jan 1970')), 'Response issues Set-Cookie clearing session cookie');
    const json = await res.json();
    assert(json.success === true, 'Response JSON confirms success: true');
  } catch {
    console.log('ℹ️ Local server test skipped (server offline or non-blocking).');
  }

  if (failed) {
    console.error('\n❌ SOME VERIFICATIONS FAILED.');
    process.exit(1);
  } else {
    console.log('\n✨ ALL LOG OUT TESTS & CHECKS PASSED CLEANLY! 🦊🚪💤');
  }
}

run();
