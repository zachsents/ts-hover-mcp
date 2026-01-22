import * as vscode from "vscode";
import type { Server } from "node:http";
import { createServer } from "./server";

let server: Server | null = null;
let outputChannel: vscode.OutputChannel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  // Get configured port
  const config = vscode.workspace.getConfiguration("tsHoverMcp");
  const port = config.get<number>("port") ?? 7777;

  // Create output channel for logging
  outputChannel = vscode.window.createOutputChannel("TS Hover MCP");
  outputChannel.appendLine(`Starting TS Hover MCP server on port ${port}...`);

  try {
    server = createServer(port);

    server.on("listening", () => {
      outputChannel?.appendLine(
        `TS Hover MCP server running at http://localhost:${port}/mcp`
      );
      outputChannel?.appendLine("Available tools:");
      outputChannel?.appendLine("  - hover_at_position: Get hover info at file:line:character");
      outputChannel?.appendLine("  - hover_at_symbol: Get hover info at symbol definition");
      outputChannel?.appendLine("  - public_type_shape: Get compact type shape of a symbol");
    });

    server.on("error", (err: Error) => {
      outputChannel?.appendLine(`Server error: ${err.message}`);
      vscode.window.showErrorMessage(`TS Hover MCP server error: ${err.message}`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to start server: ${message}`);
    vscode.window.showErrorMessage(`Failed to start TS Hover MCP server: ${message}`);
  }

  // Register disposal
  context.subscriptions.push({
    dispose: () => {
      if (server) {
        server.close();
        outputChannel?.appendLine("TS Hover MCP server stopped");
      }
    },
  });
}

export function deactivate(): void {
  if (server) {
    server.close();
    server = null;
  }
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = null;
  }
}
