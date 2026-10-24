// Money, hours and date arithmetic — the browser twin of the Python app's
// app/services/money.py. Storage conventions are identical so the two
// implementations can be compared case for case:
//   * money  -> integer cents
//   * hours  -> integer thousandths of an hour (6.5 h == 6500)
//   * dates  -> ISO YYYY-MM-DD strings
// There is no float anywhere in the calculation path.

export const HOURS_SCALE = 1000;
export const CENTS_PER_RAND = 100;

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export class MoneyError extends Error {}

/** Integer division rounded half-up; avoids float banker's rounding. */
export function roundHalfUp(numerator, denominator) {
  if (denominator <= 0) throw new MoneyError("denominator must be positive");
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  let q = Math.floor(abs / denominator);
  const r = abs - q * denominator;
  if (r * 2 >= denominator) q += 1;
  return sign * q;
}

// Python's _MONEY_CLEAN / _HOURS_CLEAN both strip everything except digits,
// dot and minus. Commas are kept here because they are a decimal separator in
// the locale this app is typed in, not noise - see splitNumberText.
const CLEAN = /[^0-9.,\-]/g;

/**
 * Split typed text into sign, whole and fraction parts, accepting "." or ","
 * as the decimal separator.
 *
 * A South African keyboard puts "," on the decimal key, so treating "," as
 * noise silently turned "6,5" hours into 65 hours. Rules, chosen to keep the
 * Python reference implementation's behaviour wherever the two overlap:
 *
 *   * A dot is always the decimal point ("12.345" is twelve point three four
 *     five, truncated to the cent, exactly as the Python app reads it).
 *   * When both separators appear, the LAST one is the decimal point and the
 *     other is grouping, so "1,234.56" and "1 234,56" both read correctly.
 *   * A lone comma is ambiguous. "150,50" is clearly a decimal. "1,500" could
 *     be fifteen hundred, so the caller's domain decides via
 *     groupingThreeIsThousands: money reads it as one thousand five hundred,
 *     hours as one and a half (nobody tutors fifteen hundred hours).
 *
 * Returns null when the text cannot be read as a number.
 */
function splitNumberText(value, { groupingThreeIsThousands = false } = {}) {
  let text = String(value).trim();
  text = text.replace(CLEAN, "");
  if (text === "" || text === "-" || text === "." || text === ",") return null;
  const neg = text.startsWith("-");
  text = text.replace(/^-+/, "");
  if (text.includes("-")) return null;

  const commas = (text.match(/,/g) || []).length;
  const dots = (text.match(/\./g) || []).length;

  let whole = text;
  let frac = "";
  if (commas > 0 || dots > 0) {
    // Pick the decimal separator, then require every other separator to be
    // grouping. Several dots ("1.2.3") cannot be grouping, so they stay invalid.
    let dec = "";
    if (commas > 0 && dots > 0) {
      dec = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    } else if (dots > 0) {
      if (dots > 1) return null;
      dec = ".";
    } else {
      const after = text.slice(text.lastIndexOf(",") + 1);
      const asGrouping = groupingThreeIsThousands && /^[0-9]{3}$/.test(after);
      if (commas > 1 && !asGrouping) return null;
      dec = asGrouping ? "" : ",";
    }

    const idx = dec === "" ? -1 : text.lastIndexOf(dec);
    if (idx === -1) {
      const groups = text.split(",");
      if (!groups.every((g, i) => (i === 0 ? /^[0-9]{1,3}$/.test(g) : /^[0-9]{3}$/.test(g)))) {
        return null;
      }
      whole = groups.join("");
    } else {
      const before = text.slice(0, idx);
      const after = text.slice(idx + 1);
      if (after.includes(dec)) return null;      // 1.2.3 or 1,2,3
      // Everything before the decimal point must be digits and well-formed
      // grouping separators.
      const groupChar = dec === "." ? "," : ".";
      const groups = before.split(groupChar);
      if (before.includes(groupChar)) {
        if (!groups.every((g, i) => (i === 0 ? /^[0-9]{1,3}$/.test(g) : /^[0-9]{3}$/.test(g)))) {
          return null;
        }
      }
      whole = groups.join("");
      frac = after;
    }
  }

  whole = whole || "0";
  if (!/^[0-9]+$/.test(whole) || (frac !== "" && !/^[0-9]+$/.test(frac))) return null;
  return { neg, whole, frac };
}

/** Parse user input such as "R240", "240.00" or 240 to integer cents. */
export function parseMoneyToCents(value) {
  if (value === null || value === undefined) throw new MoneyError("amount is required");
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value * CENTS_PER_RAND;
    value = String(value); // shortest round-trip form, as Python's repr()
  }
  if (String(value).trim() === "") throw new MoneyError("amount is required");
  const parts = splitNumberText(value, { groupingThreeIsThousands: true });
  if (!parts) throw new MoneyError(`could not read amount from ${value}`);
  const frac = (parts.frac + "00").slice(0, 2);
  const cents = parseInt(parts.whole, 10) * CENTS_PER_RAND + parseInt(frac, 10);
  return parts.neg ? -cents : cents;
}

