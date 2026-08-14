/** Application bootstrap: shell, theme, i18n, router, shortcuts, offline. */
import { openDB, db } from "./database.js";
import { loadAll, state, subscribe, saveSetting, get } from "./state.js";
import { setLang, t, LANGS, getLang } from "./i18n.js";
import { ensureSeeded } from "./seed.js";
import * as router from "./router.js";
import * as V from "./modules/views.js";
import { runExpiryScan } from "./modules/domain.js";
import { esc, debounce } from "./utils/format.js";
import * as UI from "./components/ui.js";

const NAV = [
  { group: "nav_main", items: [["/dashboard", "dashboard", "🏠"], ["/analytics", "analytics", "📈"], ["/reports", "reports", "📄"]] },
  { group: "nav_catalog", items: [["/products", "products", "🧴"], ["/categories", "categories", "🏷"], ["/inventory", "inventory", "📦"], ["/batches", "batches", "🧪"]] },
  { group: "nav_operations", items: [["/purchases", "purchases", "🚚"], ["/sales", "sales", "🧾"], ["/movements", "movements", "🔁"], ["/expiry", "expiry", "⏳"]] },
  { group: "nav_insights", items: [["/suppliers", "suppliers", "🏭"], ["/customers", "customers", "👥"]] },
  { group: "nav_system", items: [["/notifications", "notifications", "🔔"], ["/activity", "activity", "🗂"], ["/settings", "settings", "⚙️"]] },
];

const MOBILE_NAV = [["/dashboard", "dashboard", "🏠"], ["/products", "products", "🧴"], ["/sales", "sales", "🧾"], ["/inventory", "inventory", "📦"], ["/settings", "settings", "⚙️"]];

function applyTheme() {
  const pref = state.settings.theme || "system";
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);
}

function renderShell() {
  const unread = get("notifications").filter((n) => !n.read).length;
  document.getElementById("app").innerHTML = `
    <aside class="sidebar" id="sidebar" aria-label="${t("nav_main")}">
      <div class="brand"><span class="brand-logo" aria-hidden="true">NC</span>
        <span class="brand-text"><span class="brand-name">${esc(t("app_name"))}</span><br><span class="brand-sub">${esc(t("app_sub"))}</span></span></div>
      <nav class="nav">${NAV.map(
        (g) => `<div class="nav-group-title">${t(g.group)}</div>${g.items
          .map(([path, key, icon]) => `<a class="nav-link" data-route="${path}" href="#${path}"><span class="ic" aria-hidden="true">${icon}</span><span class="lbl">${t(key)}</span>${
            path === "/notifications" && unread ? `<span class="count">${unread}</span>` : ""
          }</a>`)
          .join("")}`,
      ).join("")}</nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn" id="menu-btn" aria-label="${t("nav_main")}">☰</button>
        <div class="search"><span class="sic" aria-hidden="true">🔍</span>
          <input class="search-input" id="global-search" type="search" placeholder="${esc(t("search_placeholder"))}" aria-label="${t("search")}" role="combobox" aria-expanded="false">
          <div class="search-results" id="search-results" role="listbox"></div></div>
        <span style="flex:1"></span>
        <select class="select" id="lang-select" aria-label="${t("lang")}" style="width:auto">${LANGS.map((l) => `<option value="${l.code}" ${getLang() === l.code ? "selected" : ""}>${l.label}</option>`).join("")}</select>
        <button class="icon-btn tip" id="theme-btn" data-tip="${t("theme")}" aria-label="${t("theme")}">${document.documentElement.dataset.theme === "dark" ? "🌙" : "☀️"}</button>
        <a class="icon-btn tip" data-tip="${t("notifications")}" href="#/notifications" aria-label="${t("notifications")}">🔔${unread ? `<span class="dot">${unread}</span>` : ""}</a>
      </header>
      <main class="view" id="view" tabindex="-1"></main>
      <nav class="bottom-nav" aria-label="${t("nav_main")}">${MOBILE_NAV.map(([path, key, icon]) => `<a data-route="${path}" href="#${path}"><span class="ic">${icon}</span>${t(key)}</a>`).join("")}</nav>
    </div>`;

  const sidebar = document.getElementById("sidebar");
  document.getElementById("menu-btn").addEventListener("click", () => {
    if (window.innerWidth <= 760) {
      sidebar.classList.toggle("open");
      document.getElementById("backdrop").classList.toggle("show", sidebar.classList.contains("open"));
    } else document.getElementById("app").classList.toggle("rail-open");
  });
  document.getElementById("backdrop").addEventListener("click", () => {
    sidebar.classList.remove("open");
    document.getElementById("backdrop").classList.remove("show");
  });
  document.querySelectorAll(".nav-link, .bottom-nav a").forEach((a) =>
    a.addEventListener("click", () => {
      sidebar.classList.remove("open");
      document.getElementById("backdrop").classList.remove("show");
    }),
  );
  document.getElementById("theme-btn").addEventListener("click", async () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    await saveSetting("theme", next);
    applyTheme();
    renderShell();
    router.resolve();
  });
  document.getElementById("lang-select").addEventListener("change", async (e) => {
    await saveSetting("language", e.target.value);
    setLang(e.target.value);
    renderShell();
    router.resolve();
  });

  const input = document.getElementById("global-search");
  const results = document.getElementById("search-results");
  const runSearch = debounce(() => {
    const groups = V.globalSearch(input.value);
    results.innerHTML = groups.length
      ? groups
          .map((g) => `<div class="res-group">${esc(g.label)}</div>${g.items.map((i) => `<button class="res-item" data-go="${i.route}"><span>${esc(i.label)}</span><span class="stat-hint">${esc(i.hint || "")}</span></button>`).join("")}`)
          .join("")
      : `<div class="res-group">${t("empty_title")}</div>`;
    results.classList.toggle("show", Boolean(input.value.trim()));
    input.setAttribute("aria-expanded", String(Boolean(input.value.trim())));
    results.querySelectorAll("[data-go]").forEach((b) =>
      b.addEventListener("click", () => {
        results.classList.remove("show");
        input.value = "";
        router.navigate(b.dataset.go);
      }),
    );
  }, 200);
  input.addEventListener("input", runSearch);
  input.addEventListener("blur", () => setTimeout(() => results.classList.remove("show"), 180));
  document.querySelectorAll("[data-route]").forEach((el) => el.classList.toggle("active", el.dataset.route === router.currentPath()));
}

