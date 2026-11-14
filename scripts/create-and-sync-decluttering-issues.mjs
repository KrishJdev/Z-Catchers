import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const declutteringIssues = [
  {
    id: 1,
    phase: 'Phase 1 (P0): High-Impact UI Decluttering & Core Action Ergonomics',
    priorityTag: 'P0 - Critical',
    jiraPriority: 'Highest',
    issueTypeId: '10071',
    title: "[P0] Pinned Self-Action Bar for One-Tap Check-Ins",
    labels: ['frontend', 'enhancement', 'priority: critical'],
    targetFiles: [
      'src/components/StatusBucket.tsx',
      'src/components/MemberCard.tsx',
      'src/components/BottomNav.tsx',
      'src/app/page.tsx',
      'src/app/api/members/in-bed/route.ts',
      'src/app/api/members/wake-up/route.ts',
      'src/app/api/members/cancel-pending/route.ts',
    ],
    testFile: 'scripts/test-pinned-self-action-bar.mjs',
    body: `## Goal & Summary
Decouple the logged-in user's sleep/wake controls from the scrolling member list so check-ins take one tap from anywhere on the dashboard.

Currently, self-action buttons ("I'm in Bed", "I'm Awake", "Cancel Pending") are embedded inside \`StatusBucket.tsx\` and \`MemberCard.tsx\`. In a community with many members, logged-in users are forced to scroll past inactive members to locate their own card before they can register their check-in or cancel a pending schedule change.

## Architecture & Implementation Blueprint
1. **Component Extraction:** Extract self-action controls from \`src/components/StatusBucket.tsx\` and \`src/components/MemberCard.tsx\` into a dedicated, pinned self-action component (e.g. \`PinnedSelfActionBar.tsx\`).
2. **Dashboard Placement:** Mount the bar directly above \`src/components/BottomNav.tsx\` in \`src/app/page.tsx\` (\`fixed bottom-16 md:bottom-0 left-0 right-0 z-30\`).
3. **Context-Aware Presentation:**
   - When Awake (Daytime / Wind-Down / Bedtime Hit): Display prominent "🛏️ I'm in Bed" check-in button.
   - When Asleep (Sleep Shield Active): Display "☀️ I'm Awake" check-in button.
   - When 48h Schedule Cooldown Pending: Display compact "⏳ Cancel Pending Change" button alongside primary action.
4. **Design System & Ergonomics:**
   - Adhere to Warm Dark palette (\`#1C1714\` surface, \`#F5EBE1\` cream text, subtle amber border \`border-amber-900/20\`).
   - Enforce mobile touch accessibility with minimum \`min-h-[44px]\` and \`min-w-[44px]\` touch targets.
   - Only render the bar when a verified session (\`sessionMember\`) is active.

## API Wiring & Endpoints
- \`POST /api/members/in-bed\`: Early bedtime check-in activating Sleep Shield and silencing outgoing community nags.
- \`POST /api/members/wake-up\`: Morning wake-up check-in transitioning member out of sleep window.
- \`POST /api/members/cancel-pending\`: Rate-limited cancellation of pending 48-hour schedule cooldown.

## Target Files & Key References
- \`src/components/StatusBucket.tsx\`
- \`src/components/MemberCard.tsx\`
- \`src/components/BottomNav.tsx\`
- \`src/app/page.tsx\`
- \`src/app/api/members/in-bed/route.ts\`
- \`src/app/api/members/wake-up/route.ts\`
- \`src/app/api/members/cancel-pending/route.ts\`

## Acceptance Criteria
- Logged-in users see a persistent context-aware action bar (In Bed, Wake Up, or Cancel Pending) without scrolling through buckets.
- Action buttons trigger instant optimistic UI updates on the dashboard while awaiting server confirmation.
- Minimum touch target >= 44x44px across mobile viewports (375px+).
- Unauthenticated visitors do not see the self-action bar.

## Automated Regression Testing
- **Test File:** \`scripts/test-pinned-self-action-bar.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert component rendering, context-aware action switching, and 44px touch target compliance.`,
  },
  {
    id: 2,
    phase: 'Phase 1 (P0): High-Impact UI Decluttering & Core Action Ergonomics',
    priorityTag: 'P0 - Critical',
    jiraPriority: 'Highest',
    issueTypeId: '10071',
    title: "[P0] Compact Member Cards with Progressive Disclosure",
    labels: ['frontend', 'enhancement', 'priority: critical'],
    targetFiles: [
      'src/components/MemberCard.tsx',
      'src/lib/timezone.ts',
      'src/components/SleepCalendarModal.tsx',
      'src/components/MetastrikeModal.tsx',
      'src/app/api/members/nag-assist/route.ts',
      'src/app/api/members/nag-notif/route.ts',
    ],
    testFile: 'scripts/test-compact-member-cards.mjs',
    body: `## Goal & Summary
Reduce visual noise and vertical scrolling across \`src/components/MemberCard.tsx\` by introducing progressive disclosure for secondary actions and accountability metrics.

Currently, each \`MemberCard.tsx\` renders the avatar, badges, full schedule row, GMT timezone offset, strikes/metastrikes bar, sleep calendar trigger, metastrike trigger, and nag action buttons by default. This makes cards vertically tall and forces extensive scrolling on mobile screens.

## Architecture & Implementation Blueprint
1. **Compact Primary Card View:**
   - Restrict default rendering to primary identifiers: Avatar, Username, Status Badge, and Viewer-Local Time (computed via \`src/lib/timezone.ts\`).
   - Remove permanent expanded display of calendar/strike modals and secondary actions from default card body.
2. **Progressive Disclosure Bottom Sheet:**
   - Tapping the card or a compact disclosure trigger expands a bottom sheet modal revealing:
     - Full schedule details and timezone metadata row
     - Monthly Strikes & Metastrikes accountability bar
     - Trigger for \`src/components/SleepCalendarModal.tsx\`
     - Trigger for \`src/components/MetastrikeModal.tsx\`
     - Nag Assist ("👥 Nagged!") and Nag Notification buttons
3. **Ergonomics & Layout:**
   - Preserve >= 44x44px touch targets for username links, watchlist star, and tap-to-expand controls.
   - Maintain strict Warm Dark aesthetic (\`#1C1714\` background, \`#F5EBE1\` text).

## API Wiring & Endpoints
- \`POST /api/members/nag-assist\`: Records community assist check-ins for sleeper's journal.
- \`POST /api/members/nag-notif\`: Dispatches individual push notification nags to sleepy members.
- \`GET /api/members/sleep-history\`: Fetches historical bedtime check-in calendar logs.

## Target Files & Key References
- \`src/components/MemberCard.tsx\`
- \`src/lib/timezone.ts\`
- \`src/components/SleepCalendarModal.tsx\`
- \`src/components/MetastrikeModal.tsx\`
- \`src/app/api/members/nag-assist/route.ts\`
- \`src/app/api/members/nag-notif/route.ts\`

## Acceptance Criteria
- Default card height drops by at least 40% on mobile screens (measured in CSS pixels).
- All secondary actions (sleep calendar, metastrike history, nag assist, nag push) remain fully accessible via progressive disclosure bottom sheet.
- Discord journal deep links remain directly accessible.
- Zero horizontal overflow on narrow mobile viewports (375px).

## Automated Regression Testing
- **Test File:** \`scripts/test-compact-member-cards.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert 40%+ card height reduction, presence of essential primary elements, and functional disclosure triggers.`,
  },
  {
    id: 3,
    phase: 'Phase 1 (P0): High-Impact UI Decluttering & Core Action Ergonomics',
    priorityTag: 'P0 - Critical',
    jiraPriority: 'Highest',
    issueTypeId: '10071',
    title: "[P0] Smart Status Bucket Folding by Default",
    labels: ['frontend', 'enhancement', 'priority: critical'],
    targetFiles: [
      'src/components/StatusBucket.tsx',
      'src/lib/sleepEngine.ts',
      'src/app/page.tsx',
    ],
    testFile: 'scripts/test-smart-status-bucket-folding.mjs',
    body: `## Goal & Summary
Surface members who need immediate accountability first on \`src/app/page.tsx\` by automatically folding passive buckets.

Currently, all 4 status buckets (🚨 Nag Now, 🌙 Winding Down, ☀️ Wide Awake, 💤 Asleep) render fully expanded. Users must scroll through dozens of passive awake or sleeping members before seeing who is currently hitting bedtime or winding down.

## Architecture & Implementation Blueprint
1. **Passive Bucket Auto-Collapse:**
   - Update \`src/components/StatusBucket.tsx\` to accept default open/collapsed state.
   - Auto-collapse passive buckets on initial render:
     - 💤 **Asleep (Zzz)** bucket (default collapsed)
     - ☀️ **Wide Awake** bucket (default collapsed)
2. **Actionable Buckets Kept Expanded:**
   - 🚨 **Nag Now / Bedtime Hit (Overdue)** (default expanded per \`src/lib/sleepEngine.ts\`)
   - 🌙 **Winding Down** (within 60m before bedtime) (default expanded)
3. **Collapsed Header UX:**
   - Render clean member count pill on collapsed headers (e.g. \`💤 Asleep (6 foxes)\`).
   - Include chevron icon indicating collapse/expand state with smooth CSS transitions.
   - Allow user to toggle accordion open/close with 1 tap, preserving user overrides during the active session.

## API Wiring & Endpoints
- Pure client-side UI optimization driven by \`src/lib/sleepEngine.ts\` status evaluation calculations.

## Target Files & Key References
- \`src/components/StatusBucket.tsx\`
- \`src/lib/sleepEngine.ts\`
- \`src/app/page.tsx\`

## Acceptance Criteria
- Actionable members (Nag Now, Winding Down) appear above the fold without scrolling past inactive cards.
- Passive buckets render collapsed headers displaying accurate member counts.
- Single tap expands or collapses any bucket smoothly.
- Zero layout shift during initial status bucket rendering.

## Automated Regression Testing
- **Test File:** \`scripts/test-smart-status-bucket-folding.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert initial collapsed state for Asleep/Awake, expanded state for Nag Now/Winding Down, and member count pill accuracy.`,
  },
  {
    id: 4,
    phase: 'Phase 2 (P1): Navigation Consolidation & Onboarding Streamlining',
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071',
    title: "[P1] Consolidated Profile & Settings Drawer",
    labels: ['frontend', 'enhancement', 'priority: high'],
    targetFiles: [
      'src/components/Header.tsx',
      'src/components/BottomNav.tsx',
      'src/components/MyScheduleModal.tsx',
      'src/components/PushModal.tsx',
      'src/components/LoginModal.tsx',
      'src/components/ModDrawer.tsx',
      'src/app/api/members/update-schedule/route.ts',
    ],
    testFile: 'scripts/test-consolidated-profile-settings-drawer.mjs',
    body: `## Goal & Summary
Eliminate scattered modal triggers across \`src/components/Header.tsx\` and \`src/components/BottomNav.tsx\` by unifying settings, schedule management, and authentication into a single cohesive settings sheet.

Currently, users have separate dialogs for schedule editing (\`MyScheduleModal.tsx\`), Web Push notification toggles (\`PushModal.tsx\`), and authentication (\`LoginModal.tsx\`). This fragments user management and clutters mobile navigation.

## Architecture & Implementation Blueprint
1. **Unified Settings Drawer Component:**
   - Combine \`MyScheduleModal.tsx\`, \`PushModal.tsx\`, and \`LoginModal.tsx\` into a unified slide-over drawer (e.g. \`src/components/SettingsDrawer.tsx\`).
   - Group settings into clear sections / tabs:
     - 🦊 **Account & Auth:** Login status, PIN change, Discord link, logout.
     - ⏰ **Bedtime Schedule:** Bedtime/wake time picker, 48-hour cooldown notice, Discord journal thread link.
     - 🔔 **Notifications:** Web Push toggle, permission request, test push button.
2. **Moderator Separation:**
   - Keep \`src/components/ModDrawer.tsx\` strictly isolated for moderator-only passcode workflows to maintain governance security.
3. **Navigation Integration:**
   - Update \`Header.tsx\` and \`BottomNav.tsx\` to route all profile/settings actions to the unified drawer.

## API Wiring & Endpoints
- \`POST /api/members/update-schedule\`: Enforces 48-hour cooldown on schedule updates.
- \`POST /api/push/subscribe\` & \`POST /api/push/unsubscribe\`: Manages browser push subscriptions.
- \`POST /api/auth/login\` & \`POST /api/auth/logout\`: Manages member session tokens.

## Target Files & Key References
- \`src/components/Header.tsx\`
- \`src/components/BottomNav.tsx\`
- \`src/components/MyScheduleModal.tsx\`
- \`src/components/PushModal.tsx\`
- \`src/components/LoginModal.tsx\`
- \`src/components/ModDrawer.tsx\`
- \`src/app/api/members/update-schedule/route.ts\`

## Acceptance Criteria
- Schedule edits, push notification settings, and authentication controls operate seamlessly from one unified drawer.
- ModDrawer remains protected and isolated behind moderator authentication.
- Navigation chrome in Header and BottomNav is clean and intuitive.

## Automated Regression Testing
- **Test File:** \`scripts/test-consolidated-profile-settings-drawer.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert single drawer routing, tab transitions, schedule submission handling, and mod drawer isolation.`,
  },
  {
    id: 5,
    phase: 'Phase 2 (P1): Navigation Consolidation & Onboarding Streamlining',
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071',
    title: "[P1] Unified PWA Install & Push Onboarding Card",
    labels: ['frontend', 'pwa', 'enhancement', 'priority: high'],
    targetFiles: [
      'src/components/PwaBanner.tsx',
      'src/components/PushModal.tsx',
      'src/app/page.tsx',
      'src/lib/pushClient.ts',
    ],
    testFile: 'scripts/test-unified-pwa-push-onboarding.mjs',
    body: `## Goal & Summary
Replace competing top banners and popups with a single contextual setup card on \`src/app/page.tsx\`.

Currently, new visitors encounter multiple overlapping onboarding prompts: \`PwaBanner.tsx\` at the top urging PWA installation, and \`PushModal.tsx\` prompting for Web Push permissions. This produces cognitive overload.

## Architecture & Implementation Blueprint
1. **Unified Setup Card Component:**
   - Merge \`src/components/PwaBanner.tsx\` and \`src/components/PushModal.tsx\` into a guided 2-step onboarding card on \`src/app/page.tsx\`:
     - **Step 1:** Add Z-Catchers to Home Screen (shows iOS Safari "Add to Home Screen" instructions or Android Chrome install button).
     - **Step 2:** Enable Push Notifications with Sleep Shield guarantee explanation.
2. **Auto-Dismiss & State Detection:**
   - Detect standalone PWA display mode via \`window.matchMedia('(display-mode: standalone)').matches\` or \`window.navigator.standalone\`.
   - Inspect active push subscriptions via \`src/lib/pushClient.ts\` (\`getExistingSubscription()\`).
   - Automatically and permanently hide the setup card once both standalone mode and push notifications are active.
   - Allow user dismissal with local storage persistence.

## API Wiring & Endpoints
- Client-side PWA install prompt handler (\`beforeinstallprompt\` event).
- \`src/lib/pushClient.ts\` for push permission queries and subscription registration.

## Target Files & Key References
- \`src/components/PwaBanner.tsx\`
- \`src/components/PushModal.tsx\`
- \`src/app/page.tsx\`
- \`src/lib/pushClient.ts\`

## Acceptance Criteria
- Installed PWA users with active push permissions see zero setup banners or modals on launch.
- Non-installed or non-subscribed users see a single, elegant, step-by-step card.
- User dismissal is respected and persisted in localStorage.

## Automated Regression Testing
- **Test File:** \`scripts/test-unified-pwa-push-onboarding.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert standalone display check, push subscription state resolution, and auto-dismiss behavior.`,
  },
  {
    id: 6,
    phase: 'Phase 2 (P1): Navigation Consolidation & Onboarding Streamlining',
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071',
    title: "[P1] Silent Timezone Auto-Detection",
    labels: ['frontend', 'backend', 'enhancement', 'priority: high'],
    targetFiles: [
      'src/lib/timezone.ts',
      'src/app/join/page.tsx',
      'src/components/MyScheduleModal.tsx',
      'src/components/TimezoneSelect.tsx',
    ],
    testFile: 'scripts/test-silent-timezone-auto-detection.mjs',
    body: `## Goal & Summary
Remove manual timezone dropdown friction during member onboarding (\`/join\`) and schedule updates by silently detecting the user's IANA timezone.

Currently, users must manually search through hundreds of timezones in \`TimezoneSelect.tsx\`, creating signup friction and occasional selection errors.

## Architecture & Implementation Blueprint
1. **Silent IANA Detection:**
   - Utilize \`Intl.DateTimeFormat().resolvedOptions().timeZone\` in \`src/lib/timezone.ts\` to detect the client's current IANA timezone.
   - Validate the specifier against Luxon's \`IANAZone.isValidSpecifier(detectedTz)\`.
   - Fall back safely to \`'UTC'\` if the browser reports an invalid or unrecognized specifier.
2. **Compact UI Presentation:**
   - Display a compact pill on \`src/app/join/page.tsx\` and schedule modals: \`📍 Asia/Kolkata (GMT+05:30)\` alongside a subtle \`"Change"\` button.
   - Keep the full \`TimezoneSelect.tsx\` dropdown hidden by default unless the user clicks \`"Change"\`.
3. **Payload Pre-population:**
   - Automatically assign the validated timezone into form state and submission payloads.

## API Wiring & Endpoints
- Client-side helper in \`src/lib/timezone.ts\` wired to \`src/app/join/page.tsx\` and \`src/app/api/members/update-schedule/route.ts\`.

## Target Files & Key References
- \`src/lib/timezone.ts\`
- \`src/app/join/page.tsx\`
- \`src/components/MyScheduleModal.tsx\`
- \`src/components/TimezoneSelect.tsx\`

## Acceptance Criteria
- New users on \`src/app/join/page.tsx\` complete onboarding without manually touching the timezone selector unless intentionally overriding.
- Detected timezone displays formatted IANA name and GMT offset pill.
- Manual override picker opens cleanly upon clicking "Change".

## Automated Regression Testing
- **Test File:** \`scripts/test-silent-timezone-auto-detection.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert IANA auto-detection, fallback handling on invalid specifiers, and manual override UI visibility toggle.`,
  },
  {
    id: 7,
    phase: 'Phase 3 (P2): Native-Grade PWA Lock-Screen & Home Screen Features',
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071',
    title: "[P2] Interactive Lock-Screen Push Notification Actions",
    labels: ['pwa', 'backend', 'enhancement', 'priority: medium'],
    targetFiles: [
      'src/lib/pushServer.ts',
      'src/lib/cronDispatcher.ts',
      'public/sw.js',
      'src/app/api/members/in-bed/route.ts',
      'src/app/api/members/wake-up/route.ts',
      'src/app/api/members/nag-assist/route.ts',
    ],
    testFile: 'scripts/test-interactive-push-actions.mjs',
    body: `## Goal & Summary
Let users log sleep, wake up, or send nag assists directly from OS lock-screen notifications without having to open the app in a browser tab.

## Architecture & Implementation Blueprint
1. **Push Payload Actions Definition:**
   - In \`src/lib/pushServer.ts\` and \`src/lib/cronDispatcher.ts\`, attach \`actions\` arrays to push notification payloads:
     - **Bedtime Alert:** \`[{ action: 'in-bed', title: '🛏️ I\\'m in Bed' }, { action: 'snooze', title: '⏰ Snooze 10m' }]\`
     - **Nag Notification:** \`[{ action: 'nag-assist', title: '👥 Nagged!' }, { action: 'open-journal', title: '📖 Open Journal' }]\`
     - **Wake-Up Alarm:** \`[{ action: 'wake-up', title: '☀️ I\\'m Awake' }]\`
2. **Service Worker \`notificationclick\` Handler:**
   - In \`public/sw.js\`, handle \`event.action\` values.
   - For background actions (\`in-bed\`, \`wake-up\`, \`nag-assist\`), send authenticated background POST requests to the matching endpoints.
   - Show an immediate confirmation notification (e.g. \`"🦊 Sleep Shield active. Rest well!"\`) without opening or focusing a browser window.
   - For \`open-journal\`, open or focus the Discord journal URL in a new window/tab.

## API Wiring & Endpoints
- \`POST /api/members/in-bed\`: Sets \`is_in_bed = true\`, activates Sleep Shield.
- \`POST /api/members/wake-up\`: Sets \`is_woke_up = true\`, records wake time.
- \`POST /api/members/nag-assist\`: Increments nightly community assist count.

## Target Files & Key References
- \`src/lib/pushServer.ts\`
- \`src/lib/cronDispatcher.ts\`
- \`public/sw.js\`
- \`src/app/api/members/in-bed/route.ts\`
- \`src/app/api/members/wake-up/route.ts\`
- \`src/app/api/members/nag-assist/route.ts\`

## Acceptance Criteria
- Tapping a notification action button updates member status and displays confirmation without opening a browser window.
- Notification action clicks preserve full authentication integrity and Sleep Shield rules.
- Fallback click opens the main application dashboard cleanly.

## Automated Regression Testing
- **Test File:** \`scripts/test-interactive-push-actions.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert action schema definitions in push payloads, service worker action routing, and API endpoint integration.`,
  },
  {
    id: 8,
    phase: 'Phase 3 (P2): Native-Grade PWA Lock-Screen & Home Screen Features',
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071',
    title: "[P2] Home Screen App Icon Shortcuts",
    labels: ['pwa', 'frontend', 'enhancement', 'priority: medium'],
    targetFiles: [
      'public/manifest.json',
      'public/icons/',
      'src/app/page.tsx',
      'src/app/api/members/in-bed/route.ts',
      'src/app/api/members/wake-up/route.ts',
    ],
    testFile: 'scripts/test-app-icon-shortcuts.mjs',
    body: `## Goal & Summary
Enable one-tap check-ins via long-press on the installed home screen icon (PWA App Shortcuts).

## Architecture & Implementation Blueprint
1. **Manifest Shortcuts Configuration:**
   - Update \`public/manifest.json\` with a \`shortcuts\` array:
     - Shortcut 1:
       - \`name\`: \`"I'm in Bed"\`
       - \`short_name\`: \`"In Bed"\`
       - \`url\`: \`"/?action=in-bed"\`
       - \`icons\`: \`[{ "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" }]\`
     - Shortcut 2:
       - \`name\`: \`"I'm Awake"\`
       - \`short_name\`: \`"Wake Up"\`
       - \`url\`: \`"/?action=wake-up"\`
       - \`icons\`: \`[{ "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" }]\`
2. **Deep-Link Handling in Dashboard:**
   - In \`src/app/page.tsx\`, inspect URL search params on mount (\`useSearchParams()\`).
   - If \`action === 'in-bed'\` or \`action === 'wake-up'\`, verify authenticated member session and immediately trigger check-in.
   - Display confirmation toast and sanitize query parameters via \`window.history.replaceState\`.

## API Wiring & Endpoints
- \`POST /api/members/in-bed\`: Registers bedtime check-in.
- \`POST /api/members/wake-up\`: Registers morning wake-up check-in.

## Target Files & Key References
- \`public/manifest.json\`
- \`public/icons/\`
- \`src/app/page.tsx\`
- \`src/app/api/members/in-bed/route.ts\`
- \`src/app/api/members/wake-up/route.ts\`

## Acceptance Criteria
- Long-pressing PWA icon on Android, iOS WebClip, or desktop displays "I'm in Bed" and "I'm Awake" shortcuts.
- Selecting a shortcut launches the PWA and triggers the corresponding check-in immediately.
- Clean URL query replacement prevents duplicate triggers on page refresh.

## Automated Regression Testing
- **Test File:** \`scripts/test-app-icon-shortcuts.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert manifest shortcuts schema validity, icon path references, and query parameter trigger handling.`,
  },
  {
    id: 9,
    phase: 'Phase 3 (P2): Native-Grade PWA Lock-Screen & Home Screen Features',
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071',
    title: "[P2] App Icon Badging for Unread Nags & Wind-Down Alerts",
    labels: ['pwa', 'frontend', 'enhancement', 'priority: medium'],
    targetFiles: [
      'public/sw.js',
      'src/app/api/cron/dispatch-notifications/route.ts',
      'public/icons/badge-72x72.png',
      'src/lib/pushClient.ts',
      'src/app/page.tsx',
    ],
    testFile: 'scripts/test-app-icon-badging.mjs',
    body: `## Goal & Summary
Surface pending accountability alerts and unread bedtime nags directly on the home screen app icon via the Badging API.

## Architecture & Implementation Blueprint
1. **Badge Setting in Service Worker:**
   - In \`public/sw.js\`, invoke \`navigator.setAppBadge(count)\` when push events arrive from \`/api/cron/dispatch-notifications\`.
   - Read badge count from payload (\`data.badgeCount\` or increment local badge counter).
   - Ensure feature detection guard (\`if ('setAppBadge' in navigator)\`) prevents errors on unsupported browsers.
   - Pair with monochrome \`public/icons/badge-72x72.png\` for Android notification tray badging.
2. **Badge Clearing on App Focus:**
   - In \`src/lib/pushClient.ts\` and \`src/app/page.tsx\`, invoke \`navigator.clearAppBadge()\` whenever the user opens, focuses, or returns to the dashboard tab (\`visibilitychange\` event).

## API Wiring & Endpoints
- Web Push payload from \`src/app/api/cron/dispatch-notifications/route.ts\`.
- Browser Badging API (\`navigator.setAppBadge\` / \`navigator.clearAppBadge\`).

## Target Files & Key References
- \`public/sw.js\`
- \`src/app/api/cron/dispatch-notifications/route.ts\`
- \`public/icons/badge-72x72.png\`
- \`src/lib/pushClient.ts\`
- \`src/app/page.tsx\`

## Acceptance Criteria
- Unread push alerts increment the OS home screen app icon badge.
- Opening or focusing the app tab clears the badge immediately.
- Graceful degradation on browsers lacking Badging API support.

## Automated Regression Testing
- **Test File:** \`scripts/test-app-icon-badging.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert badging calls on push receipt, badge clearing on app visibility, and feature detection safety.`,
  },
  {
    id: 10,
    phase: 'Phase 4 (P3): Offline Resilience',
    priorityTag: 'P3 - Low',
    jiraPriority: 'Low',
    issueTypeId: '10071',
    title: "[P3] Offline Check-In Queue via Background Sync",
    labels: ['pwa', 'backend', 'frontend', 'enhancement', 'priority: low'],
    targetFiles: [
      'src/app/api/members/in-bed/route.ts',
      'src/app/api/members/wake-up/route.ts',
      'public/sw.js',
      'src/app/page.tsx',
    ],
    testFile: 'scripts/test-offline-checkin-sync.mjs',
    body: `## Goal & Summary
Prevent failed sleep check-ins when users toggle airplane mode or have weak bedroom Wi-Fi connectivity at night.

## Architecture & Implementation Blueprint
1. **Offline Request Interception:**
   - In \`public/sw.js\`, intercept POST requests targeting \`/api/members/in-bed\` and \`/api/members/wake-up\`.
   - When network request fails (\`TypeError: Failed to fetch\` or \`!navigator.onLine\`), clone request body and persist it to IndexedDB queue (\`z_catchers_offline_checkins\`).
2. **Background Sync Registration:**
   - Register a Background Sync tag (\`sync.register('replay-checkins')\`).
   - Listen for \`sync\` events in \`public/sw.js\`: replay queued requests sequentially with original timestamps and session headers once network connectivity returns.
   - Purge successfully synced records from IndexedDB and show a push notification: \`"🦊 Check-in synced successfully!"\`.
3. **Dashboard Feedback Pill:**
   - In \`src/app/page.tsx\`, query pending queue count from IndexedDB.
   - Display a compact \`"⏳ Queued Offline (will sync when online)"\` pill on the action bar when items are pending.

## API Wiring & Endpoints
- \`POST /api/members/in-bed\`: Idempotent handling of delayed/queued check-ins with client timestamp.
- \`POST /api/members/wake-up\`: Idempotent handling of delayed/queued wake-up check-ins.

## Target Files & Key References
- \`src/app/api/members/in-bed/route.ts\`
- \`src/app/api/members/wake-up/route.ts\`
- \`public/sw.js\`
- \`src/app/page.tsx\`

## Acceptance Criteria
- Sleep and wake check-ins triggered offline queue locally in IndexedDB without losing data.
- Check-ins replay automatically when the device reconnects to the internet.
- UI displays a clear "Queued Offline" indicator while offline items await synchronization.

## Automated Regression Testing
- **Test File:** \`scripts/test-offline-checkin-sync.mjs\`
- **Suite Integration:** Must pass via \`scripts/run-tests.mjs\` (and \`npm run test:unit\`).
- Must assert fetch interception, IndexedDB record creation, background sync replay sequencing, and offline pill state.`,
  },
];

