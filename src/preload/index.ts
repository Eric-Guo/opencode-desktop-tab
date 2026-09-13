import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("desktopTabAccount", {
  signIn: (credentials: { username: string; password: string }) =>
    ipcRenderer.invoke("desktop-tabs-account", "sign-in", credentials),
  currentUser: () => ipcRenderer.invoke("desktop-tabs-account", "current-user"),
})
