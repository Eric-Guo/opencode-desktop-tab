import { join } from "node:path"

export function configureEnvironment(resourcesPath: string, packaged: boolean, env: NodeJS.ProcessEnv) {
  const configured = env.OPENCODE_CONFIG_DIR?.trim()
  env.OPENCODE_CONFIG_DIR = packaged || !configured ? join(resourcesPath, "thape-config") : configured
  return env.OPENCODE_CONFIG_DIR
}
