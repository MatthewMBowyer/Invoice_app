// New Invoice — one short screen in three steps, exactly as specified:
//   1. Who is it for?  (type-ahead over saved parents; new parent reveals a
//      mobile-number box; the child picker is hidden for a new parent)
//   2. Rate and hours  (rate select with "+ Add a new rate"; hours or a flat
//      total; add/remove rows named after their own row)
//   3. Dates           (auto-assigned number, invoice date, due date; editable)
// "Remember this rate for this parent" saves the rate for next time.

import { el, field, toast, download } from "../ui.js";
import * as I from "../invoicing.js";
import * as M from "../money.js";
import * as S from "../service.js";
import { buildInvoicePdf } from "../pdf.js";
import { state, navigate, errorMessage } from "../app.js";

function rateKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export async function renderInvoiceNew(main) {
  const store = state.store;
  const symbol = store.settings.currency_symbol || "R";
  const parents = store.parents.filter((p) => String(p.archived).toLowerCase() !== "true");

  const form = el("form", { class: "screen invoice-form", novalidate: true });
  let step = 1;
  let selectedParent = null;
  let newParent = null;
  let learnerId = null;
  let remember = true;
  const rows = [];

  const container = el("div");
  form.appendChild(container);

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
    container.replaceChildren();
    container.appendChild(stepTabs());
    if (step === 1) drawStepOne();
    else if (step === 2) drawStepTwo();
    else drawStepThree();
  }

  function stepTabs() {
    const mk = (n, label) => el("button", {
      type: "button", class: `step-tab${step === n ? " active" : ""}`,
      onClick: () => { if (n < step || canAdvance(n - 1)) { step = n; drawStep(); } },
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
    const input = el("input", { type: "search", placeholder: "Start typing a parent's name\u2026", autocomplete: "off" });
    const results = el("div", { class: "typeahead" });
    const details = el("div", { class: "parent-details" });
    const mobileWrap = el("div", { class: "hidden" });

    function renderDetails() {
      details.replaceChildren();
      mobileWrap.replaceChildren();
      mobileWrap.className = "hidden";
      if (selectedParent) {
        details.appendChild(el("p", { class: "picked", text: `Picked: ${selectedParent.name} ${selectedParent.surname}`.trim() }));
        const kids = store.learners.filter((l) => String(l.parent_id) === String(selectedParent.parent_id));
        if (kids.length) {
          const sel = el("select", { class: "child-picker", "aria-label": "Learner (optional)" });
          sel.appendChild(el("option", { value: "", text: "No specific learner" }));
          for (const k of kids) sel.appendChild(el("option", { value: String(k.learner_id), text: `${k.name} ${k.surname}`.trim() }));
          sel.value = learnerId || "";
          sel.addEventListener("change", () => { learnerId = sel.value || null; drawStepTwoPreview(); });
          details.appendChild(field("Child (optional)", sel, "Leave blank if the invoice is for the parent."));
        } else {
          details.appendChild(el("p", { class: "help", text: "This parent has no saved learners yet." }));
        }
      } else if (newParent) {
        mobileWrap.className = "";
        const mob = el("input", { type: "tel", placeholder: "0821234567", value: newParent.whatsapp || "" });
        mob.addEventListener("input", () => { newParent.whatsapp = mob.value; });
        mobileWrap.appendChild(field("Mobile number", mob, "Needed so the invoice can be shared on WhatsApp later."));
        details.appendChild(el("p", { class: "picked", text: `New parent: ${newParent.name}` }));
      }
    }
    function drawStepTwoPreview() { /* learner change only affects the next step */ }

    input.addEventListener("input", () => {
      const q = input.value;
      results.replaceChildren();
      selectedParent = null; newParent = null;
      if (q.trim()) {
        const matches = parentMatches(q);
        for (const p of matches) {
          results.appendChild(el("button", {
            type: "button", class: "typeahead-item",
            onClick: () => { selectedParent = p; input.value = `${p.name} ${p.surname}`.trim(); results.replaceChildren(); renderDetails(); nextBtn.disabled = false; },
          }, [el("strong", { text: `${p.name} ${p.surname}`.trim() }), el("span", { text: p.whatsapp || "" })]));
        }
        results.appendChild(el("button", {
          type: "button", class: "typeahead-item new",
          onClick: () => { newParent = { name: q.trim(), whatsapp: "" }; selectedParent = null; results.replaceChildren(); renderDetails(); nextBtn.disabled = false; },
        }, [`Create new parent "${q.trim()}"`]));
      }
      nextBtn.disabled = !(selectedParent || newParent);
    });

    box.appendChild(field("Who is it for?", input, "Pick a saved parent, or type a new name to save one with this invoice."));
    box.appendChild(results);
    box.appendChild(details);
    box.appendChild(mobileWrap);

    const nextBtn = el("button", { type: "button", class: "btn primary large", text: "Next", disabled: true,
      onClick: () => { if (canAdvance(1)) { step = 2; drawStep(); } } });
    box.appendChild(el("div", { class: "step-actions" }, [nextBtn]));
    container.appendChild(box);
  }

  // ---- step 2 ------------------------------------------------------------
  function drawStepTwo() {
    const box = el("section", { class: "step-panel" });
    const linesBox = el("div", { class: "lines" });

    function rateOptions(selectedKey) {
      const sel = el("select", { class: "rate-select", "aria-label": "Rate" });
      for (const r of store.rates.filter((r) => String(r.active).toLowerCase() !== "false")) {
        sel.appendChild(el("option", { value: r.key, text: `${r.label} (${I.formatMoney(Number(r.rate_cents))}/hour)`, selected: r.key === selectedKey }));
      }
      sel.appendChild(el("option", { value: "__new__", text: "+ Add a new rate" }));
      return sel;
    }

    function addRow(prefill = {}) {
      const row = { service: prefill.service || (store.rates[0] && store.rates[0].key) || "primary",
        mode: "hourly", rate: prefill.rate || "", hours: prefill.hours || "", amount: "" };
      const idx = rows.length + 1;
      const rateSel = rateOptions(row.service);
      const rateInput = el("input", { type: "text", inputmode: "decimal", value: row.rate, "aria-label": `Rate for line ${idx}` });
      const hoursInput = el("input", { type: "text", inputmode: "decimal", value: row.hours, "aria-label": `Hours for line ${idx}` });
      const flatInput = el("input", { type: "text", inputmode: "decimal", value: row.amount, "aria-label": `Full amount for line ${idx}`, class: "hidden" });
      const modeToggle = el("input", { type: "checkbox", "aria-label": `Charge one total for line ${idx}` });
      const total = el("span", { class: "line-total", text: I.formatMoney(0, "ZAR", symbol) });

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
          recalc();
          return;
        }
        row.service = rateSel.value;
        const r = store.rates.find((x) => x.key === rateSel.value);
        if (r && row.mode === "hourly") { rateInput.value = M.formatMoneyPlain(Number(r.rate_cents)); row.rate = rateInput.value; }
        recalc();
      });
      rateInput.addEventListener("input", () => { row.rate = rateInput.value; recalc(); });
      hoursInput.addEventListener("input", () => { row.hours = hoursInput.value; recalc(); });
      flatInput.addEventListener("input", () => { row.amount = flatInput.value; recalc(); });
      modeToggle.addEventListener("change", () => {
        row.mode = modeToggle.checked ? "flat" : "hourly";
        hoursInput.classList.toggle("hidden", modeToggle.checked);
        flatInput.classList.toggle("hidden", !modeToggle.checked);
        recalc();
      });

      const remove = el("button", { type: "button", class: "btn danger small", text: `Remove line ${idx}`,
        onClick: () => {
          if (rows.length <= 1) { rateInput.value = ""; hoursInput.value = ""; flatInput.value = ""; recalc(); return; }
          const at = rows.indexOf(row); rows.splice(at, 1); drawRows();
        } });

      const node = el("div", { class: "line-row" }, [
        el("div", { class: "line-grid" }, [
          field("Rate", rateSel),
          field("Hours", hoursInput),
          field("Charge one total instead of hours", modeToggle),
          field("Full amount", flatInput),
        ]),
        el("div", { class: "line-foot" }, [total, remove]),
      ]);
      row.node = node; row.recalc = recalc; rows.push(row);
      return node;
    }

    function drawRows() {
      linesBox.replaceChildren();
      rows.length = 0;
      if (!store.rates.length) store.rates = [{ key: "primary", label: "Primary School", rate_cents: "24000", active: "TRUE" }];
      linesBox.appendChild(addRow());
      updateGrandTotal();
    }

    function updateGrandTotal() {
      let total = 0;
      for (const r of rows) {
        try {
          total += r.mode === "flat"
            ? M.parseMoneyToCents(r.amount || r.rate)
            : M.lineAmountCents(M.parseMoneyToCents(r.rate), M.parseHoursToMilli(r.hours));
        } catch (err) { /* skip unreadable rows */ }
      }
      if (grandTotal) grandTotal.textContent = I.formatMoney(total, "ZAR", symbol);
    }

    const grandTotal = el("span", { class: "grand-total", text: I.formatMoney(0, "ZAR", symbol) });
    const preview = el("div", { class: "invoice-preview" }, [
      el("span", { text: "Invoice total" }), grandTotal,
    ]);

    box.appendChild(el("p", { class: "help", text: "Rate x hours makes a live total. Tick the box to charge one flat total instead. Add another rate for a second line." }));
    box.appendChild(linesBox);
    box.appendChild(el("button", { type: "button", class: "btn secondary", text: "+ Add another rate",
      onClick: () => { linesBox.appendChild(addRow()); updateGrandTotal(); } }));
    box.appendChild(preview);
    box.appendChild(el("div", { class: "step-actions" }, [
      el("button", { type: "button", class: "btn secondary", text: "Back", onClick: () => { step = 1; drawStep(); } }),
      el("button", { type: "button", class: "btn primary large", text: "Next", onClick: () => { step = 3; drawStep(); } }),
    ]));
    container.appendChild(box);
    drawRows();
  }

  // ---- step 3 ------------------------------------------------------------
  function drawStepThree() {
    const box = el("section", { class: "step-panel" });
    const preview = I.nextNumberPreview(store.settings);

    const numberField = el("input", { type: "text", value: preview.text, readonly: true });
    const dateField = el("input", { type: "date", value: M.todayIso() });
    const termsDays = parseInt(store.settings.due_date_period_days || "7", 10) || 7;
    const dueField = el("input", { type: "date", value: M.addDays(M.todayIso(), termsDays) });
    dateField.addEventListener("change", () => { dueField.value = M.addDays(dateField.value, termsDays); });

    const rememberBox = el("input", { type: "checkbox", checked: true });
    rememberBox.addEventListener("change", () => { remember = rememberBox.checked; });

    const saveBtn = el("button", { class: "btn primary large", type: "submit", text: "Save invoice" });
    const pdfBtn = el("button", { class: "btn secondary", type: "button", text: "Preview & generate PDF",
      onClick: () => generate(true) });

    box.appendChild(field("Invoice number", numberField, "Assigned automatically. A used number is never reused."));
    box.appendChild(field("Invoice date", dateField));
    box.appendChild(field("Due date", dueField));
    box.appendChild(field("Remember this rate for this parent", rememberBox, "Fills the price in next time. Never changes an existing invoice."));
    box.appendChild(el("div", { class: "step-actions" }, [
      el("button", { type: "button", class: "btn secondary", text: "Back", onClick: () => { step = 2; drawStep(); } }),
      saveBtn, pdfBtn,
    ]));
    container.appendChild(box);
  }

  async function ensureParent() {
    if (selectedParent) return selectedParent.parent_id;
    if (newParent) {
      const saved = await S.saveParent(store, { name: newParent.name, whatsapp: newParent.whatsapp || "" });
      await store.reload();
      selectedParent = store.parents.find((p) => String(p.parent_id) === String(saved.parent_id));
      return saved.parent_id;
    }
    throw new Error("Choose or create a parent first.");
  }

  function collectLines() {
    return rows.map((r) => ({
      service: r.service, mode: r.mode,
      rate: r.rate, hours: r.hours, amount: r.amount,
    }));
  }

  async function generate(alsoPdf) {
    const saveBtn = form.querySelector('button[type="submit"]');
    try {
      const parentId = await ensureParent();
      const lineData = collectLines();
      const invoice = await S.createInvoice(store, {
        parentId, learnerId, lines: lineData,
        invoiceDate: form.querySelector("input[type=date]").value,
      });
      if (remember) {
        try {
          await S.saveParent(store, { parentId, name: selectedParent.name, surname: selectedParent.surname,
            whatsapp: selectedParent.whatsapp, email: selectedParent.email,
            defaultRateCents: M.parseMoneyToCents(lineData[0].rate || "0") });
        } catch (err) { /* remembering a rate is best-effort */ }
      }
      await store.reload();
      toast(`Invoice ${invoice.number_text} saved.`, "success");
      if (alsoPdf) {
        const fresh = store.invoices.find((i) => String(i.invoice_id) === String(invoice.invoice_id));
        const bytes = await buildInvoicePdf(fresh);
        download(I.invoiceFilename(fresh), bytes, "application/pdf");
      }
      navigate("invoices");
    } catch (err) {
      // Honest failure: the user is told plainly and their input stays on screen.
      toast(errorMessage(err), "error");
      void saveBtn;
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); generate(false); });
  drawStep();
  main.appendChild(form);
}
