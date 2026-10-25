import type {Location, ScanReport} from './types.js'

export interface SarifOptions {
  /** Repository-relative path from the checkout root to the scan root. */
  pathPrefix?: string
}

/** Convert metadata-only scanner findings into SARIF 2.1.0 for code review tools. */
export function toSarif(report: ScanReport, options: SarifOptions = {}) {
  const prefix = (options.pathPrefix ?? '').replaceAll('\\', '/').replace(/\/$/u, '')
  const absolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:/u.test(path) || /^[A-Za-z][\w+.-]*:/u.test(path)
  if (absolute(prefix)) throw new Error('SARIF pathPrefix must be repository-relative.')
  const physicalLocation = (location: Location) => {
    const path = location.file.replaceAll('\\', '/')
    if (absolute(path)) throw new Error('SARIF input paths must be repository-relative.')
    const uri = [prefix, path].filter(Boolean).join('/').split('/').filter(part => part !== '.' && part !== '').map(encodeURIComponent).join('/')
    return {artifactLocation: {uri}, region: {startLine: location.line, startColumn: location.column}}
  }
  const rules = [
    {id: 'ZT001', name: 'WalletDataInLogs', description: 'Sensitive wallet data reaches logging.', level: 'error'},
    {id: 'ZT002', name: 'WalletDataInNetworkRequest', description: 'Sensitive wallet data reaches an unapproved network destination or field.', level: 'warning'},
    {id: 'ZT003', name: 'WalletDataInAnalytics', description: 'Sensitive wallet data reaches analytics.', level: 'error'},
  ] as const
  return {
    $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0' as const,
    runs: [{
      tool: {driver: {
        name: 'ZTrace', semanticVersion: report.toolVersion,
        informationUri: 'https://github.com/ELLA0VICTOR/ztrace',
        rules: rules.map(rule => ({id: rule.id, name: rule.name, shortDescription: {text: rule.description},
          defaultConfiguration: {level: rule.level},
          help: {text: 'Review the source-to-destination trace. Remove private values from logs and analytics, and approve only necessary network disclosures using exact endpoint and field policies.'},
          properties: {tags: ['security', 'privacy', 'zcash']},
        })),
      }},
      columnKind: 'utf16CodeUnits' as const,
      invocations: [{executionSuccessful: report.summary.coverage !== 'incomplete',
        toolExecutionNotifications: report.diagnostics.map(item => ({
          level: 'warning' as const, message: {text: `${item.code}: ${item.message}`},
          ...(item.file.startsWith('<') ? {} : {locations: [{physicalLocation: physicalLocation(item)}]}),
          properties: {code: item.code},
        })),
      }],
      results: report.findings.map(finding => {
        const trace = finding.trace.length > 1000 ? [finding.trace[0]!, ...finding.trace.slice(-999)] : finding.trace
        return {
          ruleId: finding.ruleId, ruleIndex: rules.findIndex(rule => rule.id === finding.ruleId),
          level: finding.severity, message: {text: `${finding.title}. ${finding.message}\n${finding.remediation}`},
          locations: [{physicalLocation: physicalLocation(finding.sink)}],
          relatedLocations: [{id: 1, physicalLocation: physicalLocation(finding.source), message: {text: finding.source.label}}],
          codeFlows: [{threadFlows: [{locations: trace.map((step, index) => ({executionOrder: index,
            location: {physicalLocation: physicalLocation(step), message: {text: step.label}},
          }))}]}],
          properties: {sensitiveKind: finding.kind, traceTruncated: trace.length !== finding.trace.length},
        }
      }),
      properties: {coverage: report.summary.coverage, sourcesDetected: report.summary.sourcesDetected,
        recognizedSourceKinds: report.modelCoverage?.sourceKinds ?? [],
        sourceRequirementsSatisfied: report.modelCoverage?.requirementsSatisfied ?? null},
    }],
  }
}
