// New Invoice — one short screen in three steps:
//   1. Who is it for?  (type-ahead over saved parents; new parent reveals a
//      mobile-number box; the child picker is hidden for a new parent)
//   2. Rate and hours  (rate select with "+ Add a new rate"; hours or a flat
//      total; a description; add/remove rows)
//   3. Dates           (auto-assigned number, invoice date, due date; editable)
// "Remember this rate for this parent" saves the rate for next time.
//
// The typed work is held in `draft` and mirrored to localStorage on every
// change, so moving between steps (or reloading) never discards it, and a
// validation failure is reported on the field that caused it rather than as a
// bare "Line 1: enter a rate" the owner cannot act on.

import { el, field, toast, viewDocument, withBusy } from "../ui.js";
import * as I from "../invoicing.js";
import * as M from "../money.js";
import * as S from "../service.js";
import { buildInvoicePdf } from "../pdf.js";
import { state, navigate, errorMessage } from "../app.js";

const DRAFT_KEY = "ctt_invoice_draft";

function rateKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function loadDraft() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DRAFT_KEY) : null;
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveDraft(draft) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (err) { /* private mode: not being able to save a draft is not fatal */ }
}

export function clearInvoiceDraft() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(DRAFT_KEY);
  } catch (err) { /* ignore */ }
}