/** A currency symbol safe to print anywhere in the app. */
export function sanitiseSymbol(value, def = "R") {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text || text.length > 4) return def;
  for (const ch of "<>&\"'\\/`") if (text.includes(ch)) return def;
  return text;
}

function group3(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Cents as a bare decimal with no symbol or separators: 240.00 */
export function formatMoneyPlain(cents) {
  let c = cents === null || cents === undefined ? 0 : Math.trunc(Number(cents));
  const sign = c < 0 ? "-" : "";
  c = Math.abs(c);
  const whole = Math.floor(c / CENTS_PER_RAND);
  const frac = c % CENTS_PER_RAND;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/** Cents as R1,560.00 (thousands-separated, two decimals). */
export function formatMoney(cents, currency = "ZAR", symbol = null) {
  let c = cents === null || cents === undefined ? 0 : Math.trunc(Number(cents));
  const sign = c < 0 ? "-" : "";
  c = Math.abs(c);
  const whole = Math.floor(c / CENTS_PER_RAND);
  const frac = c % CENTS_PER_RAND;
  let sym = symbol;
  if (sym === null || sym === undefined) {
    sym = String(currency || "").toUpperCase() === "ZAR" ? "R" : "";
  }
  return `${sign}${sym}${group3(whole)}.${String(frac).padStart(2, "0")}`;
}

/** Parse hours input ("6.5", "6,5", "2.25", 1) to thousandths of an hour. */
export function parseHoursToMilli(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new MoneyError("hours are required");
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value * HOURS_SCALE;
    value = String(value);
  }
  // Hours never carry thousands grouping in this app, so "1,500" means an hour
  // and a half rather than fifteen hundred hours.
  const parts = splitNumberText(value, { groupingThreeIsThousands: false });
  if (!parts) throw new MoneyError(`could not read hours from ${value}`);
  const frac = (parts.frac + "000").slice(0, 3);
  const milli = parseInt(parts.whole, 10) * HOURS_SCALE + parseInt(frac, 10);
  return parts.neg ? -milli : milli;
}

/** Thousandths of an hour without trailing zeros: 6500 -> "6.5". */
export function formatHours(hoursMilli) {
  let m = Math.trunc(Number(hoursMilli));
  const sign = m < 0 ? "-" : "";
  m = Math.abs(m);
  const whole = Math.floor(m / HOURS_SCALE);
  const raw = m % HOURS_SCALE;
  if (raw === 0) return `${sign}${whole}`;
  const fracText = String(raw).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fracText}`;
}

/** rate x hours in integer cents, rounded half-up to the cent. */
export function lineAmountCents(rateCents, hoursMilli) {
  return roundHalfUp(Math.trunc(rateCents) * Math.trunc(hoursMilli), HOURS_SCALE);
}

// --------------------------------------------------------------------------
// dates
// --------------------------------------------------------------------------

export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SHORT_SET = new Set(MONTHS_SHORT);
const LONG_SET = new Set(MONTHS_LONG);

/** Parse an ISO or human date string to {y,m,d}, or null. */
export function parseIso(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const text = String(value).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) {
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) {
    return { y: +m[3], m: +m[2], d: +m[1] };
  }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,}) (\d{4})$/.exec(text))) {
    const name = m[2];
    let idx = MONTHS_SHORT.indexOf(name.slice(0, 3).replace(/^./, (c) => c.toUpperCase()));
    if (idx === -1) {
      idx = MONTHS_LONG.findIndex((x) => x.toLowerCase() === name.toLowerCase());
    }
    if (idx !== -1) return { y: +m[3], m: idx + 1, d: +m[1] };
  }
  return null;
}

export function addDays(iso, days) {
  const base = parseIso(iso) || (() => {
    const t = parseIso(todayIso());
    return t;
  })();
  const dt = new Date(Date.UTC(base.y, base.m - 1, base.d));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(days));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 2026-08-25 -> "25 Aug 2026" (the PDF's ISSUED/DUE form). */
export function formatDateDisplay(iso) {
  const p = parseIso(iso);
  if (!p) return String(iso || "");
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

/** 2026-09-01 -> "1 September 2026" (the WhatsApp message form). */
export function formatDateLong(iso) {
  const p = parseIso(iso);
  if (!p) return String(iso || "");
  return `${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`;
}

/** 2026-08-25 -> "2608" (two-digit year + month, the payment-reference form). */
export function formatYearMonthShort(iso) {
  const p = parseIso(iso);
  return p ? `${String(p.y % 100).padStart(2, "0")}${String(p.m).padStart(2, "0")}` : "";
}

/** 2026-08-25 -> "2026-08". */
export function monthKey(iso) {
  const p = parseIso(iso);
  return p ? `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}` : "";
}

export function monthLabel(monthKeyStr) {
  const parts = String(monthKeyStr || "").split("-");
  if (parts.length !== 2) return monthKeyStr;
  const idx = parseInt(parts[1], 10) - 1;
  if (idx < 0 || idx > 11 || !/^\d+$/.test(parts[1])) return monthKeyStr;
  return `${MONTHS_LONG[idx]} ${parts[0]}`;
}

export const _internal = { SHORT_SET, LONG_SET };
