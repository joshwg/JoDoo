// Server-setup QR payload: the raw JSON handed from one device's Server
// Settings to another's via QR code. Deliberately NOT a URL - it is only
// understood by Jodoo's in-app scanner, so a leaked screenshot of the code
// is an opaque blob rather than a tappable invitation. It contains the
// server access key, so the QR itself must be treated as a secret.

import { normalizeBaseUrl, ServerConfig } from './serverConfig';

const MARKER = 'server-setup';

/** Mirrors the server's minServerKeyLength. */
const MIN_SERVER_KEY_LENGTH = 20;

export function makeServerSetupPayload(config: ServerConfig): string {
  return JSON.stringify({
    jodoo: MARKER,
    server: normalizeBaseUrl(config.baseUrl),
    key: config.serverKey.trim(),
  });
}

/** Decodes a scanned QR back into a config; null for anything that is not a
 *  plausible Jodoo server-setup payload. */
export function parseServerSetupPayload(raw: string): ServerConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.jodoo !== MARKER) return null;
  if (typeof obj.server !== 'string' || typeof obj.key !== 'string') return null;
  const baseUrl = normalizeBaseUrl(obj.server);
  const serverKey = obj.key.trim();
  if (!/^https?:\/\/\S+$/i.test(baseUrl)) return null;
  if (serverKey.length < MIN_SERVER_KEY_LENGTH) return null;
  return { baseUrl, serverKey };
}
