import { type ChildProcess, spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { extname } from "node:path"
import { z } from "zod"

const REQUEST_TIMEOUT_MS = 30_000

const jsonRpcMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
})

type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>

const hoverResultSchema = z.object({
  contents: z.unknown(),
})

/** MarkupContent shape: `{ kind, value }` or just a raw `{ value }` string */
const markupContentSchema = z.object({ value: z.string() })

// Shared LSP building blocks
const positionSchema = z.object({ line: z.number(), character: z.number() })
const rangeSchema = z.object({ start: positionSchema, end: positionSchema })

// Definition/references response — can be Location or LocationLink
const locationSchema = z.object({ uri: z.string(), range: rangeSchema })
const locationLinkSchema = z.object({
  targetUri: z.string(),
  targetRange: rangeSchema,
  targetSelectionRange: rangeSchema.optional(),
})

// Diagnostics
const diagnosticItemSchema = z.object({
  range: rangeSchema,
  severity: z.number().optional(),
  code: z.union([z.number(), z.string()]).optional(),
  source: z.string().optional(),
  message: z.string(),
})
const diagnosticResultSchema = z.object({
  kind: z.string(),
  items: z.array(diagnosticItemSchema),
})

// Code actions
const textEditSchema = z.object({ range: rangeSchema, newText: z.string() })
const codeActionSchema = z.object({
  title: z.string(),
  kind: z.string().optional(),
  diagnostics: z.array(diagnosticItemSchema).optional(),
  edit: z
    .object({
      changes: z.record(z.string(), z.array(textEditSchema)).optional(),
    })
    .optional(),
})

export interface LspLocation {
  file: string
  line: number
  character: number
}

const SEVERITY_LABELS = ["", "error", "warning", "info", "hint"] as const

export interface LspDiagnostic {
  line: number
  character: number
  endLine: number
  endCharacter: number
  severity: (typeof SEVERITY_LABELS)[number]
  message: string
  code?: number | string
}

export interface LspTextEdit {
  file: string
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
  newText: string
}

export interface LspCodeAction {
  title: string
  kind?: string
  edits: LspTextEdit[]
}

// Document symbols — tsgo returns flat SymbolInformation[], not hierarchical
const symbolInformationSchema = z.object({
  name: z.string(),
  kind: z.number(),
  containerName: z.string().optional(),
  location: locationSchema,
})

const SYMBOL_KIND_LABELS: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  22: "enum member",
  26: "type parameter",
}

export interface LspSymbol {
  name: string
  kind: string
  line: number
  character: number
  children: LspSymbol[]
}

// Workspace edit (shared by rename and code actions)
const workspaceEditSchema = z.object({
  changes: z.record(z.string(), z.array(textEditSchema)).optional(),
})

// Inlay hints
const inlayHintLabelSchema = z.union([
  z.string(),
  z.array(z.object({ value: z.string() })),
])

const inlayHintSchema = z.object({
  position: positionSchema,
  label: inlayHintLabelSchema,
  kind: z.number().optional(),
})

const INLAY_HINT_KIND_LABELS: Record<number, string> = {
  1: "type",
  2: "parameter",
}

export interface LspInlayHint {
  line: number
  character: number
  text: string
  kind: string
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: Timer
}

interface DocumentState {
  version: number
  content: string
}

/**
 * LSP JSON-RPC client that communicates with a tsgo process over stdio. Handles
 * Content-Length message framing, request/response correlation,
 * server-initiated requests (e.g. client/registerCapability), and automatic
 * document open/change tracking.
 */
export class LspClient {
  private proc: ChildProcess
  private stdin: NodeJS.WritableStream
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private buffer = Buffer.alloc(0)
  private documents = new Map<string, DocumentState>()
  private alive = true

