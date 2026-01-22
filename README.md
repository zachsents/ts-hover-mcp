# TS Hover MCP

**Give AI agents access to TypeScript's type system.**

A VS Code/Cursor extension that exposes TypeScript hover and type information via MCP, allowing AI agents to query the live TypeScript language server.

See [extension/README.md](extension/README.md) for full documentation.

## Quick Start

1. Download the latest `.vsix` from [Releases](https://github.com/zachsents/ts-hover-mcp/releases)
2. Install in Cursor: `Cmd+Shift+P` → "Extensions: Install from VSIX"
3. Add to `.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "ts-hover": {
         "url": "http://localhost:7777/mcp"
       }
     }
   }
   ```
4. Restart Cursor

## License

MIT - Zach Sents
