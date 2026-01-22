# Future Plans

## Expanded Type Bodies

Currently, `public_type_shape` returns exactly what VS Code's hover shows - for interfaces/types this is the declaration name and JSDoc, not the expanded body with all properties.

To get full expanded type bodies (e.g., showing all properties of an interface), potential approaches:

1. **Read source definition range** - Use the document symbol's `range` to extract the actual source text of the type definition

2. **TypeScript compiler API** - Use `ts.createProgram` or the language service directly to get the full type structure (but this conflicts with the "don't reimplement type inference" constraint)

3. **Hover at each property** - For interfaces, iterate through child symbols and hover at each to build up the full shape

4. **VS Code's "Go to Type Definition"** - May provide more detailed type info in some cases
