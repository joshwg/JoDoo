import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'jodoo.serverConfig';

export interface ServerConfig {
  /** e.g. "https://jodoo.example.com" - no trailing slash. */
  baseUrl: string;
  /** Shared server access secret (>= 20 chars), set as an env var on the server. */
  serverKey: string;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Reads the saved server connection settings, or null if none are set. */
export async function getServerConfig(): Promise<ServerConfig | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.baseUrl === 'string' && typeof parsed?.serverKey === 'string') {
      return { baseUrl: parsed.baseUrl, serverKey: parsed.serverKey };
    }
  } catch {
    // fall through to null below on malformed stored data
  }
  return null;
}

export async function setServerConfig(config: ServerConfig): Promise<void> {
  const cleaned: ServerConfig = {
    baseUrl: normalizeBaseUrl(config.baseUrl),
    serverKey: config.serverKey.trim(),
  };
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(cleaned));
}

export async function clearServerConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
