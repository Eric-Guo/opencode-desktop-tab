import type { DesktopWindowHost } from "@opencode/desktop/extension"
import type { RendererDesktopTab } from "./desktop-tabs"

/** Each tab opts into its own dev server; false keeps the host's primary dev server out of local tabs. */
export function localRendererOptions(
  tab: RendererDesktopTab,
  env: NodeJS.ProcessEnv,
): Parameters<DesktopWindowHost["createRenderer"]>[0] {
  const variable = tab.devServerEnv ?? `ELECTRON_${tab.id.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_RENDERER_URL`
  return { id: tab.id, html: tab.html, devHtml: tab.devHtml, devURL: env[variable]?.trim() || false }
}
