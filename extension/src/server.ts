import * as http from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { hoverAtPosition, hoverAtSymbol, publicTypeShape } from "./hover"

/** Create and configure the MCP server with tools */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ts-hover",
    version: "0.1.0",
  })

  server.registerTool(
    "hover_at_position",
    {
      title: "Hover at Position",
      description:
        "Get TypeScript hover information at a specific file location",
      inputSchema: {
        file: z.string().describe("Absolute path to the TypeScript file"),
        line: z.number().describe("Line number (0-indexed)"),
        character: z.number().describe("Character position (0-indexed)"),
      },
    },
    async ({ file, line, character }) => {
      const hover = await hoverAtPosition(file, line, character)
      return {
        content: [{ type: "text" as const, text: hover || "(no hover info)" }],
      }
    }
  )

  server.registerTool(
    "hover_at_symbol",
    {
      title: "Hover at Symbol",
      description: "Get TypeScript hover information at a symbol's definition",
      inputSchema: {
        file: z.string().describe("Absolute path to the TypeScript file"),
        symbol: z.string().describe("Name of the symbol to look up"),
      },
    },
    async ({ file, symbol }) => {
      const hover = await hoverAtSymbol(file, symbol)
      return {
        content: [{ type: "text" as const, text: hover || "(no hover info)" }],
      }
    }
  )

  server.registerTool(
    "public_type_shape",
    {
      title: "Public Type Shape",
      description:
        "Get the public type shape of a symbol, stripping documentation",
      inputSchema: {
        file: z.string().describe("Absolute path to the TypeScript file"),
        symbol: z.string().describe("Name of the type/interface to look up"),
      },
    },
    async ({ file, symbol }) => {
      const typeShape = await publicTypeShape(file, symbol)
      return {
        content: [
          { type: "text" as const, text: typeShape || "(no type info)" },
        ],
      }
    }
  )

  return server
}

/** Create the HTTP server with MCP StreamableHTTP transport */
export function createServer(port: number): http.Server {
  const mcpServer = createMcpServer()

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`)

    if (url.pathname === "/mcp") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })

      await mcpServer.connect(transport)
      await transport.handleRequest(req, res)
      return
    }

    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
  })

  httpServer.listen(port, "127.0.0.1")
  return httpServer
}
