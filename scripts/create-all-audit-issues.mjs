import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const issues = [
  {
    id: 1,
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071', // Task
    title: '[P1 - High] Security: Remove hardcoded fallback session secrets & dev PIN salt in production',
    labels: ['security', 'backend', 'bug', 'priority: high'],
    file: 'src/lib/auth.ts',
    body: `## Summary & Problem Statement
In production deployments, the authentication module must strictly enforce strong, environment-configured cryptographic secrets. Currently, multiple fallback values are hardcoded in source code and remain active even when \`NODE_ENV === 'production'\`.

## Root Cause Analysis
1. \`src/lib/auth.ts#L96-L101\`: When \`SESSION_SECRET\` is missing, \`getSigningSessionSecret()\` falls back to the public string \`'z_catchers_session_secret_fox_den_fallback_2026'\`. It logs a warning but still returns this secret.
2. \`src/lib/auth.ts#L130-L138\`: \`getVerificationSessionSecrets()\` unconditionally appends both \`'z_catchers_session_secret_fox_den_fallback_2026'\` and \`'z_catchers_session_secret_dev_only'\` to candidate secrets for token verification in production.
3. \`src/lib/auth.ts#L58-L63\`: \`getPinSalt()\` falls back to \`'z_catchers_salt_dev_only'\`.

## Security & System Impact
- **Authentication Bypass:** Any attacker with knowledge of the public repository can forge valid HMAC-SHA256 session tokens for arbitrary \`member_id\`s, impersonating community members or moderators in production.
- **PIN Compromise:** 4-digit PINs (10,000 possibilities) can be brute-forced offline in milliseconds if hashed with a known, static salt.

## Target Files & Line References
- \`src/lib/auth.ts\` lines 58-63, 96-101, 130-138

## Remediation Plan
1. In \`src/lib/auth.ts\`, fail closed when \`NODE_ENV === 'production'\`: throw an error or refuse to sign/verify if \`SESSION_SECRET\` or \`PIN_SALT\` is not set.
2. Strictly gate fallback candidate secrets in \`getVerificationSessionSecrets()\` with \`if (process.env.NODE_ENV !== 'production')\`.
3. Add unit test assertions in \`scripts/test-login-and-auth.mjs\` verifying production rejection of dev fallbacks.`,
  },
  {
    id: 2,
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071', // Task
    title: '[P1 - High] Security: Fix unauthenticated push endpoint deletion in /api/push/unsubscribe',
    labels: ['security', 'pwa', 'backend', 'bug', 'priority: high'],
    file: 'src/app/api/push/unsubscribe/route.ts',
    body: `## Summary & Problem Statement
The Web Push unsubscription endpoint allows anonymous clients to delete arbitrary push subscription records from the database without authentication.

## Root Cause Analysis
In \`src/app/api/push/unsubscribe/route.ts#L21-L42\`:
When a request provides an \`endpoint\` string, the query filters only by \`endpoint\`. The check \`if (sessionMemberId) query.eq('member_id', sessionMemberId)\` is optional. If the caller has no session (\`sessionMemberId === null\`), it unconditionally deletes the subscription record matching that endpoint URL across the entire database.

## Security & System Impact
- **Denial of Service / Alert Suppression:** Any unauthenticated actor who knows or guesses a push endpoint URL (or intercepts one) can delete another member's push notification registration.
- Silences legitimate bedtime alarms, community reminders, and Sleep Shield notifications for affected users.

## Target Files & Line References
- \`src/app/api/push/unsubscribe/route.ts\` lines 21-42

## Remediation Plan
1. Require an authenticated session (via session cookie or \`Authorization: Bearer <token>\`) for all unsubscription requests.
2. Always enforce \`.eq('member_id', sessionMemberId)\` on the delete query.
3. Return HTTP 401 Unauthorized if no authenticated session is present.`,
  },
  {
    id: 3,
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071', // Task
    title: '[P1 - High] Security: Enforce database-backed persistent rate limiting in cancel-pending and push/subscribe',
    labels: ['security', 'backend', 'bug', 'priority: high'],
    file: 'src/app/api/members/cancel-pending/route.ts',
    body: `## Summary & Problem Statement
Two API routes still rely on in-memory rate limiting, which is ineffective in serverless deployment environments like Vercel.

## Root Cause Analysis
- \`src/app/api/members/cancel-pending/route.ts#L4, L38, L68, L82, L88\`: Imports and invokes \`checkPinRateLimit\`, \`recordPinFailure\`, and \`resetPinFailure\` (in-memory Map).
- \`src/app/api/push/subscribe/route.ts#L4, L101, L117, L119\`: Imports and invokes the in-memory \`checkPinRateLimit\`, \`recordPinFailure\`, and \`resetPinFailure\` functions.

## Security & System Impact
- In serverless runtimes (such as Vercel Edge / Node Serverless), each cold start, isolate migration, or concurrent container has an isolated in-memory Map that resets to zero attempts.
- Attackers can distribute requests across concurrent instances to brute-force 4-digit PINs without hitting lockout limits.

## Target Files & Line References
- \`src/app/api/members/cancel-pending/route.ts\` lines 4, 38, 68, 82, 88
- \`src/app/api/push/subscribe/route.ts\` lines 4, 101, 117, 119

## Remediation Plan
1. In both routes, import and use \`checkPinRateLimitPersistent\`, \`recordPinFailurePersistent\`, and \`resetPinFailurePersistent\` from \`@/lib/rateLimit\`.
2. Ensure database-backed sliding windows and lockout tracking via the Supabase \`rate_limits\` table.`,
  },
  {
    id: 4,
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071', // Task
    title: '[P1 - High] Security: Sanitize and validate x-forwarded-host in OAuth redirect base URL',
    labels: ['security', 'backend', 'bug', 'priority: high'],
    file: 'src/lib/auth.ts',
    body: `## Summary & Problem Statement
The OAuth base URL resolution logic trusts client-controlled HTTP headers without validation, introducing potential host header poisoning risks.

## Root Cause Analysis
\`src/lib/auth.ts#L217-L222\`:
\`\`\`typescript
const proto = request.headers.get('x-forwarded-proto') || 'https';
const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
if (host) {
  return \`\${proto}://\${host}\`;
}
\`\`\`
The header \`x-forwarded-host\` is used directly to build the Discord OAuth callback URL.

## Security & System Impact
- **OAuth Code Hijacking / Open Redirect:** In proxy or reverse-proxy configurations where \`x-forwarded-host\` is passed from the client, an attacker can supply \`x-forwarded-host: evil.com\`, causing the application to register \`https://evil.com/api/auth/discord/callback\` as the OAuth redirect URL, leaking authorization codes.

## Target Files & Line References
- \`src/lib/auth.ts\` lines 217-222

## Remediation Plan
1. Use \`process.env.NEXT_PUBLIC_APP_URL\` as the authoritative source of truth.
2. If resolving from headers, validate \`host\` against an allowlist of trusted origins (e.g. \`z-catchers.vercel.app\`, \`localhost:3000\`).`,
  },
  {
    id: 5,
    priorityTag: 'P1 - High',
    jiraPriority: 'High',
    issueTypeId: '10071', // Task
    title: '[P1 - High] Security: Prevent IDOR / unauthenticated claim in update-schedule when mod rate limit is exceeded',
    labels: ['security', 'backend', 'bug', 'priority: high'],
    file: 'src/app/api/members/update-schedule/route.ts',
    body: `## Summary & Problem Statement
When a schedule update request contains a \`mod_passcode\` that triggers the rate limiter, the endpoint skips moderator validation but does not reject the request, allowing fallthrough to profile claiming.

## Root Cause Analysis
\`src/app/api/members/update-schedule/route.ts#L62-L75\`:
When \`modRate.allowed === false\`, the code logs a warning and leaves \`isModeratorOverride = false\`. The execution flow then proceeds to line 74 where \`isFirstTimeClaim\` is evaluated. If the profile is unlinked and has no existing PIN, the caller is treated as claiming the profile.

## Security & System Impact
- **Authorization Bypass & IDOR:** An attacker who triggers moderator rate limits can still claim unlinked profiles by falling through into first-time claim logic without valid verification.

## Target Files & Line References
- \`src/app/api/members/update-schedule/route.ts\` lines 62-75

## Remediation Plan
1. When \`mod_passcode\` is supplied and \`!modRate.allowed\`, immediately return HTTP 429 Too Many Requests with \`Retry-After\` header.
2. Abort execution immediately upon rate limit exhaustion rather than continuing.`,
  },
  {
    id: 6,
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071', // Task
    title: '[P2 - Medium] PWA / Notifications: Prevent race condition by recording nag deduplication before sending push',
    labels: ['pwa', 'backend', 'bug', 'priority: medium'],
    file: 'src/app/api/members/nag-notif/route.ts',
    body: `## Summary & Problem Statement
In \`/api/members/nag-notif\`, Web Push notifications are dispatched across networks before the deduplication record is committed to the database.

## Root Cause Analysis
\`src/app/api/members/nag-notif/route.ts#L202-L240\`:
1. Push notifications are sent to all subscriber devices on lines 202-227.
2. The deduplication log entry (\`NOTIFICATION_LOG\`) is inserted on lines 235-240.

## Impact & Failure Mode
- Concurrent requests from rapid double-tapping on "Send Nag" or network retries will both pass the initial dedup check (lines 158-164).
- Both requests dispatch push notifications, resulting in duplicate notification spam delivered to the sleeper.

## Target Files & Line References
- \`src/app/api/members/nag-notif/route.ts\` lines 202-240

## Remediation Plan
1. Insert the deduplication record into \`notification_logs\` (relying on the unique constraint on \`[member_id, notification_type, local_date, stage]\`) *before* invoking \`sendPushNotification()\`.
2. If the insert fails due to a unique constraint violation, gracefully return the existing assist count and exit without sending duplicate push notifications.`,
  },
  {
    id: 7,
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071', // Task
    title: '[P2 - Medium] PWA / Push: Add Authorization Bearer header to push test and unsubscribe requests',
    labels: ['pwa', 'frontend', 'bug', 'priority: medium'],
    file: 'src/components/PushModal.tsx',
    body: `## Summary & Problem Statement
Push test and unsubscription calls omit the client's stored authentication token, leading to 401 Unauthorized errors on mobile PWAs where cookies are restricted.

## Root Cause Analysis
- \`src/components/PushModal.tsx#L158-L162\`: \`handleSendTestPush()\` invokes \`fetch('/api/push/test')\` without \`Authorization: Bearer <token>\`.
- \`src/lib/pushClient.ts#L365-L370\`: \`unsubscribeFromPush()\` calls \`fetch('/api/push/unsubscribe')\` without \`Authorization: Bearer <token>\`.

## Impact & Failure Mode
- In iOS Safari PWA standalone mode or browsers with strict third-party/partitioned cookie policies, \`/api/push/test\` and \`/api/push/unsubscribe\` fail with HTTP 401 Unauthorized even when the user has an active session.

## Target Files & Line References
- \`src/components/PushModal.tsx\` lines 158-162
- \`src/lib/pushClient.ts\` lines 365-370

## Remediation Plan
1. Retrieve \`getStoredAuthToken()\` and inject \`headers: { 'Authorization': \`Bearer \${token}\` }\` into the fetch calls for both endpoints.`,
  },
  {
    id: 8,
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071', // Task
    title: '[P2 - Medium] Backend: Align nag-assist date calculation with getSleepCycleDate()',
    labels: ['backend', 'bug', 'priority: medium'],
    file: 'src/app/api/members/nag-assist/route.ts',
    body: `## Summary & Problem Statement
Community nag assists record and fetch tallies using standard calendar date instead of the member's sleep cycle date, causing desynchronization for post-midnight bedtimes.

## Root Cause Analysis
\`src/app/api/members/nag-assist/route.ts#L57\` and \`#L132\`:
The route computes local date via \`sleeperLocalNow.toISODate()\` (calendar day).
In contrast, \`nag-notif\` and the main roster endpoint use \`getSleepCycleDate(sleeper as Member, nowUtc)\`.

## Impact & Failure Mode
- For members with bedtimes after midnight (e.g. 01:00 AM), assists logged at 11:30 PM and assists logged at 12:30 AM get assigned to different calendar dates.
- Assist counts on the frontend member card desynchronize between endpoints.

## Target Files & Line References
- \`src/app/api/members/nag-assist/route.ts\` lines 57, 132

## Remediation Plan
1. Update both POST and GET handlers in \`nag-assist/route.ts\` to use \`getSleepCycleDate(sleeper as Member, nowUtc)\`.`,
  },
  {
    id: 9,
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071', // Task
    title: '[P2 - Medium] PWA / Service Worker: Resolve notificationclick message dropping during tab navigation',
    labels: ['pwa', 'bug', 'priority: medium'],
    file: 'public/sw.js',
    body: `## Summary & Problem Statement
When a user clicks a push notification, the service worker calls \`client.navigate()\` and immediately fires a \`client.postMessage()\`. The message is lost during page unload.

## Root Cause Analysis
\`public/sw.js#L269-L279\`:
\`\`\`javascript
client.focus();
if ('navigate' in client) { client.navigate(targetUrl); }
if ('postMessage' in client) {
  client.postMessage({ type: 'NOTIFICATION_ACTION', url: targetUrl, action: ... });
}
\`\`\`
Calling \`client.navigate()\` causes the document to tear down and navigate, discarding any pending \`postMessage\` in transit.

## Impact & Failure Mode
- Tapping "I'm in Bed" from a push notification action button often fails to check the user in when navigating an existing tab.

## Target Files & Line References
- \`public/sw.js\` lines 269-279

## Remediation Plan
1. Rely on the URL query parameter (\`targetUrl = '/?action=in-bed'\`), which \`HomePage\` already handles reliably on mount via \`processDeepLinkAction()\`.
2. Only send \`postMessage\` if \`client.navigate()\` is not called (i.e. client is already at \`targetUrl\`).`,
  },
  {
    id: 10,
    priorityTag: 'P2 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071', // Task
    title: '[P2 - Medium] Backend: Remove wake_time_local default destructuring to prevent schedule overwrites',
    labels: ['backend', 'bug', 'priority: medium'],
    file: 'src/app/api/members/update-schedule/route.ts',
    body: `## Summary & Problem Statement
Destructuring \`wake_time_local = '07:00'\` as a default value inadvertently resets custom wake times when omitted from partial updates.

## Root Cause Analysis
\`src/app/api/members/update-schedule/route.ts#L33\`:
\`\`\`typescript
const { wake_time_local = '07:00', ... } = body;
\`\`\`
On line 216:
\`\`\`typescript
targetWakeTime = wake_time_local || currentMember.wake_time_local;
\`\`\`
Because \`wake_time_local\` defaults to \`'07:00'\`, it is never \`undefined\` and always overwrites the member's existing custom wake time (e.g. 08:30 or 09:00).

## Impact & Failure Mode
- A member editing only their bedtime or journal link has their custom wake time reset to 07:00, unintentionally triggering a 48-hour schedule cooldown.

## Target Files & Line References
- \`src/app/api/members/update-schedule/route.ts\` lines 33, 216

## Remediation Plan
1. Remove the default value (\`= '07:00'\`) from the destructuring in \`update-schedule/route.ts\`.
2. Allow \`wake_time_local\` to be \`undefined\` when omitted, falling back cleanly to \`currentMember.wake_time_local\`.`,
  },
  {
    id: 11,
    priorityTag: 'P3 - Medium',
    jiraPriority: 'Medium',
    issueTypeId: '10071', // Task
    title: '[P3 - Medium] State Machine: Reconcile Sleep Shield active vs canVoteStrike in 60-480m overdue window',
    labels: ['frontend', 'backend', 'bug', 'priority: medium'],
    file: 'src/lib/sleepEngine.ts',
    body: `## Summary & Problem Statement
In the 60-480 minute window past bedtime for unchecked-in members, the sleep engine sets both \`isSleepShieldActive = true\` and \`canVoteStrike = true\`, creating conflicting UI states.

## Root Cause Analysis
- \`src/lib/sleepEngine.ts#L1189-L1196\`: When a member is 60 to 480 minutes past bedtime without checking in, \`isSleepShieldActive\` is set to \`true\` while \`canVoteStrike\` is also set to \`true\`.
- \`src/components/MemberCard.tsx#L210-L218\`: \`isTargetShieldOn\` checks \`state.isSleepShieldActive || bucket === 'SLEEPING'\`, which displays "Shield On (Muted)" while strike voting controls are rendered.

## Impact & Failure Mode
- Confusing UI: The card indicates Sleep Shield is active (muted), yet peers are prompted to cast strikes against them.

## Target Files & Line References
- \`src/lib/sleepEngine.ts\` lines 1189-1196
- \`src/components/MemberCard.tsx\` lines 210-218

## Remediation Plan
1. Reconcile state: when the 60-minute nag window passes, either disallow strike voting (\`canVoteStrike = false\` when \`diffMinutes > 60\`) or create a distinct status state (e.g. \`UNCHECKED_OVERDUE\`).`,
  },
  {
    id: 12,
    priorityTag: 'P3 - Low',
    jiraPriority: 'Low',
    issueTypeId: '10071', // Task
    title: '[P3 - Low] State Machine: Enforce mutual exclusion between is_in_bed and is_woke_up flags',
    labels: ['backend', 'frontend', 'bug', 'priority: low'],
    file: 'src/app/api/auth/me/route.ts',
    body: `## Summary & Problem Statement
\`is_in_bed\` and \`is_woke_up\` can both evaluate to \`true\` simultaneously if log entries for both exist on the same cycle date.

## Root Cause Analysis
- \`src/app/api/auth/me/route.ts#L78-L79\` and \`src/app/api/members/route.ts#L120-L121\`:
Both flags are derived independently by checking for \`IN_BED_EARLY\` and \`WOKE_UP\` in \`notification_logs\`. If a race condition occurs during check-in/wake-up cancellation, both records can exist for today's sleep cycle date.

## Impact & Failure Mode
- Main dashboard renders conflicting UI states (e.g. displaying member as both Asleep and Awake).

## Target Files & Line References
- \`src/app/api/auth/me/route.ts\` lines 78-79
- \`src/app/api/members/route.ts\` lines 120-121

## Remediation Plan
1. Enforce explicit mutual exclusion in hydration: if \`is_woke_up === true\`, set \`is_in_bed = false\`.`,
  },
  {
    id: 13,
    priorityTag: 'P3 - Low',
    jiraPriority: 'Low',
    issueTypeId: '10071', // Task / Enhancement
    title: '[P3 - Low] Security / ModDrawer: Avoid storing plaintext moderator passcode in sessionStorage',
    labels: ['security', 'frontend', 'enhancement', 'priority: low'],
    file: 'src/components/ModDrawer.tsx',
    body: `## Summary & Problem Statement
The moderator drawer caches the raw master moderator passcode in plaintext in browser \`sessionStorage\`.

## Root Cause Analysis
\`src/components/ModDrawer.tsx#L141\`:
\`\`\`typescript
const cached = sessionStorage.getItem('z_catchers_mod_passcode');
if (cached) {
  setPasscode(cached);
  setIsUnlocked(true);
}
\`\`\`

## Impact & Failure Mode
- Plaintext secret exposure: Any script running in the browser tab (such as third-party scripts or extensions) can access the master moderator secret.

## Target Files & Line References
- \`src/components/ModDrawer.tsx\` lines 138-147

## Remediation Plan
1. Rely on the server-authenticated session cookie with verified moderator role claims instead of caching the master passcode in plaintext.
2. If temporary client-side caching is required, issue a short-lived signed moderator JWT.`,
  },
  {
    id: 14,
    priorityTag: 'P3 - Low',
    jiraPriority: 'Low',
    issueTypeId: '10071', // Task / Enhancement
    title: '[P3 - Low] PWA / Cache: Implement versioned cache invalidation for _next/static assets in Service Worker',
    labels: ['pwa', 'enhancement', 'priority: low'],
    file: 'public/sw.js',
    body: `## Summary & Problem Statement
The service worker caches Next.js static chunks using stale-while-revalidate under a static cache key (\`z-catchers-shell-v1\`), which does not automatically bust on new deployments.

## Root Cause Analysis
\`public/sw.js#L4, L192-L206\`:
\`\`\`javascript
if (url.pathname.startsWith('/_next/static/')) { ... }
\`\`\`
Assets are matched against cache first while revalidating in background. When a new deployment compiles with new chunk hashes, users can load stale JavaScript chunks.

## Impact & Failure Mode
- Installed PWA users can experience React hydration mismatches or \`ChunkLoadError\` on their first visit following a production deployment.

## Target Files & Line References
- \`public/sw.js\` lines 4, 192-206

## Remediation Plan
1. Use network-first caching for \`_next/static/\` with offline cache fallback, or incorporate a build timestamp / git commit hash into the cache name.`,
  },
];

