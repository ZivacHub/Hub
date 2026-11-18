// Pure rules for the Hub app (no Electron import, so plain Node can test them): which port, which server flags,
// which pages the window may show, and which claude:// links may be handed to Windows.

export const HOST = "127.0.0.1"; // never 0.0.0.0 or localhost: the same address the dashboard listens on (D8)
export const DEFAULT_PORT = 4780;

// The only links that leave the Hub: they open a chat in the Claude app (Phase 14). Exact prefixes, nothing looser.
export const CHAT_LINK_PREFIXES = Object.freeze([
  "claude://claude.ai/epitaxy/local_",
  "claude://code/new?",
  "claude://resume?session=",
]);

// Server flags that make no sense inside the app: --open would open a browser tab, --selftest picks a random port.
// --boot (start the projects ticked "Start with PC") is added only by the app itself, in --hidden mode (lib/startup.mjs startPlan).
const DROPPED_FLAGS = new Set(["--open", "--selftest", "--boot"]);
const FLAG = /^--[a-z][a-z0-9-]*(=[A-Za-z0-9_-]+)?$/;

/** HUB_PORT -> a port number (default 4780). Returns null for anything that is not a whole number 1..65535. */
export function parsePort(value) {
  if (value === undefined || value === null || String(value).trim() === "") return DEFAULT_PORT;
  const s = String(value).trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

/** HUB_APP_ARGS -> a list of server flags. Space separated; only "--word" or "--word=value" survive; --open, --selftest and --boot are dropped. */
export function parseServerArgs(value) {
  if (!value) return [];
  return String(value).split(/\s+/).filter((a) => a && FLAG.test(a) && !DROPPED_FLAGS.has(a.split("=")[0]));
}

export const hubOrigin = (port) => `http://${HOST}:${port}`;
export const hubUrl = (port) => `${hubOrigin(port)}/`;

/** true only when the URL's origin is exactly http://127.0.0.1:PORT (not localhost, not another port, not https). */
export function isHubOrigin(url, port) {
  try { return new URL(url).origin === hubOrigin(port); } catch { return false; }
}

/** true only for a claude:// link that starts with one of the three exact prefixes, has no spaces/control characters and is not huge. */
export function isAllowedChatLink(url) {
  if (typeof url !== "string" || url.length > 4096) return false;
  if (/[\s\u0000-\u001f\u007f"<>\\^`{|}]/.test(url)) return false;
  return CHAT_LINK_PREFIXES.some((p) => url.startsWith(p) && url.length > p.length);
}

/**
 * true for a link to ANOTHER local program's page (a project card's "Running · port N" link): http (not https) on 127.0.0.1 or
 * localhost, port 1024..65535 and not the Hub's own port, no user name or password. Such a link goes to the default browser.
 */
export function isOtherLocalPortLink(url, hubPort) {
  if (typeof url !== "string" || url.length > 2048) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" || (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")) return false;
  if (u.username || u.password || !/^\d{1,5}$/.test(u.port)) return false; // an empty port (= 80) never passes
  const n = Number(u.port);
  return n >= 1024 && n <= 65535 && n !== hubPort;
}
