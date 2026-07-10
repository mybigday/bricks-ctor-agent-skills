#!/usr/bin/env node
/**
 * validate.mjs — lint this marketplace against the rules the CTOR desktop
 * plugin system actually enforces (plus repo conventions). Zero dependencies.
 *
 *   bun scripts/validate.mjs   (or: node scripts/validate.mjs)
 *
 * Checks:
 *  - .bricks-plugin/ and .claude-plugin/ manifests exist and are identical
 *    (marketplace root and every plugin)
 *  - name pattern ^[A-Za-z0-9][A-Za-z0-9_-]*$ (max 64) for marketplace,
 *    plugins, and skills; skill name === directory name
 *  - marketplace entries ↔ plugin dirs: sources exist, versions in sync
 *  - no unsupported component fields (commands, outputStyles, lspServers,
 *    userConfig, channels, dependencies, experimental)
 *  - SKILL.md frontmatter parses with a CTOR-shaped minimal YAML parser
 *    (top-level keys + one nesting level), description ≤ 1024 chars,
 *    no reserved skill names, body ≤ 500 lines (warning)
 *  - relative markdown links in SKILL.md resolve to files
 *  - MCP server commands are version-pinned (warning)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const RESERVED_SKILLS = new Set([
  // CTOR bundled skills + CLI-embedded project skills — install-blocked names.
  'bricks-cli', 'template-creator', 'browser', 'skill-creator', 'brainstorming',
  'imagegen', 'bricks-ctor', 'bricks-design', 'bricks-ux', 'rive-marketplace',
])
const UNSUPPORTED_FIELDS = [
  'commands', 'outputStyles', 'lspServers', 'userConfig', 'channels', 'dependencies', 'experimental',
]

const errors = []
const warnings = []
const err = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    err(`${rel(path)}: ${e.message}`)
    return null
  }
}

const rel = (p) => p.slice(ROOT.length + 1)

function checkDualManifest(dir, file) {
  const a = join(dir, '.bricks-plugin', file)
  const b = join(dir, '.claude-plugin', file)
  for (const p of [a, b]) if (!existsSync(p)) err(`missing ${rel(p)}`)
  if (!existsSync(a) || !existsSync(b)) return null
  const ja = readJson(a)
  const jb = readJson(b)
  if (ja && jb && JSON.stringify(ja) !== JSON.stringify(jb))
    err(`${rel(a)} and ${rel(b)} differ — keep both manifest flavors identical`)
  return ja
}

function checkName(name, what) {
  if (!name) err(`${what}: missing name`)
  else if (name.length > 64) err(`${what}: name longer than 64 chars`)
  else if (!NAME_RE.test(name)) err(`${what}: name "${name}" violates ${NAME_RE}`)
}

// Minimal YAML mirroring CTOR's frontmatter parser: top-level `key: value`
// and ONE nesting level (e.g. under `metadata:`). Anything deeper is flagged.
function parseFrontmatter(src, where) {
  if (!src.startsWith('---\n')) return err(`${where}: missing frontmatter`), null
  const end = src.indexOf('\n---', 4)
  if (end < 0) return err(`${where}: unterminated frontmatter`), null
  const body = src.slice(end + 4)
  const out = {}
  let currentParent = null
  for (const line of src.slice(4, end).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.match(/^ */)[0].length
    const m = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) {
      err(`${where}: frontmatter line not parseable by the minimal parser: "${line.trim().slice(0, 60)}"`)
      continue
    }
    const [, key, value] = m
    if (indent === 0) {
      if (value === '') {
        out[key] = {}
        currentParent = key
      } else {
        out[key] = stripQuotes(value)
        currentParent = null
      }
    } else if (currentParent && indent <= 4) {
      out[currentParent][key] = stripQuotes(value)
    } else {
      err(`${where}: nesting deeper than one level ("${key}") — CTOR's parser won't read it`)
    }
  }
  return { fm: out, body }
}

