// The "should I water?" rules. Same rules as the iPhone app version.
//
// A lawn needs about 1 inch of water a week, from rain or sprinklers. We add the
// rain from the past 7 days to any rain we trust is coming in the next two days,
// and see how far short of the target that leaves us.

export const WEEKLY_TARGET = 1.0;   // inches per week
export const MIN_RAIN_CHANCE = 40;  // percent; forecast rain below this doesn't count

export function inchesText(value) {
  return `${value.toFixed(2)} in`;
}

const roundToQuarter = (v) => Math.round(v * 4) / 4;

/**
 * recentRain: inches of rain over the past 7 days
 * today / tomorrow: { rainInches, rainChance } (tomorrow may be missing)
 * watered: inches you've watered by hand or sprinkler in the past 7 days. It counts
 *   toward the weekly target exactly like rain.
 */
export function advise(recentRain, today, tomorrow, watered = 0) {
  const rain = recentRain;
  recentRain = rain + watered; // everything the lawn has received
  const got = watered > 0
    ? `${inchesText(recentRain)} of water (${inchesText(rain)} rain + ${inchesText(watered)} watering)`
    : `${inchesText(rain)} of rain`;

  const forecastRain = today.rainInches + (tomorrow?.rainInches ?? 0);
  const forecastChance = Math.max(today.rainChance ?? 0, tomorrow?.rainChance ?? 0);
  const expectedRain = forecastChance >= MIN_RAIN_CHANCE ? forecastRain : 0;
  const shortfall = Math.max(0, WEEKLY_TARGET - (recentRain + expectedRain));

  if (recentRain >= WEEKLY_TARGET) {
    return {
      verdict: "skip",
      headline: "Skip watering",
      explanation: `About ${got} reached your lawn in the past 7 days. It has had enough.`,
      suggestedInches: 0,
    };
  }

  if (expectedRain >= 0.25 && shortfall < 0.5) {
    return {
      verdict: "skip",
      headline: "Hold off — rain is on the way",
      explanation: `${inchesText(expectedRain)} is forecast for today and tomorrow, on top of ${watered > 0 ? got : inchesText(rain)} over the past week.`,
      suggestedInches: 0,
    };
  }

  if (shortfall <= 0.15) {
    return {
      verdict: "skip",
      headline: "Skip watering",
      explanation: `${got[0].toUpperCase() + got.slice(1)} over the past 7 days is close to what your lawn needs.`,
      suggestedInches: 0,
    };
  }

  if (shortfall < 0.5) {
    const amount = Math.max(0.25, roundToQuarter(shortfall));
    return {
      verdict: "light",
      headline: "A light watering would help",
      explanation: `Only ${got} in the past 7 days. About ${inchesText(amount)} of water would top it up.`,
      suggestedInches: amount,
    };
  }

  const amount = Math.min(1.0, roundToQuarter(shortfall));
  const outlook = expectedRain > 0
    ? `${inchesText(expectedRain)} is forecast, which won't be enough.`
    : "No meaningful rain is forecast.";
  return {
    verdict: "water",
    headline: "Time to water",
    explanation: `Only ${got} in the past 7 days. ${outlook} Aim for about ${inchesText(amount)} of water.`,
    suggestedInches: amount,
  };
}
