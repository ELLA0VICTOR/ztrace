import ts from 'typescript'
import { isAnalyticsReference, kindLabels, loggingMethods, sensitiveKinds } from './rules.js'
import { inspectViewingCapability } from '../../protocol/src/unified.js'
import type {
  Diagnostic, Finding, Location, ModelCoverage, ScanOptions, ScanReport, SensitiveKind, SourceFile, TraceStep,
} from './types.js'

interface Flow {
  id: string
  kind: SensitiveKind
  trace: TraceStep[]
}

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration
interface Value {
  flows: Flow[]
  fields: Map<string, Value>
  reference?: string
  fn?: FunctionNode
  closure?: Environment
  literal?: string | number | boolean | null
  trail?: TraceStep[]
  alternatives?: Value[]
  classNode?: ts.ClassDeclaration
  state?: { value: Value }
  setter?: { value: Value }
  array?: boolean
  serialized?: Value
}
type Environment = Map<ts.Symbol, Value>

const empty = (): Value => ({ flows: [], fields: new Map() })
const ref = (reference: string): Value => ({ ...empty(), reference })
const isFunction = (node: ts.Node): node is FunctionNode =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

function uniqueFlows(flows: Flow[]): Flow[] {
  const found = new Map<string, Flow>()
  for (const flow of flows) if (!found.has(flow.id)) found.set(flow.id, flow)
  return [...found.values()]
}

function allFlows(value: Value, visited = new Set<Value>()): Flow[] {
  if (visited.has(value)) return []
  visited.add(value)
  return uniqueFlows([...value.flows, ...(value.state ? allFlows(value.state.value, visited) : []), ...[...value.fields.values()].flatMap(child => allFlows(child, visited))])
    .map(flow => ({ ...flow, trace: [...flow.trace, ...(value.trail ?? [])] }))
}

function merge(...values: Value[]): Value {
  return mergeValues(values, new Set())
}

function mergeValues(values: Value[], seen: Set<Map<string, Value>>): Value {
  if (values.some(value => seen.has(value.fields))) return { ...empty(), flows: uniqueFlows(values.flatMap(value => allFlows(value))) }
  values.forEach(value => seen.add(value.fields))
  const result = empty()
  if (values.some(value => value.array)) result.array = true
  result.flows = uniqueFlows(values.flatMap(value => value.flows.map(flow => ({ ...flow, trace: [...flow.trace, ...(value.trail ?? [])] }))))
  const keys = new Set(values.flatMap(value => [...value.fields.keys()]))
  for (const key of keys) result.fields.set(key, mergeValues(values.map(value => {
    const child = value.fields.get(key) ?? empty()
    return { ...child, trail: [...(child.trail ?? []), ...(value.trail ?? [])] }
  }), new Set(seen)))
  const capabilities = values.flatMap(value => value.alternatives ?? (value.reference || value.fn || value.classNode || value.setter ? [value] : []))
  const unique = capabilities.filter((value, index) => capabilities.findIndex(other => other.reference === value.reference && other.fn === value.fn && other.classNode === value.classNode && other.setter === value.setter) === index)
  if (unique.length === 1) {
    result.reference = unique[0]!.reference
    result.fn = unique[0]!.fn
    result.closure = unique[0]!.closure
    result.classNode = unique[0]!.classNode
    result.setter = unique[0]!.setter
  } else if (unique.length > 1) result.alternatives = unique
  const state = values.find(value => value.state)?.state
  if (state) result.state = state
  if (values.every(value => value.literal === values[0]?.literal)) result.literal = values[0]?.literal
  return result
}

function fork(env: Environment): Environment {
  const seen = new Map<Value, Value>()
  const fieldCopies = new Map<Map<string, Value>, Map<string, Value>>()
  const copy = (value: Value): Value => {
    const existing = seen.get(value)
    if (existing) return existing
    const fields = fieldCopies.get(value.fields)
    const result = { ...value, fields: fields ?? new Map<string, Value>() }
    seen.set(value, result)
    if (!fields) {
      fieldCopies.set(value.fields, result.fields)
      for (const [key, child] of value.fields) result.fields.set(key, copy(child))
    }
    return result
  }
  return new Map([...env].map(([key, value]) => [key, copy(value)]))
}