  private constructor(
    binaryPath: string,
    private rootUri: string,
  ) {
    this.proc = spawn(binaryPath, ["--lsp", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
    })

    if (!this.proc.stdin || !this.proc.stdout) {
      throw new Error("Failed to create tsgo process with piped stdio")
    }
    this.stdin = this.proc.stdin

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drainBuffer()
    })

    this.proc.on("exit", (code) => {
      this.alive = false
      for (const [, req] of this.pending) {
        req.reject(new Error(`tsgo exited with code ${code}`))
        clearTimeout(req.timer)
      }
      this.pending.clear()
    })
  }

  /** Create and initialize a new LSP client for a project root */
  static async create(binaryPath: string, rootUri: string): Promise<LspClient> {
    const client = new LspClient(binaryPath, rootUri)
    await client.initialize()
    return client
  }

  get isAlive() {
    return this.alive
  }

  /** Get hover information at a position in a file */
  async hover(
    filePath: string,
    line: number,
    character: number,
  ): Promise<string | null> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    })

    const parsed = hoverResultSchema.safeParse(result)
    if (!parsed.success) return null

    return formatHoverContents(parsed.data.contents)
  }

  /** Get definition location(s) for a symbol at a position */
  async definition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    })

    return parseLocations(result)
  }

  /** Pull diagnostics for a file */
  async diagnostics(filePath: string): Promise<LspDiagnostic[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest("textDocument/diagnostic", {
      textDocument: { uri },
    })

    const parsed = diagnosticResultSchema.safeParse(result)
    if (!parsed.success) return []

    return parsed.data.items.map((item) => ({
      line: item.range.start.line,
      character: item.range.start.character,
      endLine: item.range.end.line,
      endCharacter: item.range.end.character,
      severity: SEVERITY_LABELS[item.severity ?? 1] ?? "error",
      message: item.message,
      code: item.code,
    }))
  }

  /** Get code actions for a range, optionally scoped to specific diagnostics */
  async codeActions(
    filePath: string,
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    },
    diagnostics: LspDiagnostic[] = [],
  ): Promise<LspCodeAction[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const lspDiagnostics = diagnostics.map((d) => ({
      range: {
        start: { line: d.line, character: d.character },
        end: { line: d.endLine, character: d.endCharacter },
      },
      severity: SEVERITY_LABELS.indexOf(d.severity) || 1,
      message: d.message,
      ...(d.code != null ? { code: d.code } : {}),
    }))

    const result: unknown = await this.sendRequest("textDocument/codeAction", {
      textDocument: { uri },
      range,
      context: { diagnostics: lspDiagnostics },
    })

    if (!Array.isArray(result)) return []

    const actions: LspCodeAction[] = []
    for (const item of result) {
      const parsed = codeActionSchema.safeParse(item)
      if (!parsed.success || !parsed.data.edit) continue

      actions.push({
        title: parsed.data.title,
        kind: parsed.data.kind,
        edits: parseWorkspaceEdit(parsed.data.edit),
      })
    }

    return actions
  }

  /** Get a structured outline of all symbols in a file */
  async documentSymbols(filePath: string): Promise<LspSymbol[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest(
      "textDocument/documentSymbol",
      { textDocument: { uri } },
    )

    if (!Array.isArray(result)) return []

    return buildSymbolTree(result)
  }

  /** Rename a symbol across the project */
  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<LspTextEdit[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName,
    })

    return parseWorkspaceEdit(result)
  }

  /** Get inferred type annotations for a line range */
  async inlayHints(
    filePath: string,
    startLine: number,
    endLine: number,
  ): Promise<LspInlayHint[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest("textDocument/inlayHint", {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: 0 },
        end: { line: endLine, character: 0 },
      },
    })

    if (!Array.isArray(result)) return []

    const hints: LspInlayHint[] = []
    for (const item of result) {
      const parsed = inlayHintSchema.safeParse(item)
      if (!parsed.success) continue

      const label = parsed.data.label
      const text =
        typeof label === "string"
          ? label
          : label.map((part) => part.value).join("")

      hints.push({
        line: parsed.data.position.line,
        character: parsed.data.position.character,
        text,
        kind: INLAY_HINT_KIND_LABELS[parsed.data.kind ?? 0] ?? "unknown",
      })
    }

    return hints
  }

  /** Find all references to a symbol at a position */
  async references(
    filePath: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    if (!this.alive) throw new Error("LSP client is not alive")

    const uri = pathToUri(filePath)
    await this.ensureDocumentOpen(filePath, uri)

    const result: unknown = await this.sendRequest("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    })

    return parseLocations(result)
  }

  /** Gracefully shut down the LSP server */
  async shutdown(): Promise<void> {
    if (!this.alive) return
    this.alive = false

    try {
      await this.sendRequest("shutdown", null)
      this.sendNotification("exit", undefined)
    } catch {
      // Process may already be dead
    }

    this.proc.kill()
  }

  private async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
        },
      },
    })
    this.sendNotification("initialized", {})
  }

  /** Open a document in the LSP if needed, or update it if contents changed */
  private async ensureDocumentOpen(
    filePath: string,
    uri: string,
  ): Promise<void> {
    const content = await readFile(filePath, "utf-8")
    const existing = this.documents.get(uri)

    if (!existing) {
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: getLanguageId(filePath),
          version: 1,
          text: content,
        },
      })
      this.documents.set(uri, { version: 1, content })
      return
    }

    if (existing.content !== content) {
      const version = existing.version + 1
      this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      })
      this.documents.set(uri, { version, content })
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(
            `Request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        )
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  private sendNotification(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params })
  }

  private sendResponse(id: number | string, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result })
  }

  private send(message: object): void {
    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
    this.stdin.write(header + body)
  }

  /** Parse Content-Length framed messages from the buffer */
  private drainBuffer(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return

      const header = this.buffer.subarray(0, headerEnd).toString("ascii")
      const match = header.match(/Content-Length:\s*(\d+)/)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }

      const contentLength = Number.parseInt(match[1] ?? "0", 10)
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + contentLength

      if (this.buffer.length < bodyEnd) return

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf-8")
      this.buffer = this.buffer.subarray(bodyEnd)

      const parsed = jsonRpcMessageSchema.safeParse(JSON.parse(body))
      if (parsed.success) this.handleMessage(parsed.data)
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    // Response to one of our requests (numeric id, no method)
    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return

      clearTimeout(pending.timer)
      this.pending.delete(message.id)

      if (message.error) {
        pending.reject(
          new Error(
            `LSP error: ${message.error.message} (${message.error.code})`,
          ),
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    // Server-initiated request — auto-acknowledge
    if (message.id != null && message.method) {
      this.sendResponse(message.id, null)
    }
  }
}

function pathToUri(filePath: string): string {
  return `file://${filePath}`
}

