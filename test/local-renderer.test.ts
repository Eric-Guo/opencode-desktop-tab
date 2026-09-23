import { expect, test } from "bun:test"
import { parseDesktopTabs } from "../src/main/desktop-tabs"
import { localRendererOptions } from "../src/main/local-renderer"

const tabs = parseDesktopTabs(
  JSON.stringify({
    desktopTabs: [
      { id: "opencode", title: "Sigma", label: "Assistant" },
      { id: "7777", title: "7777", label: "7777", html: "7777/index.html", devHtml: "index.html" },
      { id: "local-two", type: "local", title: "Two", label: "Two", html: "two/index.html", devHtml: "chat.html" },
      {
        id: "shared",
        type: "local",
        title: "Shared",
        label: "Shared",
        html: "7777/index.html",
        devServerEnv: "SHARED_UI_URL",
      },
    ],
  }),
).filter((tab) => tab.type === "local")

test("resolves independent dev servers and preserves the existing 7777 variable", () => {
  expect(
    tabs.map((tab) =>
      localRendererOptions(tab, {
        ELECTRON_RENDERER_URL: "http://localhost:4000/",
        ELECTRON_7777_RENDERER_URL: "http://localhost:7777/",
        ELECTRON_LOCAL_TWO_RENDERER_URL: "http://localhost:8000/",
        SHARED_UI_URL: "http://localhost:9000/",
      }),
    ),
  ).toEqual([
    { id: "7777", html: "7777/index.html", devHtml: "index.html", devURL: "http://localhost:7777/" },
    { id: "local-two", html: "two/index.html", devHtml: "chat.html", devURL: "http://localhost:8000/" },
    { id: "shared", html: "7777/index.html", devHtml: undefined, devURL: "http://localhost:9000/" },
  ])
})

test("bundled tabs do not inherit either the primary or another agent's development server", () => {
  const env = { ELECTRON_RENDERER_URL: "http://localhost:4000/", ELECTRON_7777_RENDERER_URL: "http://localhost:7777/" }
  expect(localRendererOptions(tabs[1]!, env).devURL).toBe(false)
  expect(localRendererOptions(tabs[2]!, env).devURL).toBe(false)
  expect(localRendererOptions(tabs[1]!, { ELECTRON_LOCAL_TWO_RENDERER_URL: "  " }).devURL).toBe(false)
})

test("meeting loads its own bundle unless its own development server is configured", () => {
  const meeting = {
    ...tabs[0]!,
    id: "plm-meeting",
    html: "plm-meeting/index.html",
    devServerEnv: "ELECTRON_PLM_MEETING_RENDERER_URL",
  }
  const env = { ELECTRON_7777_RENDERER_URL: "http://localhost:4777/" }
  expect(localRendererOptions(meeting, env)).toEqual({
    id: "plm-meeting",
    html: "plm-meeting/index.html",
    devHtml: "index.html",
    devURL: false,
  })
  expect(
    localRendererOptions(meeting, { ...env, ELECTRON_PLM_MEETING_RENDERER_URL: "http://localhost:4778/" }).devURL,
  ).toBe("http://localhost:4778/")
})
