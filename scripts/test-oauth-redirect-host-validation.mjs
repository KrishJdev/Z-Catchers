#!/usr/bin/env node
/**
 * Automated Unit Test Suite: OAuth Redirect Host Header Poisoning & Base URL Sanitization
 *
 * Verifies resolution of Issue #33 / #48 (Jira ZC-19):
 * 1. Static AST / source inspection confirming getAppBaseUrl, isTrustedHost, and sanitizeHostHeader exports and usage.
 * 2. Strict host header format sanitization (multi-value commas, CRLF, injection, userinfo, ports, RFC 1123).
 * 3. Trusted host allowlist validation (canonical production, Vercel preview wildcards, ALLOWED_HOSTS, loopback).
 * 4. Production vs non-production loopback isolation.
 * 5. Protocol sanitization (rejecting javascript:, data:, enforcing https in production).
 * 6. Authoritative prioritization of NEXT_PUBLIC_APP_URL over spoofed client headers.
 * 7. Safe fail-closed fallback when untrusted or malformed headers are passed.
 * 8. Route handler integration tests for /api/auth/discord, /api/auth/discord/callback, /api/auth/login, /api/auth/register.
 */

import fs from 'fs';
import path from 'path';

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
  console.log('🧪 Starting OAuth Redirect Host Header Validation & Sanitization Test Suite (ZC-19 / GH #33)...\n');

  const {
    getAppBaseUrl,
    isTrustedHost,
    sanitizeHostHeader,
  } = await import('../src/lib/auth.ts');

  // =========================================================================
  // 1. Static AST / Source Code Verification
  // =========================================================================
  console.log('--- 1. Static AST & Source Code Verification ---');

  const authSrc = fs.readFileSync(path.resolve('src/lib/auth.ts'), 'utf8');
  assert(authSrc.includes('export function sanitizeHostHeader('), 'auth.ts exports sanitizeHostHeader');
  assert(authSrc.includes('export function isTrustedHost('), 'auth.ts exports isTrustedHost');
  assert(authSrc.includes('export function getAppBaseUrl('), 'auth.ts exports getAppBaseUrl');
  assert(
    authSrc.includes('process.env.NEXT_PUBLIC_APP_URL') &&
    authSrc.includes('isTrustedHost(') &&
    authSrc.includes('sanitizeHostHeader('),
    'auth.ts sanitizes and validates host headers against trusted allowlist'
  );

  const discordRouteSrc = fs.readFileSync(path.resolve('src/app/api/auth/discord/route.ts'), 'utf8');
  assert(discordRouteSrc.includes('getAppBaseUrl(request)'), 'discord/route.ts invokes getAppBaseUrl(request)');

  const callbackRouteSrc = fs.readFileSync(path.resolve('src/app/api/auth/discord/callback/route.ts'), 'utf8');
  assert(callbackRouteSrc.includes('getAppBaseUrl(request)'), 'discord/callback/route.ts invokes getAppBaseUrl(request)');

  const loginRouteSrc = fs.readFileSync(path.resolve('src/app/api/auth/login/route.ts'), 'utf8');
  assert(loginRouteSrc.includes('getAppBaseUrl(request)'), 'login/route.ts invokes getAppBaseUrl(request)');

  const registerRouteSrc = fs.readFileSync(path.resolve('src/app/api/auth/register/route.ts'), 'utf8');
  assert(registerRouteSrc.includes('getAppBaseUrl(request)'), 'register/route.ts invokes getAppBaseUrl(request)');

  // =========================================================================
  // 2. Host Header Sanitization (sanitizeHostHeader)
  // =========================================================================
  console.log('\n--- 2. Host Header Sanitization (sanitizeHostHeader) ---');

  // Null & empty values
  assert(sanitizeHostHeader(null) === null, 'Rejects null rawHost');
  assert(sanitizeHostHeader(undefined) === null, 'Rejects undefined rawHost');
  assert(sanitizeHostHeader('') === null, 'Rejects empty rawHost');
  assert(sanitizeHostHeader('   ') === null, 'Rejects whitespace-only rawHost');

  // Multi-value comma separation (takes first client-facing host)
  assert(
    sanitizeHostHeader('z-catchers.vercel.app, proxy1.internal, proxy2.internal') === 'z-catchers.vercel.app',
    'Extracts first client-facing host from multi-value comma-separated header'
  );
  assert(
    sanitizeHostHeader('evil.com, z-catchers.vercel.app') === 'evil.com',
    'Extracts first entry even if malicious client prepends evil.com'
  );

  // CRLF injection attacks
  assert(sanitizeHostHeader('z-catchers.vercel.app\r\nEvil-Header: injected') === null, 'Rejects CRLF \\r\\n injection');
  assert(sanitizeHostHeader('z-catchers.vercel.app\nInjected: 1') === null, 'Rejects newline \\n injection');
  assert(sanitizeHostHeader('z-catchers.vercel.app\rInjected: 1') === null, 'Rejects carriage return \\r injection');

  // Control characters & null bytes
  assert(sanitizeHostHeader('z-catchers.vercel.app\0.evil.com') === null, 'Rejects null byte \\0 injection');
  assert(sanitizeHostHeader('z-catchers\x1b[31m.vercel.app') === null, 'Rejects ANSI escape sequences');

  // Userinfo, path, query, fragment injection
  assert(sanitizeHostHeader('user:pass@z-catchers.vercel.app') === null, 'Rejects userinfo @ injection');
  assert(sanitizeHostHeader('z-catchers.vercel.app/oauth/callback') === null, 'Rejects path / in host header');
  assert(sanitizeHostHeader('z-catchers.vercel.app\\evil') === null, 'Rejects backslash \\ in host header');
  assert(sanitizeHostHeader('z-catchers.vercel.app?redirect=evil.com') === null, 'Rejects query string ? in host header');
  assert(sanitizeHostHeader('z-catchers.vercel.app#fragment') === null, 'Rejects fragment # in host header');
  assert(sanitizeHostHeader('"z-catchers.vercel.app"') === null, 'Rejects quotes in host header');

  // Port format validation
  assert(sanitizeHostHeader('localhost:3000') === 'localhost:3000', 'Allows valid host with port 3000');
  assert(sanitizeHostHeader('127.0.0.1:8080') === '127.0.0.1:8080', 'Allows valid IPv4 with port 8080');
  assert(sanitizeHostHeader('z-catchers.vercel.app:443') === 'z-catchers.vercel.app:443', 'Allows valid domain with port 443');
  assert(sanitizeHostHeader('localhost:0') === null, 'Rejects port 0');
  assert(sanitizeHostHeader('localhost:65536') === null, 'Rejects port out of range (>65535)');
  assert(sanitizeHostHeader('localhost:999999') === null, 'Rejects 6-digit port');
  assert(sanitizeHostHeader('localhost:abc') === null, 'Rejects non-numeric port');

  // IPv6 bracketed hosts
  assert(sanitizeHostHeader('[::1]') === '[::1]', 'Allows valid bracketed IPv6 loopback [::1]');
  assert(sanitizeHostHeader('[::1]:3000') === '[::1]:3000', 'Allows valid bracketed IPv6 with port [::1]:3000');
  assert(sanitizeHostHeader('[2001:db8::1]:8443') === '[2001:db8::1]:8443', 'Allows valid IPv6 address with port');

  // RFC 1123 label rules
  assert(sanitizeHostHeader('-invalid.com') === null, 'Rejects hostname label starting with hyphen');
  assert(sanitizeHostHeader('invalid-.com') === null, 'Rejects hostname label ending with hyphen');
  assert(sanitizeHostHeader('inv..alid.com') === null, 'Rejects hostname with consecutive dots');
  assert(sanitizeHostHeader('a'.repeat(64) + '.com') === null, 'Rejects label exceeding 63 characters');

  // Normalization to lowercase
  assert(sanitizeHostHeader('Z-CATCHERS.VERCEL.APP') === 'z-catchers.vercel.app', 'Normalizes hostname to lowercase');

  // =========================================================================
  // 3. Trusted Host Allowlist Validation (isTrustedHost)
  // =========================================================================
  console.log('\n--- 3. Trusted Host Allowlist Validation (isTrustedHost) ---');

  // Canonical production domains
  assert(isTrustedHost('z-catchers.vercel.app') === true, 'Accepts exact canonical production domain z-catchers.vercel.app');
  assert(isTrustedHost('api.z-catchers.vercel.app') === true, 'Accepts subdomains of canonical domain');

  // Vercel Preview Deployments for Z-Catchers
  assert(
    isTrustedHost('z-catchers-git-feat-zc-19.vercel.app') === true,
    'Accepts valid Vercel branch preview deployment z-catchers-git-feat-zc-19.vercel.app'
  );
  assert(
    isTrustedHost('z-catchers-git-krish-krishjdevs-projects.vercel.app') === true,
    'Accepts preview deployment with team slug z-catchers-*-krishjdevs-projects.vercel.app'
  );

  // Attacker lookalikes & poisoning attempts (MUST BE STRICTLY REJECTED)
  assert(isTrustedHost('evil.com') === false, 'Strictly rejects evil.com');
  assert(isTrustedHost('attacker.org:3000') === false, 'Strictly rejects attacker.org:3000');
  assert(isTrustedHost('evil-z-catchers.vercel.app') === false, 'Strictly rejects prefix spoof evil-z-catchers.vercel.app');
  assert(isTrustedHost('z-catchers-attacker.vercel.app') === false, 'Strictly rejects unrelated project prefix z-catchers-attacker.vercel.app');
  assert(isTrustedHost('z-catchers.vercel.app.evil.com') === false, 'Strictly rejects subdomain spoof z-catchers.vercel.app.evil.com');
  assert(isTrustedHost('attacker.vercel.app') === false, 'Strictly rejects other arbitrary vercel.app deployments');
  assert(isTrustedHost('fake-z-catchers.com') === false, 'Strictly rejects fake-z-catchers.com');

  // Loopback / Localhost handling
  const origNodeEnv = process.env.NODE_ENV;

  // In test / development mode:
  process.env.NODE_ENV = 'test';
  assert(isTrustedHost('localhost') === true, 'Accepts localhost in test mode');
  assert(isTrustedHost('localhost:3000') === true, 'Accepts localhost:3000 in test mode');
  assert(isTrustedHost('127.0.0.1:3000') === true, 'Accepts 127.0.0.1:3000 in test mode');
  assert(isTrustedHost('[::1]:3000') === true, 'Accepts [::1]:3000 in test mode');

  // In production mode: loopback must be rejected unless allowLocalhost: true
  process.env.NODE_ENV = 'production';
  assert(isTrustedHost('localhost') === false, 'Rejects localhost in production mode by default');
  assert(isTrustedHost('localhost:3000') === false, 'Rejects localhost:3000 in production mode by default');
  assert(isTrustedHost('127.0.0.1:3000') === false, 'Rejects 127.0.0.1 in production mode by default');
  assert(isTrustedHost('localhost:3000', { allowLocalhost: true }) === true, 'Allows localhost in production when allowLocalhost: true');

  // Custom ALLOWED_HOSTS / TRUSTED_HOSTS environment variable
  process.env.ALLOWED_HOSTS = 'custom-fox-den.org, *.community-foxes.den';
  assert(isTrustedHost('custom-fox-den.org') === true, 'Accepts exact custom host from ALLOWED_HOSTS');
  assert(isTrustedHost('sub.community-foxes.den') === true, 'Accepts wildcard subdomain from ALLOWED_HOSTS');
  assert(isTrustedHost('unauthorized.org') === false, 'Rejects unauthorized host not in ALLOWED_HOSTS');

  delete process.env.ALLOWED_HOSTS;
  process.env.NODE_ENV = origNodeEnv;

  // =========================================================================
  // 4. Base URL Resolution (getAppBaseUrl) & Host Header Poisoning Defense
  // =========================================================================
  console.log('\n--- 4. Base URL Resolution (getAppBaseUrl) & Host Poisoning Defense ---');

  const origAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  // Case 4A: NEXT_PUBLIC_APP_URL is authoritative
  process.env.NEXT_PUBLIC_APP_URL = 'https://z-catchers.vercel.app';

  const poisonedReq1 = new Request('https://z-catchers.vercel.app/api/auth/discord', {
    headers: {
      'x-forwarded-host': 'evil.attacker.com',
      'x-forwarded-proto': 'https',
    },
  });
  const resolvedUrl1 = getAppBaseUrl(poisonedReq1);
  assert(
    resolvedUrl1 === 'https://z-catchers.vercel.app',
    'Prioritizes authoritative NEXT_PUBLIC_APP_URL and ignores poisoned x-forwarded-host'
  );

  // Case 4A-2: Valid non-placeholder domain containing "example" as substring (e.g. notexample.com)
  process.env.NEXT_PUBLIC_APP_URL = 'https://notexample.com';
  assert(
    getAppBaseUrl() === 'https://notexample.com',
    'Accepts valid public URL even if substring contains "example" when host is not exact placeholder'
  );
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
  assert(
    getAppBaseUrl() !== 'https://example.com',
    'Rejects exact placeholder example.com'
  );

  // Case 4B: NEXT_PUBLIC_APP_URL is unset; test request header validation
  delete process.env.NEXT_PUBLIC_APP_URL;

  // Legitimate preview host header
  const legitimatePreviewReq = new Request('https://z-catchers-git-feat-zc-19.vercel.app/api/auth/discord', {
    headers: {
      'x-forwarded-host': 'z-catchers-git-feat-zc-19.vercel.app',
      'x-forwarded-proto': 'https',
    },
  });
  assert(
    getAppBaseUrl(legitimatePreviewReq) === 'https://z-catchers-git-feat-zc-19.vercel.app',
    'Resolves trusted Vercel preview host from x-forwarded-host when NEXT_PUBLIC_APP_URL is unset'
  );

  // Attack: Untrusted domain in x-forwarded-host
  const evilHostReq = new Request('https://z-catchers.vercel.app/api/auth/discord', {
    headers: {
      'x-forwarded-host': 'evil.attacker.com',
      'x-forwarded-proto': 'https',
    },
  });
  const evilResolved = getAppBaseUrl(evilHostReq);
  assert(
    evilResolved !== 'https://evil.attacker.com' && !evilResolved.includes('evil.attacker.com'),
    'Strictly refuses to use untrusted x-forwarded-host evil.attacker.com'
  );
  assert(
    evilResolved === 'http://localhost:3000' || evilResolved === 'https://z-catchers.vercel.app',
    'Falls back to trusted default origin on untrusted host header'
  );

  // Attack: Multi-value header where attacker prepends evil host
  const multiValPoisonReq = new Request('https://z-catchers.vercel.app/api/auth/discord', {
    headers: {
      'x-forwarded-host': 'evil.com, z-catchers.vercel.app',
      'x-forwarded-proto': 'https',
    },
  });
  const multiValResolved = getAppBaseUrl(multiValPoisonReq);
  assert(
    !multiValResolved.includes('evil.com'),
    'Rejects multi-value header prepended with untrusted evil.com'
  );

  // Attack: Protocol poisoning (x-forwarded-proto: javascript or data)
  const protoPoisonReq = new Request('https://z-catchers.vercel.app/api/auth/discord', {
    headers: {
      'x-forwarded-host': 'z-catchers.vercel.app',
      'x-forwarded-proto': 'javascript:alert(1)',
    },
  });
  const protoResolved = getAppBaseUrl(protoPoisonReq);
  assert(
    protoResolved.startsWith('https://'),
    'Sanitizes invalid or malicious x-forwarded-proto to https://'
  );

  // Attack: CRLF injection in x-forwarded-host (tested via mock request since native fetch Headers disallows CRLF in constructor)
  const mockCrlfReq = {
    headers: {
      get: (h) => (h === 'x-forwarded-host' ? 'z-catchers.vercel.app\r\nEvil-Header: payload' : null),
    },
    url: 'https://z-catchers.vercel.app/api/auth/discord',
  };
  const crlfResolved = getAppBaseUrl(mockCrlfReq);
  assert(
    !crlfResolved.includes('\r') && !crlfResolved.includes('\n') && !crlfResolved.includes('Evil-Header'),
    'Neutralizes CRLF injection in host header and falls back safely'
  );

  // Case 4E: request.url fallback in production enforces HTTPS policy
  const origNodeEnv2 = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const httpUrlReq = {
    headers: { get: () => null },
    url: 'http://z-catchers.vercel.app/api/auth/discord',
  };
  const httpFallbackResolved = getAppBaseUrl(httpUrlReq);
  assert(
    httpFallbackResolved === 'https://z-catchers.vercel.app',
    'Enforces HTTPS policy on request.url fallback in production for non-loopback host'
  );
  process.env.NODE_ENV = origNodeEnv2;

  // Production fallback verification
  process.env.NODE_ENV = 'production';
  const isolatedEnv = {
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    TRUSTED_HOSTS: process.env.TRUSTED_HOSTS,
    ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
  };
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  delete process.env.TRUSTED_HOSTS;
  delete process.env.ALLOWED_HOSTS;
  try {
    const prodFallback = getAppBaseUrl();
    assert(prodFallback === 'https://z-catchers.vercel.app', 'Defaults to canonical https://z-catchers.vercel.app in production');
  } finally {
    if (isolatedEnv.VERCEL_PROJECT_PRODUCTION_URL !== undefined) process.env.VERCEL_PROJECT_PRODUCTION_URL = isolatedEnv.VERCEL_PROJECT_PRODUCTION_URL;
    if (isolatedEnv.VERCEL_URL !== undefined) process.env.VERCEL_URL = isolatedEnv.VERCEL_URL;
    if (isolatedEnv.TRUSTED_HOSTS !== undefined) process.env.TRUSTED_HOSTS = isolatedEnv.TRUSTED_HOSTS;
    if (isolatedEnv.ALLOWED_HOSTS !== undefined) process.env.ALLOWED_HOSTS = isolatedEnv.ALLOWED_HOSTS;
  }
  process.env.NODE_ENV = origNodeEnv;

  // Restore original NEXT_PUBLIC_APP_URL
  if (origAppUrl !== undefined) {
    process.env.NEXT_PUBLIC_APP_URL = origAppUrl;
  }

  // =========================================================================
  // 5. Route Integration Tests: Discord OAuth & Login Endpoints
  // =========================================================================
  console.log('\n--- 5. Route Integration Tests: Discord OAuth & Login Endpoints ---');

  const origClientId = process.env.DISCORD_CLIENT_ID;
  const origClientSecret = process.env.DISCORD_CLIENT_SECRET;
  process.env.DISCORD_CLIENT_ID = 'test_discord_client_id_123';
  process.env.DISCORD_CLIENT_SECRET = 'test_discord_client_secret_456';

  try {
    const { GET: discordLoginGet } = await import('../src/app/api/auth/discord/route.ts');
    const { GET: discordCallbackGet } = await import('../src/app/api/auth/discord/callback/route.ts');
    const { GET: legacyLoginGet } = await import('../src/app/api/auth/login/route.ts');
    const { GET: legacyRegisterGet } = await import('../src/app/api/auth/register/route.ts');

    // 5A. /api/auth/discord initiation with poisoned host header
    const poisonDiscordReq = new Request('https://z-catchers.vercel.app/api/auth/discord', {
      headers: {
        'x-forwarded-host': 'attacker-phishing.com',
        'x-forwarded-proto': 'https',
      },
    });

    const discordResp = await discordLoginGet(poisonDiscordReq);
    assert(discordResp.status === 302, 'GET /api/auth/discord returns 302 redirect');
    const redirectLocation = discordResp.headers.get('location') || '';
    assert(redirectLocation.startsWith('https://discord.com/oauth2/authorize?'), 'Redirects to Discord OAuth2 authorize endpoint');

    // Verify redirect_uri parameter inside Discord authorize URL
    const authParams = new URL(redirectLocation).searchParams;
    const redirectUriParam = authParams.get('redirect_uri');
    assert(redirectUriParam !== null, 'Discord authorize URL contains redirect_uri parameter');
    assert(
      !redirectUriParam.includes('attacker-phishing.com'),
      'redirect_uri does NOT contain attacker-phishing.com host header'
    );
    assert(
      redirectUriParam.endsWith('/api/auth/discord/callback'),
      'redirect_uri points to canonical /api/auth/discord/callback'
    );

    // 5B. /api/auth/discord/callback with poisoned host header on error
    const poisonCallbackReq = new Request(
      'https://z-catchers.vercel.app/api/auth/discord/callback?error=access_denied&error_description=User+declined',
      {
        headers: {
          'x-forwarded-host': 'attacker-phishing.com',
          'x-forwarded-proto': 'https',
        },
      }
    );

    const callbackResp = await discordCallbackGet(poisonCallbackReq);
    assert(callbackResp.status === 302, 'GET /api/auth/discord/callback returns 302 redirect on error');
    const callbackLoc = callbackResp.headers.get('location') || '';
    assert(
      !callbackLoc.includes('attacker-phishing.com'),
      'Callback error redirect location does NOT contain attacker-phishing.com'
    );
    assert(
      callbackLoc.includes('/join?error='),
      'Callback redirects securely to canonical /join with error description'
    );

    // 5C. /api/auth/login and /api/auth/register legacy redirect poisoning defense
    const poisonLoginReq = new Request('https://z-catchers.vercel.app/api/auth/login', {
      headers: {
        'x-forwarded-host': 'attacker-phishing.com',
        'x-forwarded-proto': 'https',
      },
    });
    const loginResp = await legacyLoginGet(poisonLoginReq);
    assert(loginResp.status === 302, 'GET /api/auth/login returns 302 redirect');
    const loginLoc = loginResp.headers.get('location') || '';
    assert(
      !loginLoc.includes('attacker-phishing.com'),
      'GET /api/auth/login redirect does NOT contain attacker-phishing.com'
    );
    assert(
      loginLoc.endsWith('/api/auth/discord'),
      'GET /api/auth/login redirects to canonical /api/auth/discord'
    );

    const poisonRegReq = new Request('https://z-catchers.vercel.app/api/auth/register', {
      headers: {
        'x-forwarded-host': 'attacker-phishing.com',
        'x-forwarded-proto': 'https',
      },
    });
    const regResp = await legacyRegisterGet(poisonRegReq);
    assert(regResp.status === 302, 'GET /api/auth/register returns 302 redirect');
    const regLoc = regResp.headers.get('location') || '';
    assert(
      !regLoc.includes('attacker-phishing.com'),
      'GET /api/auth/register redirect does NOT contain attacker-phishing.com'
    );
    assert(
      regLoc.endsWith('/api/auth/discord'),
      'GET /api/auth/register redirects to canonical /api/auth/discord'
    );

  } finally {
    if (origClientId !== undefined) process.env.DISCORD_CLIENT_ID = origClientId;
    else delete process.env.DISCORD_CLIENT_ID;

    if (origClientSecret !== undefined) process.env.DISCORD_CLIENT_SECRET = origClientSecret;
    else delete process.env.DISCORD_CLIENT_SECRET;
  }

  // =========================================================================
  // Final Results
  // =========================================================================
  console.log('\n============================================================');
  if (failed) {
    console.error('❌ SOME TESTS FAILED in test-oauth-redirect-host-validation.mjs');
    process.exit(1);
  } else {
    console.log('🎉 ALL OAUTH REDIRECT HOST VALIDATION TESTS PASSED CLEANLY! 🦊🔒');
  }
}

run().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
