/**
 * RA-061: AES-256-GCM encryption for project secrets.
 *
 * Uses only Node.js built-in `crypto` — no external dependencies.
 * The same functions are duplicated in services/dispatcher/src/crypto.ts
 * to avoid cross-service dynamic imports.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

export type EncryptedPayload = {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
};

/**
 * Derive the 32-byte encryption key from the hex-encoded env var.
 * Throws if the key is missing or malformed.
 */
export function getEncryptionKey(): Buffer {
  const hex = process.env.SECRETS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY env var is required for project secrets. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars), got ${buf.length} bytes.`,
    );
  }
  return buf;
}

export function encryptSecret(
  plaintext: string,
  key: Buffer,
): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(
  payload: EncryptedPayload,
  key: Buffer,
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64"),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
