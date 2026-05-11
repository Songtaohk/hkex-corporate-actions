const monthLookup: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function getFutureWindow(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 3);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWithinWindow(value: string | null, start: Date, end: Date) {
  if (!value) return true;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed >= start && parsed <= end;
}

export function normalizeDateText(value: string | null | undefined) {
  if (!value) return null;
  const clean = value
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, "")
    .replace(/\b(st|nd|rd|th)\b/gi, "")
    .replace(/[,，]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const yyyyMmDd = clean.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (yyyyMmDd) {
    return toIsoDate(
      new Date(
        Number(yyyyMmDd[1]),
        Number(yyyyMmDd[2]) - 1,
        Number(yyyyMmDd[3]),
      ),
    );
  }

  const ddMonthYYYY = clean.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\b/,
  );
  if (ddMonthYYYY) {
    const month = monthLookup[ddMonthYYYY[2].toLowerCase()];
    if (month !== undefined) {
      return toIsoDate(new Date(Number(ddMonthYYYY[3]), month, Number(ddMonthYYYY[1])));
    }
  }

  const monthDdYYYY = clean.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})\s+(20\d{2})\b/,
  );
  if (monthDdYYYY) {
    const month = monthLookup[monthDdYYYY[1].toLowerCase()];
    if (month !== undefined) {
      return toIsoDate(new Date(Number(monthDdYYYY[3]), month, Number(monthDdYYYY[2])));
    }
  }

  return null;
}

export function pickDateNear(text: string, hints: RegExp[]) {
  for (const hint of hints) {
    const match = text.match(hint);
    if (match) {
      const normalized = normalizeDateText(match[1] || match[0]);
      if (normalized) return normalized;
    }
  }
  return null;
}
