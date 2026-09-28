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

/**
 * Normalise a South African mobile number to 27XXXXXXXXX.
 * 0821234567, "082 123 4567", +27821234567, 27821234567 and 082-123-4567 all
 * become 27821234567. Returns "" when the input cannot be read at all.
 */
export function normaliseZaMobile(raw) {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("0027")) d = d.slice(2);
  if (d.startsWith("27") && d.length >= 11) return d;
  if (d.startsWith("0") && d.length === 10) return "27" + d.slice(1);
  if (d.length === 9 && "678".includes(d[0])) return "27" + d;
  return d;
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
