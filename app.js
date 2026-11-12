import { buildReport, isValidZip, LawnError } from "./weather.js";
import { inchesText, advise } from "./advisor.js";
import { VAPID_PUBLIC_KEY } from "./config.js";
import { shiftDate, cleanEntries, mergeEntries, wateredIn7Days } from "./log.js";
import { guessRepo, isRepoName, readRemote, updateRemote, SyncError } from "./sync.js";

const $ = (id) => document.getElementById(id);
const zipInput = $("zip");
const statusEl = $("status");
const reportEl = $("report");
const alertsEl = $("alerts");
const alertsBody = $("alertsBody");

let lastReport = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function dayName(dateStr, withDate) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString(undefined, withDate
    ? { weekday: "short", month: "numeric", day: "numeric" }
    : { weekday: "short" });
}

// ---------- watering log ----------
// Always kept on this phone. When sync is on, it is also saved to log.json in your
// GitHub repository so the daily alert counts it too.
let syncState = { kind: "off", message: "" }; // off | ok | error

function lawnToday() {
  if (lastReport) return lastReport.today.date;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadLog() {
  try { return cleanEntries(JSON.parse(store.get("lawn.log") || "[]"), lawnToday()); }
  catch { return []; }
}
function saveLog(list) { store.set("lawn.log", JSON.stringify(cleanEntries(list, lawnToday()))); }

const wateredTotal = () => wateredIn7Days(loadLog(), lawnToday());

function syncConfig() {
  const repo = store.get("lawn.syncRepo"), token = store.get("lawn.syncToken");
  return repo && token && isRepoName(repo) ? { repo, token } : null;
}

/** Applies a change to the saved log on GitHub, then adopts the result. */
async function pushChange(mutate) {
  const cfg = syncConfig();
  if (!cfg) { syncState = { kind: "off", message: "" }; return; }
  try {
    const saved = await updateRemote(cfg, (remote) => cleanEntries(mutate(remote), lawnToday()));
    saveLog(saved);
    syncState = { kind: "ok", message: "" };
  } catch (err) {
    syncState = { kind: "error", message: err instanceof SyncError ? err.message : "Couldn't save to GitHub." };
  }
}

async function pullLog() {
  const cfg = syncConfig();
  if (!cfg) return;
  try {
    const { entries } = await readRemote(cfg);
    const local = loadLog();
    saveLog(mergeEntries(entries, local));
    syncState = { kind: "ok", message: "" };
    // Anything saved on the phone while offline gets sent up now.
    const known = new Set(entries.map((e) => String(e.id)));
    if (local.some((e) => !known.has(String(e.id)))) await pushChange((remote) => mergeEntries(remote, local));
  } catch (err) {
    syncState = { kind: "error", message: err instanceof SyncError ? err.message : "Couldn't read from GitHub." };
  }
}

function syncLine() {
  if (syncState.kind === "ok") return `<p class="problem">Saved to your daily alert too.</p>`;
  if (syncState.kind === "error") return `<p class="problem">Saved on this phone, but not to GitHub: ${esc(syncState.message)}</p>`;
  return syncConfig() ? "" : `<p class="problem">Saved on this phone only. Turn on sync (under Daily alert) so the morning alert counts it.</p>`;
}

function logHtml(suggested) {
  const since = shiftDate(lawnToday(), -6);
  const entries = loadLog().filter((e) => e.date >= since).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
  const amounts = [0.25, 0.5, 0.75, 1, 1.5];
  const pick = amounts.includes(suggested) ? suggested : 0.5;
  const list = entries.length
    ? `<ul class="rows logrows">${entries.map((e) => `<li>
        <span class="day">${esc(dayName(e.date, true))}</span>
        <span class="amt">${inchesText(e.inches)}</span>
        <button class="quiet small" type="button" data-remove="${esc(e.id)}" aria-label="Remove watering on ${esc(dayName(e.date, true))}">Remove</button>
      </li>`).join("")}</ul>`
    : `<p class="problem">Nothing logged in the past 7 days.</p>`;
  return `
    <h3>Watering log</h3>
    <form class="logform" id="logForm">
      <label class="sr" for="logAmount">Amount watered</label>
      <select id="logAmount">${amounts.map((a) => `<option value="${a}"${a === pick ? " selected" : ""}>${inchesText(a)}</option>`).join("")}</select>
      <label class="sr" for="logDay">Day</label>
      <select id="logDay"><option value="0">Today</option><option value="-1">Yesterday</option><option value="-2">2 days ago</option></select>
      <button type="submit" id="logBtn">I watered</button>
    </form>
    ${list}
    ${syncLine()}`;
}

// ---------- the rain gauge ----------
// Fills to the rain that fell over 7 days. The line marks the 1 inch a lawn needs.
function gaugeSvg(inches) {
  const top = 14, height = 140, scaleMax = 1.5;
  const filled = Math.min(inches, scaleMax) / scaleMax * height;
  const targetY = top + height - (1 / scaleMax) * height;
  return `
  <svg class="gauge" viewBox="0 0 72 170" role="img" aria-label="Rain gauge: ${esc(inchesText(inches))} of the 1 inch a lawn needs">
    <rect x="6" y="${top}" width="26" height="${height}" rx="13" fill="var(--tube)"/>
    <clipPath id="tubeClip"><rect x="6" y="${top}" width="26" height="${height}" rx="13"/></clipPath>
    <rect class="water" x="6" y="${top + height - filled}" width="26" height="${filled}" fill="var(--fill)" clip-path="url(#tubeClip)"/>
    <line x1="2" x2="38" y1="${targetY}" y2="${targetY}" stroke="#fff" stroke-width="2"/>
    <text x="42" y="${targetY + 4}">1 in</text>
    <text x="6" y="166">7 days</text>
  </svg>`;
}

function rowsHtml(days, { past }) {
  const maxRain = Math.max(0.5, ...days.map((d) => d.rainInches));
  return days.map((d, i) => {
    const label = past ? dayName(d.date, true) : (i === 0 ? "Today" : dayName(d.date, false));
    const chance = !past && d.rainChance != null ? `<span class="chance">${d.rainChance}%</span>` : "";
    return `<li>
      <span class="day">${esc(label)}</span>
      <span class="bar" aria-hidden="true"><i style="width:${Math.min(100, d.rainInches / maxRain * 100).toFixed(0)}%"></i></span>
      ${chance}<span class="amt">${inchesText(d.rainInches)}</span>
    </li>`;
  }).join("");
}

function render(r) {
  const watered = wateredTotal();
  const a = advise(r.recentRain, r.today, r.upcoming[0], watered);
  const sourceLabel = r.rainSource === "noaa" ? "NOAA radar + gauges" : "model estimate";
  reportEl.innerHTML = `
    <section class="verdict ${a.verdict}">
      <div>
        <h2>${esc(a.headline)}</h2>
        <p>${esc(a.explanation)}</p>
        <p class="where">${esc(r.place.name)}</p>
      </div>
      ${gaugeSvg(r.recentRain + watered)}
    </section>
    <div class="stats">
      <div class="stat"><div class="label">Last 7 days</div><div class="num">${inchesText(r.recentRain)}</div><div class="note">${esc(sourceLabel)}${watered > 0 ? ` + ${inchesText(watered)} watering` : ""}</div></div>
      <div class="stat"><div class="label">Today + tomorrow</div><div class="num">${inchesText(r.soonRain)}</div><div class="note">forecast</div></div>
    </div>
    ${r.noaaProblem ? `<p class="problem">NOAA rain data unavailable: ${esc(r.noaaProblem)}</p>` : ""}
    ${logHtml(a.suggestedInches)}
    <h3>Past 7 days${r.rainSource === "noaa" ? "" : " (model estimate)"}</h3>
    <ul class="rows past">${rowsHtml([...r.pastDays].reverse(), { past: true })}</ul>
    <h3>Forecast</h3>
    <ul class="rows">${rowsHtml([r.today, ...r.upcoming], { past: false })}</ul>`;
  reportEl.hidden = false;
  wireLog();

  $("credits").innerHTML = (r.rainSource === "noaa"
    ? "Past rain: NOAA National Water Prediction Service. "
    : "") +
    'Forecast: <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0).';
}

function wireLog() {
  $("logForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const entry = {
      id: Date.now(),
      date: shiftDate(lawnToday(), Number($("logDay").value)),
      inches: Number($("logAmount").value),
    };
    saveLog([...loadLog(), entry]);      // show it right away
    render(lastReport);
    await pushChange((remote) => mergeEntries(remote, [entry]));
    render(lastReport);
  });
  reportEl.querySelectorAll("[data-remove]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.remove;
    saveLog(loadLog().filter((x) => String(x.id) !== id));
    render(lastReport);
    await pushChange((remote) => remote.filter((x) => String(x.id) !== id));
    render(lastReport);
  }));
}