const stripQuotes = (v) => v.replace(/^['"]|['"]$/g, '')

function checkSkill(dir, pluginName, seenSkillNames) {
  const skillFile = join(dir, 'SKILL.md')
  const where = rel(skillFile)
  const src = readFileSync(skillFile, 'utf8')
  const parsed = parseFrontmatter(src, where)
  if (!parsed) return
  const { fm, body } = parsed
  const dirName = dir.split('/').pop()

  checkName(fm.name, where)
  if (fm.name !== dirName) err(`${where}: frontmatter name "${fm.name}" !== directory name "${dirName}"`)
  if (RESERVED_SKILLS.has(fm.name)) err(`${where}: "${fm.name}" is a reserved bundled/CLI skill name — install would be blocked`)
  if (seenSkillNames.has(fm.name)) err(`${where}: duplicate skill name "${fm.name}" across plugins`)
  seenSkillNames.add(fm.name)

  if (!fm.description) err(`${where}: missing description`)
  else if (fm.description.length > 1024) err(`${where}: description is ${fm.description.length} chars (max 1024)`)
  else if (fm.description.length < 80) warn(`${where}: description is short (${fm.description.length} chars) — add trigger phrases`)

  const lines = body.split('\n').length
  if (lines > 500) warn(`${where}: body is ${lines} lines (>500) — move detail into references/`)

  for (const m of body.matchAll(/\]\(((?:references|scripts)\/[^)#\s]+)\)/g)) {
    if (!existsSync(join(dir, m[1]))) err(`${where}: broken relative link → ${m[1]}`)
  }
}

function checkMcpConfig(path) {
  const cfg = readJson(path)
  if (!cfg?.mcpServers) return err(`${rel(path)}: no mcpServers key`)
  for (const [name, server] of Object.entries(cfg.mcpServers)) {
    const line = [server.command, ...(server.args || [])].join(' ')
    if (/\b(uvx|npx|bunx)\b/.test(line) && !/(==|@\d)/.test(line))
      warn(`${rel(path)}: server "${name}" command is not version-pinned: "${line}"`)
  }
}

// ---------------------------------------------------------------- run ----

const marketplace = checkDualManifest(ROOT, 'marketplace.json')
if (marketplace) {
  checkName(marketplace.name, 'marketplace')
  if (!marketplace.owner?.name) err('marketplace: owner.name is required')
  if (!Array.isArray(marketplace.plugins)) err('marketplace: plugins must be an array')

  const seenSkillNames = new Set()
  for (const entry of marketplace.plugins || []) {
    const what = `marketplace entry "${entry.name}"`
    checkName(entry.name, what)
    if (!entry.description) warn(`${what}: no description (the card shows it)`)
    if (typeof entry.source !== 'string' || !entry.source.startsWith('./'))
      err(`${what}: source must be a "./" relative path inside this repo`)
    const pluginDir = join(ROOT, entry.source || '')
    if (!existsSync(pluginDir)) {
      err(`${what}: source dir missing: ${entry.source}`)
      continue
    }
    const manifest = checkDualManifest(pluginDir, 'plugin.json')
    if (!manifest) continue
    checkName(manifest.name, rel(pluginDir))
    if (manifest.name !== entry.name) err(`${what}: plugin.json name "${manifest.name}" mismatch (install fails on plugin-name-mismatch)`)
    if (manifest.version !== entry.version)
      err(`${what}: version out of sync — marketplace ${entry.version} vs plugin.json ${manifest.version}`)
    for (const field of UNSUPPORTED_FIELDS)
      if (field in manifest) warn(`${rel(pluginDir)}/plugin.json: "${field}" is not supported by CTOR yet (shown as inert)`)

    if (manifest.mcpServers) {
      const mcpPath = join(pluginDir, manifest.mcpServers)
      if (!existsSync(mcpPath)) err(`${rel(pluginDir)}: mcpServers path missing: ${manifest.mcpServers}`)
      else checkMcpConfig(mcpPath)
    }

    const skillsDir = join(pluginDir, 'skills')
    if (!existsSync(skillsDir)) {
      warn(`${rel(pluginDir)}: no skills/ directory`)
      continue
    }
    for (const name of readdirSync(skillsDir)) {
      const dir = join(skillsDir, name)
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(join(dir, 'SKILL.md'))) err(`${rel(dir)}: missing SKILL.md`)
      else checkSkill(dir, entry.name, seenSkillNames)
    }
  }
}

for (const w of warnings) console.log(`warn  ${w}`)
for (const e of errors) console.log(`ERROR ${e}`)
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`)
process.exit(errors.length ? 1 : 0)
