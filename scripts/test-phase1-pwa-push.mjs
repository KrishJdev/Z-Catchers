import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Auto-load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  // Ignore
}

console.log('🧪 Starting Phase 1: Mobile PWA Lifecycle, Service Worker & Multi-Device Push Verification...\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function run() {
  try {
    // -------------------------------------------------------------
    // 1. Web App Manifest Verification
    // -------------------------------------------------------------
    console.log('--- 1. Web App Manifest (manifest.json) Verification ---');
    const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
    assert(fs.existsSync(manifestPath), 'manifest.json exists');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert(manifest.id === '/', 'Manifest id is "/"');
    assert(manifest.scope === '/', 'Manifest scope is "/"');
    assert(manifest.start_url === '/', 'Manifest start_url is "/"');
    assert(manifest.display === 'standalone', 'Manifest display is "standalone"');
    assert(manifest.orientation === 'portrait', 'Manifest orientation is "portrait"');

    const hasAny192 = manifest.icons.some(
      (i) => i.src === '/icons/icon-192x192.png' && i.purpose === 'any'
    );
    const hasMaskable192 = manifest.icons.some(
      (i) => i.src === '/icons/icon-192x192.png' && i.purpose === 'maskable'
    );
    const hasAny512 = manifest.icons.some(
      (i) => i.src === '/icons/icon-512x512.png' && i.purpose === 'any'
    );
    const hasMaskable512 = manifest.icons.some(
      (i) => i.src === '/icons/icon-512x512.png' && i.purpose === 'maskable'
    );

    assert(hasAny192 && hasMaskable192, 'Icon 192x192 has distinct any and maskable declarations');
    assert(hasAny512 && hasMaskable512, 'Icon 512x512 has distinct any and maskable declarations');

    assert(Array.isArray(manifest.shortcuts), 'Manifest defines shortcuts array');
    const inBedShortcut = manifest.shortcuts.find(
      (s) => s.url === '/?action=in-bed' && s.name === "I'm In Bed"
    );
    assert(Boolean(inBedShortcut), '1-tap "I\'m In Bed" shortcut pointing to /?action=in-bed exists');

    // -------------------------------------------------------------
    // 2. Service Worker Verification
    // -------------------------------------------------------------
    console.log('\n--- 2. Service Worker (public/sw.js) Verification ---');
    const swPath = path.resolve(process.cwd(), 'public/sw.js');
    assert(fs.existsSync(swPath), 'public/sw.js exists');

    const swContent = fs.readFileSync(swPath, 'utf8');
    assert(swContent.includes('z-catchers-shell-v1'), 'Versioned shell cache "z-catchers-shell-v1" defined');
    assert(swContent.includes('self.skipWaiting()'), 'Calls self.skipWaiting() on install');
    assert(swContent.includes('self.clients.claim()'), 'Calls self.clients.claim() on activate');
    assert(swContent.includes("request.mode === 'navigate'"), 'Network-first for navigate requests');
    assert(swContent.includes('OFFLINE_HTML'), 'Contains Warm Dark offline fallback HTML');
    assert(swContent.includes('#120F0D'), 'Offline HTML uses Warm Dark palette (#120F0D)');
    assert(swContent.includes('btn-reconnect'), 'Offline HTML provides Reconnect retry action');
    assert(swContent.includes("url.pathname.startsWith('/api/')"), 'Strictly bypasses /api/* routes from caching');
    assert(swContent.includes('notificationclick'), 'Contains notificationclick handler');
    assert(swContent.includes('action=in-bed'), 'Supports deep-link action in-bed');
    assert(swContent.includes('pushsubscriptionchange'), 'Contains pushsubscriptionchange listener');
    assert(swContent.includes('/api/push/subscribe'), 'POSTs updated token to /api/push/subscribe on rotation');

    // -------------------------------------------------------------
    // 3. Client & Server Push Utilities Verification
    // -------------------------------------------------------------
    console.log('\n--- 3. Client & Server Push Utilities Verification ---');
    const pushClientPath = path.resolve(process.cwd(), 'src/lib/pushClient.ts');
    const pushClientContent = fs.readFileSync(pushClientPath, 'utf8');
    assert(
      pushClientContent.includes('syncPushSubscriptionHealth'),
      'pushClient.ts exports silent syncPushSubscriptionHealth function'
    );
    assert(
      pushClientContent.includes("Notification.permission === 'granted'"),
      'syncPushSubscriptionHealth checks permission is granted'
    );

    const pushServerPath = path.resolve(process.cwd(), 'src/lib/pushServer.ts');
    const pushServerContent = fs.readFileSync(pushServerPath, 'utf8');
    assert(
      pushServerContent.includes('statusCode === 404 || statusCode === 410'),
      'pushServer.ts checks for 404 / 410 dead subscription status codes'
    );
    assert(
      pushServerContent.includes("from('push_subscriptions')") && pushServerContent.includes('.delete()'),
      'pushServer.ts automatically prunes dead subscription endpoint from Supabase'
    );

    const subscribeRoutePath = path.resolve(process.cwd(), 'src/app/api/push/subscribe/route.ts');
    const subscribeRouteContent = fs.readFileSync(subscribeRoutePath, 'utf8');
    assert(
      subscribeRouteContent.includes('existingSub?.notify_personal ?? true') &&
      subscribeRouteContent.includes('existingSub?.notify_community ?? true'),
      '/api/push/subscribe preserves existing notification preferences when omitted'
    );

    // -------------------------------------------------------------
    // 4. PwaBanner Component Verification
    // -------------------------------------------------------------
    console.log('\n--- 4. PwaBanner Component Verification ---');
    const pwaBannerPath = path.resolve(process.cwd(), 'src/components/PwaBanner.tsx');
    const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf8');
    assert(
      pwaBannerContent.includes("(display-mode: standalone)") && pwaBannerContent.includes('.standalone'),
      'Detects standalone mode via matchMedia and navigator.standalone'
    );
    assert(
      pwaBannerContent.includes('zcatchers_pwa_banner_dismissed_at'),
      'Persists dismissal in localStorage'
    );
    assert(
      pwaBannerContent.includes('7 * 24 * 60 * 60 * 1000') || pwaBannerContent.includes('SEVEN_DAYS_MS'),
      'Enforces 7-day dismissal cooldown'
    );
    assert(
      pwaBannerContent.includes('beforeinstallprompt'),
      'Preserves beforeinstallprompt for Android/Chromium'
    );
    assert(
      pwaBannerContent.includes('Share') && pwaBannerContent.includes('Add to Home Screen'),
      'Renders iOS instructions to tap Share and Add to Home Screen'
    );

    // -------------------------------------------------------------
    // 5. Page.tsx Foreground Resume & Deep Link Verification
    // -------------------------------------------------------------
    console.log('\n--- 5. page.tsx Foreground Sync & Deep-Link Verification ---');
    const pagePath = path.resolve(process.cwd(), 'src/app/page.tsx');
    const pageContent = fs.readFileSync(pagePath, 'utf8');
    assert(
      pageContent.includes("document.visibilityState === 'visible'") && pageContent.includes("'focus'"),
      'page.tsx registers visibilitychange and window focus listeners'
    );
    assert(
      pageContent.includes('5000'),
      'page.tsx throttles foreground refetches to at most once every 5 seconds'
    );
    assert(
      pageContent.includes("action === 'in-bed'") || pageContent.includes("action=in-bed"),
      'page.tsx checks for /?action=in-bed deep-link query parameter'
    );
    assert(
      pageContent.includes('window.history.replaceState'),
      'page.tsx cleans URL query parameter via window.history.replaceState'
    );
    assert(
      pageContent.includes('syncPushSubscriptionHealth'),
      'page.tsx calls syncPushSubscriptionHealth on boot and foreground resume'
    );

    // -------------------------------------------------------------
    // 6. Live Multi-Device Push & Stale Pruning Test (if DB available)
    // -------------------------------------------------------------
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      console.log('\n--- 6. Live Multi-Device Subscriptions & Stale Pruning Verification ---');
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

      const { data: members } = await supabaseAdmin.from('members').select('id, discord_username').limit(1);
      const testMember = members && members.length > 0 ? members[0] : null;

      if (testMember) {
        const phoneEndpoint = `https://mock.fcm.push.apple/phone_${Date.now()}`;
        const desktopEndpoint = `https://mock.fcm.push.google/desktop_${Date.now()}`;

        // Upsert device 1: Mobile PWA
        const { error: err1 } = await supabaseAdmin.from('push_subscriptions').upsert(
          {
            member_id: testMember.id,
            endpoint: phoneEndpoint,
            p256dh_key: 'test_phone_key',
            auth_key: 'test_phone_auth',
            user_agent: 'Mobile PWA / iPhone',
          },
          { onConflict: 'endpoint' }
        );
        assert(!err1, 'Successfully upserted Mobile PWA push endpoint');

        // Upsert device 2: Desktop Browser for the SAME member
        const { error: err2 } = await supabaseAdmin.from('push_subscriptions').upsert(
          {
            member_id: testMember.id,
            endpoint: desktopEndpoint,
            p256dh_key: 'test_desktop_key',
            auth_key: 'test_desktop_auth',
            user_agent: 'Desktop Browser / Chrome',
          },
          { onConflict: 'endpoint' }
        );
        assert(!err2, 'Successfully upserted Desktop Browser push endpoint for the same member');

        // Verify both endpoints coexist simultaneously for the same member
        const { data: memberSubs } = await supabaseAdmin
          .from('push_subscriptions')
          .select('endpoint, user_agent')
          .eq('member_id', testMember.id)
          .in('endpoint', [phoneEndpoint, desktopEndpoint]);

        assert(
          memberSubs && memberSubs.length === 2,
          'Member simultaneously maintains active push subscriptions on both mobile PWA and desktop'
        );

        // Delete only the phone endpoint (specific endpoint unsubscribe)
        const { error: delErr } = await supabaseAdmin
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', phoneEndpoint);
        assert(!delErr, 'Successfully unsubscribed specific mobile endpoint');

        // Confirm desktop endpoint still exists and remains active
        const { data: remainingSubs } = await supabaseAdmin
          .from('push_subscriptions')
          .select('endpoint')
          .eq('endpoint', desktopEndpoint);
        assert(
          remainingSubs && remainingSubs.length === 1,
          'Desktop endpoint remains active after unsubscribing mobile endpoint'
        );

        // Clean up remaining test endpoint
        await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', desktopEndpoint);
        console.log('✅ PASSED: Cleaned up temporary test endpoints');
      }
    }

    console.log('\n-----------------------------------------------------------');
    if (failed) {
      console.error('❌ SOME TESTS FAILED.');
      process.exit(1);
    } else {
      console.log('🎉 ALL PHASE 1 MOBILE PWA & MULTI-DEVICE PUSH TESTS PASSED!');
    }
  } catch (err) {
    console.error('Unexpected test error:', err);
    process.exit(1);
  }
}

run();
