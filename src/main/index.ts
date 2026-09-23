import contextMenu from "electron-context-menu"
import { copy } from "../shared/copy"
import { app, net, WebContentsView } from "electron"
import type { WebContents, IpcMainInvokeEvent } from "electron"
import { join } from "node:path"
import type { DesktopExtension, DesktopWindowHost } from "@opencode/desktop/extension"
import { loadDesktopTabs } from "./desktop-tabs"
import type { DesktopTabInitialization, ExternalDesktopTab } from "./desktop-tabs"
import {
  createExternalTabNavigationHandler,
  isExternalTabPermissionAllowed,
  isExternalTabURL,
} from "./external-tab-policy"
import { restoreSession, setSitePermissions } from "./sessions"
import { loadSsoBearerApiKey, getCybrosCurrentUser, signInToThapeSso } from "./thape-sso"
import { createTabController } from "./tabs"
import { configureEnvironment } from "./environment"
import { localRendererOptions } from "./local-renderer"

const clients = new Map<
  number,
  {
    contents: WebContents
    role: "bar" | "renderer" | "site"
    tab?: ExternalDesktopTab
    initialization?: DesktopTabInitialization
    request?: (action: string, value?: unknown) => void
  }
>()
const refresh = new Set<() => void>()
let tabs: ReturnType<typeof loadDesktopTabs> = []
let configDirectory: string | undefined

function register(contents: WebContents, client: Omit<NonNullable<ReturnType<typeof clients.get>>, "contents">) {
  clients.set(contents.id, { contents, ...client })
  contents.once("destroyed", () => clients.delete(contents.id))
}

const extension: DesktopExtension = {
  apiVersion: 1,
  environment(host) {
    configDirectory = configureEnvironment(host.resourcesPath, app.isPackaged, process.env)
  },
  async initialize() {
    tabs = loadDesktopTabs(configDirectory)
    const key = await loadSsoBearerApiKey(app.getPath("userData"), process.env.THAPE_SSO_BEARER_API_KEY)
    if (key) process.env.THAPE_SSO_BEARER_API_KEY = key
  },
  // The next launch must start a service with the credentials saved by account sign-in.
  beforeQuit: (host) => host.stopService(),
  serviceCors: () => [
    ...new Set(tabs.flatMap((tab) => (tab.type === "web" && tab.localServer ? [new URL(tab.url).origin] : []))),
  ],
  rendererData(contents) {
    return {
      ...clients.get(contents.id)?.initialization,
      ...(process.env.THAPE_SSO_BEARER_API_KEY ? { ssoJwtSecretKey: process.env.THAPE_SSO_BEARER_API_KEY } : {}),
    }
  },
  async request(contents, method) {
    if (clients.get(contents.id)?.role !== "renderer") throw new Error("Invalid account sender")
    if (method !== "account.current-user") throw new Error("Unknown extension request")
    return process.env.THAPE_SSO_BEARER_API_KEY ? currentUser() : null
  },
  createWindow: createWindow,
  ipc(host) {
    return {
      "desktop-tabs-request": (event, action, value) => {
        const client = requireClient(event, "bar")
        if (typeof action !== "string") throw new Error("Invalid tab action")
        return client.request?.(action, value)
      },
      "desktop-tabs-account": async (event, action, value) => {
        requireClient(event, "renderer")
        if (action === "current-user") return process.env.THAPE_SSO_BEARER_API_KEY ? currentUser() : null
        if (action !== "sign-in" || !isCredentials(value)) throw new Error("Invalid account request")
        process.env.THAPE_SSO_BEARER_API_KEY = await signInToThapeSso(app.getPath("userData"), value, (url, init) =>
          net.fetch(url, init),
        )
        refresh.forEach((send) => send())
      },
      // Compatibility for existing sites: only the registered top-level configured origin may call these.
      "await-initialization": async (event) => {
        const client = requireClient(event, "site")
        const connection = await host.connection()
        requireClient(event, "site")
        return {
          url: connection.url,
          ...(client.tab?.localServer ? { password: connection.password } : {}),
          ...extension.rendererData?.(event.sender),
        }
      },
      "get-cybros-current-user": (event) => {
        requireClient(event, "site")
        return currentUser()
      },
    }
  },
}
export default extension

