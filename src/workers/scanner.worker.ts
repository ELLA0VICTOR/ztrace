/// <reference lib="webworker" />
import {scanSources} from '../../packages/core/src/analyzer'
import type {ScanOptions, SourceFile} from '../../packages/core/src/types'

self.onmessage = ({data}: MessageEvent<{id: number; files: SourceFile[]; options: ScanOptions}>) => {
  const start = performance.now()
  try {
    const report = scanSources(data.files, data.options)
    self.postMessage({id: data.id, report, elapsedMs: performance.now() - start})
  } catch {
    self.postMessage({id: data.id, error: 'The example could not be analyzed. Try the CLI quickstart.'})
  }
}
