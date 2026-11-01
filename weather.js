// Looks up a ZIP code, past rain (NOAA) and the forecast (Open-Meteo).
// Works in the browser and in Node 18+. Every function takes an optional `fetchFn`
// so tests can swap in fake network replies.

import { advise } from "./advisor.js";

const NOAA_SERVICE = "https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer";
const PAST_DAYS = 7;
const FORECAST_DAYS = 6; // today + the next 5

export class LawnError extends Error {}

// ---------- small helpers ----------

async function getJson(url, what, fetchFn, timeoutMs = 12000) {
  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchFn(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    throw new LawnError(`${what}: couldn't connect (${err?.message || err}).`);
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
    throw new LawnError(`${what} returned HTTP ${response.status}. ${body}`.trim());
  }
  try {
    return await response.json();
  } catch {
    throw new LawnError(`${what}: the reply wasn't readable.`);
  }
}

/** NOAA sometimes sends numbers as text ("0.39"); "NoData" and the like become null. */
export function looseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (value.trim() !== "" && Number.isFinite(n)) return n;
  }
  return null;
}

// ---------- ZIP code -> place ----------

export function isValidZip(zip) {
  return /^\d{5}$/.test(zip);
}

export async function lookupZip(zip, fetchFn = fetch) {
  if (!isValidZip(zip)) throw new LawnError("Please enter a 5-digit US ZIP code.");

  // First choice: a free ZIP lookup service.
  try {
    const data = await getJson(`https://api.zippopotam.us/us/${zip}`, "ZIP lookup", fetchFn);
    const p = data?.places?.[0];
    const lat = Number(p?.latitude);
    const lon = Number(p?.longitude);
    if (p && Number.isFinite(lat) && Number.isFinite(lon)) {
      return { zip, name: `${p["place name"]}, ${p["state abbreviation"]}`, latitude: lat, longitude: lon };
    }
  } catch (err) {
    if (err instanceof LawnError && /HTTP 404/.test(err.message)) {
      throw new LawnError("We couldn't find that ZIP code. Double-check it and try again.");
    }
    // Any other problem: try the backup below.
  }

  // Backup: Open-Meteo's place search understands postal codes too.
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=10&language=en&format=json`;
  const data = await getJson(url, "ZIP lookup (backup)", fetchFn);
  const hit = (data?.results || []).find((r) => r.country_code === "US" && (r.postcodes || []).includes(zip))
    || (data?.results || []).find((r) => r.country_code === "US");
  if (!hit) throw new LawnError("We couldn't find that ZIP code. Double-check it and try again.");
  return {
    zip,
    name: [hit.name, hit.admin1_code || hit.admin1].filter(Boolean).join(", "),
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

// ---------- forecast (Open-Meteo) ----------

export async function getForecast(place, fetchFn = fetch) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max",
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
    precipitation_unit: "inch",
    temperature_unit: "fahrenheit",
    timezone: "auto",
  });
  const data = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`, "Forecast", fetchFn);
  const d = data?.daily;
  const n = d?.time?.length ?? 0;
  if (!d || n < PAST_DAYS + 1 || ![d.precipitation_sum, d.precipitation_probability_max, d.temperature_2m_max].every((a) => a?.length === n)) {
    throw new LawnError("Forecast: the reply didn't have the expected days.");
  }
  const days = d.time.map((date, i) => ({
    date, // "YYYY-MM-DD" in the lawn's own time zone
    rainInches: d.precipitation_sum[i] ?? 0,
    rainChance: d.precipitation_probability_max[i],
    highF: d.temperature_2m_max[i],
  }));
  return {
    pastDays: days.slice(0, PAST_DAYS),
    today: days[PAST_DAYS],
    upcoming: days.slice(PAST_DAYS + 1),
  };
}

// ---------- observed rain (NOAA) ----------

/** Picks the "Last 7 Days Observed" layer(s) out of NOAA's layer list. */
export function pickSevenDayLayers(info) {
  const layers = info?.layers || [];
  const matches = layers.filter((l) => String(l.name).toLowerCase().includes("last 7 days observed"));
  const layer = matches.find((l) => String(l.name).toLowerCase().includes("inch")) || matches[0];
  if (!layer) {
    const sample = layers.filter((l) => /day/i.test(l.name)).slice(0, 8).map((l) => l.name);
    throw new LawnError(`Couldn't find NOAA's "Last 7 Days Observed" layer among ${layers.length} layers. Names with "day": ${JSON.stringify(sample)}`);
  }
  return layer.subLayerIds?.length ? layer.subLayerIds : [layer.id];
}

/** Finds the rain amount (inches) in NOAA's identify reply. */
export function pickRainValue(reply) {
  for (const result of reply?.results || []) {
    let n = looseNumber(result.value);
    if (n === null) {
      for (const [key, item] of Object.entries(result.attributes || {})) {
        if (key.toLowerCase().includes("value")) {
          n = looseNumber(item);
          if (n !== null) break;
        }
      }
    }
    if (n !== null && n >= 0 && n < 100) return n;
  }
  return null;
}

export async function getObservedRain(place, fetchFn = fetch) {
  const info = await getJson(`${NOAA_SERVICE}?f=json`, "NOAA layer list", fetchFn);
  const layerIds = pickSevenDayLayers(info);
  const { longitude: lon, latitude: lat } = place;
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: `all:${layerIds.join(",")}`,
    tolerance: "2",
    mapExtent: `${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`,
    imageDisplay: "400,400,96",
    returnGeometry: "false",
    f: "json",
  });
  const reply = await getJson(`${NOAA_SERVICE}/identify?${params}`, "NOAA rain lookup", fetchFn);
  const inches = pickRainValue(reply);
  if (inches === null) {
    throw new LawnError(`NOAA answered but gave no rain number (layers tried: ${layerIds}). Reply began: ${JSON.stringify(reply).slice(0, 200)}`);
  }
  return inches;
}

// ---------- everything together ----------

/**
 * Gets rain + forecast for a place (or a ZIP) and returns what the screen and the
 * daily alert both need. If NOAA can't be reached, falls back to the forecast
 * service's own estimate and says why in `noaaProblem`.
 */
export async function buildReport(placeOrZip, fetchFn = fetch) {
  const place = typeof placeOrZip === "string" ? await lookupZip(placeOrZip, fetchFn) : placeOrZip;
  const forecast = await getForecast(place, fetchFn);

  let recentRain = forecast.pastDays.reduce((sum, d) => sum + d.rainInches, 0);
  let rainSource = "model";
  let noaaProblem = null;
  try {
    recentRain = await getObservedRain(place, fetchFn);
    rainSource = "noaa";
  } catch (err) {
    noaaProblem = err?.message || String(err);
  }

  const tomorrow = forecast.upcoming[0];
  const soonRain = forecast.today.rainInches + (tomorrow?.rainInches ?? 0);
  const advice = advise(recentRain, forecast.today, tomorrow);

  return { place, recentRain, rainSource, noaaProblem, soonRain, ...forecast, advice };
}
