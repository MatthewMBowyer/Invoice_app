// Parents / Clients: search over name, learner name and phone, an
// Active/All/Archived filter, add/edit a parent, add a learner, per-learner
// edit and remove, and a parent detail view. A parent with financial history
// cannot be deleted.

import { el, field, toast, confirmDialog, emptyState } from "../ui.js";
import * as S from "../service.js";
import { state, navigate, errorMessage } from "../app.js";

export async function renderParents(main, { refresh }) {
  const store = state.store;
  const view = { q: "", status: "all" };

  const box = el("div", { class: "screen" });
  box.appendChild(el("div", { class: "screen-head" }, [
    el("h1", { text: "Parents" }),
    el("button", { class: "btn primary", text: "Add parent", onClick: () => editParent(null) }),
  ]));

  const search = el("input", { type: "search", placeholder: "Search name, learner or phone", "aria-label": "Search parents" });
  const filter = el("select", { "aria-label": "Show active, all or archived" });
  for (const v of [["active", "Active"], ["all", "All"], ["archived", "Archived"]]) filter.appendChild(el("option", { value: v[0], text: v[1] }));
  search.addEventListener("input", () => { view.q = search.value; draw(); });
  filter.addEventListener("change", () => { view.status = filter.value; draw(); });
  box.appendChild(el("div", { class: "filter-grid two" }, [field("Search", search), field("Show", filter)]));

  const list = el("div", { class: "parent-list" });
  box.appendChild(list);

  function learnersOf(id) {
    return store.learners.filter((l) => String(l.parent_id) === String(id));
  }

  function visible() {
    const needle = view.q.trim().toLowerCase();
    return store.parents.filter((p) => {
      const archived = String(p.archived).toLowerCase() === "true";
      const active = String(p.active).toLowerCase() !== "false";
      if (view.status === "active" && (!active || archived)) return false;
      if (view.status === "archived" && !archived) return false;
      if (!needle) return true;
      const kids = learnersOf(p.parent_id).map((l) => `${l.name} ${l.surname}`.toLowerCase()).join(" ");
      return `${p.name} ${p.surname}`.toLowerCase().includes(needle)
        || String(p.whatsapp || "").includes(needle)
        || kids.includes(needle);
    });
  }

  function draw() {
    list.replaceChildren();
    const rows = visible();
    if (!rows.length) {
      list.appendChild(emptyState("No parents yet", "Add your first parent to start invoicing."));
      return;
    }
    for (const p of rows) {
      const kids = learnersOf(p.parent_id);
      list.appendChild(el("div", { class: "parent-card" }, [
        el("div", { class: "parent-head" }, [
          el("strong", { text: `${p.name} ${p.surname}`.trim() }),
          el("span", { class: "help", text: p.whatsapp || "" }),
        ]),
        el("p", { class: "help", text: `${kids.length} learner${kids.length === 1 ? "" : "s"}` }),
        el("div", { class: "detail-actions" }, [
          el("button", { class: "btn secondary small", text: "Open", onClick: () => detail(p) }),
          el("button", { class: "btn secondary small", text: "Edit", onClick: () => editParent(p) }),
          el("button", { class: "btn secondary small", text: "Add learner", onClick: () => editLearner(p, null) }),
          el("button", { class: "btn danger small", text: "Delete", onClick: () => del(p) }),
        ]),
      ]));
    }
  }

  function detail(p) {
    const panel = el("div", { class: "detail-panel" });
    main.appendChild(panel);
    panel.appendChild(el("button", { class: "btn secondary small", text: "Close", onClick: () => panel.remove() }));
    panel.appendChild(el("h2", { text: `${p.name} ${p.surname}`.trim() }));
    panel.appendChild(el("p", { text: p.whatsapp || "No mobile number" }));
    if (p.email) panel.appendChild(el("p", { text: p.email }));
    const kids = learnersOf(p.parent_id);
    panel.appendChild(el("h3", { text: "Learners" }));
    if (!kids.length) panel.appendChild(el("p", { class: "help", text: "No learners yet." }));
    for (const l of kids) {
      panel.appendChild(el("div", { class: "learner-row" }, [
        el("span", { text: `${l.name} ${l.surname}`.trim() }),
        el("span", { class: "help", text: `${l.grade || ""} \u2022 ${l.school_level || ""}` }),
        el("button", { class: "btn secondary small", text: "Edit", onClick: () => editLearner(p, l) }),
        el("button", { class: "btn danger small", text: "Remove", onClick: async () => {
          try { await S.removeLearner(store, l.learner_id); await store.reload(); toast("Learner removed.", "success"); refresh(); }
          catch (err) { toast(errorMessage(err), "error"); }
        } }),
      ]));
    }
    const invs = store.invoices.filter((i) => String(i.parent_id) === String(p.parent_id));
    panel.appendChild(el("h3", { text: "Invoices" }));
    if (!invs.length) panel.appendChild(el("p", { class: "help", text: "No invoices yet." }));
    for (const i of invs) panel.appendChild(el("p", { text: `#${i.number_text} \u2022 ${i.status}` }));
    panel.scrollIntoView({ behavior: "smooth" });
  }

  function editParent(p) {
    const dlg = el("dialog", { class: "app-dialog" });
    const name = el("input", { type: "text", value: p ? p.name : "" });
    const surname = el("input", { type: "text", value: p ? p.surname : "" });
    const whatsapp = el("input", { type: "tel", value: p ? p.whatsapp : "" });
    const email = el("input", { type: "email", value: p ? p.email : "" });
    const notes = el("textarea", {}, [p ? p.notes || "" : ""]);
    dlg.appendChild(el("h2", { text: p ? "Edit parent" : "Add parent" }));
    dlg.appendChild(field("First name", name));
    dlg.appendChild(field("Surname", surname));
    dlg.appendChild(field("WhatsApp / mobile", whatsapp, "A South African mobile number such as 0821234567."));
    dlg.appendChild(field("Email", email));
    dlg.appendChild(field("Notes", notes));
    const error = el("p", { class: "error-text hidden" });
    dlg.appendChild(error);
    dlg.appendChild(el("div", { class: "dialog-actions" }, [
      el("button", { class: "btn secondary", text: "Cancel", onClick: () => dlg.close() }),
      el("button", { class: "btn primary", text: "Save", onClick: async () => {
        try {
          await S.saveParent(store, { parentId: p ? p.parent_id : null, name: name.value, surname: surname.value,
            whatsapp: whatsapp.value, email: email.value, notes: notes.value,
            defaultRateCents: p ? Number(p.default_rate_cents || 0) : 0 });
          await store.reload(); dlg.close(); toast("Parent saved.", "success"); refresh();
        } catch (err) {
          error.textContent = errorMessage(err); error.className = "error-text";
        }
      } }),
    ]));
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function editLearner(p, l) {
    const dlg = el("dialog", { class: "app-dialog" });
    const name = el("input", { type: "text", value: l ? l.name : "" });
    const surname = el("input", { type: "text", value: l ? l.surname : "" });
    const grade = el("input", { type: "text", value: l ? l.grade : "" });
    const level = el("select", {});
    for (const r of store.rates) level.appendChild(el("option", { value: r.key, text: r.label, selected: l && l.school_level === r.key }));
    const rate = el("input", { type: "text", value: l ? (Number(l.default_rate_cents) / 100).toFixed(2) : "" });
    dlg.appendChild(el("h2", { text: l ? "Edit learner" : `Add learner to ${p.name}` }));
    dlg.appendChild(field("Name", name));
    dlg.appendChild(field("Surname", surname));
    dlg.appendChild(field("Grade", grade, "Free text, e.g. Grade 4, Gr 4 or R."));
    dlg.appendChild(field("School level", level));
    dlg.appendChild(field("Default rate (per hour)", rate));
    dlg.appendChild(el("div", { class: "dialog-actions" }, [
      el("button", { class: "btn secondary", text: "Cancel", onClick: () => dlg.close() }),
      el("button", { class: "btn primary", text: "Save", onClick: async () => {
        try {
          await S.addLearner(store, { parentId: p.parent_id, learnerId: l ? l.learner_id : null,
            name: name.value, surname: surname.value, grade: grade.value, schoolLevel: level.value,
            defaultRateCents: Math.round(Number(rate.value || "0") * 100) });
          await store.reload(); dlg.close(); toast("Learner saved.", "success"); refresh();
        } catch (err) { toast(errorMessage(err), "error"); }
      } }),
    ]));
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  async function del(p) {
    const hasHistory = S.parentHasFinancialHistory(store, p.parent_id);
    if (hasHistory) {
      // The rule, not the mechanism: refuse with a plain message.
      await confirmDialog({
        title: "Cannot delete this parent",
        message: `${p.name} has invoices or lessons, so the record must be kept. Archive them instead.`,
        confirmText: "OK",
      });
      return;
    }
    const ok = await confirmDialog({ title: "Delete parent?", message: "This cannot be undone.", confirmText: "Delete", danger: true });
    if (!ok) return;
    try { await S.deleteParent(store, p.parent_id); await store.reload(); toast("Parent deleted.", "success"); refresh(); }
    catch (err) { toast(errorMessage(err), "error"); }
  }

  draw();
  main.appendChild(box);
  void navigate;
}
