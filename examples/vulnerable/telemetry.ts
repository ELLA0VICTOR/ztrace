import posthog from 'posthog-js'

export function recordCheckout(address: string) {
  const payload = { address }
  posthog.capture('checkout_started', payload)
}
