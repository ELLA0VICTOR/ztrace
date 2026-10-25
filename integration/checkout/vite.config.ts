import {defineConfig} from 'vite'
import {resolve} from 'node:path'
export default defineConfig({build:{rollupOptions:{input:{leaking:resolve('leaking.html'),corrected:resolve('corrected.html')}}}})