/** Static source analysis only. No scanned module or configuration code is executed. */
export function scanSources(inputs: SourceFile[], options: ScanOptions = {}): ScanReport {
  if (!Array.isArray(inputs) || inputs.length > 1000 || inputs.some(input => !input || typeof input.path !== 'string' || !input.path || input.path.length > 4096 || typeof input.content !== 'string')) throw new Error('Provide at most 1000 source files with valid paths and text.')
  let inputBytes = 0
  for (const input of inputs) {
    const size = new TextEncoder().encode(input.content).length
    inputBytes += size
    if (size > 1_000_000 || inputBytes > 20_000_000) throw new Error('Source input exceeds the analysis size limit.')
  }
  if (options.requireSources !== undefined && typeof options.requireSources !== 'boolean') throw new Error('requireSources must be a boolean.')
  if (options.requiredSourceKinds !== undefined && (!Array.isArray(options.requiredSourceKinds) || !options.requiredSourceKinds.every(kind => sensitiveKinds.includes(kind)))) throw new Error('Invalid required source categories.')
  const files = new Map(inputs.map(input => [normalize(input.path), input.content]))
  if (files.size !== inputs.length) throw new Error('Source paths must be unique after normalization.')
  const displayPaths = new Map(inputs.map(input => [normalize(input.path), input.path.replaceAll('\\', '/')]))
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    allowJs: true, noLib: true, noResolve: false, jsx: ts.JsxEmit.Preserve,
  }
  const host: ts.CompilerHost = {
    getSourceFile: (name, languageVersion) => {
      const content = files.get(normalize(name))
      return content === undefined ? undefined : ts.createSourceFile(name, content, languageVersion, true)
    },
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: name => files.has(normalize(name)),
    readFile: name => files.get(normalize(name)), getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, containingFile) => names.map(name => {
      const bases: string[] = []
      if (name.startsWith('.')) bases.push(normalize(`${containingFile.slice(0, containingFile.lastIndexOf('/'))}/${name}`))
      for (const [pattern, targets] of Object.entries(options.moduleAliases ?? {})) {
        const [prefix, suffix] = pattern.split('*')
        if (pattern.includes('*') ? name.startsWith(prefix!) && name.endsWith(suffix ?? '') : name === pattern) {
          const middle = pattern.includes('*') ? name.slice(prefix!.length, suffix ? -suffix.length : undefined) : ''
          bases.push(...targets.map(target => normalize(target.replace('*', middle))))
        }
      }
      for (const base of bases) {
      const withoutJs = base.replace(/\.(?:mjs|cjs|js|jsx)$/u, '')
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`,
        `${base}/index.tsx`, `${base}/index.js`, `${withoutJs}.ts`, `${withoutJs}.tsx`, `${withoutJs}.mts`]
      const resolved = candidates.find(candidate => files.has(candidate))
      if (resolved) return { resolvedFileName: resolved, isExternalLibraryImport: false }
      }
      return undefined
    }),
  }
  const program = ts.createProgram([...files.keys()], compilerOptions, host)
  const checker = program.getTypeChecker()
  const environment: Environment = new Map()
  const resolving = new Set<ts.Symbol>()
  const activeFunctions = new Set<FunctionNode>()
  const findings = new Map<string, Finding>()
  const diagnostics = new Map<string, Diagnostic>()
  const sources = new Set<string>()
  const observedKinds = new Set<SensitiveKind>()
  const importInventory = new Map<string, ModelCoverage['imports'][number]>()
  const functions: FunctionNode[] = []
  const expandedFunctions = new Set<FunctionNode>()
  const closureContexts = new Map<FunctionNode, Set<Environment>>()
  const thisStack: Value[] = []
  const exceptionFrames: Value[][] = []
  let loopDepth = 0
  let symbolicLoopDepth = 0
  let switchDepth = 0
  let steps = 0
  const maxSteps = options.maxSteps ?? 100_000
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 1_000_000) throw new Error('maxSteps must be an integer between 1 and 1000000.')
  const budgetExceeded = Symbol('budget')

  function location(node: ts.Node): Location {
    const file = node.getSourceFile()
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    return { file: displayPaths.get(normalize(file.fileName)) ?? file.fileName, line: position.line + 1, column: position.character + 1 }
  }

  function diagnostic(node: ts.Node, code: string, message: string): void {
    const at = location(node)
    diagnostics.set(`${code}:${at.file}:${at.line}:${at.column}`, { ...at, code, message })
  }

  function recordImport(name: string, node: ts.Node, local: boolean): void {
    const customSource = options.sources?.some(rule => rule.module === name)
    const customSink = options.sinks?.some(rule => rule.module === name)
    const builtSource = ['@noir-wallet/sdk', '@rhea-finance/zcash-wallet-adapter', '@rhea-finance/zcash-wallet-adapter/react', '@rhea-finance/zcash-wallet-adapter/walletconnect', '@ledgerhq/zcash-utils'].includes(name)
    const builtSink = ['axios', 'posthog-js', '@segment/analytics-next', '@sentry/browser', '@sentry/react', '@sentry/node', 'pino', 'winston'].includes(name)
    const transform = ['react', '@noir-wallet/sdk', '@noir-wallet/sdk/chains/zcash'].includes(name)
    // URL imports may contain credentials or query tokens. Inventory package identifiers only.
    const identifier = /^[@\w./-]{1,160}$/u.test(name) ? name : '[non-package-specifier]'
    const item: ModelCoverage['imports'][number] = importInventory.get(identifier) ?? {module: identifier, model: customSource || customSink ? 'configured' : builtSource || builtSink || transform ? 'built-in' : local ? 'local' : 'unmodeled', roles: [], locations: []}
    if (customSource || builtSource) item.roles.push('source')
    if (customSink || builtSink) item.roles.push('sink')
    if (transform) item.roles.push('transform')
    item.roles = [...new Set(item.roles)]
    const at = location(node)
    if (!item.locations.some(other => other.file === at.file && other.line === at.line && other.column === at.column)) item.locations.push(at)
    importInventory.set(identifier, item)
  }

  function tick(node: ts.Node): void {
    if (++steps > maxSteps) {
      diagnostic(node, 'ANALYSIS_LIMIT', 'Analysis stopped at the configured step limit. Some code was not checked.')
      throw budgetExceeded
    }
  }

  function functionValue(fn: FunctionNode, env: Environment): Value {
    if (expandedFunctions.has(fn)) return {...empty(), fn, closure: env}
    const contexts = closureContexts.get(fn) ?? new Set<Environment>()
    if (contexts.size < 8) contexts.add(env)
    else if (!contexts.has(env)) diagnostic(fn, 'CLOSURE_CONTEXT_LIMIT', 'Additional closure contexts require review.')
    closureContexts.set(fn, contexts)
    return {...empty(), fn, closure: env}
  }

  function source(node: ts.Node, kind: SensitiveKind, label: string): Value {
    const at = location(node)
    const id = `${kind}:${at.file}:${at.line}:${at.column}`
    sources.add(id)
    observedKinds.add(kind)
    return { ...empty(), flows: [{ id, kind, trace: [{ ...at, kind: 'source', label }] }] }
  }

  function step(value: Value, node: ts.Node, kind: TraceStep['kind'], label: string): Value {
    return { ...value, trail: [...(value.trail ?? []), { ...location(node), kind, label }] }
  }

  function symbol(node: ts.Node): ts.Symbol | undefined {
    return checker.getSymbolAtLocation(node)
  }

  function moduleReference(declaration: ts.Declaration): string | undefined {
    let module: string | undefined
    let name: string | undefined
    if (ts.isImportSpecifier(declaration)) {
      const statement = declaration.parent.parent.parent
      if (ts.isStringLiteral(statement.moduleSpecifier)) module = statement.moduleSpecifier.text
      name = (declaration.propertyName ?? declaration.name).text
    } else if (ts.isImportClause(declaration)) {
      const statement = declaration.parent
      if (ts.isStringLiteral(statement.moduleSpecifier)) module = statement.moduleSpecifier.text
      name = 'default'
    } else if (ts.isNamespaceImport(declaration)) {
      const statement = declaration.parent.parent
      if (ts.isStringLiteral(statement.moduleSpecifier)) module = statement.moduleSpecifier.text
      name = '*'
    }
    return module && name ? `import:${module}:${name}` : undefined
  }

  function lookup(name: ts.Identifier, env: Environment): Value {
    let key = symbol(name)
    if (ts.isShorthandPropertyAssignment(name.parent)) key = checker.getShorthandAssignmentValueSymbol(name.parent) ?? key
    if (!key || (['globalThis', 'require', 'undefined'].includes(name.text) && !key.declarations?.length)) return ref(`global:${name.text}`)
    const existing = env.get(key) ?? environment.get(key)
    if (existing) return existing
    const declarations = key.declarations ?? []
    const imported = declarations.map(moduleReference).find(Boolean)
    if (imported) {
      const configured = options.sources?.some(rule => imported === `import:${rule.module}:${rule.export}`)
        || options.sinks?.some(rule => imported === `import:${rule.module}:${rule.export.split('.')[0]}`)
      const localTarget = key.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(key) : key
      const local = localTarget.declarations?.some(declaration => files.has(normalize(declaration.getSourceFile().fileName)))
      if (configured || !local) return ref(imported)
    }
    if (key.flags & ts.SymbolFlags.Alias) key = checker.getAliasedSymbol(key)
    const cached = env.get(key) ?? environment.get(key)
    if (cached) return cached
    if (resolving.has(key)) return empty()
    resolving.add(key)
    let value = empty()
    for (const declaration of key.declarations ?? []) {
      if (isFunction(declaration)) value = functionValue(declaration, env)
      else if (ts.isClassDeclaration(declaration)) value = { ...empty(), classNode: declaration }
      else if (ts.isVariableDeclaration(declaration) && declaration.initializer) value = evaluate(declaration.initializer, env)
    }
    resolving.delete(key)
    env.set(key, value)
    return value
  }

  function property(value: Value, key: string): Value {
    if (value.state) return property(value.state.value, key)
    if (value.alternatives) return merge(...value.alternatives.map(alternative => property(alternative, key)))
    if (value.reference === 'builtin:map' && key === 'size') return {...empty(), flows: value.flows}
    const child = value.fields.get(key)
    if (child) return { ...child, trail: [...(child.trail ?? []), ...(value.trail ?? [])] }
    if (key === 'length' && value.array && !value.flows.length && !value.fields.has('*')) return { ...empty(), literal: [...value.fields.keys()].filter(field => /^\d+$/u.test(field)).length }
    const wildcard = value.fields.get('*')
    if (wildcard && key !== 'length') return { ...wildcard, trail: [...(wildcard.trail ?? []), ...(value.trail ?? [])] }
    if (value.reference === 'noir:root' && key === 'zcash') return ref('noir:wallet')
    if (['global:window', 'global:globalThis'].includes(value.reference ?? '') && key === 'noirwallet') return ref('noir:root')
    if (['global:window', 'global:globalThis'].includes(value.reference ?? '') && ['fetch', 'console', 'navigator'].includes(key)) return ref(`global:${key}`)
    if (value.reference?.endsWith(':*')) return ref(`${value.reference.slice(0, -1)}${key}`)
    if (value.reference) return ref(`${value.reference}.${key}`)
    return { ...empty(), flows: value.flows, trail: value.trail }
  }

  function bind(name: ts.BindingName, value: Value, env: Environment, node: ts.Node): void {
    if (ts.isIdentifier(name)) {
      const key = symbol(name)
      if (key) env.set(key, step(value, node, 'assignment', `Assigned to ${name.text}`))
    } else {
      let index = 0
      const used = new Set<string>()
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) { index++; continue }
        const fieldName = element.propertyName
        const key = fieldName && (ts.isIdentifier(fieldName) || ts.isStringLiteral(fieldName))
          ? fieldName.text : ts.isObjectBindingPattern(name) && ts.isIdentifier(element.name) ? element.name.text : String(index)
        let selected = property(value, key)
        if (element.dotDotDotToken) {
          selected = { ...empty(), flows: value.flows, array: ts.isArrayBindingPattern(name) }
          for (const [field, child] of value.fields) {
            if (ts.isObjectBindingPattern(name) && !used.has(field)) selected.fields.set(field, child)
            if (ts.isArrayBindingPattern(name) && /^\d+$/u.test(field) && Number(field) >= index) selected.fields.set(String(Number(field) - index), child)
          }
        }
        used.add(key)
        if (element.initializer) selected = merge(selected, evaluate(element.initializer, env))
        bind(element.name, selected, env, element)
        index++
      }
    }
  }

  function noirResult(method: string, node: ts.Node): Value | undefined {
    if (['connect', 'getAccounts', 'getAddresses'].includes(method)) {
      const addresses = empty()
      addresses.fields.set('shielded', source(node, 'shielded-address', `Noir ${method}(): shielded address`))
      addresses.fields.set('transparent', source(node, 'wallet-account', `Noir ${method}(): linked account address`))
      if (method !== 'getAddresses') addresses.fields.set('accounts', source(node, 'wallet-account', `Noir ${method}(): authorized account records`))
      return addresses
    }
    if (['getBalance', 'getMaxTransfer'].includes(method)) return source(node, 'wallet-balance', `Noir ${method}(): private wallet balance`)
    if (method === 'getPublicKey') return {...empty(), fields: new Map(['pubkey', 'address', 'originAddress'].map(field => [field, source(node, 'wallet-account', 'Noir signing identity: linked account information')]))}
    if (method === 'checkLendingMcaAccount') return {...empty(), fields: new Map(['mcaId', 'publicKey'].map(field => [field, source(node, 'wallet-account', 'Noir lending identity: linked account information')]))}
    if (method === 'getTransactionHistory') return source(node, 'wallet-history', 'Noir getTransactionHistory(): private history and memos')
    return undefined
  }

  function reportSink(node: ts.Node, values: Value[], kind: 'logging' | 'network' | 'analytics', label: string): void {
    const ruleId = kind === 'logging' ? 'ZT001' : kind === 'network' ? 'ZT002' : 'ZT003'
    const sink: TraceStep = { ...location(node), kind: 'sink', label }
    for (const flow of uniqueFlows(values.flatMap(value => allFlows(value)))) {
      const key = `${ruleId}:${flow.id}:${sink.file}:${sink.line}:${sink.column}`
      findings.set(key, {
        id: key, ruleId, kind: flow.kind,
        severity: kind !== 'network' || flow.kind === 'spending-key' || flow.kind === 'viewing-key' ? 'error' : 'warning',
        title: `${kindLabels[flow.kind]} reaches ${kind}`,
        message: kind === 'network'
          ? 'Sensitive wallet data reaches a network request without an explicit destination policy. Review whether disclosure is necessary.'
          : `Sensitive wallet data reaches ${kind}, where it can be retained or shared outside the wallet.`,
        source: flow.trace[0]!, sink, trace: [...flow.trace, sink],
        remediation: kind === 'logging'
          ? 'Remove the sensitive value from this log. Log a public status or event name instead.'
          : kind === 'analytics'
            ? 'Remove wallet details from the analytics payload. Record a public event name without wallet identifiers or financial data.'
            : 'Remove the sensitive payload or explicitly approve a necessary HTTPS origin in ztrace.config.json after reviewing the disclosure.',
      })
    }
  }

  function network(node: ts.Node, args: Value[], label: string, payloadIndex = 1): void {
    let url: URL | undefined
    if (typeof args[0]?.literal === 'string' && !allFlows(args[0]).length) {
      try { url = new URL(args[0].literal) } catch { /* Dynamic or relative destination: no approval. */ }
    }
    const policies = url?.protocol === 'https:' ? options.disclosurePolicies?.filter(policy => policy.origin === url!.origin && policy.pathname === url!.pathname) ?? [] : []
    const legacyAllowed = url?.protocol === 'https:' && options.allowedNetworkOrigins?.includes(url.origin)
    const retained: Flow[] = []
    const visit = (value: Value, path: string, ancestors = new Set<Value>(), trail: TraceStep[] = []): void => {
      if (ancestors.has(value)) return
      const seen = new Set(ancestors).add(value)
      const carried = [...(value.trail ?? []), ...trail]
      if (value.serialized) { visit(value.serialized, path, seen, carried); return }
      for (const flow of value.flows) {
        const key = flow.kind === 'viewing-key' || flow.kind === 'spending-key'
        const approved = !key && path !== '$url' && (policies.length
          ? policies.some(policy => policy.kinds.includes(flow.kind) && policy.fields.includes(path))
          : legacyAllowed)
        if (!approved) retained.push({ ...flow, trace: [...flow.trace, ...carried] })
      }
      if (value.state) visit(value.state.value, path, seen, carried)
      for (const [field, child] of value.fields) visit(child, path ? `${path}.${field}` : field, seen, carried)
    }
    args.forEach((value, index) => visit(value, index === 0 ? '$url' : index === payloadIndex ? '' : `$arg${index}`))
    reportSink(node, [{ ...empty(), flows: uniqueFlows(retained) }], 'network', label)
  }

  function invoke(fn: FunctionNode, args: Value[], caller: Environment, node: ts.Node, closure?: Environment, instance?: Value): Value {
    expandedFunctions.add(fn)
    if (activeFunctions.has(fn)) {
      diagnostic(node, 'RECURSION', 'A recursive call was not expanded. Its inputs remain sensitive; review this path.')
      return merge(...args)
    }
    const env = new Map([...(closure ?? caller), ...caller])
    fn.parameters.forEach((parameter, index) => {
      const value = parameter.dotDotDotToken
        ? { ...empty(), fields: new Map(args.slice(index).map((arg, i) => [String(i), arg])) }
        : args[index] ?? (parameter.initializer ? evaluate(parameter.initializer, env) : empty())
      bind(parameter.name, step(value, node, 'call', 'Passed into a local function'), env, parameter)
      if (ts.isConstructorDeclaration(fn) && instance && parameter.modifiers?.length && ts.isIdentifier(parameter.name)) instance.fields.set(parameter.name.text, value)
    })
    activeFunctions.add(fn)
    if (instance) thisStack.push(instance)
    let result = empty()
    try {
      if (fn.body && ts.isBlock(fn.body)) result = statements(fn.body.statements, env).value
      else if (fn.body) result = evaluate(fn.body, env)
    } finally {
      activeFunctions.delete(fn)
      if (instance) thisStack.pop()
    }
    // Preserve changes to captured bindings, without leaking local declarations into callers.
    for (const key of caller.keys()) if (env.has(key)) caller.set(key, env.get(key)!)
    return step(result, fn, 'return', 'Returned from a local function')
  }

  function call(node: ts.CallExpression, env: Environment): Value {
    const receiver = ts.isPropertyAccessExpression(node.expression) ? evaluate(node.expression.expression, env) : undefined
    const target = receiver && ts.isPropertyAccessExpression(node.expression) ? property(receiver, node.expression.name.text) : evaluate(node.expression, env)
    const args = node.arguments.map(argument => evaluate(argument, env))
    if (target.alternatives) return merge(...target.alternatives.map(alternative => applyCall(node, alternative, args, env, receiver)))
    return applyCall(node, target, args, env, receiver)
  }

  function applyCall(node: ts.CallExpression, target: Value, args: Value[], env: Environment, receiver?: Value): Value {
    if (target.setter) {
      const next = args[0]?.fn ? invoke(args[0].fn, [target.setter.value], env, node, args[0].closure) : args[0] ?? empty()
      target.setter.value = merge(target.setter.value, next)
      return empty()
    }
    if (target.fn) return invoke(target.fn, args, env, node, target.closure, receiver)
    const reference = target.reference ?? ''
    if (reference === 'global:require' && typeof args[0]?.literal === 'string') {
      const module = args[0].literal
      const configured = [...(options.sources ?? []), ...(options.sinks ?? [])].some(rule => rule.module === module)
      if (module.startsWith('.') && !configured) diagnostic(node, 'COMMONJS_LOCAL_REVIEW', 'Local require/module.exports resolution is not modeled; use ES modules or an explicit adapter.')
      return ref(`import:${module}:*`)
    }
    const configuredSink = options.sinks?.find(rule => reference === `import:${rule.module}:${rule.export}`)
    if (configuredSink) {
      if (configuredSink.kind === 'network') network(node, args, 'Configured network destination')
      else reportSink(node, args, configuredSink.kind, 'Configured disclosure destination')
      return empty()
    }
    const configured = options.sources?.find(rule => reference === `import:${rule.module}:${rule.export}`)
    if (configured) {
      let result = source(node, configured.kind, `Configured ${configured.export}() source`)
      for (const field of configured.path?.split('.').reverse() ?? []) result = { ...empty(), fields: new Map([[field, result]]) }
      return result
    }
    if (reference === 'import:@noir-wallet/sdk:getNoirWallet') return ref('noir:root')
    if (reference === 'import:@ledgerhq/zcash-utils:parsePczt') return source(node, 'pczt', 'Ledger PCZT signer projection: private note data')
    if (reference === 'import:@ledgerhq/zcash-utils:startSync') return ref('ledger:stream')
    if (reference === 'ledger:stream.next') return source(node, 'wallet-history', 'Ledger scan stream: decrypted notes and history')
    if (reference === 'import:@ledgerhq/zcash-utils:testDeriveKeys') return { ...empty(), fields: new Map([['ufvk', source(node, 'viewing-key', 'Ledger test key derivation: full viewing key')], ['xpub', source(node, 'wallet-account', 'Ledger test key derivation: linked account xpub')]]) }
    if (['import:@ledgerhq/zcash-utils:buildTransaction', 'import:@ledgerhq/zcash-utils:buildIronwoodTransaction'].includes(reference)) {
      return { ...empty(), fields: new Map([['pcztHex', source(node, 'pczt', 'Ledger transaction builder: private PCZT bytes')]]) }
    }
    if (/^import:@rhea-finance\/zcash-wallet-adapter(?:\/react)?:useWallet$/u.test(reference)) {
      const wallet = ref('noir:wallet')
      wallet.fields.set('shieldedAddress', source(node, 'shielded-address', 'React wallet: shielded address'))
      wallet.fields.set('transparentAddress', source(node, 'wallet-account', 'React wallet: linked address'))
      wallet.fields.set('accounts', source(node, 'wallet-account', 'React wallet: authorized accounts'))
      wallet.fields.set('balance', source(node, 'wallet-balance', 'React wallet: balance'))
      wallet.fields.set('isConnected', empty())
      return wallet
    }
    if (reference === 'import:react:useState') {
      const state = { value: args[0]?.fn ? invoke(args[0].fn, [], env, node, args[0].closure) : args[0] ?? empty() }
      return { ...empty(), array: true, fields: new Map([['0', { ...empty(), state }], ['1', { ...empty(), setter: state }]]) }
    }
    if (reference === 'import:react:useRef') return { ...empty(), fields: new Map([['current', args[0] ?? empty()]]) }
    if (['import:react:useEffect', 'import:react:useLayoutEffect', 'import:react:useMemo'].includes(reference)) {
      return args[0]?.fn ? invoke(args[0].fn, [], env, node, args[0].closure) : empty()
    }
    if (reference === 'import:react:useCallback') return args[0] ?? empty()
    if (reference === 'import:@segment/analytics-next:AnalyticsBrowser.load') return ref('import:@segment/analytics-next:client')
    if (reference === 'import:axios:default.create' || reference === 'import:axios:*.create') return ref('transport:axios')
    if (/^import:(pino|winston):(?:default|createLogger|\*)$/u.test(reference)) return ref('logger:instance')
    if (reference.startsWith('logger:instance.') && loggingMethods.has(reference.slice('logger:instance.'.length))) {
      reportSink(node, args, 'logging', 'Structured logger')
      return empty()
    }
    if (/^(?:import:axios:(?:default|\*)|transport:axios)(?:\.(?:get|post|put|patch|delete|request))?$/u.test(reference)) {
      network(node, args, 'Axios request')
      return { ...empty(), flows: uniqueFlows(args.flatMap(value => allFlows(value))) }
    }
    if (['transport:websocket.send', 'transport:xhr.send'].includes(reference)) {
      reportSink(node, args, 'network', 'Browser transport send')
      return empty()
    }
    if (reference === 'transport:xhr.open') return empty()
    if (reference.startsWith('noir:wallet.')) {
      const method = reference.slice('noir:wallet.'.length)
      const result = noirResult(method, node)
      if (result) return result
      if (['disconnect', 'sendTransaction', 'shieldFunds', 'signMessage', 'getPublicKey'].includes(method)) return empty()
      if (method === 'signAndSendTransaction') return empty()
      if (method === 'on' && ['accountsChanged', 'chainChanged', 'connect', 'disconnect'].includes(String(args[0]?.literal)) && args[1]?.fn) {
        invoke(args[1].fn, [args[0]?.literal === 'accountsChanged' ? noirResult('getAddresses', node)! : empty()], env, node, args[1].closure)
        return empty()
      }
      diagnostic(node, 'UNMODELED_WALLET_METHOD', 'This wallet method has no privacy model in this release. Review its returned data.')
      return empty()
    }
    if (reference.startsWith('global:console.') && loggingMethods.has(reference.slice('global:console.'.length))) {
      reportSink(node, args, 'logging', reference.replace('global:', ''))
      return empty()
    }
    if (['global:fetch', 'global:navigator.sendBeacon'].includes(reference)) {
      network(node, args, reference.replace('global:', ''))
      return empty()
    }
    if (isAnalyticsReference(reference)) {
      reportSink(node, args, 'analytics', 'Analytics SDK call')
      return empty()
    }
    if (['global:JSON.stringify', 'global:JSON.parse', 'global:String', 'global:encodeURIComponent', 'global:btoa', 'global:atob'].includes(reference)) {
      if (reference === 'global:JSON.parse' && args[0]?.serialized) return args[0].serialized
      return { ...empty(), flows: uniqueFlows(args.flatMap(value => allFlows(value))), serialized: reference === 'global:JSON.stringify' ? args[0] : undefined }
    }
    if (reference === 'global:Object.assign') {
      const result = args[0] ?? empty()
      for (const value of args.slice(1)) {
        result.flows = uniqueFlows([...result.flows, ...value.flows])
        for (const [key, field] of value.fields) result.fields.set(key, field)
      }
      return result
    }
    if (reference === 'global:Promise.all') return args[0] ?? empty()
    if (reference === 'global:Promise.resolve') return args[0] ?? empty()
    if (/^global:(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError)$/u.test(reference)) return errorValue(args)
    if (['import:@noir-wallet/sdk:verifyMessageSignature', 'import:@noir-wallet/sdk:publicKeyToAddress', 'import:@noir-wallet/sdk/chains/zcash:verifyMessageSignature', 'import:@noir-wallet/sdk/chains/zcash:publicKeyToAddress'].includes(reference)) return {...empty(), flows: uniqueFlows(args.flatMap(value => allFlows(value)))}
    if (['global:Object.entries', 'global:Object.keys', 'global:Object.values'].includes(reference)) {
      const object = args[0] ?? empty()
      const items = [...object.fields].map(([key, value]) => reference === 'global:Object.keys' ? {...empty(), literal: key}
        : reference === 'global:Object.values' ? value
          : {...empty(), array: true, fields: new Map([['0', {...empty(), literal: key}], ['1', value]])})
      const fields = new Map(items.map((item, index) => [String(index), item]))
      if (object.flows.length) fields.set('*', reference === 'global:Object.entries' ? {...empty(), array: true, fields: new Map([['0', {...empty(), flows: object.flows}], ['1', {...empty(), flows: object.flows}]])} : {...empty(), flows: object.flows})
      return {...empty(), array: true, fields}
    }
    if (['global:parseFloat', 'global:parseInt', 'global:Number', 'global:Boolean'].includes(reference)) return {...empty(), flows: uniqueFlows(args.flatMap(value => allFlows(value)))}
    if (reference === 'global:Array.from') {
      const input = args[0] ?? empty()
      if (!args[1]?.fn) return input
      const element = merge(...[...input.fields.values()])
      return {...empty(), array: true, fields: new Map([['*', invoke(args[1].fn, [element], env, node, args[1].closure)]])}
    }
    if (reference.startsWith('builtin:map.') && receiver) {
      const method = reference.slice('builtin:map.'.length)
      const entries = [...receiver.fields.entries()].filter(([key]) => key.startsWith('entry:')).map(([, entry]) => entry)
      const key = args[0]?.literal !== undefined ? `entry:${typeof args[0].literal}:${String(args[0].literal)}` : 'entry:*'
      if (method === 'set') {
        const entry = {...empty(), fields: new Map([['key', args[0] ?? empty()], ['value', args[1] ?? empty()]])}
        receiver.fields.set(key, key === 'entry:*' && receiver.fields.has(key) ? merge(receiver.fields.get(key)!, entry) : entry)
        return receiver
      }
      if (method === 'get') {
        const values = (key === 'entry:*' ? entries : [receiver.fields.get(key), receiver.fields.get('entry:*')].filter((value): value is Value => !!value)).map(entry => entry.fields.get('value') ?? empty())
        if (values.length === 1) return {...values[0]!, flows: uniqueFlows([...values[0]!.flows, ...receiver.flows])}
        if (!values.length) return receiver.flows.length ? {...empty(), flows: receiver.flows} : ref('global:undefined')
        if (values.some(value => value.fields.size)) diagnostic(node, 'MAP_ALIAS_REVIEW', 'Several map entries may be returned; review mutations through this ambiguous alias.')
        return merge(...values, {...empty(), flows: receiver.flows})
      }
      if (method === 'clear') {receiver.fields.clear(); return empty()}
      if (method === 'delete') {if (key !== 'entry:*') receiver.fields.delete(key); return {...empty(), flows: uniqueFlows([...receiver.flows, ...allFlows(args[0] ?? empty()), ...entries.flatMap(entry => allFlows(entry.fields.get('key') ?? empty()))])}}
      if (method === 'has') return {...empty(), flows: uniqueFlows([...receiver.flows, ...allFlows(args[0] ?? empty()), ...entries.flatMap(entry => allFlows(entry.fields.get('key') ?? empty()))])}
      if (['entries', 'values', 'keys'].includes(method)) return {...empty(), array: true, flows: receiver.flows, fields: new Map(entries.map((entry, index) => [String(index), method === 'entries' ? {...empty(), array: true, fields: new Map([['0', entry.fields.get('key') ?? empty()], ['1', entry.fields.get('value') ?? empty()]])} : entry.fields.get(method === 'keys' ? 'key' : 'value') ?? empty()]))}
      if (method === 'forEach' && args[0]?.fn) {
        for (const entry of entries) invoke(args[0].fn, [entry.fields.get('value') ?? empty(), entry.fields.get('key') ?? empty(), receiver], env, node, args[0].closure)
        if (receiver.flows.length) invoke(args[0].fn, [{...empty(), flows: receiver.flows}, {...empty(), flows: receiver.flows}, receiver], env, node, args[0].closure)
        return empty()
      }
    }
    if (['global:window.addEventListener', 'global:globalThis.addEventListener', 'global:addEventListener'].includes(reference)) {
      if (args[1]?.fn) invoke(args[1].fn, [empty()], env, node, args[1].closure)
      else if (args[1] && allFlows(args[1]).length) diagnostic(node, 'EVENT_HANDLER_REVIEW', 'A dynamic event handler needs review.')
      return empty()
    }
    if (['global:window.removeEventListener', 'global:globalThis.removeEventListener', 'global:removeEventListener'].includes(reference)) return empty()
    if (/^builtin:(?:date|regexp)\./u.test(reference)) return {...empty(), flows: uniqueFlows([...allFlows(receiver ?? empty()), ...args.flatMap(value => allFlows(value))])}
    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const base = receiver ?? empty()
      if (method === 'push' && base.array) {
        if (symbolicLoopDepth) {
          const values = [...base.fields.values(), ...args]
          base.fields.clear()
          base.fields.set('*', merge(...values))
          return empty()
        }
        let index = [...base.fields.keys()].filter(key => /^\d+$/u.test(key)).reduce((largest, key) => Math.max(largest, Number(key) + 1), 0)
        for (const value of args) {
          if (base.fields.has('*')) base.fields.set('*', merge(base.fields.get('*')!, value))
          else base.fields.set(String(index++), value)
        }
        return base.fields.has('*') ? empty() : {...empty(), literal: index}
      }
      if (['catch', 'finally'].includes(method) && args[0]?.fn) {
        const output = invoke(args[0].fn, method === 'catch' ? [base] : [], env, node, args[0].closure)
        return method === 'finally' ? base : merge(base, output)
      }
      if (['then', 'map', 'forEach', 'filter', 'flatMap', 'find', 'findIndex', 'some', 'every'].includes(method) && args[0]?.fn) {
        const elements = [...base.fields.entries()].filter(([key]) => /^\d+$/u.test(key)).map(([, value]) => value)
        const input = method === 'then' ? base : elements.length ? merge(...elements, ...(base.fields.has('*') ? [base.fields.get('*')!] : [])) : base.fields.get('*') ?? { ...empty(), flows: allFlows(base) }
        const output = invoke(args[0].fn, [input], env, node, args[0].closure)
        if (method === 'find') return input
        if (['findIndex', 'some', 'every'].includes(method)) return {...empty(), flows: uniqueFlows([...allFlows(input), ...allFlows(output)])}
        return method === 'filter' ? base : method === 'forEach' ? empty() : method === 'then' ? output : { ...empty(), array: true, fields: new Map([['*', output]]) }
      }
      if (['toString', 'toFixed', 'slice', 'substring', 'replace', 'replaceAll', 'join', 'trim', 'toLowerCase', 'toUpperCase'].includes(method)) {
        return { ...empty(), flows: uniqueFlows([allFlows(base), ...args.map(value => allFlows(value))].flat()) }
      }
    }
    const incoming = uniqueFlows([...args.flatMap(value => allFlows(value)), ...allFlows(target)])
    if (incoming.length || args.some(value => value.fn)) diagnostic(node, 'UNMODELED_CALL', 'This external call receives sensitive data or a callback. External side effects and callback scheduling need manual review; known sensitive inputs propagate to the result.')
    return { ...empty(), flows: incoming }
  }

  function evaluate(node: ts.Expression, env: Environment): Value {
    tick(node)
    if (node.kind === ts.SyntaxKind.ThisKeyword) return thisStack.at(-1) ?? empty()
    if (ts.isIdentifier(node)) return lookup(node, env)
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
      if (ts.isStringLiteralLike(node) && /^u(?:view|ivk)(?:test|regtest)?1/iu.test(node.text)) {
        const capability = inspectViewingCapability(node.text)
        if (capability.status === 'recognized-encoding') return { ...source(node, 'viewing-key', `Recognized ${capability.scope} viewing capability encoding`), literal: node.text }
      }
      return { ...empty(), literal: ts.isNumericLiteral(node) ? Number(node.text) : node.text }
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { ...empty(), literal: node.kind === ts.SyntaxKind.TrueKeyword }
    if (node.kind === ts.SyntaxKind.NullKeyword) return { ...empty(), literal: null }
    if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return evaluate(node.expression, env)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return functionValue(node, env)
    if (ts.isRegularExpressionLiteral(node)) return ref('builtin:regexp')
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return ref('meta:import')
    if (ts.isCallExpression(node)) return call(node, env)
    if (ts.isPropertyAccessExpression(node)) {
      const base = evaluate(node.expression, env)
      if (['global:window', 'global:globalThis'].includes(base.reference ?? '') && ['fetch', 'console', 'navigator'].includes(node.name.text)) return ref(`global:${node.name.text}`)
      return property(base, node.name.text)
    }
    if (ts.isElementAccessExpression(node)) {
      const base = evaluate(node.expression, env)
      const key = node.argumentExpression ? evaluate(node.argumentExpression, env).literal : undefined
      if (typeof key === 'string' || typeof key === 'number') return property(base, String(key))
      if (base.reference === 'global:console') {
        diagnostic(node, 'DYNAMIC_DISPATCH_REVIEW', 'The logger method is dynamic; supported logging methods are treated as possible destinations.')
        return { ...empty(), alternatives: [...loggingMethods].map(method => ref(`global:console.${method}`)) }
      }
      if (allFlows(base).length) diagnostic(node, 'DYNAMIC_PROPERTY', 'A dynamic property access was approximated by combining the object fields.')
      return { ...empty(), flows: allFlows(base) }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const result = empty()
      for (const entry of node.properties) {
        if (ts.isSpreadAssignment(entry)) {
          const value = evaluate(entry.expression, env)
          result.flows = uniqueFlows([...result.flows, ...value.flows])
          for (const [key, field] of value.fields) result.fields.set(key, field)
        } else if (ts.isPropertyAssignment(entry) || ts.isShorthandPropertyAssignment(entry) || ts.isMethodDeclaration(entry)) {
          const key = ts.isComputedPropertyName(entry.name) ? evaluate(entry.name.expression, env).literal : entry.name.text
          const value = ts.isPropertyAssignment(entry) ? evaluate(entry.initializer, env)
            : ts.isShorthandPropertyAssignment(entry) ? lookup(entry.name, env) : { ...empty(), fn: entry, closure: env }
          if (typeof key === 'string' || typeof key === 'number') result.fields.set(String(key), value)
          else result.flows = uniqueFlows([...result.flows, ...allFlows(value)])
        }
      }
      return result
    }
    if (ts.isArrayLiteralExpression(node)) {
      const result: Value = { ...empty(), array: true }
      let index = 0
      for (const entry of node.elements) {
        if (ts.isSpreadElement(entry)) {
          const spread = evaluate(entry.expression, env)
          if (spread.array && !spread.fields.has('*') && !spread.flows.length) {
            for (const [key, value] of spread.fields) if (/^\d+$/u.test(key)) result.fields.set(String(index++), value)
          } else result.fields.set('*', { ...empty(), flows: allFlows(spread) })
        } else result.fields.set(String(index++), ts.isOmittedExpression(entry) ? empty() : evaluate(entry, env))
      }
      return result
    }
    if (ts.isTemplateExpression(node)) return { ...empty(), flows: uniqueFlows(node.templateSpans.flatMap(span => allFlows(evaluate(span.expression, env)))) }
    if (ts.isConditionalExpression(node)) {
      const condition = truth(evaluate(node.condition, env))
      if (condition !== undefined) return evaluate(condition ? node.whenTrue : node.whenFalse, env)
      const left = fork(env), right = fork(env)
      const result = merge(evaluate(node.whenTrue, left), evaluate(node.whenFalse, right))
      joinEnvironments(env, left, right)
      return result
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind
      if (operator === ts.SyntaxKind.EqualsToken) {
        const store = assignmentTarget(node.left, env, node)
        const right = evaluate(node.right, env)
        store.write(right)
        return right
      }
      const compound = operator >= ts.SyntaxKind.FirstCompoundAssignment && operator <= ts.SyntaxKind.LastCompoundAssignment ? assignmentTarget(node.left, env, node) : undefined
      const left = compound ? compound.read() : evaluate(node.left, env)
      const logical = operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken ? ts.SyntaxKind.AmpersandAmpersandToken : operator === ts.SyntaxKind.BarBarEqualsToken ? ts.SyntaxKind.BarBarToken : operator === ts.SyntaxKind.QuestionQuestionEqualsToken ? ts.SyntaxKind.QuestionQuestionToken : operator
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(logical)) {
        const decision = logical === ts.SyntaxKind.QuestionQuestionToken
          ? left.literal !== undefined ? left.literal === null : left.reference === 'global:undefined' ? true : undefined
          : truth(left) === undefined ? undefined : logical === ts.SyntaxKind.AmpersandAmpersandToken ? truth(left) : !truth(left)
        if (decision === false) return left
        if (decision === true) {
          const right = evaluate(node.right, env)
          compound?.write(right)
          return right
        }
        const skipped = fork(env), executed = fork(env)
        const right = evaluate(node.right, executed)
        joinEnvironments(env, skipped, executed)
        const result = merge(left, right)
        compound?.write(result)
        return result
      }
      const right = evaluate(node.right, env)
      if (operator === ts.SyntaxKind.CommaToken) return right
      const combined = { ...empty(), flows: uniqueFlows([...allFlows(left), ...allFlows(right)]) }
      if (left.literal !== undefined && right.literal !== undefined) {
        const a = left.literal, b = right.literal
        if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || (operator === ts.SyntaxKind.EqualsEqualsToken && typeof a === typeof b)) combined.literal = a === b
        if (operator === ts.SyntaxKind.ExclamationEqualsEqualsToken || (operator === ts.SyntaxKind.ExclamationEqualsToken && typeof a === typeof b)) combined.literal = a !== b
        if (typeof a === 'number' && typeof b === 'number') {
          if (operator === ts.SyntaxKind.LessThanToken) combined.literal = a < b
          if (operator === ts.SyntaxKind.LessThanEqualsToken) combined.literal = a <= b
          if (operator === ts.SyntaxKind.GreaterThanToken) combined.literal = a > b
          if (operator === ts.SyntaxKind.GreaterThanEqualsToken) combined.literal = a >= b
          if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.PlusEqualsToken) combined.literal = a + b
          if (operator === ts.SyntaxKind.MinusToken || operator === ts.SyntaxKind.MinusEqualsToken) combined.literal = a - b
        }
        if (operator === ts.SyntaxKind.PlusToken && (typeof a === 'string' || typeof b === 'string')) combined.literal = String(a) + String(b)
      }
      compound?.write(combined)
      return combined
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const previous = evaluate(node.operand, env)
      const result = { ...empty(), flows: allFlows(previous) }
      if (node.operator === ts.SyntaxKind.ExclamationToken && truth(previous) !== undefined) result.literal = !truth(previous)
      if (typeof previous.literal === 'number') {
        if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
          result.literal = previous.literal + (node.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1)
          assign(node.operand, result, env, node)
          return ts.isPostfixUnaryExpression(node) ? previous : result
        }
        if (node.operator === ts.SyntaxKind.MinusToken) result.literal = -previous.literal
        if (node.operator === ts.SyntaxKind.PlusToken) result.literal = previous.literal
      }
      return result
    }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) return evaluate(node.expression, env)
    if (ts.isNewExpression(node)) {
      const target = evaluate(node.expression, env)
      const args = node.arguments?.map(argument => evaluate(argument, env)) ?? []
      if (target.classNode) {
        const instance = empty()
        thisStack.push(instance)
        try {
          if (target.classNode.heritageClauses?.length) diagnostic(node, 'CLASS_INHERITANCE_REVIEW', 'Inherited class behavior is not modeled.')
          for (const member of target.classNode.members) {
            if ((ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) && member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isPrivateIdentifier(member.name))) {
              instance.fields.set(member.name.text, ts.isMethodDeclaration(member) ? { ...empty(), fn: member, closure: env } : member.initializer ? evaluate(member.initializer, env) : empty())
            } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) diagnostic(member, 'ACCESSOR_REVIEW', 'Class accessors need manual review.')
          }
          const constructor = target.classNode.members.find(ts.isConstructorDeclaration)
          if (constructor) invoke(constructor, args, env, node, env, instance)
        } finally { thisStack.pop() }
        return instance
      }
      if (/^import:@rhea-finance\/zcash-wallet-adapter(?:\/walletconnect)?:[A-Za-z]*ZcashWalletAdapter$/u.test(target.reference ?? '')) return ref('noir:wallet')
      if (target.reference === 'global:WebSocket') return ref('transport:websocket')
      if (target.reference === 'global:XMLHttpRequest') return ref('transport:xhr')
      if (/^global:(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError)$/u.test(target.reference ?? '')) return errorValue(args)
      if (target.reference === 'global:Date' || target.reference === 'global:RegExp') return {...ref(target.reference === 'global:Date' ? 'builtin:date' : 'builtin:regexp'), flows: uniqueFlows(args.flatMap(value => allFlows(value)))}
      if (target.reference === 'global:Map') {
        const result = ref('builtin:map')
        result.flows = args[0]?.flows ?? []
        for (const entry of args[0]?.fields.values() ?? []) {
          const key = entry.fields.get('0') ?? empty(), value = entry.fields.get('1') ?? empty()
          const name = key.literal !== undefined ? `entry:${typeof key.literal}:${String(key.literal)}` : 'entry:*'
          const item = {...empty(), fields: new Map([['key', key], ['value', value]])}
          result.fields.set(name, name === 'entry:*' && result.fields.has(name) ? merge(result.fields.get(name)!, item) : item)
        }
        return result
      }
      if (args.some(value => allFlows(value).length)) diagnostic(node, 'UNMODELED_CONSTRUCTOR', 'A constructor receives sensitive data. Its side effects need manual review.')
      return { ...empty(), flows: uniqueFlows(args.flatMap(value => allFlows(value))) }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return jsx(node, env)
    else diagnostic(node, 'UNMODELED_EXPRESSION', `Expression ${ts.SyntaxKind[node.kind]} is not modeled.`)
    return empty()
  }

  function truth(value: Value): boolean | undefined {
    if (value.literal !== undefined) return Boolean(value.literal)
    if (value.reference === 'global:undefined' && !value.fields.size && !value.array && !allFlows(value).length) return false
    return undefined
  }

  function errorValue(args: Value[]): Value {
    return {...empty(), fields: new Map([['message', args[0] ?? empty()], ['stack', args[0] ?? empty()], ['cause', args[1]?.fields.get('cause') ?? empty()]])}
  }

  function jsx(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, env: Environment): Value {
    const props = empty()
    if (!ts.isJsxFragment(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          const spread = evaluate(attribute.expression, env)
          for (const [key, value] of spread.fields) props.fields.set(key, value)
          continue
        }
        const value = attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
          ? evaluate(attribute.initializer.expression, env) : empty()
        props.fields.set(attribute.name.getText(), value)
        if (/^on[A-Z]/u.test(attribute.name.getText()) && value.fn) invoke(value.fn, [empty()], env, attribute, value.closure)
        if (['src', 'href', 'action', 'formAction', 'data'].includes(attribute.name.getText())) reportSink(attribute, [value], 'network', 'JSX resource or navigation URL')
      }
      if (ts.isIdentifier(opening.tagName) && /^[A-Z]/u.test(opening.tagName.text)) {
        const component = lookup(opening.tagName, env)
        if (component.fn) invoke(component.fn, [props], env, opening, component.closure)
        else if (allFlows(props).length) diagnostic(opening, 'JSX_COMPONENT_REVIEW', 'Sensitive props enter an unmodeled component. Review its side effects.')
      }
    }
    if (!ts.isJsxSelfClosingElement(node)) for (const child of node.children) {
      if (ts.isJsxExpression(child) && child.expression) evaluate(child.expression, env)
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) jsx(child, env)
    }
    return empty()
  }

  function assignmentTarget(target: ts.Expression, env: Environment, node: ts.Node): { read(): Value; write(value: Value): void } {
    if (ts.isIdentifier(target)) return { read: () => lookup(target, env), write: value => bind(target, value, env, node) }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const base = evaluate(target.expression, env)
      const key = ts.isPropertyAccessExpression(target) ? target.name.text : target.argumentExpression ? evaluate(target.argumentExpression, env).literal : undefined
      return { read: () => typeof key === 'string' || typeof key === 'number' ? property(base, String(key)) : { ...empty(), flows: allFlows(base) }, write: value => {
        if (typeof key === 'string' || typeof key === 'number') base.fields.set(String(key), step(value, node, 'assignment', 'Assigned to an object property'))
        else base.flows = uniqueFlows([...base.flows, ...allFlows(value)])
      } }
    }
    diagnostic(node, 'UNMODELED_ASSIGNMENT', 'This assignment form is not modeled. Review its data flow.')
    return { read: empty, write: () => {} }
  }

  function assign(target: ts.Expression, value: Value, env: Environment, node: ts.Node): void {
    assignmentTarget(target, env, node).write(value)
  }

  function joinEnvironments(target: Environment, left: Environment, right: Environment): void {
    const shared = new Map<Map<string, Value>, Map<Map<string, Value>, Map<string, Value>>>()
    for (const key of new Set([...left.keys(), ...right.keys()])) {
      const first = left.get(key) ?? empty(), second = right.get(key) ?? empty()
      const value = merge(first, second)
      const previous = shared.get(first.fields)?.get(second.fields)
      if (previous) value.fields = previous
      else {
        const pairs = shared.get(first.fields) ?? new Map()
        pairs.set(second.fields, value.fields)
        shared.set(first.fields, pairs)
      }
      target.set(key, value)
    }
  }

  interface Execution { value: Value; returned: boolean; control?: 'break' | 'continue' }

  function loop(node: ts.ForOfStatement | ts.ForInStatement | ts.ForStatement | ts.WhileStatement | ts.DoStatement, env: Environment): Execution {
    const results: Value[] = []
    const runBody = (symbolic = false): Execution => {
      loopDepth++
      if (symbolic) symbolicLoopDepth++
      try { return statements([node.statement], env) } finally { loopDepth--; if (symbolic) symbolicLoopDepth-- }
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const collection = evaluate(node.expression, env)
      const entries = [...collection.fields.entries()].filter(([key]) => key !== 'length')
      const known = entries.length > 0 && !collection.fields.has('*') && !collection.flows.length
      const items = known ? entries.map(([key, value]) => ts.isForInStatement(node) ? { ...empty(), literal: key } : value)
        : allFlows(collection).length ? [{ ...empty(), flows: allFlows(collection) }] : []
      const before = fork(env)
      for (const item of items.slice(0, 128)) {
        if (ts.isVariableDeclarationList(node.initializer)) for (const declaration of node.initializer.declarations) bind(declaration.name, item, env, declaration)
        else assign(node.initializer, item, env, node)
        const body = runBody(!known)
        results.push(body.value)
        if (body.returned) {
          if (!known) { env.clear(); for (const [key, value] of before) env.set(key, value) }
          return { value: merge(...results), returned: known }
        }
        if (body.control === 'break') break
      }
      if (!known && items.length) {
        // Zero or more iterations are possible; repeat transfer until source sets stabilize.
        const bodyState = fork(env)
        joinEnvironments(env, before, bodyState)
        for (let iteration = 0; iteration < 16; iteration++) {
          const previous = stateSignature(env)
          const beforeIteration = fork(env)
          const body = runBody(true)
          results.push(body.value)
          joinEnvironments(env, beforeIteration, fork(env))
          if (stateSignature(env) === previous) break
          if (iteration === 15) diagnostic(node, 'LOOP_LIMIT', 'Symbolic loop state did not converge within the analysis bound.')
        }
      }
      if (items.length > 128) diagnostic(node, 'LOOP_LIMIT', 'Collection exceeds the 128-iteration analysis bound.')
      return { value: merge(...results), returned: false }
    }
    if (ts.isForStatement(node) && node.initializer) {
      if (ts.isVariableDeclarationList(node.initializer)) for (const declaration of node.initializer.declarations) bind(declaration.name, declaration.initializer ? evaluate(declaration.initializer, env) : empty(), env, declaration)
      else evaluate(node.initializer, env)
    }
    for (let iteration = 0; iteration < 128; iteration++) {
      const condition = ts.isForStatement(node) ? node.condition : node.expression
      const decision = ts.isDoStatement(node) && iteration === 0 ? true : condition ? truth(evaluate(condition, env)) : true
      if (decision === false) break
      const before = fork(env)
      const previous = stateSignature(env)
      const body = runBody(decision === undefined)
      results.push(body.value)
      if (body.returned) {
        if (decision === undefined) { env.clear(); for (const [key, value] of before) env.set(key, value) }
        return { value: merge(...results), returned: decision === true }
      }
      if (body.control === 'break') break
      if (ts.isForStatement(node) && node.incrementor) evaluate(node.incrementor, env)
      if (decision === undefined) {
        joinEnvironments(env, before, fork(env))
        if (stateSignature(env) === previous) break
      }
      if (iteration === 127) diagnostic(node, 'LOOP_LIMIT', 'Loop exceeds the 128-iteration analysis bound.')
    }
    return { value: merge(...results), returned: false }
  }

  function stateSignature(env: Environment): string {
    const signature = (value: Value, seen = new Set<Map<string, Value>>()): string => {
      const base = `${value.flows.map(flow => flow.id).sort().join(',')}:${String(value.literal)}:${value.reference ?? ''}`
      if (seen.has(value.fields)) return base + ':cycle'
      const next = new Set(seen).add(value.fields)
      return base + '{' + [...value.fields].sort(([a], [b]) => a.localeCompare(b)).map(([field, child]) => `${field}:${signature(child, next)}`).join('|') + '}'
    }
    return [...env].map(([key, value]) => `${key.getName()}:${signature(value)}`).sort().join('|')
  }

  function switchStatement(node: ts.SwitchStatement, env: Environment): Execution {
    const selector = evaluate(node.expression, env)
    const clauses = node.caseBlock.clauses
    if (clauses.length > 128) {
      diagnostic(node, 'SWITCH_LIMIT', 'Switch exceeds the 128-clause analysis bound.')
      return {value: empty(), returned: false}
    }
    const searching = fork(env)
    const entries: Array<{index: number; state: Environment}> = []
    let fallback = -1, guaranteedMatch = false
    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index]!
      tick(clause)
      if (ts.isDefaultClause(clause)) {fallback = index; continue}
      const candidate = evaluate(clause.expression, searching)
      const known = selector.literal !== undefined && candidate.literal !== undefined
      if (known && selector.literal !== candidate.literal) continue
      entries.push({index, state: fork(searching)})
      if (known) {guaranteedMatch = true; break}
      if (candidate.literal === undefined) diagnostic(clause, 'SWITCH_CASE_REVIEW', 'A computed case expression requires conservative entry-path analysis.')
    }
    if (!guaranteedMatch) entries.push({index: fallback, state: fork(searching)})
    const paths: Array<{state: Environment; result: Execution}> = []
    switchDepth++
    try {
      for (const entry of entries) {
        const returned: Value[] = []
        let result: Execution = {value: empty(), returned: false}
        if (entry.index >= 0) for (let index = entry.index; index < clauses.length; index++) {
          result = statements(clauses[index]!.statements, entry.state)
          returned.push(result.value)
          if (result.returned || result.control) break
        }
        paths.push({state: entry.state, result: {...result, value: merge(...returned)}})
      }
    } finally {switchDepth--}
    const continuing = paths.filter(path => !path.result.returned)
    if (continuing.length) {
      let joined = continuing[0]!.state
      for (const path of continuing.slice(1)) {
        const next: Environment = new Map()
        joinEnvironments(next, joined, path.state)
        joined = next
      }
      for (const [key, value] of joined) env.set(key, value)
    }
    const controls = continuing.map(path => path.result.control === 'break' ? undefined : path.result.control)
    const control = controls.length && controls.every(value => value === 'continue') ? 'continue' as const : undefined
    if (controls.some(value => value === 'continue') && !control) diagnostic(node, 'CONTROL_FLOW_REVIEW', 'A possible continue leaves this switch; review enclosing loop reachability.')
    return {value: merge(...paths.map(path => path.result.value)), returned: paths.length > 0 && continuing.length === 0, control}
  }

  function statements(nodes: ts.NodeArray<ts.Statement> | readonly ts.Statement[], env: Environment): Execution {
    const returns: Value[] = []
    for (const node of nodes) {
      tick(node)
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) bind(declaration.name, declaration.initializer ? evaluate(declaration.initializer, env) : empty(), env, declaration)
      else if (ts.isExpressionStatement(node)) evaluate(node.expression, env)
      else if (ts.isReturnStatement(node)) return { value: merge(...returns, node.expression ? evaluate(node.expression, env) : empty()), returned: true }
      else if (ts.isBlock(node)) {
        const result = statements(node.statements, env)
        returns.push(result.value)
        if (result.returned) return { value: merge(...returns), returned: true }
        if (result.control) return { value: merge(...returns), returned: false, control: result.control }
      } else if (ts.isIfStatement(node)) {
        const condition = truth(evaluate(node.expression, env))
        if (condition !== undefined) {
          const selected = condition ? node.thenStatement : node.elseStatement
          if (selected) {
            const result = statements([selected], env)
            returns.push(result.value)
            if (result.returned || result.control) return { ...result, value: merge(...returns) }
          }
          continue
        }
        const left = fork(env), right = fork(env)
        const first = statements([node.thenStatement], left)
        const second = node.elseStatement ? statements([node.elseStatement], right) : { value: empty(), returned: false }
        joinEnvironments(env, left, right)
        returns.push(first.value, second.value)
        if (first.returned && second.returned) return { value: merge(...returns), returned: true }
        if (first.control && first.control === second.control) return { value: merge(...returns), returned: false, control: first.control }
        if (first.control || second.control) diagnostic(node, 'CONTROL_FLOW_REVIEW', 'A conditional break or continue was approximated. Review loop reachability.')
      } else if (ts.isSwitchStatement(node)) {
        const result = switchStatement(node, env)
        returns.push(result.value)
        if (result.returned || result.control) return {...result, value: merge(...returns)}
      } else if (ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        const result = loop(node, env)
        returns.push(result.value)
        if (result.returned) return { value: merge(...returns), returned: true }
      } else if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
        if (node.label || (!loopDepth && (!switchDepth || ts.isContinueStatement(node)))) diagnostic(node, 'CONTROL_FLOW_REVIEW', 'Labeled or out-of-context control flow needs review.')
        return { value: merge(...returns), returned: false, control: ts.isBreakStatement(node) ? 'break' : 'continue' }
      } else if (ts.isClassDeclaration(node) && node.name) {
        const key = symbol(node.name)
        if (key) env.set(key, { ...empty(), classNode: node })
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const key = symbol(node.name)
        if (key) env.set(key, functionValue(node, env))
      } else if (ts.isTryStatement(node)) {
        const bodyEnv = fork(env), catchEnv = fork(env)
        const thrown: Value[] = []
        exceptionFrames.push(thrown)
        let body: Execution
        try {body = statements(node.tryBlock.statements, bodyEnv)} finally {exceptionFrames.pop()}
        if (node.catchClause?.variableDeclaration) bind(node.catchClause.variableDeclaration.name, merge(...thrown), catchEnv, node.catchClause.variableDeclaration)
        if (!node.catchClause) exceptionFrames.at(-1)?.push(...thrown)
        const caught = node.catchClause ? statements(node.catchClause.block.statements, catchEnv) : { value: empty(), returned: false }
        joinEnvironments(env, bodyEnv, catchEnv)
        returns.push(body.value, caught.value)
        if (node.finallyBlock) returns.push(statements(node.finallyBlock.statements, env).value)
      } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
        evaluate(node.expression, env)
      } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEmptyStatement(node)) {
        // Type declarations and imports have no executable effects here.
      } else if (ts.isThrowStatement(node)) {
        if (node.expression) exceptionFrames.at(-1)?.push(evaluate(node.expression, env))
        return { value: merge(...returns), returned: true }
      } else {
        diagnostic(node, 'UNMODELED_STATEMENT', `Statement ${ts.SyntaxKind[node.kind]} is not modeled. Its contents require review.`)
      }
    }
    return { value: merge(...returns), returned: false }
  }

  for (const file of program.getSourceFiles()) {
    for (const statement of file.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const name = statement.moduleSpecifier.text
        const local = name.startsWith('.') || Object.keys(options.moduleAliases ?? {}).some(pattern => pattern.includes('*') ? name.startsWith(pattern.split('*')[0]!) : name === pattern)
        recordImport(name, statement, local)
        if (local && !/\.(?:css|svg|png|jpg|json)$/u.test(name) && !checker.getSymbolAtLocation(statement.moduleSpecifier)) diagnostic(statement, 'UNRESOLVED_IMPORT', 'A local JavaScript or TypeScript import could not be resolved within the scanned files. Include that module in the scan.')
      }
    }
    const syntaxErrors = program.getSyntacticDiagnostics(file)
    for (const error of syntaxErrors) {
      const position = file.getLineAndCharacterOfPosition(error.start ?? 0)
      const item: Diagnostic = { file: displayPaths.get(normalize(file.fileName)) ?? file.fileName, line: position.line + 1, column: position.character + 1,
        code: 'PARSE_ERROR', message: 'This file contains a syntax error. Repair it before relying on its analysis.' }
      diagnostics.set(`parse:${item.file}:${item.line}:${item.column}`, item)
    }
    const pending: ts.Node[] = [file]
    while (pending.length) {
      const node = pending.pop()!
      if (isFunction(node) && node.body) functions.push(node)
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
        const binding = checker.getSymbolAtLocation(node.expression)
        if (!binding?.declarations?.length) recordImport(node.arguments[0]!.text, node, node.arguments[0]!.text.startsWith('.'))
      }
      const children: ts.Node[] = []
      ts.forEachChild(node, child => {children.push(child)})
      pending.push(...children.reverse())
    }
  }
  try {
    for (const file of program.getSourceFiles()) statements(file.statements, environment)
    for (const fn of functions) if (!expandedFunctions.has(fn)) {
      for (const closure of closureContexts.get(fn) ?? [environment]) invoke(fn, [], environment, fn, closure)
    }
  } catch (error) {
    if (error !== budgetExceeded) throw error
  }
  const orderedFindings = [...findings.values()].sort((a, b) => a.sink.file.localeCompare(b.sink.file) || a.sink.line - b.sink.line || a.id.localeCompare(b.id))
  const missingKinds = (options.requiredSourceKinds ?? []).filter(kind => !observedKinds.has(kind))
  const requirementsSatisfied = (!options.requireSources || sources.size > 0) && missingKinds.length === 0
  if (!requirementsSatisfied) diagnostics.set('required-sources', {file: '<analysis>', line: 1, column: 1, code: 'SOURCE_REQUIREMENT_UNMET', message: 'Expected sensitive source models were not observed. Check wallet integration, adapters, and required source categories.'})
  return {
    schemaVersion: 1, toolVersion: '0.1.0', files: inputs.map(input => input.path.replaceAll('\\', '/')).sort(),
    findings: orderedFindings,
    modelCoverage: {imports: [...importInventory.values()].sort((a, b) => a.module.localeCompare(b.module)), sourceKinds: [...observedKinds].sort(), requirementsSatisfied},
    diagnostics: [...diagnostics.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column),
    summary: { filesScanned: inputs.length, sourcesDetected: sources.size,
      errors: orderedFindings.filter(finding => finding.severity === 'error').length,
      warnings: orderedFindings.filter(finding => finding.severity === 'warning').length,
      coverage: diagnostics.size ? 'incomplete' : 'limited' },
  }
}
