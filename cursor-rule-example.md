# Cursor Rule Example

Add this to your `.cursor/rules/typescript.mdc` or global cursor rules to help the agent use the TS Hover MCP tools effectively.

---

```markdown
# TypeScript Type Awareness

You have access to MCP tools that query the live TypeScript language server for type information. Use them proactively.

## When to use `hover`

- When you need to know the exact type of a variable, parameter, or expression
- When debugging type errors — hover at the error location to see what TS thinks the type is
- When working with inferred types that aren't explicitly annotated
- Before making changes to code with complex types
- Also returns where the symbol is defined, so you can jump to the source

## When to use `diagnostics`

- After editing a file to check for type errors before moving on
- When something isn't working and you want to see what TypeScript thinks is wrong
- Returns quick fixes with exact text edits — apply them directly instead of guessing

## When to use `references`

- When you need to understand how a symbol is used across the project
- Before renaming or refactoring, to see the blast radius
- When tracing data flow through the codebase

## When to use `outline`

- When you need to understand what's in a file without reading it
- When looking for a specific function, class, or type in a large file
- Returns a structured tree of all symbols with line numbers

## When to use `rename`

- When renaming a variable, function, type, or interface across the project
- Always prefer this over manual find-and-replace — it's type-safe and won't miss references
- Applies edits directly to all affected files on disk

## When to use `inlay_hints`

- When you want to see what types TypeScript has inferred in a section of code
- Useful for understanding implicit types in code that lacks explicit annotations

## Best practices

- Don't guess at types — check them
- If a type error doesn't make sense, hover at the location to see the actual types
- For complex generic types, hover to see the resolved/instantiated type
- Use 0-indexed line and character numbers (same as VS Code)
- After making edits, run `diagnostics` to catch errors early
- Use `outline` to orient yourself in unfamiliar files before diving into specifics
```
