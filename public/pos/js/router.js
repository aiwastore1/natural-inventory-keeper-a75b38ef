/** Minimal hash router with parameter support (#/products/prd_1). */
const routes = new Map();
let notFound = null;
let current = "";

export function register(path, handler) {
  routes.set(path, handler);
}

export function setNotFound(handler) {
  notFound = handler;
}

export function parseHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/dashboard";
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ""));
  return { path: `/${segments[0] || "dashboard"}`, segments, param: segments[1] || null, query, raw };
}

export function navigate(path) {
  const target = path.startsWith("#") ? path : `#${path}`;
  if (window.location.hash === target) resolve();
  else window.location.hash = target;
}

export function currentPath() {
  return current;
}

export async function resolve() {
  const route = parseHash();
  current = route.path;
  const handler = routes.get(route.path) || notFound;
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route.path);
    if (el.tagName === "A") el.setAttribute("aria-current", el.dataset.route === route.path ? "page" : "false");
  });
  const view = document.getElementById("view");
  view.setAttribute("aria-busy", "true");
  try {
    await handler(route, view);
  } catch (error) {
    console.error(error);
    view.innerHTML = `<div class="card"><div class="card-body"><h2>⚠️ ${error.message}</h2></div></div>`;
  }
  view.setAttribute("aria-busy", "false");
  window.scrollTo({ top: 0 });
}

export function start() {
  window.addEventListener("hashchange", resolve);
  return resolve();
}
