import { afterEach, expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import manifest from "../package.json"
import extension from "../desktop-extension.json"

const directories: string[] = []

test("packages the main and meeting renderers from their own builds", () => {
  expect(extension.builds["../7777"]).toBe("build")
  expect(extension.builds["../plm-meeting"]).toBe("build")
  expect(extension.assets["7777"]).toBe("../7777/dist")
  expect(extension.assets["plm-meeting"]).toBe("../plm-meeting/dist")
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test.each([
  { projects: ["7777"], failure: "", steps: ["7777", "desktop-prebuild", "desktop"] },
  { projects: ["7777", "plm-meeting"], failure: "", steps: ["7777", "plm-meeting", "desktop-prebuild", "desktop"] },
  { projects: ["7777", "plm-meeting"], failure: "plm-meeting", steps: ["7777", "plm-meeting"] },
  { projects: ["7777", "second"], failure: "", steps: ["7777", "second", "desktop-prebuild", "desktop"] },
  { projects: ["7777", "second"], failure: "7777", steps: ["7777"] },
  { projects: ["7777", "second"], failure: "second", steps: ["7777", "second"] },
  { projects: ["7777"], failure: "desktop-prebuild", steps: ["7777", "desktop-prebuild"] },
  { projects: ["7777"], failure: "desktop", steps: ["7777", "desktop-prebuild", "desktop"] },
  { projects: [], failure: "", steps: ["desktop-prebuild", "desktop"] },
])("build runs sibling scripts in order and propagates '$failure' failures", async (input) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "desktop-tab-build-")))
  directories.push(directory)
  await Promise.all([
    Bun.write(join(directory, "desktop-tab/package.json"), JSON.stringify(manifest)),
    Bun.write(
      join(directory, "desktop-tab/scripts/build.ts"),
      Bun.file(new URL("../scripts/build.ts", import.meta.url)),
    ),
    Bun.write(
      join(directory, "desktop-tab/desktop-extension.json"),
      JSON.stringify({
        ...extension,
        builds: Object.fromEntries(input.projects.map((project) => [`../${project}`, "bundle"])),
      }),
    ),
    ...input.projects.map((project) =>
      Bun.write(
        join(directory, `${project}/package.json`),
        JSON.stringify({ scripts: { bundle: `bun ../build.ts ${project}` } }),
      ),
    ),
    Bun.write(
      join(directory, "desktop/package.json"),
      JSON.stringify({ scripts: { prebuild: "bun ../build.ts desktop-prebuild", build: "bun ../build.ts desktop" } }),
    ),
    Bun.write(
      join(directory, "build.ts"),
      `const step = process.argv[2]
if (step.startsWith("desktop") && process.env.OPENCODE_DESKTOP_EXTENSION !== ${JSON.stringify(join(directory, "desktop-tab"))}) {
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
  expect(
    stdout.split(/\r?\n/).filter((line) => line.startsWith("built:")),
    stderr,
  ).toEqual(input.steps.map((step) => `built:${step}`))
  expect(code, stderr).toBe(input.failure ? 23 : 0)
})
