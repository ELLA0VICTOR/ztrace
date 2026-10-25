// Controlled browser tests provide synthetic data at the extension-provider boundary.
// The application imports the actual published SDK, which wraps this provider.
export function installSyntheticProvider() {
  const data = window.__ZTRACE_TEST_DATA__
  if (!data?.address || !data.balance || !data.history) return false
  const methods: string[] = []
  window.__ZTRACE_PROVIDER_CALLS__ = methods
  window.noirwallet = {
    isNoirWallet: true,
    version: 'synthetic-test-provider',
    zcash: {
      async request({method}: {method: string}) {
        methods.push(method)
        await window.__ZTRACE_CHECKPOINT__?.(method)
        if (method === 'zcash_getAccounts') return {shielded: data.address, transparent: 'synthetic-transparent-account'}
        if (method === 'zcash_getBalance') return {transparent: '0', shielded: data.balance, available: data.balance}
        if (method === 'zcash_getTransactionHistory') return [{memo: data.history, status: 'confirmed'}]
        throw new Error('Unsupported synthetic provider method')
      },
      on() {},
      async disconnect() {},
    },
  }
  return true
}
