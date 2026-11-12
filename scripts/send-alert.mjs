// Runs once a day on GitHub. Checks rain + forecast and sends one push notification.
//
// Settings come from environment variables (set by the workflow file):
//   ALERT_CONFIG       setup code copied from the Lawn Check page (secret)
//   VAPID_PRIVATE_KEY  private key that matches the public key in config.js (secret)
//   VAPID_SUBJECT      optional; an address that identifies you, e.g. mailto:you@example.com
//   ALERT_MODE         "always" (default) or "needed" (only send when watering is advised)
//   FORCE_SEND         "true" when you run the workflow by hand: always send
//   DRY_RUN            "true" to print the message instead of sending it

import { VAPID_PUBLIC_KEY } from "../config.js";
import { buildReport } from "../weather.js";
import { advise } from "../advisor.js";
import { wateredIn7Days } from "../log.js";
import { readFileSync } from "node:fs";

/** Reads log.json (kept up to date by the page's sync). A missing or broken file means "nothing logged". */
export function readLogFile(path = new URL("../log.json", import.meta.url)) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function decodeConfig(code) {
  let config;
  try {
    config = JSON.parse(Buffer.from(String(code).trim(), "base64").toString("utf8"));
  } catch {
    throw new Error("ALERT_CONFIG isn't a valid setup code. Copy it again from the Lawn Check page.");
  }
  if (!config?.subscription?.endpoint || !config?.place?.latitude) {
    throw new Error("ALERT_CONFIG is missing the alert address or location. Copy a fresh setup code from the page.");
  }
  return config;
}

export function buildMessage(report, advice) {
  const { place } = report;
  return { title: advice.headline, body: `${advice.explanation} (${place.name})` };
}

export function shouldSend(advice, mode, force) {
  if (force) return true;
  if (mode === "needed") return advice.verdict !== "skip";
  return true;
}

export async function run(env = process.env, deps = {}) {
  const config = decodeConfig(env.ALERT_CONFIG || "");
  const report = await (deps.buildReport || buildReport)(config.place);
  const mode = (env.ALERT_MODE || "always").toLowerCase();
  const watered = wateredIn7Days((deps.readLog || readLogFile)(), report.today.date);
  const advice = advise(report.recentRain, report.today, report.upcoming[0], watered);
  const message = buildMessage(report, advice);

  console.log(`Verdict: ${advice.verdict} | past 7 days: ${report.recentRain.toFixed(2)} in rain (${report.rainSource}) + ${watered.toFixed(2)} in watering | soon: ${report.soonRain.toFixed(2)} in`);
  if (report.noaaProblem) console.log(`NOAA note: ${report.noaaProblem}`);

  if (!shouldSend(advice, mode, env.FORCE_SEND === "true")) {
    console.log(`Mode is "${mode}" and no watering is needed, so no alert was sent.`);
    return { sent: false, message };
  }
  if (env.DRY_RUN === "true") {
    console.log("Dry run, would send:", JSON.stringify(message));
    return { sent: false, message };
  }

  const webpush = deps.webpush || (await import("web-push")).default;
  if (!env.VAPID_PRIVATE_KEY) throw new Error("The VAPID_PRIVATE_KEY secret is missing.");
  webpush.setVapidDetails(env.VAPID_SUBJECT || "https://github.com", VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(config.subscription, JSON.stringify(message), { TTL: 60 * 60 * 12, urgency: "normal" });
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      throw new Error("Your iPhone's alert address has expired. Open Lawn Check, turn alerts on again, and replace the ALERT_CONFIG secret with the new setup code.");
    }
    throw new Error(`Sending failed (HTTP ${err?.statusCode ?? "?"}): ${err?.body || err?.message || err}`);
  }
  console.log("Alert sent:", JSON.stringify(message));
  return { sent: true, message };
}

// Only run when started directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
