/**
 * Account settings tab (#/settings/account) — username + password change.
 * Passwords are never stored in plain text: SHA-256 with a per-user salt.
 */
import { db, uid, logActivity } from "../database.js";
import { get, reload, state } from "../state.js";
import { t } from "../i18n.js";
import { esc } from "../utils/format.js";
import * as UI from "../components/ui.js";
import { hashPassword, verifyPassword } from "../utils/hash.js";

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin123";

export function currentUser() {
  const users = get("users");
  const activeId = state.settings.activeUserId;
  return users.find((u) => u.id === activeId) || users[0] || null;
}

/** Creates the default admin account on first run. */
export async function ensureDefaultUser() {
  if (get("users").length) return currentUser();
  const { salt, hash } = await hashPassword(DEFAULT_PASSWORD);
  const user = { id: uid("usr"), username: DEFAULT_USERNAME, salt, hash, role: "admin", createdAt: new Date().toISOString() };
  await db.put("users", user);
  await reload("users");
  return user;
}

export async function updateAccount({ currentPassword, newUsername, newPassword, confirmPassword }) {
  const user = currentUser();
  if (!user) throw new Error(t("no_account"));
  if (!currentPassword) throw new Error(t("current_password_required"));
  const ok = await verifyPassword(currentPassword, user.salt, user.hash);
  if (!ok) throw new Error(t("wrong_password"));

  const patch = {};
  const username = String(newUsername || "").trim();
  if (username && username !== user.username) {
    if (username.length < 3) throw new Error(t("username_too_short"));
    if (get("users").some((u) => u.id !== user.id && u.username.toLowerCase() === username.toLowerCase())) throw new Error(t("username_taken"));
    patch.username = username;
  }
  if (newPassword || confirmPassword) {
    if (newPassword !== confirmPassword) throw new Error(t("passwords_mismatch"));
    if (String(newPassword).length < 6) throw new Error(t("password_too_weak"));
    const next = await hashPassword(newPassword);
    patch.salt = next.salt;
    patch.hash = next.hash;
  }
  if (!Object.keys(patch).length) throw new Error(t("nothing_to_update"));
  const updated = { ...user, ...patch, updatedAt: new Date().toISOString() };
  await db.put("users", updated);
  await reload("users");
  await logActivity("ACCOUNT_UPDATE", "user", `${t("account")} — ${updated.username}`);
  await reload("activityLog");
  return updated;
}

export async function accountSettings(route, view) {
  await ensureDefaultUser();
  const user = currentUser();
  view.innerHTML = UI.card({
    title: t("account"),
    body: `<form id="acc-form" class="grid g2">
        <div class="field"><label>${t("current_username")}</label>
          <input class="input" value="${esc(user.username)}" readonly aria-readonly="true"></div>
        ${UI.field({ label: t("new_username"), name: "newUsername", value: "" })}
        ${UI.field({ label: t("current_password"), name: "currentPassword", type: "password", required: true, attrs: "autocomplete=off" })}
        <div></div>
        ${UI.field({ label: t("new_password"), name: "newPassword", type: "password", hint: t("password_hint"), attrs: "autocomplete=off" })}
        ${UI.field({ label: t("confirm_new_password"), name: "confirmPassword", type: "password", attrs: "autocomplete=off" })}
        <div class="field full"><button class="btn btn-primary" type="button" data-update-account>💾 ${t("update_account")}</button></div>
      </form>`,
  });

  view.querySelector("[data-update-account]").addEventListener("click", async () => {
    const data = UI.formData(view.querySelector("#acc-form"));
    try {
      const updated = await updateAccount(data);
      UI.toast(`${t("account_updated")} — ${updated.username}`);
      accountSettings(route, view);
    } catch (error) {
      UI.toast(error.message, "error", 4000);
    }
  });
  void route;
}