function createWindow(host: DesktopWindowHost) {
  const win = host.window
  const bar = new WebContentsView({
    webPreferences: {
      preload: join(host.preloadRoot, "tabbar.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  host.trackContents(bar.webContents)
  bar.setBackgroundColor("#12121f")
  win.contentView.addChildView(bar)
  const primary = host.createRenderer({ id: "opencode", html: "index.html" })
  const initial = tabs.find((tab) => tab.id === "opencode")
  register(primary.webContents, { role: "renderer", initialization: initialization(initial) })
  win.contentView.addChildView(primary)
  configureContextMenu(primary)
  const namespace = `opencode.desktop-tabs.${host.id.replace(/[^a-zA-Z0-9._-]/g, "-")}.dat`
  const controller = createTabController(tabs, {
    primary,
    create(tab) {
      switch (tab.type) {
        case "primary":
          return primary
        case "local": {
          const view = host.createRenderer(localRendererOptions(tab, process.env))
          register(view.webContents, { role: "renderer", initialization: initialization(tab) })
          return view
        }
        case "web":
          return createSite(host, tab, host.storage.get(namespace, tab.id), (url) =>
            host.storage.set(namespace, tab.id, url),
          )
      }
    },
    attach(view) {
      configureContextMenu(view)
      host.window.contentView.addChildView(view)
      view.webContents.on("did-navigate", sendState)
      view.webContents.on("did-navigate-in-page", sendState)
    },
    release(view) {
      if (!host.window.isDestroyed()) host.window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
    },
    changed(tab) {
      host.setControlColor(tab.systemControlColor)
      win.contentView.addChildView(bar)
      layout()
      sendState()
      controller.active().webContents.focus()
    },
  })
  const navigation = () => controller.active().webContents.navigationHistory
  function sendState() {
    if (bar.webContents.isDestroyed()) return
    bar.webContents.send("desktop-tabs-state", {
      active: controller.id(),
      tabs: tabs.map((tab) => ({ id: tab.id, title: tab.title, label: tab.label, skipDisplay: tab.skipDisplay })),
      ssoConfigured: Boolean(process.env.THAPE_SSO_BEARER_API_KEY?.trim()),
      navigation: { canGoBack: navigation().canGoBack(), canGoForward: navigation().canGoForward() },
    })
  }
  function layout() {
    if (win.isDestroyed()) return
    const bounds = win.getContentBounds()
    const width = Math.min(80, bounds.width)
    bar.setBounds({ x: 0, y: 0, width, height: bounds.height })
    controller
      .views()
      .forEach((view) =>
        view.setBounds({ x: width, y: 0, width: Math.max(0, bounds.width - width), height: bounds.height }),
      )
  }
  register(bar.webContents, {
    role: "bar",
    request(action, value) {
      if (action === "subscribe") return sendState()
      if (action === "select" && typeof value === "string") return controller.select(value)
      if (action === "back" && navigation().canGoBack()) return navigation().goBack()
      if (action === "forward" && navigation().canGoForward()) return navigation().goForward()
      if (action === "reload") return controller.active().webContents.reload()
      if (action === "settings" || action === "login") {
        controller.select("opencode")
        host.command(action === "settings" ? "settings.open" : "sso.login")
      }
      if (action === "help") host.openExternal("https://plm.thape.com.cn/projects/opencode/wiki/01-shi-yong-shuo-ming")
    },
  })
  refresh.add(sendState)
  primary.webContents.on("did-navigate", sendState)
  primary.webContents.on("did-navigate-in-page", sendState)
  win.on("resize", layout)
  controller.select("opencode")
  void host.load(bar.webContents, "desktop-tab/tabbar.html").catch((error) => host.log("tab bar load failed", error))
  return {
    primary: primary.webContents,
    contentView: primary,
    active: () => controller.active().webContents,
    forget: () => host.storage.clear(namespace),
    dispose() {
      refresh.delete(sendState)
      win.off("resize", layout)
      controller.dispose()
      if (!bar.webContents.isDestroyed()) bar.webContents.close({ waitForBeforeUnload: false })
    },
  }
}

function createSite(
  host: DesktopWindowHost,
  tab: ExternalDesktopTab,
  saved: string | null,
  save: (url: string) => void,
) {
  const view = new WebContentsView({
    webPreferences: {
      partition: tab.partition,
      preload: join(host.preloadRoot, "external-tab.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  register(view.webContents, { role: "site", tab, initialization: initialization(tab) })
  host.trackContents(view.webContents)
  view.setBackgroundColor("#ffffff")
  setSitePermissions(view.webContents, (permission, url) => isExternalTabPermissionAllowed(tab, permission, url))
  view.webContents.setWindowOpenHandler(({ url }) => {
    host.openExternal(url)
    return { action: "deny" }
  })
  const navigate = createExternalTabNavigationHandler(tab, host.openExternal)
  view.webContents.on("will-navigate", navigate)
  view.webContents.on("will-redirect", navigate)
  view.webContents.on("did-navigate", (_event, url) => {
    if (isExternalTabURL(tab, url)) save(url)
  })
  view.webContents.on("did-navigate-in-page", (_event, url, main) => {
    if (main && isExternalTabURL(tab, url)) save(url)
  })
  void restoreSession(tab.partition, host.storage, host.log)
    .then(() => {
      if (!view.webContents.isDestroyed())
        return view.webContents.loadURL(saved && isExternalTabURL(tab, saved) ? saved : tab.url)
    })
    .catch((error) => host.log("external tab load failed", error))
  return view
}

function initialization(tab?: DesktopTabInitialization) {
  return {
    ...(tab?.localAgent === undefined ? {} : { localAgent: tab.localAgent }),
    ...(tab?.welcomeText === undefined ? {} : { welcomeText: tab.welcomeText }),
    ...(tab?.suggestedQuestions === undefined ? {} : { suggestedQuestions: tab.suggestedQuestions }),
  }
}

function requireClient(event: IpcMainInvokeEvent, role: "bar" | "renderer" | "site") {
  const client = clients.get(event.sender.id)
  if (!client || client.role !== role || event.senderFrame !== event.sender.mainFrame)
    throw new Error("Invalid desktop tab sender")
  if (role === "site" && (!client.tab || new URL(event.senderFrame.url).origin !== new URL(client.tab.url).origin))
    throw new Error("Invalid desktop tab origin")
  return client
}

function isCredentials(value: unknown): value is { username: string; password: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "username" in value &&
    typeof value.username === "string" &&
    "password" in value &&
    typeof value.password === "string"
  )
}

function currentUser() {
  return getCybrosCurrentUser(
    app.getPath("userData"),
    process.env.THAPE_SSO_BEARER_API_KEY,
    () => {
      delete process.env.THAPE_SSO_BEARER_API_KEY
      refresh.forEach((send) => send())
    },
    (url, init) => net.fetch(url, init),
  )
}

function configureContextMenu(view: WebContentsView) {
  contextMenu({
    window: view,
    showSaveImageAs: true,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    append: () => [{ label: copy.debug, click: () => view.webContents.openDevTools() }],
  })
}
