import type { DesktopRendererExtension } from "@opencode/desktop/extension"
import type { CybrosCurrentUser } from "../shared/api"

declare global {
  interface Window {
    desktopTabAccount: {
      signIn(credentials: { username: string; password: string }): Promise<void>
      currentUser(): Promise<CybrosCurrentUser | null>
    }
  }
}
const extension: DesktopRendererExtension = {
  setup(host) {
    return {
      command(id) {
        if (id !== "sso.login") return false
        host.showLogin((credentials) => window.desktopTabAccount.signIn(credentials))
        return true
      },
    }
  },
}
export default extension
