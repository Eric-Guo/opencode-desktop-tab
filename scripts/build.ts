import { resolve } from "node:path"
import manifest from "../desktop-extension.json"

const directory = resolve(import.meta.dir, "..")
// Build declared renderer assets before the host copies them into its output.
for (const [project, script] of Object.entries(manifest.builds)) {
  const code = await Bun.spawn([process.execPath, "run", "--cwd", resolve(directory, project), script], {
    cwd: directory,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited
  if (code) process.exit(code)
}

process.exitCode = await Bun.spawn([process.execPath, "run", "--cwd", resolve(directory, "../desktop"), "build"], {
  cwd: directory,
  env: { ...process.env, OPENCODE_DESKTOP_EXTENSION: directory },
  stdio: ["inherit", "inherit", "inherit"],
}).exited
