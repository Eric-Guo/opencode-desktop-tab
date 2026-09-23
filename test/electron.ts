import { mkdtemp, mkdir, cp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import electron from "electron"

const directory = await mkdtemp(join(tmpdir(), "desktop-tab-smoke-"))
try {
  await symlink(new URL("../node_modules", import.meta.url).pathname, join(directory, "node_modules"))
  await mkdir(join(directory, "desktop-tab"))
  await cp(new URL("../src/renderer/tabbar.html", import.meta.url), join(directory, "desktop-tab/tabbar.html"))
  for (const name of ["index", "tabbar", "external-tab"]) {
    const build = await Bun.build({
      entrypoints: [new URL(`../src/preload/${name}.ts`, import.meta.url).pathname],
      target: "node",
      format: "cjs",
      external: ["electron"],
    })
    if (!build.success) throw new AggregateError(build.logs)
    await Bun.write(join(directory, `${name}.cjs`), build.outputs[0]!)
  }
  const build = await Bun.build({
    entrypoints: [new URL("./electron-smoke.ts", import.meta.url).pathname],
    target: "node",
    format: "esm",
    external: ["electron", "jsonc-parser", "electron-context-menu"],
  })
  if (!build.success) throw new AggregateError(build.logs)
  await Bun.write(join(directory, "smoke.mjs"), build.outputs[0]!)
  // The temporary macOS profile must not prompt for access to the user's real Keychain.
  process.exitCode = await Bun.spawn(
    [String(electron), ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []), join(directory, "smoke.mjs")],
    {
      env: { ...process.env, DESKTOP_TAB_TEST_DIR: directory },
      stdio: ["ignore", "inherit", "inherit"],
    },
  ).exited
} finally {
  await rm(directory, { recursive: true, force: true })
}