// ---------- checking ----------
async function check(zip) {
  statusEl.className = "";
  statusEl.textContent = "Checking the rain…";
  $("checkBtn").disabled = true;
  try {
    lastReport = await buildReport(zip);
    store.set("lawn.zip", zip);
    await pullLog();
    statusEl.textContent = "";
    render(lastReport);
    alertsEl.hidden = false;
    renderAlerts();
  } catch (err) {
    statusEl.className = "error";
    statusEl.textContent = err instanceof LawnError ? err.message
      : "Couldn't get weather data right now. Check your connection and try again.";
  } finally {
    $("checkBtn").disabled = false;
  }
}

$("zipForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const zip = zipInput.value.trim();
  if (!isValidZip(zip)) {
    statusEl.className = "error";
    statusEl.textContent = "Please enter a 5-digit US ZIP code.";
    return;
  }
  zipInput.blur();
  check(zip);
});
zipInput.addEventListener("input", () => { zipInput.value = zipInput.value.replace(/\D/g, "").slice(0, 5); });

// ---------- daily alert (push notifications) ----------
const standalone = () => window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function makeSetupCode(subscription) {
  const p = lastReport.place;
  const payload = { v: 1, place: { zip: p.zip, name: p.name, latitude: p.latitude, longitude: p.longitude }, subscription };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

// Waits for the background helper, but never forever.
function helperReady(ms = 6000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await helperReady(3000);
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

async function renderAlerts() {
  renderSync();
  await renderAlertsMain();
}

async function renderAlertsMain() {
  alertsBody.innerHTML = "<p>Checking alerts…</p>";
  if (!pushSupported() || !standalone()) {
    alertsBody.innerHTML = `
      <p>To get a morning alert, open Lawn Check from your Home Screen first.</p>
      <ol>
        <li>In Safari, tap the Share button.</li>
        <li>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open Lawn Check from the new icon and come back to this section.</li>
      </ol>`;
    return;
  }
  const sub = await currentSubscription();
  if (!sub || Notification.permission !== "granted") {
    alertsBody.innerHTML = `
      <p>Get a notification each morning that says whether to water. It also counts the waterings you log, once you turn on sync below.</p>
      <div class="actions"><button id="enableBtn" type="button">Turn on alerts</button></div>
      <p id="alertMsg" role="status"></p>`;
    $("enableBtn").addEventListener("click", enableAlerts);
    return;
  }
  showSetupCode(sub);
}

function showSetupCode(sub) {
  alertsBody.innerHTML = `
    <p class="ok">Alerts are allowed on this iPhone.</p>
    <p>Copy this setup code into your GitHub secret called <strong>ALERT_CONFIG</strong>. It tells the daily check your ZIP code and where to send the alert.</p>
    <textarea id="code" readonly aria-label="Setup code">${esc(makeSetupCode(sub.toJSON()))}</textarea>
    <div class="actions">
      <button id="copyBtn" type="button">Copy setup code</button>
      <button id="testBtn" class="quiet" type="button">Show a test alert</button>
    </div>
    <p id="alertMsg" role="status"></p>`;
  $("copyBtn").addEventListener("click", async () => {
    const text = $("code").value;
    try { await navigator.clipboard.writeText(text); $("alertMsg").textContent = "Copied."; }
    catch { $("code").select(); $("alertMsg").textContent = "Press and hold the selected text, then tap Copy."; }
  });
  $("testBtn").addEventListener("click", async () => {
    const reg = await helperReady(5000);
    if (!reg) { $("alertMsg").textContent = "The background helper isn't running. Close and reopen the app, then try again."; return; }
    await reg.showNotification("Lawn Check", { body: "This is what your daily alert will look like.", icon: "icons/icon-192.png", tag: "lawn-test" });
  });
}

async function enableAlerts() {
  const msg = $("alertMsg");
  try {
    const permission = await Notification.requestPermission(); // must come straight from the tap
    if (permission !== "granted") {
      msg.textContent = "Alerts are blocked. Turn them on in Settings > Notifications > Lawn Check, then try again.";
      return;
    }
    const reg = await helperReady(10000);
    if (!reg) {
      msg.textContent = "The app's background helper isn't running yet. Close Lawn Check completely (swipe it up), open it again from the Home Screen, wait a few seconds, and tap Turn on alerts again.";
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    showSetupCode(sub);
  } catch (err) {
    msg.textContent = `Couldn't turn on alerts: ${err?.message || err}`;
  }
}

// ---------- sync settings ----------
function renderSync() {
  const cfg = syncConfig();
  const repoGuess = store.get("lawn.syncRepo") || guessRepo(location);
  $("syncBox").innerHTML = `
    <details class="sync"${cfg ? "" : " open"}>
      <summary>${cfg ? `Sync is on for ${esc(cfg.repo)}` : "Make the alert count your waterings"}</summary>
      <p>Without this, the morning alert only knows about rain. With it, tapping <strong>I watered</strong> also saves to your GitHub repository, and the alert uses it. Do this in the Home Screen app, not Safari.</p>
      <form id="syncForm" novalidate>
        <label for="syncRepo">Repository</label>
        <input id="syncRepo" value="${esc(repoGuess)}" placeholder="yourname/lawn-check" autocapitalize="none" autocorrect="off" spellcheck="false">
        <label for="syncToken">Access token</label>
        <input id="syncToken" type="password" value="" placeholder="${cfg ? "Saved. Paste a new one to replace it." : "github_pat_…"}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
        <div class="actions">
          <button type="submit">Save and sync</button>
          ${cfg ? '<button type="button" id="syncOff" class="quiet">Turn off</button>' : ""}
        </div>
        <p id="syncMsg" role="status"></p>
      </form>
    </details>`;
  $("syncForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const repo = $("syncRepo").value.trim();
    const token = $("syncToken").value.trim() || store.get("lawn.syncToken") || "";
    const msg = $("syncMsg");
    if (!isRepoName(repo)) { msg.textContent = "Type the repository like yourname/lawn-check."; return; }
    if (!token) { msg.textContent = "Paste the access token."; return; }
    msg.textContent = "Checking…";
    try {
      // Saves everything already on this phone, and brings back anything already saved.
      const local = loadLog();
      const saved = await updateRemote({ repo, token }, (remote) => cleanEntries(mergeEntries(remote, local), lawnToday()));
      store.set("lawn.syncRepo", repo);
      store.set("lawn.syncToken", token);
      saveLog(saved);
      syncState = { kind: "ok", message: "" };
      if (lastReport) render(lastReport);
      renderSync();
      $("syncMsg").textContent = "Sync is on.";
    } catch (err) {
      msg.textContent = err instanceof SyncError ? err.message : "That didn't work. Check the repository name and token.";
    }
  });
  $("syncOff")?.addEventListener("click", () => {
    store.set("lawn.syncToken", "");
    syncState = { kind: "off", message: "" };
    if (lastReport) render(lastReport);
    renderSync();
  });
}

// ---------- start ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works without it */ });
}
const savedZip = store.get("lawn.zip");
if (savedZip && isValidZip(savedZip)) {
  zipInput.value = savedZip;
  check(savedZip);
}
