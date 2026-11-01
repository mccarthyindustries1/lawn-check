// Saves the watering log into your own GitHub repository (as log.json) so the
// daily alert can read it. Uses a token you create and paste into the app once.

const API = "https://api.github.com";
const FILE = "log.json";

export class SyncError extends Error {}

/** On GitHub Pages the address itself tells us the repository: owner.github.io/repo/ */
export function guessRepo(loc) {
  const m = /^([^.]+)\.github\.io$/i.exec(loc.hostname || "");
  const repo = (loc.pathname || "").split("/").filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : "";
}

export function isRepoName(s) {
  return /^[\w.-]+\/[\w.-]+$/.test(s || "");
}

function explain(status) {
  if (status === 401) return "GitHub didn't accept the token. Check that you copied all of it and that it hasn't expired.";
  if (status === 403) return "The token isn't allowed to do that. It needs \"Contents: Read and write\" on this repository.";
  if (status === 404) return "GitHub couldn't find that repository, or the token can't see it. Check the name (like yourname/lawn-check) and the token's repository.";
  return `GitHub returned an error (HTTP ${status}).`;
}

async function call(cfg, method, path, body, fetchFn) {
  let res;
  try {
    res = await fetchFn(`${API}/repos/${cfg.repo}/contents/${path}${method === "GET" ? `?t=${Date.now()}` : ""}`, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cfg.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError("Couldn't reach GitHub. Check your connection.");
  }
  return res;
}

export async function readRemote(cfg, fetchFn = fetch) {
  const res = await call(cfg, "GET", FILE, null, fetchFn);
  if (res.status === 404) return { entries: [], sha: null };
  if (!res.ok) throw new SyncError(explain(res.status));
  const data = await res.json();
  let entries = [];
  try {
    const parsed = JSON.parse(atob(String(data.content || "").replace(/\s/g, "")));
    if (Array.isArray(parsed.entries)) entries = parsed.entries;
  } catch { /* an unreadable file is treated as empty and rewritten */ }
  return { entries, sha: data.sha };
}

/**
 * Reads the latest log, applies `mutate(entries) => newEntries`, and saves it.
 * Retries if the file changed in between. Returns the saved entries.
 */
export async function updateRemote(cfg, mutate, fetchFn = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { entries, sha } = await readRemote(cfg, fetchFn);
    const next = mutate(entries);
    const res = await call(cfg, "PUT", FILE, {
      message: "Update watering log",
      content: btoa(`${JSON.stringify({ entries: next }, null, 2)}\n`),
      ...(sha ? { sha } : {}),
    }, fetchFn);
    if (res.ok) return next;
    if (res.status !== 409 && res.status !== 422) throw new SyncError(explain(res.status));
  }
  throw new SyncError("The log changed while saving. Try again.");
}