export async function renderInvoiceNew(main) {
  const store = state.store;
  const symbol = store.settings.currency_symbol || "R";
  const parents = store.parents.filter((p) => String(p.archived).toLowerCase() !== "true");
  const saved = loadDraft();

  const form = el("form", { class: "screen invoice-form", novalidate: true });
  const draft = {
    step: (saved && saved.step) || 1,
    parentId: (saved && saved.parentId) || null,
    parentQuery: (saved && saved.parentQuery) || "",
    parentWhatsapp: (saved && saved.parentWhatsapp) || "",
    newParent: (saved && saved.newParent) || null,
    learnerId: (saved && saved.learnerId) || null,
    remember: saved ? saved.remember !== false : true,
    invoiceDate: (saved && saved.invoiceDate) || "",
    dueDate: (saved && saved.dueDate) || "",
    discountType: (saved && saved.discountType) || "none",
    discountValue: (saved && saved.discountValue) || "",
    rows: (saved && Array.isArray(saved.rows) && saved.rows.length)
      ? saved.rows.map(normaliseRow)
      : [blankRow(store)],
  };
  let selectedParent = parents.find((p) => String(p.parent_id) === String(draft.parentId)) || null;
  if (!selectedParent) draft.parentId = null;
  // A number typed on this screen but not yet generated is re-applied here, so
  // stepping back and forth (or a re-render) does not silently discard it.
  else if (draft.parentWhatsapp) {
    selectedParent = Object.assign({}, selectedParent, { whatsapp: draft.parentWhatsapp });
  }
  let newParent = draft.newParent;
  let learnerId = draft.learnerId;
  let remember = draft.remember;

  // row index -> its controls, so a validation failure can be pointed at.
  const controls = new Map();

  const container = el("div");
  form.appendChild(container);

  function persist() {
    saveDraft({
      step: draft.step, parentId: draft.parentId, parentQuery: draft.parentQuery,
      parentWhatsapp: draft.parentWhatsapp,
      newParent, learnerId, remember, invoiceDate: draft.invoiceDate,
      dueDate: draft.dueDate, rows: draft.rows,
      discountType: draft.discountType, discountValue: draft.discountValue,
    });
  }

  function parentMatches(q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return parents.filter((p) => {
      const kids = store.learners.filter((l) => String(l.parent_id) === String(p.parent_id))
        .map((l) => `${l.name} ${l.surname}`).join(" ");
      return `${p.name} ${p.surname}`.toLowerCase().includes(needle)
        || String(p.whatsapp || "").includes(needle)
        || kids.toLowerCase().includes(needle);
    }).slice(0, 6);
  }

  function drawStep() {
    controls.clear();
    container.replaceChildren();
    container.appendChild(stepTabs());
    if (draft.step === 1) drawStepOne();
    else if (draft.step === 2) drawStepTwo();
    else drawStepThree();
  }

  function goTo(n) {
    draft.step = n;
    persist();
    drawStep();
  }

  function stepTabs() {
    const mk = (n, label) => el("button", {
      type: "button", class: `step-tab${draft.step === n ? " active" : ""}`,
      onClick: () => { if (n < draft.step || canAdvance(n - 1)) goTo(n); },
    }, [el("span", { class: "step-num", text: String(n) }), el("span", { text: label })]);
    return el("div", { class: "step-tabs" }, [mk(1, "Who is it for?"), mk(2, "Rate and hours"), mk(3, "Dates")]);
  }

  function canAdvance(fromStep) {
    if (fromStep < 1) return true;
    return Boolean(selectedParent || newParent);
  }

  // ---- step 1 ------------------------------------------------------------
  function drawStepOne() {
    const box = el("section", { class: "step-panel" });
    const input = el("input", { type: "search", placeholder: "Start typing a parent's name\u2026",
      autocomplete: "off", value: draft.parentQuery });
    const results = el("div", { class: "typeahead" });
    const details = el("div", { class: "parent-details" });
    const mobileWrap = el("div", { class: "hidden" });
    const nextBtn = el("button", { type: "button", class: "btn primary large", text: "Next", disabled: !(selectedParent || newParent),
      onClick: () => { if (canAdvance(1)) goTo(2); } });

    function renderDetails() {
      details.replaceChildren();
      mobileWrap.replaceChildren();
      mobileWrap.className = "hidden";
      if (selectedParent) {
        details.appendChild(el("p", { class: "picked", text: `Picked: ${selectedParent.name} ${selectedParent.surname}`.trim() }));
        // A parent saved before their number was known keeps printing a blank
        // WhatsApp row forever, because the invoice freezes the number it was
        // given. This field edits the number on the invoice being made, so the
        // missing one can be filled in without abandoning the invoice and going
        // to the Parents screen first.
        mobileWrap.className = "";
        const mob = el("input", { type: "tel", placeholder: "0821234567", value: selectedParent.whatsapp || "" });
        mob.addEventListener("input", () => {
          selectedParent = Object.assign({}, selectedParent, { whatsapp: mob.value });
          draft.parentWhatsapp = mob.value;
          persist();
        });
        mobileWrap.appendChild(field("Mobile number", mob,
          "Printed on the invoice and used for the WhatsApp link. Saved to this parent when you generate."));
        details.appendChild(mobileWrap);
        const kids = store.learners.filter((l) => String(l.parent_id) === String(selectedParent.parent_id));
        if (kids.length) {
          const sel = el("select", { class: "child-picker", "aria-label": "Learner (optional)" });
          sel.appendChild(el("option", { value: "", text: "No specific learner" }));
          for (const k of kids) sel.appendChild(el("option", { value: String(k.learner_id), text: `${k.name} ${k.surname}`.trim() }));
          sel.value = learnerId || "";
          sel.addEventListener("change", () => { learnerId = sel.value || null; persist(); });
          details.appendChild(field("Child (optional)", sel, "Leave blank if the invoice is for the parent."));
        } else {
          details.appendChild(el("p", { class: "help", text: "This parent has no saved learners yet." }));
        }
      } else if (newParent) {
        mobileWrap.className = "";
        const mob = el("input", { type: "tel", placeholder: "0821234567", value: newParent.whatsapp || "" });
        mob.addEventListener("input", () => { newParent.whatsapp = mob.value; persist(); });
        mobileWrap.appendChild(field("Mobile number", mob, "Needed so the invoice can be shared on WhatsApp later."));
        details.appendChild(mobileWrap);
        details.appendChild(el("p", { class: "picked", text: `New parent: ${newParent.name}` }));
      }
    }

    input.addEventListener("input", () => {
      const q = input.value;
      draft.parentQuery = q;
      results.replaceChildren();
      selectedParent = null; newParent = null;
      draft.parentId = null;
      draft.parentWhatsapp = "";
      if (q.trim()) {
        const matches = parentMatches(q);
        for (const p of matches) {
          results.appendChild(el("button", {
            type: "button", class: "typeahead-item",
            onClick: () => {
              selectedParent = p; draft.parentId = p.parent_id;
              draft.parentWhatsapp = "";
              input.value = `${p.name} ${p.surname}`.trim();
              draft.parentQuery = input.value;
              results.replaceChildren(); renderDetails();
              nextBtn.disabled = false; persist();
            },
          }, [el("strong", { text: `${p.name} ${p.surname}`.trim() }), el("span", { text: p.whatsapp || "" })]));
        }
        results.appendChild(el("button", {
          type: "button", class: "typeahead-item new",
          onClick: () => {
            newParent = { name: q.trim(), whatsapp: "" }; selectedParent = null; draft.parentId = null;
            draft.newParent = newParent;
            results.replaceChildren(); renderDetails();
            nextBtn.disabled = false; persist();
          },
        }, [`Create new parent "${q.trim()}"`]));
      }
      nextBtn.disabled = !(selectedParent || newParent);
      persist();
    });

    box.appendChild(field("Who is it for?", input, "Pick a saved parent, or type a new name to save one with this invoice."));
    box.appendChild(results);
    box.appendChild(details);
    box.appendChild(mobileWrap);
    box.appendChild(el("div", { class: "step-actions" }, [nextBtn]));
    container.appendChild(box);
  }

  // ---- step 2 ------------------------------------------------------------
  function drawStepTwo() {
    const box = el("section", { class: "step-panel" });
    const linesBox = el("div", { class: "lines" });
    const errorsBox = el("div", { class: "hidden" });
    let grandTotal = null;

    function rateOptions(selectedKey) {
      const sel = el("select", { class: "rate-select", "aria-label": "Rate" });
      for (const r of store.rates.filter((r) => String(r.active).toLowerCase() !== "false")) {
        sel.appendChild(el("option", { value: r.key, text: `${r.label} (${I.formatMoney(Number(r.rate_cents))}/hour)`, selected: r.key === selectedKey }));
      }
      sel.appendChild(el("option", { value: "__new__", text: "+ Add a new rate" }));
      return sel;
    }

    function renderRow(row, index) {
      const rateSel = rateOptions(row.service);
      const rateInput = el("input", { type: "text", inputmode: "decimal", value: row.rate, "aria-label": `Rate for line ${index + 1}` });
      const hoursInput = el("input", { type: "text", inputmode: "decimal", value: row.hours, "aria-label": `Hours for line ${index + 1}` });
      const flatInput = el("input", { type: "text", inputmode: "decimal", value: row.amount, "aria-label": `Full amount for line ${index + 1}`, class: row.mode === "flat" ? "" : "hidden" });
      const modeToggle = el("input", { type: "checkbox", checked: row.mode === "flat", "aria-label": `Charge one total for line ${index + 1}` });
      const descInput = el("input", { type: "text", value: row.description, "aria-label": `Description for line ${index + 1}`, placeholder: labelFor(row.service) });
      const total = el("span", { class: "line-total", text: I.formatMoney(0, "ZAR", symbol) });
      if (row.mode === "flat") hoursInput.classList.add("hidden");

      // The rate type's own price fills the box the first time, so the owner is
      // never asked to type a rate that the app already knows. Until this box
      // was rendered there was nothing to type into at all, which is why the old
      // "Line 1: enter a rate" message could not be acted on.
      function prefillRate() {
        const r = store.rates.find((x) => x.key === row.service);
        if (r && String(r.rate_cents ?? "") !== "") {
          rateInput.value = M.formatMoneyPlain(Number(r.rate_cents));
          row.rate = rateInput.value;
        }
      }

      function recalc() {
        try {
          const cents = row.mode === "flat"
            ? M.parseMoneyToCents(flatInput.value || rateInput.value)
            : M.lineAmountCents(M.parseMoneyToCents(rateInput.value), M.parseHoursToMilli(hoursInput.value));
          total.textContent = I.formatMoney(cents, "ZAR", symbol);
        } catch (err) { total.textContent = "\u2014"; }
        updateGrandTotal();
      }

      rateSel.addEventListener("change", async () => {
        if (rateSel.value === "__new__") {
          const name = window.prompt('New rate name (for example "Holiday intensive")');
          if (!name || !name.trim()) { rateSel.value = row.service; return; }
          const key = rateKey(name);
          const cents = M.parseMoneyToCents(rateInput.value || "0");
          store.rates = store.rates.concat([{ key, label: name.trim(), rate_cents: String(cents), active: "TRUE", sort_order: String(store.rates.length + 1) }]);
          try { await S.saveRate(store, { key, label: name.trim(), rateCents: cents }); } catch (err) { /* best effort */ }
          const opt = el("option", { value: key, text: `${name.trim()} (${I.formatMoney(cents)}/hour)` });
          rateSel.insertBefore(opt, rateSel.lastElementChild);
          rateSel.value = key;
          row.service = key;
          if (!descInput.value.trim()) { descInput.value = name.trim(); row.description = descInput.value; }
          recalc(); persist();
          return;
        }
        const previousLabel = labelFor(row.service);
        row.service = rateSel.value;
        const r = store.rates.find((x) => x.key === rateSel.value);
        if (r && row.mode === "hourly") { rateInput.value = M.formatMoneyPlain(Number(r.rate_cents)); row.rate = rateInput.value; }
        // Keep the description in step with the rate type unless the owner has
        // written their own wording - which is what stops a parent's invoice
        // from reading "High Tuition" when the rate is called High School.
        if (!descInput.value.trim() || descInput.value.trim() === previousLabel) {
          descInput.value = labelFor(row.service);
          row.description = descInput.value;
        }
        recalc(); persist();
      });
      rateInput.addEventListener("input", () => { row.rate = rateInput.value; recalc(); persist(); });
      hoursInput.addEventListener("input", () => { row.hours = hoursInput.value; recalc(); persist(); });
      flatInput.addEventListener("input", () => { row.amount = flatInput.value; recalc(); persist(); });
      descInput.addEventListener("input", () => { row.description = descInput.value; persist(); });
      modeToggle.addEventListener("change", () => {
        row.mode = modeToggle.checked ? "flat" : "hourly";
        hoursInput.classList.toggle("hidden", modeToggle.checked);
        flatInput.classList.toggle("hidden", !modeToggle.checked);
        recalc(); persist();
      });

      const remove = el("button", { type: "button", class: "btn danger small", text: `Remove line ${index + 1}`,
        onClick: () => {
          if (draft.rows.length <= 1) {
            Object.assign(draft.rows[0], { rate: "", hours: "", amount: "" });
            rateInput.value = ""; hoursInput.value = ""; flatInput.value = ""; recalc(); persist();
            return;
          }
          draft.rows.splice(index, 1);
          persist(); drawStep();
        } });

      const node = el("div", { class: "line-row", dataset: { line: String(index + 1) } }, [
        el("div", { class: "line-grid" }, [
          field("Rate type", rateSel),
          field("Rate per hour", rateInput),
          field("Hours", hoursInput),
          field("Charge one total instead of hours", modeToggle),
          field("Full amount", flatInput),
        ]),
        field("Description (shown on the invoice)", descInput),
        el("div", { class: "line-foot" }, [total, remove]),
      ]);
      controls.set(index, { service: rateSel, rate: rateInput, hours: hoursInput, amount: flatInput, description: descInput, node });
      // Only fill in a rate the owner has not already typed, so returning to this
      // step never overwrites their own figure.
      if (!String(row.rate ?? "").trim() && row.mode !== "flat") prefillRate();
      recalc();
      return node;
    }

    function drawRows() {
      linesBox.replaceChildren();
      if (!store.rates.length) store.rates = [{ key: "primary", label: "Primary School", rate_cents: "24000", active: "TRUE" }];
      // Rendered FROM draft.rows; the data is never cleared here, which is what
      // previously wiped the owner's work whenever they left this step.
      draft.rows.forEach((row, i) => linesBox.appendChild(renderRow(row, i)));
      updateGrandTotal();
    }

    const subtotalLine = el("span", { class: "preview-subtotal", text: I.formatMoney(0, "ZAR", symbol) });
    const discountLine = el("span", { class: "preview-discount", text: "" });
    const discountRow = el("div", { class: "preview-row hidden" }, [
      el("span", { class: "preview-label", text: "Discount" }), discountLine,
    ]);

    // ---- discount -------------------------------------------------------
    // Optional, and last: it applies to the sum of every line above it, so the
    // owner sets it after the rates and hours are in. Blank means no discount.
    const discountSelect = el("select", { "aria-label": "Discount type" }, [
      el("option", { value: "none", text: "No discount", selected: draft.discountType === "none" }),
      el("option", { value: "percent", text: "Percentage off (%)", selected: draft.discountType === "percent" }),
      el("option", { value: "amount", text: "Rand amount off", selected: draft.discountType === "amount" }),
    ]);
    const discountInput = el("input", {
      type: "text", inputmode: "decimal", value: draft.discountValue,
      placeholder: draft.discountType === "percent" ? "10" : "150.00",
      "aria-label": "Discount value",
      class: draft.discountType === "none" ? "hidden" : "",
    });
    const discountLabelNode = el("label", {
      for: "discount-value",
      text: draft.discountType === "percent" ? "Percentage off" : "Amount off",
    });
    discountInput.id = "discount-value";
    discountSelect.addEventListener("change", () => {
      draft.discountType = discountSelect.value;
      discountInput.className = draft.discountType === "none" ? "hidden" : "";
      discountInput.placeholder = draft.discountType === "percent" ? "10" : "150.00";
      discountLabelNode.textContent = draft.discountType === "percent" ? "Percentage off" : "Amount off";
      if (draft.discountType === "none") draft.discountValue = "";
      updateGrandTotal();
      persist();
    });
    discountInput.addEventListener("input", () => {
      draft.discountValue = discountInput.value;
      updateGrandTotal();
      persist();
    });
    const discountPanel = el("div", { class: "discount-panel" }, [
      field("Discount (optional)", discountSelect, "Applied to the total of every line above, never to a single line."),
      el("div", { class: "field" }, [discountLabelNode, discountInput]),
    ]);

    /**
     * Subtotal, then the discount if there is one, then what is actually due.
     * The discount always sits below the line items and below the subtotal - it
     * can never be mistaken for a line item, because it is applied to the sum of
     * everything above it.
     */
    function updateGrandTotal() {
      let subtotal = 0;
      for (const r of draft.rows) {
        try {
          subtotal += r.mode === "flat"
            ? M.parseMoneyToCents(r.amount || r.rate)
            : M.lineAmountCents(M.parseMoneyToCents(r.rate), M.parseHoursToMilli(r.hours));
        } catch (err) { /* skip unreadable rows */ }
      }
      const totals = I.invoiceTotals(
        [{ amount_cents: subtotal }],
        { discountType: draft.discountType, discountValue: draft.discountValue },
      );
      if (subtotalLine) subtotalLine.textContent = I.formatMoney(totals.subtotalCents, "ZAR", symbol);
      if (grandTotal) grandTotal.textContent = I.formatMoney(totals.totalCents, "ZAR", symbol);
      const hasDiscount = totals.discountCents > 0;
      discountRow.className = hasDiscount ? "preview-row" : "preview-row hidden";
      if (hasDiscount) {
        const label = I.discountLabel(draft.discountType, draft.discountValue, { symbol });
        discountLine.textContent = label
          ? `-${I.formatMoney(totals.discountCents, "ZAR", symbol)} (${label})`
          : `-${I.formatMoney(totals.discountCents, "ZAR", symbol)}`;
      }
    }

    function showErrors(errors) {
      errorsBox.replaceChildren();
      errorsBox.className = errors.length ? "" : "hidden";
      if (!errors.length) return;
      errorsBox.appendChild(el("ul", { class: "error-box", role: "alert" }, errors.map((e) => el("li", { text: e }))));
    }

    grandTotal = el("span", { class: "grand-total", text: I.formatMoney(0, "ZAR", symbol) });
    const preview = el("div", { class: "invoice-preview" }, [
      el("div", { class: "preview-row" }, [
        el("span", { class: "preview-label", text: "Subtotal" }), subtotalLine,
      ]),
      discountRow,
      el("div", { class: "preview-row preview-total" }, [
        el("span", { text: "Invoice total" }), grandTotal,
      ]),
    ]);

    box.appendChild(el("p", { class: "help", text: "Rate x hours makes a live total. Tick the box to charge one flat total instead. Add another rate for a second line." }));
    box.appendChild(errorsBox);
    box.appendChild(linesBox);
    box.appendChild(el("button", { type: "button", class: "btn secondary", text: "+ Add another rate",
      onClick: () => { draft.rows.push(blankRow(store)); persist(); drawStep(); } }));
    box.appendChild(discountPanel);
    box.appendChild(preview);
    box.appendChild(el("div", { class: "step-actions" }, [
      el("button", { type: "button", class: "btn secondary", text: "Back", onClick: () => goTo(1) }),
      el("button", { type: "button", class: "btn primary large", text: "Next", onClick: () => {
        // Checked HERE, while the fields are on screen, instead of only at the
        // end - so a missing rate is answered where the owner can see it.
        const check = checkLines();
        if (check.errors.length) { showErrors(check.errors); focusFirst(check.problems); return; }
        goTo(3);
      } }),
    ]));
    container.appendChild(box);
    drawRows();
    // Returning to this step after a failed save: show what was wrong at once.
    if (pendingErrors.length) {
      showErrors(pendingErrors);
      focusFirst(pendingProblems);
      pendingErrors = []; pendingProblems = [];
    }
  }

  let pendingErrors = [];
  let pendingProblems = [];

  function focusFirst(problems) {
    if (!problems || !problems.length) return;
    const first = problems[0];
    const c = controls.get(first.index);
    if (!c) return;
    const target = c[first.field] || c.rate;
    c.node.classList.add("field-error");
    if (target && target.focus) target.focus({ preventScroll: true });
    if (c.node.scrollIntoView) c.node.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /** Local pre-flight of the line rows, naming the row and the box to fill in. */
  function checkLines() {
    const errors = [];
    const problems = [];
    draft.rows.forEach((row, i) => {
      const label = `Line ${i + 1} (${row.description || labelFor(row.service)})`;
      if (row.mode === "flat") {
        if (String(row.amount ?? "").trim() === "" && String(row.rate ?? "").trim() === "") {
          errors.push(`${label}: type the total in the "Full amount" box.`);
          problems.push({ index: i, field: "amount" });
        }
        return;
      }
      if (String(row.rate ?? "").trim() === "") {
        errors.push(`${label}: type the hourly rate in the "Rate" box.`);
        problems.push({ index: i, field: "rate" });
      }
      if (String(row.hours ?? "").trim() === "") {
        errors.push(`${label}: type the number of hours in the "Hours" box.`);
        problems.push({ index: i, field: "hours" });
      }
    });
    return { errors, problems };
  }

  function labelFor(service) {
    return I.serviceLabel(store.rates.find((x) => x.key === service), service);
  }

  // ---- step 3 ------------------------------------------------------------
  function drawStepThree() {
    const box = el("section", { class: "step-panel" });
    const preview = I.nextNumberPreview(store.settings);

    const numberField = el("input", { type: "text", value: preview.text, readonly: true });
    const dateField = el("input", { type: "date", value: draft.invoiceDate || M.todayIso() });
    const termsDays = parseInt(store.settings.due_date_period_days || "7", 10) || 7;
    const dueField = el("input", { type: "date", value: draft.dueDate || M.addDays(dateField.value, termsDays) });
    dateField.addEventListener("change", () => {
      draft.invoiceDate = dateField.value;
      dueField.value = M.addDays(dateField.value, termsDays);
      draft.dueDate = dueField.value;
      persist();
    });
    dueField.addEventListener("change", () => { draft.dueDate = dueField.value; persist(); });

    const rememberBox = el("input", { type: "checkbox", checked: remember });
    rememberBox.addEventListener("change", () => { remember = rememberBox.checked; persist(); });

    const saveBtn = el("button", { class: "btn primary large", type: "submit", text: "Save invoice" });
    const pdfBtn = el("button", { class: "btn secondary", type: "button", text: "Preview & generate PDF",
      onClick: () => generate(true, pdfBtn) });

    box.appendChild(field("Invoice number", numberField, "Assigned automatically. A used number is never reused."));
    box.appendChild(field("Invoice date", dateField));
    box.appendChild(field("Due date", dueField));
    box.appendChild(field("Remember this rate for this parent", rememberBox, "Fills the price in next time. Never changes an existing invoice."));
    box.appendChild(el("div", { class: "step-actions" }, [
      el("button", { type: "button", class: "btn secondary", text: "Back", onClick: () => goTo(2) }),
      saveBtn, pdfBtn,
    ]));
    container.appendChild(box);
  }

  async function ensureParent() {
    if (selectedParent) {
      // The mobile number may have been filled in on this screen, so it is
      // written back before the invoice is made - the invoice freezes whatever
      // the parent record holds, so saving after generation would be too late.
      const typed = String(selectedParent.whatsapp || "").trim();
      const original = String((parents.find((p) => String(p.parent_id) === String(selectedParent.parent_id)) || {}).whatsapp || "").trim();
      if (typed !== original) {
        const saved = await S.saveParent(store, {
          parentId: selectedParent.parent_id,
          name: selectedParent.name, surname: selectedParent.surname,
          whatsapp: typed, email: selectedParent.email,
          defaultRateCents: Number.isFinite(parseInt(selectedParent.default_rate_cents, 10))
            ? parseInt(selectedParent.default_rate_cents, 10) : 0,
        });
        await store.reload();
        selectedParent = store.parents.find((p) => String(p.parent_id) === String(saved.parent_id));
      }
      return selectedParent.parent_id;
    }
    if (newParent) {
      const savedParent = await S.saveParent(store, { name: newParent.name, whatsapp: newParent.whatsapp || "" });
      await store.reload();
      selectedParent = store.parents.find((p) => String(p.parent_id) === String(savedParent.parent_id));
      return savedParent.parent_id;
    }
    throw new Error("Choose or create a parent first.");
  }

  function collectLines() {
    return draft.rows.map((r) => ({
      service: r.service, mode: r.mode,
      rate: r.rate, hours: r.hours, amount: r.amount,
      description: r.description,
    }));
  }

  async function generate(alsoPdf, button) {
    try {
      await withBusy(button, alsoPdf ? "Building the PDF\u2026" : "Saving\u2026", () => generateNow(alsoPdf));
    } catch (err) {
      // Honest failure: the user is told plainly and their input stays on screen.
      toast(errorMessage(err), "error");
    }
  }

  async function generateNow(alsoPdf) {
    const check = checkLines();
    if (check.errors.length) {
      pendingErrors = check.errors;
      pendingProblems = check.problems;
      // Send the owner to the step that holds the problem, with the field
      // marked, instead of leaving an un-actionable message on another screen.
      goTo(2);
      return;
    }
    const parentId = await ensureParent();
    const lineData = collectLines();
    const invoice = await S.createInvoice(store, {
      parentId, learnerId, lines: lineData,
      invoiceDate: dateFieldValue(),
      discountType: draft.discountType,
      discountValue: draft.discountValue,
    });
    if (remember) {
      try {
        await S.saveParent(store, { parentId, name: selectedParent.name, surname: selectedParent.surname,
          whatsapp: selectedParent.whatsapp, email: selectedParent.email,
          defaultRateCents: M.parseMoneyToCents(lineData[0].rate || "0") });
      } catch (err) { /* remembering a rate is best-effort */ }
    }
    await store.reload();
    clearInvoiceDraft();
    toast(`Invoice ${invoice.number_text} saved.`, "success");
    if (alsoPdf) {
      const fresh = store.invoices.find((i) => String(i.invoice_id) === String(invoice.invoice_id));
      const bytes = await buildInvoicePdf(fresh, { rates: store.rates });
      // The button says "Preview", so it must actually show the document. A
      // bare download looks like nothing happened on a phone, where the
      // download attribute is often ignored.
      viewDocument(bytes, I.invoiceFilename(fresh));
    }
    navigate("invoices");
  }

  function dateFieldValue() {
    const node = form.querySelector("input[type=date]");
    return node && node.value ? node.value : (draft.invoiceDate || M.todayIso());
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); generate(false, e.submitter || form.querySelector("button[type=submit]")); });
  drawStep();
  main.appendChild(form);
}

function blankRow(store) {
  const first = (store.rates || []).find((r) => String(r.active).toLowerCase() !== "false")
    || (store.rates || [])[0];
  return {
    service: (first && first.key) || "primary",
    mode: "hourly", rate: "", hours: "", amount: "",
    description: first ? (first.label || "") : "",
  };
}

function normaliseRow(row) {
  return {
    service: String(row.service || "primary"),
    mode: row.mode === "flat" ? "flat" : "hourly",
    rate: String(row.rate ?? ""),
    hours: String(row.hours ?? ""),
    amount: String(row.amount ?? ""),
    description: String(row.description ?? ""),
  };
}
