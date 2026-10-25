import {getNoirWallet} from '@noir-wallet/sdk'
import {capture} from 'checkout-telemetry'

export async function checkout() {
  const wallet = getNoirWallet()
  if (!wallet) throw new Error('Connect Noir Wallet to continue')
  const account = await wallet.zcash.getAccounts()
  if (!account) throw new Error('Authorize this application in Noir Wallet')
  const balance = await wallet.zcash.getBalance()
  const history = await wallet.zcash.getTransactionHistory()
  const localState = {account, balance, history, status: 'ready'}
  capture('checkout_started', {status: localState.status})
  console.info('Checkout ready')
  await fetch('/support', {method: 'POST', body: JSON.stringify({event: 'checkout_ready'})})
  await window.__ZTRACE_CHECKPOINT__?.('checkout_complete')
  return {address: localState.account.shielded, status: localState.status}
}
