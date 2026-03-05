# TS Hover MCP

**Give AI agents TypeScript type inference — no editor required.**

A standalone MCP server that provides TypeScript type information using [tsgo](https://github.com/nicolo-ribaudo/tc39-proposal-type-annotations) (the native Go-based TypeScript compiler). Works with any MCP client — Cursor, Claude Desktop, VS Code, Windsurf, or any other agent.

No running editor needed. It spawns and manages tsgo LSP instances directly, keeping them warm for fast subsequent queries.

## Prerequisites

Install tsgo globally:

```bash
bun add -g @typescript/native-preview
```

## Install

### Cursor

[![Install in Cursor](https://img.shields.io/badge/Install_in-Cursor-blue?logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=ts-hover&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB6YWNoc2VudHMvdHMtbWNwIl19)

Or manually add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ts-hover": {
      "command": "npx",
      "args": ["-y", "@zachsents/ts-mcp"]
    }
  }
}
```

### VS Code

[![Install in VS Code](https://img.shields.io/badge/Install_in-VS_Code-blue?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=ts-hover&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40zachsents%2Fts-mcp%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/Install_in-VS_Code_Insiders-teal?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=ts-hover&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40zachsents%2Fts-mcp%22%5D%7D&quality=insiders)

Or manually add to your User Settings (JSON):

```json
{
  "mcp": {
    "servers": {
      "ts-hover": {
        "command": "npx",
        "args": ["-y", "@zachsents/ts-mcp"]
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "ts-hover": {
      "command": "npx",
      "args": ["-y", "@zachsents/ts-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add-json ts-hover '{"command":"npx","args":["-y","@zachsents/ts-mcp"]}'
```

### Windsurf

Add to your Windsurf MCP config:

```json
{
  "mcpServers": {
    "ts-hover": {
      "command": "npx",
      "args": ["-y", "@zachsents/ts-mcp"]
    }
  }
}
```

## How it works

1. Agent calls a tool (e.g. `hover` with a file path and position)
2. The MCP server finds the nearest `tsconfig.json` to determine the project root
3. It spawns (or reuses) a tsgo LSP instance for that project
4. Returns the type information
5. The tsgo instance stays warm for 5 minutes, making follow-up queries near-instant

Multiple project roots are handled automatically — each gets its own tsgo instance.

## Tools

### `hover`

Get TypeScript type information at a position, plus where it's defined. Returns the same info you'd see hovering in an IDE — resolved types, inferred types, JSDoc — and the definition location.

| Parameter   | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `file`      | `string` | Absolute path to the TypeScript file |
| `line`      | `number` | Line number (0-indexed)              |
| `character` | `number` | Character position (0-indexed)       |

### `diagnostics`

Get TypeScript errors and warnings for a file, along with available quick fixes and their exact text edits.

| Parameter | Type     | Description                          |
| --------- | -------- | ------------------------------------ |
| `file`    | `string` | Absolute path to the TypeScript file |

### `references`

Find all references to a symbol across the project.

| Parameter   | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `file`      | `string` | Absolute path to the TypeScript file |
| `line`      | `number` | Line number (0-indexed)              |
| `character` | `number` | Character position (0-indexed)       |

### `outline`

Get a structured outline of all symbols in a file — functions, classes, interfaces, types, variables — with line numbers and nesting.

| Parameter | Type     | Description                          |
| --------- | -------- | ------------------------------------ |
| `file`    | `string` | Absolute path to the TypeScript file |

### `rename`

Rename a symbol across the project. Applies the edits directly to all affected files.

| Parameter   | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `file`      | `string` | Absolute path to the TypeScript file |
| `line`      | `number` | Line number (0-indexed)              |
| `character` | `number` | Character position (0-indexed)       |
| `newName`   | `string` | The new name for the symbol          |

### `inlay_hints`

Get inferred type annotations for a line range — variable types, parameter types, return types that TypeScript infers but aren't written in code.

| Parameter   | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `file`      | `string` | Absolute path to the TypeScript file |
| `startLine` | `number` | Start line (0-indexed, inclusive)    |
| `endLine`   | `number` | End line (0-indexed, exclusive)      |

> **Note:** Requires tsgo inlay hint support, which is still in development. The tool will start returning results as tsgo fills in this capability.

## Configuration

| Env var     | Description                          |
| ----------- | ------------------------------------ |
| `TSGO_PATH` | Override the path to the tsgo binary |

## License

MIT — Zach Sents
