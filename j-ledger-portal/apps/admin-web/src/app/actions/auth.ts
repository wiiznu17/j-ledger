'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { authRequester } from '@/lib/requesters';
import { LoginRequest, RefreshTokenRequest } from '@repo/dto';
import { AUTH_COOKIE_NAME, PERMISSIONS_COOKIE_NAME } from '@/lib/api-config';
import { logLoginAttempt, logLogoutAttempt } from '@/lib/auth/audit';
import { checkRateLimit } from '@/lib/auth/rate-limit';

export async function login(formData: FormData) {
  const email = formData.get('email');
  const password = formData.get('password');

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const loginData: LoginRequest = {
    email: email as string,
    password: password as string,
  };

  // Get IP and user agent for audit logging
  const headersList = await headers();
  const ipAddress =
    headersList.get('x-forwarded-for') ||
    headersList.get('x-real-ip') ||
    'unknown';
  const userAgent = headersList.get('user-agent') || 'unknown';

  // Check rate limit based on IP
  const rateLimit = checkRateLimit(ipAddress);
  if (!rateLimit.allowed) {
    await logLoginAttempt(email as string, false, ipAddress, userAgent);
    throw new Error('Too many login attempts. Please try again later.');
  }

  try {
    console.log('[admin-web] login - Calling authRequester.login');
    const data = await authRequester.login(loginData);
    console.log('[admin-web] login - Received data:', {
      userId: data.userId,
      role: data.role,
    });

    const cookieStore = await cookies();

    // Access Token (short-lived)
    cookieStore.set(AUTH_COOKIE_NAME, data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 hours
      path: '/',
    });
    console.log('[admin-web] login - Set admin_session cookie');

    // Refresh Token (long-lived)
    cookieStore.set('refresh_token', data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    console.log('[admin-web] login - Set refresh_token cookie');

    // User Metadata
    cookieStore.set('user_id', data.userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    console.log('[admin-web] login - Set user_id cookie');

    cookieStore.set('user_role', data.role, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    console.log('[admin-web] login - Set user_role cookie');

    cookieStore.set(PERMISSIONS_COOKIE_NAME, JSON.stringify(data.permissions), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    console.log('[admin-web] login - Set user_permissions cookie');

    // Log successful login
    await logLoginAttempt(data.userId, true, ipAddress, userAgent);

    console.log('[admin-web] login - Redirecting to /dashboard');
    redirect('/dashboard');
  } catch (error) {
    // Don't catch redirect errors - let them propagate
    if (isRedirectError(error)) {
      throw error;
    }

    console.error('Login error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Login failed';

    // Log failed login attempt (use email as userId placeholder)
    await logLoginAttempt(email as string, false, ipAddress, userAgent);

    redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
  }
}

export async function logout() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value || 'unknown';

  // Get IP and user agent for audit logging
  const headersList = await headers();
  const ipAddress =
    headersList.get('x-forwarded-for') ||
    headersList.get('x-real-ip') ||
    'unknown';
  const userAgent = headersList.get('user-agent') || 'unknown';

  try {
    await authRequester.logout();
  } catch (e) {
    console.error('Remote logout failed', e);
  }

  // Log logout attempt
  await logLogoutAttempt(userId, ipAddress, userAgent);

  cookieStore.delete(AUTH_COOKIE_NAME);
  cookieStore.delete(PERMISSIONS_COOKIE_NAME);
  cookieStore.delete('refresh_token');
  cookieStore.delete('user_id');
  cookieStore.delete('user_role');
  cookieStore.delete('user_permissions');
  redirect('/login');
}

export async function refreshSession() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;
  const userId = cookieStore.get('user_id')?.value;

  if (!refreshToken || !userId) {
    return null;
  }

  const refreshData: RefreshTokenRequest = {
    userId,
    refreshToken,
  };

  try {
    const data = await authRequester.refresh(refreshData);

    // Update session cookies
    cookieStore.set('admin_session', data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 hours
      path: '/',
    });

    cookieStore.set('refresh_token', data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    cookieStore.set(PERMISSIONS_COOKIE_NAME, JSON.stringify(data.permissions), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return data.token;
  } catch (error) {
    console.error('Session refresh error:', error);
    return null;
  }
}