function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "")
}

/**
 * Parse Location[] or LocationLink[] from an LSP response into LspLocation[].
 * Handles single objects, arrays, and null.
 */
function parseLocations(result: unknown): LspLocation[] {
  if (result == null) return []
  const items = Array.isArray(result) ? result : [result]
  const locations: LspLocation[] = []

  for (const item of items) {
    const loc = locationSchema.safeParse(item)
    if (loc.success) {
      locations.push({
        file: uriToPath(loc.data.uri),
        line: loc.data.range.start.line,
        character: loc.data.range.start.character,
      })
      continue
    }

    const link = locationLinkSchema.safeParse(item)
    if (link.success) {
      const range = link.data.targetSelectionRange ?? link.data.targetRange
      locations.push({
        file: uriToPath(link.data.targetUri),
        line: range.start.line,
        character: range.start.character,
      })
    }
  }

  return locations
}

/**
 * Build a symbol tree from flat SymbolInformation[]. Uses containerName to
 * reconstruct parent-child relationships.
 */
function buildSymbolTree(items: unknown[]): LspSymbol[] {
  const flat: Array<{ symbol: LspSymbol; containerName?: string }> = []

  for (const item of items) {
    const parsed = symbolInformationSchema.safeParse(item)
    if (!parsed.success) continue

    flat.push({
      symbol: {
        name: parsed.data.name,
        kind:
          SYMBOL_KIND_LABELS[parsed.data.kind] ?? `kind(${parsed.data.kind})`,
        line: parsed.data.location.range.start.line,
        character: parsed.data.location.range.start.character,
        children: [],
      },
      containerName: parsed.data.containerName,
    })
  }

  const byName = new Map<string, LspSymbol>()
  for (const entry of flat) {
    if (!byName.has(entry.symbol.name)) {
      byName.set(entry.symbol.name, entry.symbol)
    }
  }

  const roots: LspSymbol[] = []
  for (const entry of flat) {
    const parent = entry.containerName
      ? byName.get(entry.containerName)
      : undefined
    if (parent) {
      parent.children.push(entry.symbol)
    } else {
      roots.push(entry.symbol)
    }
  }

  return roots
}

/** Parse a WorkspaceEdit into flat LspTextEdit[] */
function parseWorkspaceEdit(result: unknown): LspTextEdit[] {
  const parsed = workspaceEditSchema.safeParse(result)
  if (!parsed.success || !parsed.data.changes) return []

  const edits: LspTextEdit[] = []
  for (const [editUri, textEdits] of Object.entries(parsed.data.changes)) {
    const file = uriToPath(editUri)
    for (const te of textEdits) {
      edits.push({
        file,
        startLine: te.range.start.line,
        startCharacter: te.range.start.character,
        endLine: te.range.end.line,
        endCharacter: te.range.end.character,
        newText: te.newText,
      })
    }
  }
  return edits
}

function getLanguageId(filePath: string): string {
  const ext = extname(filePath)
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript"
    case ".tsx":
      return "typescriptreact"
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript"
    case ".jsx":
      return "javascriptreact"
    default:
      return "typescript"
  }
}

/**
 * Extract text from LSP hover contents. Handles MarkupContent (`{ value }`),
 * plain strings, and arrays of either.
 */
function formatHoverContents(contents: unknown): string | null {
  const str = z.string().safeParse(contents)
  if (str.success) return str.data

  if (Array.isArray(contents)) {
    const parts = contents.map(formatHoverContents).filter(Boolean)
    return parts.length > 0 ? parts.join("\n\n") : null
  }

  const markup = markupContentSchema.safeParse(contents)
  if (markup.success) return markup.data.value

  return null
}
