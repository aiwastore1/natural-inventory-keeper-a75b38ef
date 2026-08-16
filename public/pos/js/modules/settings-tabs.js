/** Settings shell with tabs: #/settings, #/settings/account, /general, /import-export */
import { t } from "../i18n.js";
import * as V from "./views.js";
import { accountSettings } from "./accountSettings.js";
import { generalSettings } from "./generalSettings.js";
import { importExport } from "./importExport.js";

const TABS = [
  ["", "settings_core"],
  ["account", "account"],
  ["general", "general_settings"],
  ["import-export", "import_export"],
];

export async function settingsShell(route, view) {
  const tab = route.param || "";
  view.innerHTML = `<div class="tabs" role="tablist">${TABS.map(
    ([key, label]) =>
      `<a class="tab ${tab === key ? "active" : ""}" role="tab" aria-selected="${tab === key}" href="#/settings${key ? `/${key}` : ""}">${t(label)}</a>`,
  ).join("")}</div><div id="settings-pane"></div>`;
  const pane = view.querySelector("#settings-pane");
  if (tab === "account") return accountSettings(route, pane);
  if (tab === "general") return generalSettings(route, pane);
  if (tab === "import-export") return importExport(route, pane);
  return V.settings(route, pane);
}
