// Corrected analysis fixture. Status reporting excludes wallet information.
import { getNoirWallet } from '@noir-wallet/sdk'
import posthog from 'posthog-js'

export async function checkout() {
  const wallet = getNoirWallet()
  if (!wallet) return
  const connection = await wallet.zcash.getAccounts()
  if (!connection) return

  const balance = await wallet.zcash.getBalance()
  const localState = { balance, connection, status: 'ready' }

  posthog.capture('checkout_started', { status: localState.status })
  console.info('Checkout ready')
  await fetch('https://status.example/events', {
    method: 'POST',
    body: JSON.stringify({ event: 'checkout_ready' }),
  })
}
