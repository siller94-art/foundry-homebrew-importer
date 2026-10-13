import { importHomebrew, MODULE_ID } from "./importer.js";
import { parseText, toPayload } from "./parser.js";
import { HomebrewImporterApp } from "./app.js";

let app;
export function openImporter() {
  app ??= new HomebrewImporterApp();
  return app.render({ force: true });
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "lastTarget", { scope: "client", config: false, type: String, default: "world" });
  game.settings.register(MODULE_ID, "lastBook", { scope: "client", config: false, type: String, default: "Homebrew" });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
    open: openImporter,
    parseText,
    importText: (text, opts = {}) => importHomebrew(toPayload(parseText(text, opts), { book: opts.book ?? "Homebrew" }), opts),
    importHomebrew
  };
});

Hooks.on("renderItemDirectory", (dir, html) => {
  if (!game.user.hasPermission("ITEM_CREATE")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".hbi-open")) return;
  const header = root.querySelector(".header-actions") ?? root.querySelector(".directory-footer") ?? root.querySelector(".directory-header");
  if (!header) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hbi-open";
  btn.innerHTML = `<i class="fas fa-file-import"></i> Import Homebrew`;
  btn.addEventListener("click", ev => { ev.preventDefault(); openImporter(); });
  header.append(btn);
});
