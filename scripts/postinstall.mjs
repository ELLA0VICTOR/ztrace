// Cosmetic output only. Installation works with this hook disabled.
// No network access, file writes, subprocesses, or wallet access.
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

try {
  const color = process.env.NO_COLOR === undefined && (process.env.FORCE_COLOR !== undefined ? process.env.FORCE_COLOR !== '0' : !!process.stdout.isTTY && process.env.TERM !== 'dumb')
  const green = text => color ? `\u001b[92m${text}\u001b[0m` : text
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const logo = (process.stdout.columns ?? 80) >= 58 ? readFileSync(new URL('../public/terminal-banner.txt', import.meta.url), 'utf8').trimEnd() : 'ZTRACE'
  const installed = fileURLToPath(new URL('../', import.meta.url)).split(/[\\/]/u).includes('node_modules')
  const status = installed ? `ZTrace ${metadata.version} installed` : `ZTrace ${metadata.version} development setup ready`
  process.stdout.write(`\n${green(logo)}\n\n${green(status)}\nReady to check wallet data leaving your application.\n\n  ${installed ? 'npx --no-install ztrace' : 'npm run scan -- examples/vulnerable'}\n\n`)
} catch { /* A banner must never prevent installation. */ }
