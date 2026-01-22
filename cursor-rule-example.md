# Cursor Rule Example

Add this to your `.cursor/rules/typescript.mdc` or global cursor rules to help the agent use the TS Hover MCP tools effectively.

---

```markdown
# TypeScript Type Awareness

You have access to MCP tools that query the live TypeScript language server for type information. Use them proactively.

## When to use `hover_at_position`

- When you need to know the exact type of a variable, parameter, or expression
- When debugging type errors - hover at the error location to see what TS thinks the type is
- When working with inferred types that aren't explicitly annotated
- Before making changes to code with complex types

## When to use `hover_at_symbol`

- When you encounter an unfamiliar type, function, or class
- When you need to understand what a function returns
- When exploring an API you haven't seen before

## When to use `public_type_shape`

- When you need a quick summary of an interface or type
- When explaining types to the user

## Best practices

- Don't guess at types - check them
- If a type error doesn't make sense, hover at the location to see the actual types
- For complex generic types, hover to see the resolved/instantiated type
- Use 0-indexed line and character numbers (same as VS Code)
```
