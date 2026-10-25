export function capture(event, properties) {
  navigator.sendBeacon('/events', JSON.stringify({event, properties}))
}
