import { NextResponse } from 'next/server';

/**
 * Helper to construct a logout response that clears the zcatchers_session HTTP-only cookie.
 *
 * @returns NextResponse with expired session cookie
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

