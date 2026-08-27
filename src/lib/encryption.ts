import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function getEncryptionKey() {
  const configuredKey = process.env.ENCRYPTION_KEY;
  if (!configuredKey) {
    throw new Error("ENCRYPTION_KEY is not configured.");
  }

  // AES-256 requires exactly 32 bytes. Copying into a zero-filled buffer
  // deterministically pads short values and truncates values over 32 bytes.
  const key = Buffer.alloc(32);
  Buffer.from(configuredKey, "utf8").copy(key, 0, 0, 32);
  return key;
}

export function encrypt(text: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encryptedData = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encryptedData.toString("hex")}`;
}

export function decrypt(value: string) {
  const [encodedIv, encryptedData, ...unexpectedParts] = value.split(":");
  if (!encodedIv || !encryptedData || unexpectedParts.length > 0) {
    throw new Error("Stored IMAP password is invalid.");
  }

  const iv = Buffer.from(encodedIv, "hex");
  if (iv.length !== IV_LENGTH) {
    throw new Error("Stored IMAP password has an invalid IV.");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedData, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
