import { resolve } from "node:path"

const directory = resolve(import.meta.dir, "..")

process.exitCode = await Bun.spawn([process.execPath, "run", "--cwd", resolve(directory, "../desktop"), "build"], {
  cwd: directory,
  env: { ...process.env, OPENCODE_DESKTOP_EXTENSION: directory },
  stdio: ["inherit", "inherit", "inherit"],
}).exited
