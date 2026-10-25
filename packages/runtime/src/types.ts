import type { SensitiveKind } from '../../core/src/types.js'
export interface Canary {name:string;kind:SensitiveKind;value:string;synthetic:true}
export type RuntimeAction={type:'click'|'waitFor';selector:string}|{type:'fill';selector:string;value:string}
export interface RuntimeExpectations {
  canariesRead?: string[]
  checkpoints?: string[]
  minActions?: number
}
export interface RuntimeOptions {
  url:string
  canaries:Canary[]
  testData?:Record<string,unknown>
  actions?:RuntimeAction[]
  browserPath?:string
  timeoutMs?:number
  settleMs?:number
  expectations?:RuntimeExpectations
}
export interface RuntimeFinding {channel:'request'|'console'|'websocket';canary:string;kind:SensitiveKind;encoding:string;destination:string}
export interface RuntimeReport {
  schemaVersion:1
  mode:'runtime-canary'
  completion:'completed'|'incomplete'
  browserVersion:string
  findings:RuntimeFinding[]
  diagnostics:string[]
  summary:{actionsCompleted:number;requestsObserved:number;requestsBlocked:number;consoleEventsObserved:number}
  scope:string
  execution?:{canariesRead:string[];checkpointsReached:string[];expectationsConfigured:boolean;expectationsSatisfied:boolean|null}
}
