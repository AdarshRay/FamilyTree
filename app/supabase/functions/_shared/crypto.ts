const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function tokenKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("GITHUB_TOKEN_ENCRYPTION_KEY");
  if (!secret) throw new Error("Missing required environment variable: GITHUB_TOKEN_ENCRYPTION_KEY");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token: string): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await tokenKey(), encoder.encode(token));
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
  };
}

export async function decryptToken(ciphertext: string, nonce: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(nonce) },
    await tokenKey(),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}

export function utf8ToBase64(value: string): string {
  return bytesToBase64(encoder.encode(value));
}
