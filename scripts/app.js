import { importHomebrew, escapeHTML, MODULE_ID } from "./importer.js";
import { parseText, toPayload } from "./parser.js";

const { ApplicationV2 } = foundry.applications.api;

const KIND_LABEL = { spell: "Spell", species: "Species", class: "Class", subclass: "Subclass", feat: "Feat" };
const KIND_ICON = { spell: "fa-wand-sparkles", species: "fa-person", class: "fa-shield-halved", subclass: "fa-code-branch", feat: "fa-star" };

const PLACEHOLDER = `Paste spells, species, classes, subclasses or feats here — straight from a PDF, website or Homebrewery.

Fireball
3rd-level evocation
Casting Time: 1 action
Range: 150 feet
Components: V, S, M (a tiny ball of bat guano and sulfur)
Duration: Instantaneous
...

Separate different entries with a line of ---  (several spells in a row split automatically)`;

export class HomebrewImporterApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "homebrew-importer-app",
    classes: ["hbi-app"],
    tag: "div",
    window: { title: "Import Homebrew", icon: "fas fa-file-import", resizable: true },
    position: { width: 980, height: 720 },
    actions: {
      parse: function () { this.parse(); },
      openFile: function () { this.element.querySelector("input[name=file]").click(); },
      import: function () { this.runImport(); },
      clear: function () { this.clear(); }
    }
  };

  results = [];
  jsonEdited = false;
  #timer = null;

  async _renderHTML() {
    const last = game.settings.get(MODULE_ID, "lastTarget");
    const packs = game.packs.filter(p => p.documentName === "Item" && !p.locked);
    const dest = [`<option value="world">World items</option>`,
      ...packs.map(p => `<option value="${p.collection}" ${p.collection === last ? "selected" : ""}>${escapeHTML(p.title)}</option>`)].join("");
    const opt = (v, l) => `<option value="${v}">${l}</option>`;

    const div = document.createElement("div");
    div.className = "hbi-body";
    div.innerHTML = `
      <section class="hbi-pane hbi-source">
        <div class="hbi-toolbar">
          <select name="type" title="Content type">${opt("auto", "Auto-detect")}${Object.entries(KIND_LABEL).map(([k, l]) => opt(k, l)).join("")}</select>
          <select name="rules" title="Rules edition">${opt("auto", "Edition: auto")}${opt("2024", "2024 (5.5e)")}${opt("2014", "2014 (5e)")}</select>
          <input type="text" name="className" placeholder="Parent class (subclasses)">
        </div>
        <textarea name="source" spellcheck="false" placeholder="${escapeHTML(PLACEHOLDER)}"></textarea>
        <div class="hbi-toolbar">
          <label class="hbi-check"><input type="checkbox" name="auto" checked> Auto parse</label>
          <span class="hbi-spacer"></span>
          <button type="button" data-action="clear"><i class="fas fa-eraser"></i> Clear</button>
          <button type="button" data-action="openFile"><i class="fas fa-folder-open"></i> Open file</button>
          <button type="button" data-action="parse"><i class="fas fa-magnifying-glass"></i> Parse</button>
          <input type="file" name="file" accept=".txt,.md,.json,.markdown,text/plain,application/json" hidden>
        </div>
      </section>
      <section class="hbi-pane hbi-result">
        <div class="hbi-preview"><p class="hbi-empty">Paste something on the left and press Parse. Each entry shows what was found before anything is created.</p></div>
        <details class="hbi-json"><summary>Edit parsed data</summary><textarea name="json" spellcheck="false"></textarea>
          <p class="hint">Changes here are used on import. Parsing again replaces them.</p></details>
        <div class="hbi-footer">
          <label>Source book <input type="text" name="book" value="${escapeHTML(game.settings.get(MODULE_ID, "lastBook"))}"></label>
          <label>Import into <select name="target">${dest}</select></label>
          <label class="hbi-check" title="Overwrite items this module imported before (matched by type, name and edition)"><input type="checkbox" name="update" checked> Update existing</label>
          <button type="button" data-action="import" class="hbi-import" disabled><i class="fas fa-file-import"></i> Import</button>
        </div>
      </section>`;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender() {
    const el = this.element;
    const src = el.querySelector("textarea[name=source]");
    const schedule = () => {
      if (!el.querySelector("input[name=auto]").checked) return;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.parse(), 350);
    };
    src.addEventListener("input", schedule);
    for (const n of ["type", "rules", "className"]) el.querySelector(`[name=${n}]`).addEventListener("change", schedule);
    el.querySelector("textarea[name=json]").addEventListener("input", () => { this.jsonEdited = true; });
    el.querySelector("input[name=file]").addEventListener("change", async ev => {
      const f = ev.target.files[0];
      if (!f) return;
      src.value = await f.text();
      ev.target.value = "";
      this.parse();
    });
  }

  get #fields() {
    const q = n => this.element.querySelector(`[name=${n}]`);
    return {
      source: q("source").value, type: q("type").value, rules: q("rules").value, className: q("className").value.trim(),
      book: q("book").value.trim() || "Homebrew", target: q("target").value, update: q("update").checked
    };
  }

  clear() {
    this.element.querySelector("textarea[name=source]").value = "";
    this.results = [];
    this.#show(null);
  }

  parse() {
    const f = this.#fields;
    const text = f.source.trim();
    if (!text) return this.#show(null);

    // Raw JSON (the importer's own format) skips the text parser.
    if (/^[[{]/.test(text)) {
      try {
        const data = JSON.parse(text);
        this.results = [];
        return this.#show(data, `<p class="hbi-empty">JSON detected: it will be imported as written.</p>`);
      } catch (err) {
        return this.#show(null, `<p class="hbi-warn">Looks like JSON but couldn't be read: ${escapeHTML(err.message)}</p>`);
      }
    }

    this.results = parseText(text, { type: f.type, rules: f.rules, className: f.className });
    this.#show(toPayload(this.results, { book: f.book }));
  }

  #show(payload, message) {
    const el = this.element;
    const preview = el.querySelector(".hbi-preview");
    const json = el.querySelector("textarea[name=json]");
    const btn = el.querySelector(".hbi-import");
    this.jsonEdited = false;
    json.value = payload ? JSON.stringify(payload, null, 2) : "";
    const ok = this.results.filter(r => r.kind).length;
    btn.disabled = !payload || (!ok && !message);
    btn.innerHTML = `<i class="fas fa-file-import"></i> Import${ok ? ` ${ok}` : ""}`;

    if (message) { preview.innerHTML = message; return; }
    if (!this.results.length) {
      preview.innerHTML = `<p class="hbi-empty">Paste something on the left and press Parse. Each entry shows what was found before anything is created.</p>`;
      return;
    }
    preview.innerHTML = this.results.map(r => `
      <article class="hbi-card ${r.kind ? "" : "hbi-bad"}">
        <header>
          <i class="fas ${KIND_ICON[r.kind] ?? "fa-circle-question"}"></i>
          <strong>${escapeHTML(r.data?.name ?? "Unknown")}</strong>
          <span class="hbi-badge">${KIND_LABEL[r.kind] ?? "Not recognised"}</span>
          ${r.rules ? `<span class="hbi-badge hbi-rules">${r.rules}</span>` : ""}
        </header>
        ${r.found.length ? `<ul class="hbi-found">${r.found.map(x => `<li><i class="fas fa-check"></i>${escapeHTML(x)}</li>`).join("")}</ul>` : ""}
        ${r.warnings.length ? `<ul class="hbi-warnings">${r.warnings.map(x => `<li><i class="fas fa-triangle-exclamation"></i>${escapeHTML(x)}</li>`).join("")}</ul>` : ""}
        ${r.data?.features?.length ? `<p class="hbi-features">${r.data.features.map(ft => `${ft.level != null ? `<span class="hbi-lvl">${ft.level}</span>` : ""}${escapeHTML(ft.name)}`).join(" · ")}</p>` : ""}
      </article>`).join("");
  }

  async runImport() {
    const f = this.#fields;
    const jsonText = this.element.querySelector("textarea[name=json]").value;
    let payload;
    try { payload = JSON.parse(jsonText); } catch (err) {
      return ui.notifications.error(`The parsed data isn't valid JSON: ${err.message}`);
    }
    if (!Array.isArray(payload)) {
      payload.source ??= {};
      payload.source.book = f.book;
    }
    await game.settings.set(MODULE_ID, "lastTarget", f.target);
    await game.settings.set(MODULE_ID, "lastBook", f.book);

    const btn = this.element.querySelector(".hbi-import");
    btn.disabled = true;
    let report;
    try {
      report = await importHomebrew(payload, { target: f.target, update: f.update });
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      return ui.notifications.error(`Import failed: ${err.message}`);
    }
    btn.disabled = false;

    const msg = `Created ${report.created}, updated ${report.updated}, skipped ${report.skipped}.`;
    if (report.errors.length) {
      ui.notifications.warn(`${msg} ${report.errors.length} error(s) — see the list in the window.`);
      this.element.querySelector(".hbi-preview").insertAdjacentHTML("afterbegin",
        `<article class="hbi-card hbi-bad"><header><strong>Import finished with errors</strong></header><ul class="hbi-warnings">${report.errors.map(e => `<li>${escapeHTML(e)}</li>`).join("")}</ul></article>`);
    } else {
      ui.notifications.info(`Homebrew imported. ${msg}`);
    }
  }
}