function wireGlobalDelegates() {
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) router.navigate(nav.dataset.nav);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.getElementById("global-search")?.focus();
    }
    if (e.key === "Escape") {
      if (document.getElementById("modal-root").classList.contains("show")) UI.closeModal();
      document.getElementById("search-results")?.classList.remove("show");
    }
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  window.addEventListener("online", () => UI.toast(t("offline_ready")));
}

function registerRoutes() {
  router.register("/dashboard", V.dashboard);
  router.register("/products", V.products);
  router.register("/categories", V.categories);
  router.register("/inventory", V.inventory);
  router.register("/movements", V.movements);
  router.register("/batches", V.batches);
  router.register("/expiry", V.expiry);
  router.register("/suppliers", V.suppliers);
  router.register("/customers", V.customers);
  router.register("/purchases", V.purchases);
  router.register("/sales", V.sales);
  router.register("/reports", V.reports);
  router.register("/analytics", V.analytics);
  router.register("/notifications", V.notifications);
  router.register("/activity", V.activity);
  router.register("/settings", V.settings);
  router.setNotFound((route, view) => {
    view.innerHTML = `<div class="card"><div class="card-body">${UI.emptyState("404", route.raw, "🧭")}</div></div>`;
  });
}

async function boot() {
  try {
    await openDB();
    await ensureSeeded();
    await loadAll();
    setLang(state.settings.language || "ar");
    applyTheme();
    registerRoutes();
    renderShell();
    wireGlobalDelegates();
    await router.start();
    await runExpiryScan();
    subscribe((reason) => {
      if (reason === "reload" || reason === "settings") {
        const unreadBadge = document.querySelector('a[href="#/notifications"] .dot');
        const unread = get("notifications").filter((n) => !n.read).length;
        if (unreadBadge) {
          unreadBadge.textContent = unread || "";
          unreadBadge.style.display = unread ? "grid" : "none";
        }
      }
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    }
    await db.setSetting("lastOpenedAt", new Date().toISOString());
  } catch (error) {
    console.error(error);
    document.getElementById("app").innerHTML = `<div style="padding:40px"><h1>${t("error")}</h1><p>${esc(error.message)}</p></div>`;
  }
}

boot();
