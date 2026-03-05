import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const PLATFORM_PACKAGE = `@typescript/native-preview-${process.platform}-${process.arch}`

/**
 * Resolves the tsgo native binary path. Checks TSGO_PATH env var, then bun/npm
 * global install locations. The native binary is required (not the Node
 * wrapper) for stdio piping.
 */
export function resolveTsgoBinary(): string {
  const envPath = process.env.TSGO_PATH
  if (envPath) {
    if (!existsSync(envPath))
      throw new Error(
        `TSGO_PATH is set to "${envPath}" but the file does not exist`,
      )
    return envPath
  }

  const exe = process.platform === "win32" ? "tsgo.exe" : "tsgo"
  const candidates = [
    join(
      homedir(),
      ".bun",
      "install",
      "global",
      "node_modules",
      PLATFORM_PACKAGE,
      "lib",
      exe,
    ),
    join("/usr", "local", "lib", "node_modules", PLATFORM_PACKAGE, "lib", exe),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(
    [
      "Could not find tsgo native binary.",
      `Looked for package: ${PLATFORM_PACKAGE}`,
      "Install globally: bun add -g @typescript/native-preview",
      "Or set TSGO_PATH to the native binary path.",
    ].join("\n"),
  )
}
