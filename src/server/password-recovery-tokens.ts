import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Genera token encriptado que contiene email para recuperación de contraseña.
 * Formato: iv:encrypted:authTag (todo en base64)
 */
export function generateRecoveryToken(email: string): string {
  const key = Buffer.from(
    process.env.PASSWORD_ENCRYPTION_KEY || 'default-key-change-in-production-please-do-not-use-this',
    'utf-8'
  );

  const keyHash = createHash('sha256').update(key).digest();
  const iv = randomBytes(16);

  const cipher = createCipheriv('aes-256-gcm', keyHash, iv);
  let encrypted = cipher.update(email, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
}

/**
 * Genera link de recuperación de contraseña con token encriptado.
 */
export function generateRecoveryLink(email: string): string {
  const token = generateRecoveryToken(email);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${baseUrl}/recuperar?token=${encodeURIComponent(token)}`;
}

/**
 * Desencripta token de recuperación y retorna el email.
 */
export function decryptRecoveryToken(token: string): string | null {
  if (!token) return null;

  try {
    const key = Buffer.from(
      process.env.PASSWORD_ENCRYPTION_KEY || 'default-key-change-in-production-please-do-not-use-this',
      'utf-8'
    );

    const keyHash = createHash('sha256').update(key).digest();
    const parts = token.split(':');

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;

    const iv = Buffer.from(parts[0], 'base64');
    const encryptedData = parts[1];
    const authTag = Buffer.from(parts[2], 'base64');

    const decipher = createDecipheriv('aes-256-gcm', keyHash, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  } catch {
    return null;
  }
}
