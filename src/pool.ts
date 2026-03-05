import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  type LspCodeAction,
  type LspDiagnostic,
  type LspInlayHint,
  type LspLocation,
  type LspSymbol,
  type LspTextEdit,
  LspClient,
} from "./lsp-client.ts"

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000

interface PoolEntry {
  client: LspClient
  idleTimer: Timer
}

/**
 * Manages a pool of tsgo LSP instances, one per project root. Automatically
 * discovers the project root from file paths by walking up to the nearest
 * tsconfig.json. Instances are kept warm and shut down after a configurable
 * idle timeout.
 */
export class TsgoPool {
  private entries = new Map<string, PoolEntry>()

  constructor(
    private binaryPath: string,
    private idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  ) {}

  /** Get hover info + definition location in one call */
  async hoverWithDefinition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<{ hover: string | null; definition: LspLocation | null }> {
    const client = await this.getClient(filePath)
    const [hover, definitions] = await Promise.all([
      client.hover(filePath, line, character),
      client.definition(filePath, line, character),
    ])
    return { hover, definition: definitions[0] ?? null }
  }

  /** Get diagnostics for a file with available fixes for each error */
  async diagnosticsWithFixes(
    filePath: string,
  ): Promise<{ diagnostics: LspDiagnostic[]; actions: LspCodeAction[] }> {
    const client = await this.getClient(filePath)
    const diagnostics = await client.diagnostics(filePath)

    const actions = await client.codeActions(
      filePath,
      {
        start: { line: 0, character: 0 },
        end: { line: 1_000_000, character: 0 },
      },
      diagnostics,
    )

    return { diagnostics, actions }
  }

  /** Find all references to a symbol */
  async references(
    filePath: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    const client = await this.getClient(filePath)
    return client.references(filePath, line, character)
  }

  /** Get a structured outline of all symbols in a file */
  async outline(filePath: string): Promise<LspSymbol[]> {
    const client = await this.getClient(filePath)
    return client.documentSymbols(filePath)
  }

  /** Rename a symbol across the project */
  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<LspTextEdit[]> {
    const client = await this.getClient(filePath)
    return client.rename(filePath, line, character, newName)
  }

  /** Get inferred type annotations for a line range */
  async inlayHints(
    filePath: string,
    startLine: number,
    endLine: number,
  ): Promise<LspInlayHint[]> {
    const client = await this.getClient(filePath)
    return client.inlayHints(filePath, startLine, endLine)
  }

  /** Shut down all active LSP instances */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(({ client, idleTimer }) => {
        clearTimeout(idleTimer)
        return client.shutdown()
      }),
    )
    this.entries.clear()
  }

  private async getClient(filePath: string): Promise<LspClient> {
    const projectRoot = findProjectRoot(filePath)

    const existing = this.entries.get(projectRoot)
    if (existing?.client.isAlive) {
      this.resetIdleTimer(projectRoot, existing)
      return existing.client
    }

    if (existing) {
      clearTimeout(existing.idleTimer)
      this.entries.delete(projectRoot)
    }

    const rootUri = `file://${projectRoot}`
    const client = await LspClient.create(this.binaryPath, rootUri)
    const entry: PoolEntry = {
      client,
      idleTimer: this.startIdleTimer(projectRoot),
    }
    this.entries.set(projectRoot, entry)
    return client
  }

  private startIdleTimer(projectRoot: string): Timer {
    return setTimeout(async () => {
      const entry = this.entries.get(projectRoot)
      if (entry) {
        await entry.client.shutdown()
        this.entries.delete(projectRoot)
      }
    }, this.idleTimeoutMs)
  }

  private resetIdleTimer(projectRoot: string, entry: PoolEntry): void {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = this.startIdleTimer(projectRoot)
  }
}

/** Walk up from a file path to find the nearest tsconfig.json */
function findProjectRoot(filePath: string): string {
  let dir = dirname(filePath)
  for (;;) {
    if (existsSync(join(dir, "tsconfig.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirname(filePath)
}
