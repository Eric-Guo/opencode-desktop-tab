import assert from "node:assert/strict"
import { createServer } from "node:http"
import { app, BrowserWindow, WebContentsView, ipcMain } from "electron"
import type { WebContents } from "electron"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { mkdir, writeFile } from "node:fs/promises"
import type { DesktopWindowHost } from "@opencode/desktop/extension"
import extension from "../src/main/index"

const directory = process.env.DESKTOP_TAB_TEST_DIR!
app.setPath("userData", directory)
process.env.OPENCODE_CONFIG_DIR = directory
delete process.env.THAPE_SSO_BEARER_API_KEY
async function main() {
  const timeout = setTimeout(() => {
    console.error("Electron smoke timed out")
    app.exit(1)
  }, 60000)
  const server = createServer((_request, response) =>
    response.end("<!doctype html><title>Fixture</title><body>Fixture page</body>"),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  const origin = `http://127.0.0.1:${address.port}`
  process.env.ELECTRON_7777_RENDERER_URL = origin + "/legacy/"
  delete process.env.ELECTRON_LOCAL_TWO_RENDERER_URL
  await mkdir(join(directory, "7777"))
  await writeFile(join(directory, "7777/index.html"), "<!doctype html><title>Shared</title><body>Shared agent</body>")
  await mkdir(join(directory, "local-two"))
  await writeFile(
    join(directory, "local-two/index.html"),
    "<!doctype html><title>Local Two</title><body>Bundled agent</body>",
  )
  await writeFile(
    join(directory, "sigmaagents.jsonc"),
    JSON.stringify({
      desktopTabs: [
        { id: "opencode", title: "OpenCode", label: "O", skipDisplay: true },
        {
          id: "site",
          title: "Site",
          label: "S",
          url: origin,
          partition: "persist:smoke",
          localServer: true,
          localAgent: "7777",
          storageKeys: { sessionID: "site.session", sessionDirectory: "site.directory", promptDraft: "site.draft" },
          welcomeText: "Welcome",
          suggestedQuestions: ["Question"],
          releaseWhenLostFocus: true,
        },
        { id: "other", title: "Other", label: "X", url: origin, partition: "persist:smoke" },
        {
          id: "7777",
          title: "7777",
          label: "7777",
          html: "7777/index.html",
          devHtml: "index.html",
          localAgent: "7777",
          welcomeText: "First agent",
          storageKeys: { sessionID: "first.session", sessionDirectory: "first.directory", promptDraft: "first.draft" },
          suggestedQuestions: ["First question"],
          releaseWhenLostFocus: true,
        },
        {
          type: "local",
          id: "plm-meeting",
          title: "PLM Meeting",
          label: "Meeting",
          html: "7777/index.html",
          devHtml: "index.html",
          devServerEnv: "ELECTRON_7777_RENDERER_URL",
          localAgent: "plm-meeting",
          welcomeText: "Meeting agent",
          storageKeys: {
            sessionID: "meeting.session",
            sessionDirectory: "meeting.directory",
            promptDraft: "meeting.draft",
          },
          suggestedQuestions: ["Meeting question"],
          releaseWhenLostFocus: true,
        },
        {
          type: "local",
          id: "local-two",
          title: "Local Two",
          label: "Two",
          html: "local-two/index.html",
          localAgent: "second-agent",
          welcomeText: "Second agent",
          storageKeys: {
            sessionID: "second.session",
            sessionDirectory: "second.directory",
            promptDraft: "second.draft",
          },
          suggestedQuestions: ["Second question"],
          systemControlColor: "#123456",
        },
      ],
    }),
  )
  await app.whenReady()
  extension.environment!({ resourcesPath: directory })
  assert.equal(process.env.OPENCODE_CONFIG_DIR, directory)
  await extension.initialize!()
  assert.deepEqual(extension.serviceCors!(), [origin])
  Object.entries(extension.ipc!({ connection: async () => ({ url: origin, password: "fixture-password" }) })).forEach(
    ([channel, handler]) => ipcMain.handle(channel, handler),
  )
  const records = new Map<string, string>()
  const commands: string[] = []
  const storage = {
    get: (name: string, key: string) => records.get(`${name}:${key}`) ?? null,
    set: (name: string, key: string, value: string) => {
      records.set(`${name}:${key}`, value)
    },
    clear: (name: string) => {
      ;[...records.keys()].filter((key) => key.startsWith(name + ":")).forEach((key) => records.delete(key))
    },
  }
  function create(id: string) {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: { backgroundThrottling: false },
    })
    const contents: WebContents[] = []
    const renderers: Parameters<DesktopWindowHost["createRenderer"]>[0][] = []
    const colors: (string | undefined)[] = []
    const shell = extension.createWindow!({
      window: win,
      id,
      preloadRoot: directory,
      storage,
      createRenderer(options) {
        renderers.push(options)
        const view = new WebContentsView({
          webPreferences: {
            preload: join(directory, "index.cjs"),
            backgroundThrottling: false,
            sandbox: true,
            contextIsolation: true,
          },
        })
        contents.push(view.webContents)
        void (options.id === "opencode"
          ? view.webContents.loadURL(origin)
          : options.devURL
            ? view.webContents.loadURL(new URL(options.devHtml ?? options.html, options.devURL).href)
            : view.webContents.loadFile(join(directory, options.html)))
        return view
      },
      trackContents: (value) => {
        value.setBackgroundThrottling(false)
        contents.push(value)
      },
      load: (value, html) => value.loadFile(join(directory, html)),
      openExternal: (url) => {
        commands.push(url)
      },
      command: (id) => {
        commands.push(id)
      },
      setControlColor: (color) => {
        colors.push(color)
      },
      log: (message, error) => console.error(message, error),
    })
    return { win, shell, bar: contents[0]!, renderers, colors, contents }
  }
  async function loaded(contents: WebContents) {
    while (!contents.getURL() || contents.isLoadingMainFrame()) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  try {
    const first = create("first")
    await loaded(first.bar)
    await loaded(first.shell.primary)
    assert.equal(first.shell.contentView!.getBounds().x, 80)
    assert.equal(first.shell.contentView!.getVisible(), true)
    assert.equal(await first.bar.executeJavaScript("document.querySelectorAll('#tabs button').length"), 5)
    assert.deepEqual(
      first.renderers.map((options) => options.id),
      ["opencode"],
    )
    assert.equal(
      await first.bar.executeJavaScript("document.querySelector('#back').getAttribute('aria-label')"),
      "Back",
    )
    await first.bar.executeJavaScript("window.desktopTabs.select('site')")
    assert.equal(first.shell.contentView!.getVisible(), false)
    const site = first.shell.active()
    await loaded(site)
    const data = await site.executeJavaScript("window.api.awaitInitialization()")
    assert.equal(data.password, "fixture-password")
    assert.equal(data.localAgent, "7777")
    assert.deepEqual(data.storageKeys, {
      sessionID: "site.session",
      sessionDirectory: "site.directory",
      promptDraft: "site.draft",
    })
    assert.deepEqual(data.suggestedQuestions, ["Question"])
    await site.loadURL(origin + "/page2")
    await first.bar.executeJavaScript("window.desktopTabs.action('settings')")
    assert.equal(first.shell.active(), first.shell.primary)
    assert.equal(first.shell.contentView!.getVisible(), true)
    assert(site.isDestroyed())
    assert.deepEqual(commands, ["settings.open"])
    await first.bar.executeJavaScript("window.desktopTabs.select('site')")
    await loaded(first.shell.active())
    assert.equal(first.shell.active().getURL(), origin + "/page2")
    await first.bar.executeJavaScript("window.desktopTabs.select('7777')")
    const legacy = first.shell.active()
    await loaded(legacy)
    assert.equal(legacy.getURL(), origin + "/legacy/index.html")
    assert.deepEqual(extension.rendererData!(legacy), {
      localAgent: "7777",
      welcomeText: "First agent",
      storageKeys: { sessionID: "first.session", sessionDirectory: "first.directory", promptDraft: "first.draft" },
      suggestedQuestions: ["First question"],
    })
    await first.bar.executeJavaScript("window.desktopTabs.select('plm-meeting')")
    const meeting = first.shell.active()
    await loaded(meeting)
    assert(legacy.isDestroyed())
    assert.equal(meeting.getURL(), origin + "/legacy/index.html")
    assert.deepEqual(first.renderers.at(-1), {
      id: "plm-meeting",
      html: "7777/index.html",
      devHtml: "index.html",
      devURL: origin + "/legacy/",
    })
    assert.deepEqual(extension.rendererData!(meeting), {
      localAgent: "plm-meeting",
      welcomeText: "Meeting agent",
      storageKeys: {
        sessionID: "meeting.session",
        sessionDirectory: "meeting.directory",
        promptDraft: "meeting.draft",
      },
      suggestedQuestions: ["Meeting question"],
    })
    await first.bar.executeJavaScript("window.desktopTabs.select('local-two')")
    const local = first.shell.active()
    await loaded(local)
    assert(meeting.isDestroyed())
    assert.equal(await local.executeJavaScript("document.title"), "Local Two")
    assert.equal(first.renderers.at(-1)!.devURL, false)
    assert.equal(first.colors.at(-1), "#123456")
    assert.deepEqual(extension.rendererData!(local), {
      localAgent: "second-agent",
      welcomeText: "Second agent",
      storageKeys: { sessionID: "second.session", sessionDirectory: "second.directory", promptDraft: "second.draft" },
      suggestedQuestions: ["Second question"],
    })
    delete process.env.ELECTRON_7777_RENDERER_URL
    await first.bar.executeJavaScript("window.desktopTabs.select('7777')")
    assert.notEqual(first.shell.active(), legacy)
    await loaded(first.shell.active())
    assert.equal(extension.rendererData!(first.shell.active()).localAgent, "7777")
    assert.equal(first.shell.active().getURL(), pathToFileURL(join(directory, "7777/index.html")).href)
    await first.bar.executeJavaScript("window.desktopTabs.select('plm-meeting')")
    await loaded(first.shell.active())
    assert.notEqual(first.shell.active(), meeting)
    assert.equal(first.shell.active().getURL(), pathToFileURL(join(directory, "7777/index.html")).href)
    assert.equal(extension.rendererData!(first.shell.active()).localAgent, "plm-meeting")
    assert.deepEqual(extension.rendererData!(first.shell.active()).storageKeys, {
      sessionID: "meeting.session",
      sessionDirectory: "meeting.directory",
      promptDraft: "meeting.draft",
    })
    await first.bar.executeJavaScript("window.desktopTabs.select('local-two')")
    assert.equal(first.shell.active(), local)
    await first.bar.executeJavaScript("window.desktopTabs.select('site')")
    await loaded(first.shell.active())
    const second = create("second")
    await loaded(second.bar)
    await second.bar.executeJavaScript("window.desktopTabs.select('other')")
    await loaded(second.shell.active())
    assert.equal(
      (await second.shell.active().executeJavaScript("window.api.awaitInitialization()")).password,
      undefined,
    )
    const stranger = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(directory, "external-tab.cjs"),
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
      },
    })
    await stranger.loadURL(origin)
    await assert.rejects(
      () => stranger.webContents.executeJavaScript("window.api.awaitInitialization()"),
      /Invalid desktop tab sender/,
    )
    await first.shell.active().loadURL("data:text/html,<body>Untrusted</body>")
    await assert.rejects(
      () => first.shell.active().executeJavaScript("window.api.awaitInitialization()"),
      /Invalid desktop tab origin/,
    )
    await first.bar.executeJavaScript("window.desktopTabs.action('login')")
    assert.equal(commands.at(-1), "sso.login")
    assert.equal(await first.shell.primary.executeJavaScript("window.desktopTabAccount.currentUser()"), null)
    assert.equal(await extension.request!(first.shell.primary, "account.current-user"), null)
    let stopped = false
    await extension.beforeQuit!({
      async stopService() {
        stopped = true
      },
    })
    assert(stopped)
    const closed = Promise.all(
      [...first.contents, ...second.contents]
        .filter((contents) => !contents.isDestroyed())
        .map((contents) => new Promise<void>((resolve) => contents.once("destroyed", resolve))),
    )
    first.shell.dispose()
    second.shell.dispose()
    await closed
    assert(first.shell.primary.isDestroyed())
    assert(local.isDestroyed())
    assert(first.bar.isDestroyed())
    first.win.destroy()
    second.win.destroy()
    stranger.destroy()
    console.log(
      "Electron smoke passed: UI, mixed local/web agents, shared dev/bundled renderers, release/restore, initialization, multi-window isolation, sender/origin checks, login action, disposal",
    )
    clearTimeout(timeout)
    server.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}
void main().catch((error) => {
  console.error(error)
  app.exit(1)
})
