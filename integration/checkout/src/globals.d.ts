export {}
declare global {
  interface Window {
    __ZTRACE_TEST_DATA__?: {address: string; balance: string; history: string}
    __ZTRACE_CHECKPOINT__?: (name: string) => Promise<unknown>
    __ZTRACE_PROVIDER_CALLS__?: string[]
    noirwallet?: unknown
  }
}
