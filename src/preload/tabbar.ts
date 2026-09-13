import { contextBridge, ipcRenderer } from "electron"
import { copy } from "../shared/copy"
import type { TabsState } from "../shared/api"

const request = (action: string, value?: string) => ipcRenderer.invoke("desktop-tabs-request", action, value)
contextBridge.exposeInMainWorld("desktopTabs", {
  platform: process.platform,
  copy,
  select: (id: string) => request("select", id),
  back: () => request("back"),
  forward: () => request("forward"),
  reload: () => request("reload"),
  action: (action: string) => request(action),
  subscribe(callback: (state: TabsState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: TabsState) => callback(state)
    ipcRenderer.on("desktop-tabs-state", handler)
    void request("subscribe")
    return () => ipcRenderer.removeListener("desktop-tabs-state", handler)
  },
})
