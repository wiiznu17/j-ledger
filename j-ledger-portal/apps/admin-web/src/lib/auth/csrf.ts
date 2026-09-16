import { cookies } from 'next/headers';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

function getCsrfSecret(): string {
  const secret = process.env.CSRF_SECRET;
  if (!secret) {
    throw new Error('CSRF_SECRET is required');
  }
  return secret;
}

export async function generateCSRFToken(): Promise<string> {
  const secret = getCsrfSecret();
  const timestamp = Date.now().toString();
  const random = randomBytes(16).toString('hex');
  const message = `${timestamp}.${random}`;
  const signature = createHmac('sha256', secret).update(message).digest('hex');
  return Buffer.from(`${message}.${signature}`).toString('base64');
}

export async function validateCSRFToken(token: string): Promise<boolean> {
  try {
    const secret = getCsrfSecret();
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split('.');

    if (parts.length !== 3) return false;

    const [timestampStr, random, signature] = parts;
    if (!timestampStr || !random || !signature) return false;

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;

    // Check if token is expired (1 hour)
    const tokenAge = Date.now() - timestamp;
    if (tokenAge < 0 || tokenAge > 60 * 60 * 1000) return false;

    // Verify HMAC signature using timingSafeEqual
    const message = `${timestampStr}.${random}`;
    const expectedSignature = createHmac('sha256', secret).update(message).digest('hex');

    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedSigBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedSigBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expectedSigBuffer);
  } catch (error) {
    console.error('CSRF validation failed:', error);
    return false;
  }
}

export async function getCSRFToken(): Promise<string> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get('csrf_token')?.value;

  if (existingToken) {
    const isValid = await validateCSRFToken(existingToken);
    if (isValid) return existingToken;
  }

  const newToken = await generateCSRFToken();
  cookieStore.set('csrf_token', newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60, // 1 hour
    path: '/',
  });

  return newToken;
}

