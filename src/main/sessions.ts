import { safeStorage, session } from "electron"
import type { Cookie, Session, WebContents } from "electron"
import type { DesktopExtensionStore } from "@opencode/desktop/extension"
import { app } from "electron"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const permissions = new WeakMap<Session, Map<number, (permission: string, url?: string) => boolean>>()
const restores = new Map<string, Promise<void>>()
const namespace = "opencode.desktop-tab-cookies"

export function setSitePermissions(contents: WebContents, allow: (permission: string, url?: string) => boolean) {
  const existing = permissions.get(contents.session)
  const clients = existing ?? new Map<number, (permission: string, url?: string) => boolean>()
  if (!existing) {
    permissions.set(contents.session, clients)
    contents.session.setPermissionRequestHandler((sender, permission, callback, details) =>
      callback(clients.get(sender.id)?.(permission, details.requestingUrl) ?? false),
    )
    contents.session.setPermissionCheckHandler((sender, permission, origin) =>
      sender ? (clients.get(sender.id)?.(permission, origin) ?? false) : false,
    )
  }
  clients.set(contents.id, allow)
  contents.once("destroyed", () => clients.delete(contents.id))
}

export function restoreSession(
  partition: string,
  storage: DesktopExtensionStore,
  log: (message: string, error?: unknown) => void,
) {
  const cached = restores.get(partition)
  if (cached) return cached
  const restored = restore(partition, storage, log)
  restores.set(partition, restored)
  return restored
}

async function restore(
  partition: string,
  storage: DesktopExtensionStore,
  log: (message: string, error?: unknown) => void,
) {
  const target = session.fromPartition(partition)
  const cookies = new Map<string, Cookie>()
  const save = () => {
    if (!safeStorage.isEncryptionAvailable()) return
    storage.set(
      namespace,
      partition,
      safeStorage.encryptString(JSON.stringify([...cookies.values()])).toString("base64"),
    )
  }
  const encrypted = storage.get(namespace, partition) ?? legacy(partition)
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      const value: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64")))
      if (Array.isArray(value)) value.filter(isCookie).forEach((cookie) => cookies.set(key(cookie), cookie))
    } catch (error) {
      log("external tab cookie restore failed", error)
    }
  }
  await Promise.allSettled(
    [...cookies.values()]
      .filter((cookie) => cookie.domain && (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000))
      .map((cookie) =>
        target.cookies.set({
          url: `${cookie.secure ? "https" : "http"}://${cookie.domain!.replace(/^\./, "")}${cookie.path ?? "/"}`,
          name: cookie.name,
          value: cookie.value,
          ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          ...(!cookie.session ? { expirationDate: cookie.expirationDate } : {}),
        }),
      ),
  ).then((results) =>
    results.forEach((result) => {
      if (result.status === "rejected") log("external tab cookie restore failed", result.reason)
    }),
  )
  cookies.clear()
  ;(await target.cookies.get({})).forEach((cookie) => cookies.set(key(cookie), cookie))
  save()
  target.cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (removed) cookies.delete(key(cookie))
    if (!removed) cookies.set(key(cookie), cookie)
    save()
  })
}

function key(cookie: Cookie) {
  return [cookie.name, cookie.domain ?? "", cookie.path ?? ""].join("\n")
}
function isCookie(value: unknown): value is Cookie {
  if (!value || typeof value !== "object") return false
  const cookie = value as Record<string, unknown>
  return (
    typeof cookie.name === "string" &&
    typeof cookie.value === "string" &&
    ["unspecified", "no_restriction", "lax", "strict"].includes(String(cookie.sameSite))
  )
}
function legacy(partition: string) {
  // Read-only migration from the fork's electron-store file; all new snapshots use host SQLite.
  try {
    const value = JSON.parse(readFileSync(join(app.getPath("userData"), namespace), "utf8")) as Record<string, unknown>
    return typeof value[partition] === "string" ? value[partition] : undefined
  } catch {
    return undefined
  }
}
