import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import ts from 'typescript'

/** Read JSON/JSONC path metadata only. No project config code or source is executed. */
export async function projectAliases(root: string): Promise<{ aliases: Record<string, string[]>; diagnostics: string[] }> {
  const aliases: Record<string, string[]> = {}
  const diagnostics: string[] = []
  const visited = new Set<string>()
  const bases = new Map<string, string>()
  async function visit(path: string, depth: number): Promise<string | undefined> {
    path = resolve(path)
    const inside = relative(root, path)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..\\') || inside.startsWith('../') || depth > 8) { diagnostics.push('TSCONFIG_BOUNDARY'); return }
    if (visited.has(path)) return bases.get(path)
    visited.add(path)
    let source: string
    try { source = await readFile(path, 'utf8') } catch (error) { if (depth || (error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push('TSCONFIG_READ'); return }
    if (source.length > 100_000) { diagnostics.push('TSCONFIG_SIZE'); return }
    const parsed = ts.parseConfigFileTextToJson(path, source)
    if (parsed.error) { diagnostics.push('TSCONFIG_PARSE'); return }
    const data = parsed.config as { extends?: unknown; references?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } }
    const parents = Array.isArray(data.extends) ? data.extends : data.extends ? [data.extends] : []
    let inheritedBase: string | undefined
    for (const parent of parents) {
      if (typeof parent === 'string' && parent.startsWith('.')) inheritedBase = await visit(resolve(dirname(path), parent.endsWith('.json') ? parent : parent + '.json'), depth + 1) ?? inheritedBase
      else diagnostics.push('TSCONFIG_PACKAGE_EXTENDS')
    }
    const options = data.compilerOptions
    const base = typeof options?.baseUrl === 'string' ? resolve(dirname(path), options.baseUrl) : inheritedBase ?? dirname(path)
    if (options?.paths && typeof options.paths === 'object' && !Array.isArray(options.paths)) {
      for (const [pattern, targets] of Object.entries(options.paths)) {
        if (Array.isArray(targets) && targets.every(target => typeof target === 'string')) aliases[pattern] = targets.map(target => relative(root, resolve(base, target)).replaceAll('\\', '/'))
        else diagnostics.push('TSCONFIG_PATHS')
      }
    }
    if (Array.isArray(data.references)) for (const ref of data.references) {
      if (ref && typeof ref === 'object' && typeof ref.path === 'string') await visit(resolve(dirname(path), ref.path.endsWith('.json') ? ref.path : `${ref.path}/tsconfig.json`), depth + 1)
    }
    bases.set(path, base)
    return base
  }
  await visit(resolve(root, 'tsconfig.json'), 0)
  return { aliases, diagnostics: [...new Set(diagnostics)] }
}
