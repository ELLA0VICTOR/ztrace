import { readFile, stat, writeFile } from 'node:fs/promises'
import { inspectViewingCapability } from './unified.js'
import { inspectPcztDisclosure } from './pczt.js'
import type { PcztDisclosureOptions } from './pczt.js'

export async function runInspectCommand(args: string[]): Promise<number> {
  const [kind, file, ...rest] = args
  let output: string|undefined
  const outputIndex=rest.indexOf('--output')
  if(outputIndex>=0){output=rest[outputIndex+1];if(!output||!output.endsWith('.json')||outputIndex!==rest.length-2)throw new Error('Output must be a new JSON report.');rest.splice(outputIndex,2)}
  const emit=async(value:unknown)=>{const text=JSON.stringify(value,null,2)+'\n';if(output)await writeFile(output,text,{flag:'wx'});else process.stdout.write(text)}
  if (!file || !['key', 'pczt'].includes(kind ?? '')) throw new Error('Inspect requires key or pczt and a local file.')
  if ((await stat(file)).size > 4_000_000) throw new Error('Artifact exceeds inspection size limit.')
  const input = await readFile(file)
  if (kind === 'key') {
    if (rest.length) throw new Error('Unexpected key inspection arguments.')
    const report = inspectViewingCapability(input.toString('utf8').trim())
    await emit(report)
    return report.status === 'recognized-encoding' ? 0 : 2
  }
  if (![2, 3].includes(rest.length) || rest[0] !== '--recipient' || (rest.length === 3 && rest[2] !== '--acknowledge-private-disclosure')) throw new Error('Specify the recipient role.')
  const recipient = rest[1] as PcztDisclosureOptions['recipient']
  // A private role must be acknowledged explicitly, separately from selecting its name.
  const artifact = input.subarray(0, 4).toString('ascii') === 'PCZT' ? input : input.toString('utf8').trim()
  const report = await inspectPcztDisclosure(artifact, { recipient, acknowledgePrivateDisclosure: rest[2] === '--acknowledge-private-disclosure' })
  await emit(report)
  return report.status !== 'parsed-signer-projection' ? 2 : report.decision === 'reject' ? 1 : 0
}
