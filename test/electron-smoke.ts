import assert from "node:assert/strict"
import { createServer } from "node:http"
import { app, BrowserWindow, WebContentsView, ipcMain } from "electron"
import type { WebContents } from "electron"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
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
          welcomeText: "Welcome",
          suggestedQuestions: ["Question"],
          releaseWhenLostFocus: true,
        },
        { id: "other", title: "Other", label: "X", url: origin, partition: "persist:smoke" },
      ],
    }),
  )
  await app.whenReady()
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
    const shell = extension.createWindow!({
      window: win,
      id,
      preloadRoot: directory,
      storage,
      createRenderer() {
        const view = new WebContentsView({
          webPreferences: {
            preload: join(directory, "index.cjs"),
            backgroundThrottling: false,
            sandbox: true,
            contextIsolation: true,
          },
        })
        contents.push(view.webContents)
        void view.webContents.loadURL(origin)
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
      setControlColor() {},
      log: (message, error) => console.error(message, error),
    })
    return { win, shell, bar: contents[0]! }
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
    assert.equal(await first.bar.executeJavaScript("document.querySelectorAll('#tabs button').length"), 2)
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
    const closed = new Promise<void>((resolve) => first.shell.primary.once("destroyed", resolve))
    first.shell.dispose()
    second.shell.dispose()
    await closed
    assert(first.shell.primary.isDestroyed())
    first.win.destroy()
    second.win.destroy()
    stranger.destroy()
    console.log(
      "Electron smoke passed: UI, lazy sites, release/restore, initialization, multi-window isolation, sender/origin checks, login action, disposal",
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
