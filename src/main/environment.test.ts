import { expect, test } from "bun:test"
import { join } from "node:path"
import { configureEnvironment } from "./environment"

test.each([undefined, "", "   "])("development uses bundled THAPE config for %p", (configured) => {
  const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_DIR: configured }
  configureEnvironment("resources", false, env)
  expect(env.OPENCODE_CONFIG_DIR).toBe(join("resources", "thape-config"))
})

test("development preserves the configured directory", () => {
  const env = { OPENCODE_CONFIG_DIR: "  custom-config  ", UNRELATED: "keep" }
  configureEnvironment("resources", false, env)
  expect(env).toEqual({ OPENCODE_CONFIG_DIR: "custom-config", UNRELATED: "keep" })
})

test("packaged distributions use their bundled config", () => {
  const env = { OPENCODE_CONFIG_DIR: "custom-config" }
  configureEnvironment("resources", true, env)
  expect(env.OPENCODE_CONFIG_DIR).toBe(join("resources", "thape-config"))
})
