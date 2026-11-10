import { NextResponse } from 'next/server';

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

export async function POST() {
  return createLogoutResponse();
}

export async function GET() {
  return createLogoutResponse();
}

