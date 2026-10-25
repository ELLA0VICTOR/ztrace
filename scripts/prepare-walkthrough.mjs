import {spawnSync} from 'node:child_process'
import {cp, mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--destination')) throw new Error('Use --destination with a new directory path.')
const destination = args.length ? resolve(args[1]) : resolve(root, '../ztrace-playground')
try {await stat(destination); throw new Error('The walkthrough directory already exists. Choose a new --destination; existing files are preserved.')}
catch (error) {if (error.code !== 'ENOENT') throw error}

const releases = join(root, '.artifacts/release')
await mkdir(releases, {recursive: true})
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const packed = spawnSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', releases], {cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1_000_000})
if (packed.status !== 0) throw new Error('Package preparation failed. Run npm run build:tools first.')
const [archive] = JSON.parse(packed.stdout)
const tarball = join(releases, archive.filename)
await mkdir(destination)
await cp(join(root, 'examples/vulnerable'), join(destination, 'leaking'), {recursive: true, force: false, errorOnExist: true})
await cp(join(root, 'examples/safe'), join(destination, 'corrected'), {recursive: true, force: false, errorOnExist: true})
const project = {name: 'ztrace-learning-project', version: '1.0.0', private: true, type: 'module', scripts: {
  'check:leaking': 'ztrace scan ./leaking',
  'check:corrected': 'ztrace scan ./corrected',
  'check:details': 'ztrace scan ./leaking --verbose',
}}
await writeFile(join(destination, 'package.json'), JSON.stringify(project, null, 2) + '\n', {flag: 'wx'})
await writeFile(join(destination, '.gitignore'), 'node_modules/\n*.log\n', {flag: 'wx'})
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const instructions = `# Try ZTrace as a developer\n\nThis is a separate application folder. ZTrace has not been installed here yet. Its sample source is inspected as text; no wallet calls are executed.\n\n## 1. Install the actual packaged tool\n\n\`\`\`powershell\nSet-Location ${quote(destination)}\nnpm.cmd install --save-dev --prefer-offline --foreground-scripts ${quote(tarball)}\n\`\`\`\n\nThe package is a local release archive built from your ZTrace repository. The install prints the banner when npm permits lifecycle scripts. ZTrace's hook only prints text; it makes no network requests or file changes. Ordinary npm installation may hide lifecycle output, and script-disabled installations still support the CLI.\n\n## 2. Check the leaking application\n\n\`\`\`powershell\nnpm.cmd run check:leaking\n\`\`\`\n\nExpect three findings: a balance written to logs, transaction history sent to a support endpoint, and an address sent to analytics. Exit code 1 is expected for this example.\n\n## 3. Check the corrected application\n\n\`\`\`powershell\nnpm.cmd run check:corrected\n\`\`\`\n\nExpect no findings and exit code 0. Private wallet values stay in the application; status reporting contains public messages.\n\n## 4. Follow the full path\n\n\`\`\`powershell\nnpm.cmd run check:details\n\`\`\`\n\nOpen leaking/checkout.ts and leaking/telemetry.ts. Find the address read from the wallet, passed into recordCheckout, then sent to PostHog. The scanner follows that path across files.\n\nGreen identifies ZTrace, fixes, and a check with no findings. Red marks errors; amber marks warnings and paths that need review. Color is automatic in an interactive terminal. Use --color always to force it, or --no-color to disable it.\n`
await writeFile(join(destination, 'READ-ME-FIRST.md'), instructions, {flag: 'wx'})
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
console.log(`Prepared ${metadata.name} ${metadata.version}. No dependency has been installed in the learning project.\n\nRun in PowerShell:\n\nSet-Location ${quote(destination)}\nnpm.cmd install --save-dev --prefer-offline --foreground-scripts ${quote(tarball)}\nnpx.cmd --no-install ztrace scan ./leaking\n\nGuide: ${join(destination, 'READ-ME-FIRST.md')}`)
