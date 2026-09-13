import { expect, test } from "bun:test"
import { createTabController } from "../src/main/tabs"
import type { DesktopTab } from "../src/main/desktop-tabs"

const tabs: DesktopTab[] = [
  { id: "opencode", title: "OpenCode", label: "O", skipDisplay: true },
  {
    id: "site",
    title: "Site",
    label: "S",
    skipDisplay: false,
    url: "https://example.com",
    partition: "site",
    releaseWhenLostFocus: true,
  },
  { id: "renderer", title: "Renderer", label: "R", skipDisplay: false, html: "7777/index.html" },
]
function fixture() {
  const releases: string[] = []
  const creations: string[] = []
  const view = (id: string) => ({
    id,
    visible: false,
    setVisible(visible: boolean) {
      this.visible = visible
    },
  })
  const primary = view("opencode")
  const controller = createTabController(tabs, {
    primary,
    create(tab) {
      creations.push(tab.id)
      return view(tab.id)
    },
    attach() {},
    release(view) {
      releases.push(view.id)
    },
    changed() {},
  })
  return { controller, primary, creations, releases }
}
test("hidden primary stays available for settings; sites are lazy and released on blur", () => {
  const f = fixture()
  f.controller.select("opencode")
  expect(f.creations).toEqual([])
  expect(f.primary.visible).toBe(true)
  f.controller.select("site")
  const first = f.controller.active()
  f.controller.select("site")
  expect(f.creations).toEqual(["site"])
  f.controller.select("renderer")
  expect(f.releases).toEqual(["site"])
  f.controller.select("site")
  expect(f.controller.active()).not.toBe(first)
  f.controller.select("opencode")
  expect(f.controller.active()).toBe(f.primary)
  expect(f.controller.views().map((view) => view.id)).toEqual(["opencode", "renderer"])
})
test("unknown selections preserve the active page and window controllers are independent", () => {
  const first = fixture()
  const second = fixture()
  first.controller.select("site")
  first.controller.select("missing")
  expect(first.controller.id()).toBe("site")
  expect(second.controller.id()).toBe("opencode")
  first.controller.dispose()
  expect(first.releases).toEqual(["opencode", "site"])
  expect(second.releases).toEqual([])
})
