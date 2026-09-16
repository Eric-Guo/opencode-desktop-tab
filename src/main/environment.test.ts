import { expect, test } from "bun:test"
import { join } from "node:path"
import { configureEnvironment } from "./environment"

test.each([undefined, "", "   "])("development defaults to THAPE config for %p", (configured) => {
  const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_DIR: configured }
  expect(configureEnvironment("resources", false, env)).toBe(join("resources", "thape-config"))
  expect(env).toEqual({ OPENCODE_CONFIG_DIR: join("resources", "thape-config") })
})

test("development preserves the configured directory", () => {
  const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_DIR: "  custom-config  ", UNRELATED: "keep" }
  expect(configureEnvironment("resources", false, env)).toBe("custom-config")
  expect(env).toEqual({
    OPENCODE_CONFIG_DIR: "custom-config",
    UNRELATED: "keep",
  })
})

test("packaged builds select THAPE config for tabs and server", () => {
  const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_DIR: "custom-config" }
  expect(configureEnvironment("resources", true, env)).toBe(join("resources", "thape-config"))
  expect(env).toEqual({ OPENCODE_CONFIG_DIR: join("resources", "thape-config") })
})
