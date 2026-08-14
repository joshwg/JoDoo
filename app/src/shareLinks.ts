// Share links: a list can be joined via a URL that carries the server's
// address and the list's share key - never the server access key, which the
// recipient must already have (or get out-of-band from the sharer).
//
// Two equivalent forms are understood:
//   https://<server-host>/join/<shareKey>   - the server serves a small
//     landing page there ("Open in Jodoo"), so the link also works when
//     tapped in a browser or scanned by a stock camera app.
//   jodoo://join?key=<shareKey>&server=<url> - the app's own scheme, used
//     by that landing page to hand off to the installed app.

import { normalizeBaseUrl } from './serverConfig';

/** Mirrors the server's key generator: exactly 20 lowercase alphanumerics. */
const SHARE_KEY_RE = /^[a-z0-9]{20}$/;

export interface ParsedJoinUrl {
  key: string;
  /** Server base URL the link points at, when the link carries one. */
  server: string | null;
}

/** The https join link for a share key on the configured server. */
export function makeJoinUrl(baseUrl: string, shareKey: string): string {
  return `${normalizeBaseUrl(baseUrl)}/join/${shareKey}`;
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      // skip malformed percent-encoding rather than failing the whole URL
    }
  }
  return out;
}

/**
 * Extracts the share key (and server, when present) from either join-URL
 * form, or from a bare share key (e.g. a QR code containing just the key).
 * Returns null for anything unrecognized.
 */
export function parseJoinUrl(raw: string): ParsedJoinUrl | null {
  const text = raw.trim();

  const bare = text.toLowerCase();
  if (SHARE_KEY_RE.test(bare)) {
    return { key: bare, server: null };
  }

  const scheme = text.match(/^jodoo:\/\/join\/?\?(.*)$/i);
  if (scheme) {
    const params = parseQuery(scheme[1]);
    const key = (params.key ?? '').trim().toLowerCase();
    if (!SHARE_KEY_RE.test(key)) return null;
    const server = params.server?.trim();
    return { key, server: server ? normalizeBaseUrl(server) : null };
  }

  const web = text.match(/^(https?:\/\/[^/?#]+)\/join\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/i);
  if (web) {
    const key = web[2].toLowerCase();
    if (!SHARE_KEY_RE.test(key)) return null;
    return { key, server: normalizeBaseUrl(web[1]) };
  }

  return null;
}
