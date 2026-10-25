import {useState} from 'react'

export function Checkout({run}: {run: () => Promise<{address: string; status: string}>}) {
  const [status, setStatus] = useState('Connect your wallet, then check your checkout integration.')
  return <main style={{fontFamily:'system-ui',maxWidth:640,margin:'64px auto',padding:24}}>
    <h1>Zcash checkout integration</h1>
    <p>Consumer application using the published Noir SDK and the installed ZTrace package.</p>
    <button data-test="checkout" onClick={async () => {
      try {const result = await run(); setStatus(result.status + ' · ' + result.address)}
      catch (error) {setStatus(error instanceof Error ? error.message : 'Checkout failed')}
    }}>Check checkout</button>
    <p role="status">{status}</p>
  </main>
}
