/** Quick smoke test that exercises all pool methods. Run: bun test/smoke.ts */
import { resolve } from "node:path"
import { TsgoPool } from "../src/pool.ts"
import { resolveTsgoBinary } from "../src/resolve-binary.ts"

const binary = resolveTsgoBinary()
console.error(`Using tsgo binary: ${binary}`)

const pool = new TsgoPool(binary)
const testFile = resolve(import.meta.dirname, "sample.ts")

// 1. Hover + definition
console.error(`\n--- hover (createWorkflow, line 38 char 9) ---`)
const hover = await pool.hoverWithDefinition(testFile, 38, 9)
console.log("Hover:", hover.hover?.split("\n")[0])
console.log("Definition:", hover.definition)

// 2. Diagnostics with fixes
console.error(`\n--- diagnostics ---`)
const { diagnostics, actions } = await pool.diagnosticsWithFixes(testFile)
console.log(`Errors/warnings: ${diagnostics.length}`)
for (const d of diagnostics) {
  console.log(`  ${d.line}:${d.character} ${d.severity}: ${d.message}`)
}
console.log(`Code actions: ${actions.length}`)
for (const a of actions) {
  console.log(`  ${a.title} (${a.kind}) — ${a.edits.length} edit(s)`)
}

// 3. References for createWorkflow
console.error(`\n--- references (createWorkflow, line 38 char 9) ---`)
const refs = await pool.references(testFile, 38, 9)
console.log(`Found ${refs.length} reference(s):`)
for (const ref of refs) {
  console.log(`  ${ref.file}:${ref.line}:${ref.character}`)
}

// 4. Outline
console.error(`\n--- outline ---`)
const symbols = await pool.outline(testFile)
console.log(`Top-level symbols: ${symbols.length}`)
for (const sym of symbols) {
  console.log(`  ${sym.kind} ${sym.name} (line ${sym.line})`)
  for (const child of sym.children) {
    console.log(`    ${child.kind} ${child.name} (line ${child.line})`)
  }
}

// 5. Rename (dry run — just see what edits would be produced)
console.error(
  `\n--- rename (createWorkflow -> buildWorkflow, line 38 char 9) ---`,
)
const renameEdits = await pool.rename(testFile, 38, 9, "buildWorkflow")
console.log(`Rename edits: ${renameEdits.length}`)
for (const e of renameEdits) {
  console.log(
    `  ${e.file}:${e.startLine}:${e.startCharacter} -> ${e.endLine}:${e.endCharacter}`,
  )
}

// 6. Inlay hints (lines 50-65 — example usage section with inferred types)
console.error(`\n--- inlay hints (lines 50-65) ---`)
const hints = await pool.inlayHints(testFile, 50, 65)
console.log(`Inlay hints: ${hints.length}`)
for (const h of hints) {
  console.log(`  ${h.line}:${h.character} ${h.kind}: ${h.text}`)
}

await pool.shutdown()
console.error("\nDone.")
