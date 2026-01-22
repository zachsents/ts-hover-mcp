# TS Hover MCP

**Give AI agents access to TypeScript's type system.**

This extension exposes TypeScript hover and type information via [MCP (Model Context Protocol)](https://modelcontextprotocol.io/), allowing Cursor's AI agent to query the live TypeScript language server for accurate type information.

## Why?

AI coding assistants often guess at types or make mistakes with complex TypeScript. With this extension, the agent can ask: *"What's the type of this variable?"* and get the **exact same answer** you see when hovering in the editor.

## Features

| Tool | Description |
|------|-------------|
| `hover_at_position` | Get hover info at a specific file:line:character |
| `hover_at_symbol` | Get hover info at a symbol's definition |
| `public_type_shape` | Get compact type signature, stripping JSDoc |

All tools:
- Use the **real** VS Code/Cursor TypeScript language server
- Support **unsaved buffers** (in-memory changes)
- Return **exactly** what you see when hovering
- Cache results per document version

## Installation

### From VSIX (Recommended)

1. Download the latest `.vsix` from [Releases](https://github.com/zachsents/ts-hover-mcp/releases)
2. In Cursor: `Cmd+Shift+P` → "Extensions: Install from VSIX"
3. Select the downloaded file
4. Reload Cursor

### From Source

```bash
git clone https://github.com/zachsents/ts-hover-mcp
cd ts-hover-mcp/extension
bun install
bun run package
# Then install the generated .vsix
```

## Setup MCP

Add to your `.cursor/mcp.json` (per-project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "ts-hover": {
      "url": "http://localhost:7777/mcp"
    }
  }
}
```

Restart Cursor. The agent now has access to TypeScript type information!

## Example

The agent can now do things like:

```
Agent: Let me check the type of that variable...
[calls hover_at_position]
→ "const workflow: Workflow"

Agent: What properties does Workflow have?
[calls hover_at_position on each property]
→ id: string
→ config: WorkflowConfig  
→ status: "pending" | "running" | "completed" | "failed"
→ run: () => Promise<void>
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `tsHoverMcp.port` | `7777` | Port for the MCP HTTP server |

## Cursor Rule (Optional)

To help the agent use these tools proactively, add a cursor rule. See [cursor-rule-example.md](../cursor-rule-example.md) for a template that tells the agent when to check types instead of guessing.

## Limitations

- File paths must be absolute
- Symbol search finds the first occurrence in the file
- Type shape extraction uses heuristics for complex types

## License

MIT

## Author

**Zach Sents** - [zachsents@gmail.com](mailto:zachsents@gmail.com)