export async function createGitHubIssues() {
  console.log('Creating 14 GitHub Issues with proper tags and descriptions...\n');

  const mapFile = path.join(process.cwd(), 'scripts', 'audit-issues-map.json');
  const syncedFile = path.join(process.cwd(), 'scripts', 'audit-issues-synced.json');
  const isReset = process.argv.includes('--reset') || process.env.RESET_MAP === 'true';

  // Load existing mappings unless an explicit reset is requested
  const existingMap = new Map();
  if (fs.existsSync(mapFile) && !isReset) {
    try {
      const existingData = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      if (Array.isArray(existingData)) {
        for (const entry of existingData) {
          if (entry && entry.id != null) {
            existingMap.set(entry.id, entry);
          }
        }
      }
    } catch (e) {
      console.warn(`Warning: Could not parse existing ${mapFile}:`, e.message);
    }
  }

  // Incorporate saved Jira keys from audit-issues-synced.json if present
  if (fs.existsSync(syncedFile) && !isReset) {
    try {
      const syncedData = JSON.parse(fs.readFileSync(syncedFile, 'utf8'));
      if (Array.isArray(syncedData)) {
        for (const s of syncedData) {
          if (s && s.id != null) {
            const current = existingMap.get(s.id) || {};
            existingMap.set(s.id, {
              ...current,
              jiraKey: current.jiraKey || s.jiraKey,
              jiraUrl: current.jiraUrl || s.jiraUrl,
              remoteLinked: current.remoteLinked ?? s.remoteLinked,
            });
          }
        }
      }
    } catch (e) {
      console.warn(`Warning: Could not parse existing ${syncedFile}:`, e.message);
    }
  }

  let hasError = false;

  for (const item of issues) {
    const existing = existingMap.get(item.id);
    if (!isReset && existing && existing.ghNumber) {
      console.log(`[Issue #${item.id}] Already created on GitHub: #${existing.ghNumber} (${item.title.slice(0, 40)}...)`);
      continue;
    }

    console.log(`[Issue #${item.id}] Creating: "${item.title}"...`);
    const tempFile = path.join(process.cwd(), 'scripts', `_temp_issue_${item.id}.md`);
    fs.writeFileSync(tempFile, item.body, 'utf8');

    const labelArgs = item.labels.map((l) => `--label "${l}"`).join(' ');
    const cmd = `gh issue create --title "${item.title.replace(/"/g, '\\"')}" --body-file "${tempFile}" ${labelArgs}`;

    try {
      const output = execSync(cmd, { encoding: 'utf8' }).trim();
      console.log(`  -> Created: ${output}`);
      const issueNumMatch = output.match(/\/issues\/(\d+)$/);
      const issueNum = issueNumMatch ? issueNumMatch[1] : null;

      // Update entry only after successful operation, retaining existing Jira keys
      existingMap.set(item.id, {
        ...(existing || {}),
        ...item,
        ghUrl: output,
        ghNumber: issueNum,
      });

      // Atomically persist map after each successful issue creation
      const checkpointResults = issues.map((i) => {
        const ex = existingMap.get(i.id);
        return ex ? { ...i, ...ex, ghUrl: ex.ghUrl, ghNumber: ex.ghNumber, jiraKey: ex.jiraKey, jiraUrl: ex.jiraUrl, remoteLinked: ex.remoteLinked } : i;
      });
      fs.writeFileSync(mapFile, JSON.stringify(checkpointResults, null, 2), 'utf8');
    } catch (err) {
      hasError = true;
      console.error(`  -> Failed to create issue #${item.id}:`, err.message);
      // Retain existing entry; do not overwrite or discard
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  }

  const finalResults = issues.map((item) => {
    const existing = existingMap.get(item.id);
    return existing
      ? {
          ...existing,
          ...item,
          ghUrl: existing.ghUrl,
          ghNumber: existing.ghNumber,
          jiraKey: existing.jiraKey,
          jiraUrl: existing.jiraUrl,
          remoteLinked: existing.remoteLinked,
        }
      : item;
  });

  fs.writeFileSync(mapFile, JSON.stringify(finalResults, null, 2), 'utf8');
  console.log(`\nGitHub issues processing finished! Saved map to ${mapFile}`);

  if (hasError) {
    process.exitCode = 1;
  }

  return finalResults;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  createGitHubIssues().catch((err) => {
    console.error('Fatal error during issue creation:', err);
    process.exit(1);
  });
}
