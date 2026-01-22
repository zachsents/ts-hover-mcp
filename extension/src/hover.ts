import * as vscode from "vscode";

/** Cache entry for hover results */
interface CacheEntry {
  version: number;
  hover: string;
}

/** In-memory cache keyed by file:version:line:character */
const hoverCache = new Map<string, CacheEntry>();

/** Strip markdown formatting from text, keeping only plain content */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove fenced code blocks but keep inner content
      .replace(/```[\w]*\n?([\s\S]*?)```/g, "$1")
      // Remove inline code backticks
      .replace(/`([^`]+)`/g, "$1")
      // Remove bold
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      // Remove italic
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Remove links, keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Remove headings markers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove VS Code loading indicator
      .replace(/\(loading\.\.\.\)\s*/g, "")
      // Collapse multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Type guard for LocationLink (has targetUri instead of uri) */
function isLocationLink(
  loc: vscode.Location | vscode.LocationLink
): loc is vscode.LocationLink {
  return "targetUri" in loc;
}

/** Extract file path and position from Location or LocationLink */
function extractLocationInfo(loc: vscode.Location | vscode.LocationLink): {
  filePath: string;
  line: number;
  character: number;
} {
  if (isLocationLink(loc)) {
    // Use targetSelectionRange (the symbol name) rather than targetRange (whole declaration)
    const range = loc.targetSelectionRange ?? loc.targetRange;
    return {
      filePath: loc.targetUri.fsPath,
      line: range.start.line,
      character: range.start.character,
    };
  }
  return {
    filePath: loc.uri.fsPath,
    line: loc.range.start.line,
    character: loc.range.start.character,
  };
}

/** Extract plain text from VS Code hover contents */
function extractHoverText(hovers: vscode.Hover[]): string {
  const parts: string[] = [];

  for (const hover of hovers) {
    for (const content of hover.contents) {
      if (typeof content === "string") {
        parts.push(content);
      } else if (content instanceof vscode.MarkdownString) {
        parts.push(content.value);
      } else if ("value" in content) {
        // MarkedString with language
        parts.push(content.value);
      }
    }
  }

  return stripMarkdown(parts.join("\n\n"));
}

/** Get hover information at a specific position in a file */
export async function hoverAtPosition(
  file: string,
  line: number,
  character: number
): Promise<string> {
  const uri = vscode.Uri.file(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const position = new vscode.Position(line, character);

  // Check cache
  const cacheKey = `${file}:${document.version}:${line}:${character}`;
  const cached = hoverCache.get(cacheKey);
  if (cached && cached.version === document.version) {
    return cached.hover;
  }

  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    position
  );

  if (!hovers || hovers.length === 0) {
    return "";
  }

  const hoverText = extractHoverText(hovers);

  // Cache result
  hoverCache.set(cacheKey, { version: document.version, hover: hoverText });

  return hoverText;
}

/** Find a symbol's position using VS Code's document symbol provider */
async function findSymbolPosition(
  uri: vscode.Uri,
  symbol: string
): Promise<vscode.Position | null> {
  // Try document symbols first (more accurate)
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    uri
  );

  if (symbols && symbols.length > 0) {
    const found = findSymbolInTree(symbols, symbol);
    if (found) {
      return found.selectionRange.start;
    }
  }

  // Fallback: search text (skip comments)
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  const regex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const pos = document.positionAt(match.index);
    const line = document.lineAt(pos.line).text;
    const beforeMatch = line.substring(0, pos.character);

    // Skip if inside a comment
    if (beforeMatch.includes("//") || beforeMatch.includes("*")) {
      continue;
    }

    return pos;
  }

  return null;
}

/** Recursively search for a symbol in DocumentSymbol tree */
function findSymbolInTree(
  symbols: vscode.DocumentSymbol[],
  name: string
): vscode.DocumentSymbol | null {
  for (const sym of symbols) {
    if (sym.name === name) {
      return sym;
    }
    if (sym.children.length > 0) {
      const found = findSymbolInTree(sym.children, name);
      if (found) return found;
    }
  }
  return null;
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Get hover at a symbol's definition location */
export async function hoverAtSymbol(
  file: string,
  symbol: string
): Promise<string> {
  const uri = vscode.Uri.file(file);

  // Find the symbol in the document
  const symbolPos = await findSymbolPosition(uri, symbol);
  if (!symbolPos) {
    throw new Error(`Symbol "${symbol}" not found in ${file}`);
  }

  // Get definition location - can return Location[] or LocationLink[]
  const definitions = await vscode.commands.executeCommand<
    (vscode.Location | vscode.LocationLink)[]
  >("vscode.executeDefinitionProvider", uri, symbolPos);

  if (!definitions || definitions.length === 0) {
    // If no definition found, hover at the symbol occurrence itself
    return hoverAtPosition(file, symbolPos.line, symbolPos.character);
  }

  // Extract location info from the first definition (handles both Location and LocationLink)
  const { filePath, line, character } = extractLocationInfo(definitions[0]);
  return hoverAtPosition(filePath, line, character);
}

/** Extract only the type shape from hover, stripping JSDoc and documentation */
function extractTypeShape(hoverText: string): string {
  const lines = hoverText.split("\n");
  const result: string[] = [];
  let inTypeBlock = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines at the start
    if (result.length === 0 && !trimmed) {
      continue;
    }

    // Skip JSDoc tags
    if (trimmed.startsWith("@")) {
      continue;
    }

    // Skip common documentation patterns
    if (
      /^(Example|Usage|Note|See|Returns|Param|Description):/i.test(trimmed)
    ) {
      continue;
    }

    // Detect start of type/interface/class/function declaration
    if (
      /^(type|interface|class|function|const|let|var|enum)\s+/.test(trimmed) ||
      /^\(/.test(trimmed)
    ) {
      inTypeBlock = true;
    }

    if (inTypeBlock) {
      result.push(line);

      // Track brace depth to know when type block ends
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // End of type block
      if (braceDepth <= 0 && result.length > 0) {
        // Check if this looks like a complete declaration
        const joined = result.join("\n");
        if (joined.includes("{") && joined.includes("}")) {
          break;
        }
        // For simple type aliases without braces
        if (/^type\s+\w+\s*=\s*[^{]+$/.test(trimmed)) {
          break;
        }
      }
    }
  }

  // If we extracted something, return it
  if (result.length > 0) {
    return result.join("\n").trim();
  }

  // Fallback: return first non-empty line (usually the type signature)
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("@") && !trimmed.startsWith("*")) {
      return trimmed;
    }
  }

  return hoverText;
}

/** Get the public type shape of a symbol, stripping documentation */
export async function publicTypeShape(
  file: string,
  symbol: string
): Promise<string> {
  const hover = await hoverAtSymbol(file, symbol);
  return extractTypeShape(hover);
}

/** Clear the hover cache (useful for testing) */
export function clearCache(): void {
  hoverCache.clear();
}
