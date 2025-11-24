type DateComponent = "ms" | "s" | "m" | "h" | "d" | "M";

/**
 * Resets the specified date components of a given date to their minimum values.
 * @param date - The date to reset.
 * @param components - The date components to reset.
 * @returns The modified date with the specified components reset.
 */
export const resetDateComponents = (
  date: Date,
  components: DateComponent[],
): Date => {
  const resetActions: Record<DateComponent, () => void> = {
    ms: () => date.setUTCMilliseconds(0),
    s: () => date.setUTCSeconds(0),
    m: () => date.setUTCMinutes(0),
    h: () => date.setUTCHours(0),
    d: () => date.setUTCDate(1),
    M: () => date.setUTCMonth(0),
  };

  components.forEach((component) => resetActions[component]());

  return date;
};

/**
 * Adjusts the date by adding or subtracting a specified number of days.
 * @param date - The date to adjust.
 * @param days - The number of days to add (positive) or subtract (negative).
 * @returns The adjusted date.
 */
export const getCurrentTimeAndDay = (offsetMinutes = 0) => {
  const now = new Date();

  // Convert offset from minutes to milliseconds
  const adjustedTime = new Date(now.getTime() + offsetMinutes * 60000);

  // we have already adjusted the time as per offset so we can consider utc timezone below
  const day = adjustedTime
    .toLocaleString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(/^(\w+)\s/, "$1, ");
  const time = adjustedTime.toLocaleString("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: "UTC",
  });

  return { time, day };
};

/**
 * Converts a timezone offset string (±HH:mm or ±HH) to the equivalent offset in minutes.
 * @param offsetStr - The timezone offset string to convert.
 * @returns The offset in minutes.
 * @throws {Error} If the input string is not in the expected format.
 */
export const getTimezoneOffsetFromTime = (offsetStr: string) => {
  const match = offsetStr.match(/^([+-])(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error("Invalid time format. Expected format: ±HH:mm or ±HH");
  }

  const sign = match[1] === "+" ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;

  return sign * (hours * 60 + minutes);
};

export const getTimeDifferenceInOffsetFromCurrentUTC = (
  givenTimeStr: string,
) => {
  const [h, m] = givenTimeStr.split(":").map(Number);
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const givenMinutes = h * 60 + m;

  const offsets: string[] = [];
  [0, -1440].forEach((dayShift) => {
    const offset = givenMinutes - utcMinutes + dayShift;
    if (offset >= -720 && offset <= 840) {
      const sign = offset >= 0 ? "+" : "-";
      const abs = Math.abs(offset);
      offsets.push(
        `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`,
      );
    }
  });

  return offsets;
};

export const getUTCDateWithTimeDifference = (m: number) => {
  const utcNow = new Date(); // current time UTC
  const updatedUTC = new Date(utcNow.getTime() + m * 60000); // add minutes
  return updatedUTC.toISOString();
};

export const getUTCStartOfDayFromOffset = (offsetStr: string) => {
  // Parse the offset, e.g. "+05:00" → 5 * 60
  const match = offsetStr.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("Invalid offset format");
  }

  const sign = match[1] === "+" ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3], 10);
  const offsetInMinutes = sign * (hours * 60 + minutes);

  const now = new Date();
  const utcNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  utcNow.setUTCHours(0, 0, 0, 0);

  // Convert back to UTC
  const utcStartAtTz = new Date(utcNow.getTime() - offsetInMinutes * 60 * 1000);

  return utcStartAtTz.toISOString();
};