export async function createGitHubIssues() {
  console.log('🚀 Creating 10 Z-Catchers Decluttering & PWA Enhancement GitHub Issues...\n');

  const mapFile = path.join(process.cwd(), 'scripts', 'decluttering-issues-map.json');
  let existingMap = new Map();
  if (fs.existsSync(mapFile)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      if (Array.isArray(existingData)) {
        for (const item of existingData) {
          if (item && item.id != null) {
            existingMap.set(item.id, item);
          }
        }
      }
    } catch (e) {
      console.warn(`Could not read existing map file ${mapFile}:`, e.message);
    }
  }

  const results = [];
  let hasError = false;

  for (const item of declutteringIssues) {
    const existing = existingMap.get(item.id);
    if (existing && existing.ghNumber && existing.ghUrl) {
      console.log(`⏩ Issue #${item.id} already created: GitHub #${existing.ghNumber} (${existing.ghUrl})`);
      results.push({ ...item, ...existing });
      continue;
    }

    console.log(`⏳ Creating Issue #${item.id}: "${item.title}"...`);
    const tempFile = path.join(process.cwd(), 'scripts', `_temp_issue_${item.id}.md`);
    try {
      fs.writeFileSync(tempFile, item.body, 'utf8');
      const labelFlags = item.labels.map((l) => `--label "${l}"`).join(' ');
      const titleEscaped = item.title.replace(/"/g, '\\"');
      const cmd = `gh issue create --title "${titleEscaped}" --body-file "${tempFile}" ${labelFlags}`;
      const output = execSync(cmd, { encoding: 'utf8' }).trim();
      const match = output.match(/issues\/(\d+)/);
      const ghNumber = match ? parseInt(match[1], 10) : null;

      console.log(`   ✓ GitHub Issue created: ${output} (Number: #${ghNumber})`);

      const entry = {
        ...item,
        ghUrl: output,
        ghNumber,
        jiraKey: existing?.jiraKey || null,
        jiraUrl: existing?.jiraUrl || null,
        remoteLinked: existing?.remoteLinked || false,
      };

      results.push(entry);
      existingMap.set(item.id, entry);

      // Checkpoint map
      fs.writeFileSync(mapFile, JSON.stringify(Array.from(existingMap.values()), null, 2), 'utf8');
    } catch (err) {
      hasError = true;
      console.error(`   ❌ Failed to create Issue #${item.id}:`, err.message);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }

  console.log(`\n🎉 Finished creating GitHub issues! Map saved to ${mapFile}`);
  if (hasError) {
    process.exitCode = 1;
  }
  return results;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  createGitHubIssues().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
