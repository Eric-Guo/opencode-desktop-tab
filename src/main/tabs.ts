import type { DesktopTab } from "./desktop-tabs"

/** The view lifecycle is independent of Electron and exercised with disposable view resources. */
export function createTabController<View extends { setVisible(visible: boolean): void }>(
  tabs: DesktopTab[],
  host: {
    primary: View
    create(tab: DesktopTab): View
    attach(view: View): void
    release(view: View): void
    changed(tab: DesktopTab): void
  },
) {
  const views = new Map([["opencode", host.primary]])
  let active = "opencode"
  return {
    id: () => active,
    active: () => views.get(active)!,
    views: () => [...views.values()],
    select(id: string) {
      const tab = tabs.find((tab) => tab.id === id)
      if (!tab) return
      const previous = tabs.find((tab) => tab.id === active)
      if (!views.has(id)) {
        const view = host.create(tab)
        views.set(id, view)
        host.attach(view)
      }
      active = id
      views.forEach((view, key) => view.setVisible(key === id))
      if (previous && previous.id !== id && previous.id !== "opencode" && previous.releaseWhenLostFocus) {
        const view = views.get(previous.id)!
        views.delete(previous.id)
        host.release(view)
      }
      host.changed(tab)
    },
    dispose() {
      views.forEach(host.release)
      views.clear()
    },
  }
}
