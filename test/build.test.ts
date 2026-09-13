import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import manifest from "../package.json"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test.each([
  { failure: "", steps: ["7777", "desktop-prebuild", "desktop"] },
  { failure: "7777", steps: ["7777"] },
  { failure: "desktop", steps: ["7777", "desktop-prebuild", "desktop"] },
])("build runs sibling scripts in order and propagates '$failure' failures", async (input) => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-tab-build-"))
  directories.push(directory)
  await Promise.all([
    Bun.write(join(directory, "desktop-tab/package.json"), JSON.stringify(manifest)),
    Bun.write(join(directory, "7777/package.json"), JSON.stringify({ scripts: { build: "bun ../build.ts 7777" } })),
    Bun.write(
      join(directory, "desktop/package.json"),
      JSON.stringify({ scripts: { prebuild: "bun ../build.ts desktop-prebuild", build: "bun ../build.ts desktop" } }),
    ),
    Bun.write(
      join(directory, "build.ts"),
      `const step = process.argv[2]
if (step.startsWith("desktop") && process.env.OPENCODE_DESKTOP_EXTENSION !== "../desktop-tab") {
  throw new Error("Desktop extension was not selected")
}
console.log("built:" + step)
process.exit(step === ${JSON.stringify(input.failure)} ? 23 : 0)
`,
    ),
  ])
  const child = Bun.spawn([process.execPath, "run", "build"], {
    cwd: join(directory, "desktop-tab"),
    env: { ...process.env, OPENCODE_DESKTOP_EXTENSION: "none" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(stdout.split(/\r?\n/).filter((line) => line.startsWith("built:"))).toEqual(
    input.steps.map((step) => `built:${step}`),
  )
  expect(code, stderr).toBe(input.failure ? 23 : 0)
})
