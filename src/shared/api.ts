export type CybrosCurrentUser = { chinese_name: string; clerk_code: string }
export type AgentStorageKeys = {
  sessionID: string
  sessionDirectory: string
  promptDraft: string
}
export type ServerReadyData = {
  url: string
  password?: string | null
  ssoJwtSecretKey?: string
  localAgent?: string
  welcomeText?: string
  suggestedQuestions?: string[]
  storageKeys?: AgentStorageKeys
}
export type TabsState = {
  active: string
  ssoConfigured: boolean
  tabs: { id: string; title: string; label: string; skipDisplay: boolean }[]
  navigation: { canGoBack: boolean; canGoForward: boolean }
}
