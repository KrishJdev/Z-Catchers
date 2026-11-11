import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

/**
 * Constructs a logout response clearing authentication and claim cookies.
 *
 * @returns NextResponse with expired session cookies
 */
function createLogoutResponse() {
  const response = NextResponse.json({
    success: true,
    message: 'Logged out successfully.',
  });

  // Clear session cookie
  response.cookies.set({
    name: 'zcatchers_session',
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });

  // Clear claim and state cookies
  response.cookies.set({
    name: 'zcatchers_claim_token',
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });

  response.cookies.set({
    name: 'zcatchers_oauth_state',
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}

/**
 * POST: Terminate member session by clearing authentication cookies.
 *
 * @returns NextResponse confirming logout
 */
export async function POST() {
  return createLogoutResponse();
}

/**
 * GET: Terminate member session by clearing authentication cookies (browser fallback).
 *
 * @returns NextResponse confirming logout
 */
export async function GET() {
  return createLogoutResponse();
}
