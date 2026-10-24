// South African mobile normalisation and WhatsApp wa.me deep links — the
// browser twin of the Python app's app/services/whatsapp.py.
//
// There is NO server-side WhatsApp send anywhere in this application: this
// module only produces a URL and a message string. No delivery is claimed.

export const DEFAULT_TEMPLATE =
  "Hi {parent_name} \u{1F60A}\n" +
  "Please find your latest tutoring invoice attached.\n" +
  "Invoice #{invoice_number}\n" +
  "Amount due: {amount}\n" +
  "Due: {due_date}\n" +
  "Thank you!";

export const TEMPLATE_VARIABLES = [
  "parent_name", "learner_name", "invoice_number", "amount", "business_name",
  "due_date",
];

const SA_MOBILE = /^27[6-8][0-9]{8}$/;

function digitsOnly(raw) {
  return String(raw === null || raw === undefined ? "" : raw).replace(/[^0-9]/g, "");
}

// A number is often written as more than one thing in a single cell - a mobile
// and a landline, an "or", a slash - and an extension is not part of the dial
// string. Splitting first means "082 123 4567 or 083 765 4321" reads the mobile
// instead of gluing both into a number that dials nobody.
const NUMBER_BREAK = /[,;/|]|\bor\b|\band\b|\bext\b\.?|\bxt\b\.?|\(h\)|\(w\)|\(c\)/i;

function candidateGroups(raw) {
  return String(raw === null || raw === undefined ? "" : raw)
    .split(NUMBER_BREAK)
    .map((s) => s.trim())
    .filter((s) => digitsOnly(s) !== "");
}

/** One candidate string to 27XXXXXXXXX, or "" when unreadable. */
function normaliseOne(raw) {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("0027")) d = d.slice(2);
  // "+27 (0)82 123 4567" is the standard South African written form: the "(0)"
  // is a trunk prefix that must be dropped once the country code is present, or
  // the result dials 27 0 82... and never connects.
  if (d.startsWith("270") && d.length === 12) d = "27" + d.slice(3);
  if (d.startsWith("27") && d.length >= 11) return d;
  if (d.startsWith("0") && d.length === 10) return "27" + d.slice(1);
  if (d.length === 9 && "678".includes(d[0])) return "27" + d;
  return d;
}

/**
 * Normalise a South African mobile number to 27XXXXXXXXX.
 * 0821234567, "082 123 4567", +27821234567, 27821234567, 082-123-4567 and
 * "+27 (0)82 123 4567" all become 27821234567. Returns "" when the input cannot
 * be read at all.
 */
export function normaliseZaMobile(raw) {
  const text = String(raw === null || raw === undefined ? "" : raw);
  // Sheets turns a bare long number into scientific notation, and the digits
  // are already gone by then ("8.21235E+08"). Inventing a number from what is
  // left would dial a stranger, so this is reported as unreadable instead.
  if (/[0-9][.,]?[0-9]*E[+-]?[0-9]+/i.test(text)) return "";
  const groups = candidateGroups(text);
  if (!groups.length) return "";
  // Prefer a group that is actually a valid mobile, so an "or" list resolves to
  // the number WhatsApp can reach rather than to whichever came first.
  for (const g of groups) {
    const candidate = normaliseOne(g);
    if (SA_MOBILE.test(candidate)) return candidate;
  }
  return normaliseOne(groups[0]);
}

/** True when the value is a South African *mobile* number. */
export function isValidZaMobile(raw) {
  return SA_MOBILE.test(normaliseZaMobile(raw));
}

/** A human-readable reason the number cannot be used, or null. */
export function mobileProblem(raw) {
  if (!String(raw === null || raw === undefined ? "" : raw).trim()) {
    return "No WhatsApp number is stored for this parent.";
  }
  if (!isValidZaMobile(raw)) {
    return `${raw} is not a valid South African mobile number ` +
      "(expected something like 0821234567 or +27821234567).";
  }
  return null;
}

/** Substitute {variable} placeholders, leaving unknown ones visible. */
export function renderTemplate(template, context) {
  let text = template ? template : DEFAULT_TEMPLATE;
  for (const key of TEMPLATE_VARIABLES) {
    text = text.split("{" + key + "}").join(String(context[key] ?? ""));
  }
  return text;
}

/** Render the invoice's snapshotted WhatsApp template. */
export function buildMessage(invoice, context = {}) {
  const ctx = Object.assign({}, context);
  if (ctx.parent_name === undefined) ctx.parent_name = invoice.snap_parent_name || "";
  if (ctx.learner_name === undefined) ctx.learner_name = invoice.snap_learner_name || "";
  if (ctx.invoice_number === undefined) ctx.invoice_number = invoice.number_text || "";
  if (ctx.business_name === undefined) ctx.business_name = invoice.snap_business_name || "";
  const template = String(invoice.snap_whatsapp_template || "").trim() || DEFAULT_TEMPLATE;
  return renderTemplate(template, ctx);
}

// Python's urllib.parse.urlencode uses quote_plus: spaces become "+" and every
// character outside A-Za-z0-9_.-~ is percent-encoded (including ! ' ( ) *).
function quotePlus(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

/** Build https://wa.me/<digits>?text=<percent-encoded message>. */
export function buildWaLink(number, message) {
  const digits = normaliseZaMobile(number);
  return "https://wa.me/" + digits + "?" + "text=" + quotePlus(message);
}

/** Everything the invoice screen needs to share an invoice on WhatsApp. */
export function invoiceSharePayload(invoice, { amountDisplay, dueDateDisplay }) {
  const numberRaw = invoice.snap_parent_whatsapp || "";
  const context = {
    parent_name: invoice.snap_parent_name || "",
    learner_name: invoice.snap_learner_name || "",
    invoice_number: invoice.number_text || "",
    amount: amountDisplay,
    due_date: dueDateDisplay,
    business_name: invoice.snap_business_name || "",
  };
  const message = buildMessage(invoice, context);
  const problem = mobileProblem(numberRaw);
  return {
    number_raw: numberRaw,
    number_normalised: normaliseZaMobile(numberRaw),
    message,
    url: problem ? null : buildWaLink(numberRaw, message),
    problem,
    server_side_send: false,
    delivery_claimed: false,
  };
}
