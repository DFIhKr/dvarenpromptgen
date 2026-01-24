// AES-256-GCM Encryption utilities for secure API key storage
// Uses Web Crypto API for cryptographically secure encryption

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const TAG_LENGTH = 128; // 128-bit authentication tag

/**
 * Derives a 256-bit AES key from a password/secret using PBKDF2
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // Use a fixed salt for deterministic key derivation
  // In production, you might store a unique salt per installation
  const salt = encoder.encode("lovable-api-key-encryption-salt-v1");

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a plaintext string using AES-256-GCM
 * Returns base64-encoded string with format: IV + ciphertext + authTag
 */
export async function encryptKey(plaintext: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await deriveKey(secret);
  
  // Generate random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  const encrypted = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv,
      tagLength: TAG_LENGTH,
    },
    key,
    encoder.encode(plaintext)
  );

  // Combine IV + encrypted data (includes auth tag)
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Base64 encode for storage
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64-encoded ciphertext encrypted with AES-256-GCM
 */
export async function decryptKey(ciphertext: string, secret: string): Promise<string> {
  const decoder = new TextDecoder();
  const key = await deriveKey(secret);
  
  // Decode from base64
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  
  // Extract IV and encrypted data
  const iv = combined.slice(0, IV_LENGTH);
  const encrypted = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv,
      tagLength: TAG_LENGTH,
    },
    key,
    encrypted
  );

  return decoder.decode(decrypted);
}

/**
 * Masks an API key for display (e.g., gsk_****abcd)
 */
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// Legacy XOR decryption for backward compatibility during migration
export function decryptKeyLegacy(encrypted: string, secret: string): string {
  const decoder = new TextDecoder();
  const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const secretBytes = new TextEncoder().encode(secret);
  const decrypted = new Uint8Array(encryptedBytes.length);
  
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ secretBytes[i % secretBytes.length];
  }
  
  return decoder.decode(decrypted);
}

/**
 * Attempts to decrypt with AES-GCM first, falls back to legacy XOR
 * This allows gradual migration of existing encrypted keys
 */
export async function decryptKeyWithFallback(ciphertext: string, secret: string): Promise<string> {
  try {
    // Try AES-GCM first (new format)
    return await decryptKey(ciphertext, secret);
  } catch {
    // Fall back to legacy XOR (old format)
    console.log("Falling back to legacy decryption");
    return decryptKeyLegacy(ciphertext, secret);
  }
}
