import {useEffect, useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {motion, useReducedMotion, useScroll, useTransform} from 'motion/react'
import type {MotionValue} from 'motion/react'
import {ArrowDown, ArrowRight, ArrowUpRight, Check, CircleCheck, Code2, FileCode2, GitBranch, LockKeyhole, Pause, Play, Plus, Radio, ShieldCheck, Terminal} from 'lucide-react'
import type {ScanReport} from '../../packages/core/src/types'
import examples from '../generated/examples.json'
import validation from '../generated/validation-summary.json'
import {CopyButton} from '../components/primitives'

function Reveal({children, className = '', delay = 0}: {children: ReactNode; className?: string; delay?: number}) {
  const reduced = useReducedMotion()
  return <motion.div className={className} initial={{opacity: 0, y: reduced ? 0 : 18}} whileInView={{opacity: 1, y: 0}} viewport={{once: true, amount: .12}} transition={{type: 'spring', bounce: 0, duration: .65, delay: reduced ? 0 : delay}}>{children}</motion.div>
}

function Word({word, progress, start, end}: {word: string; progress: MotionValue<number>; start: number; end: number}) {
  const color = useTransform(progress, [start, end], ['#737373', '#1a1a1a'])
  const reduced = useReducedMotion()
  return <motion.span style={{color: reduced ? '#1a1a1a' : color}}>{word} </motion.span>
}

function ScrollHeading({children}: {children: string}) {
  const target = useRef<HTMLHeadingElement>(null)
  const {scrollYProgress} = useScroll({target, offset: ['start .9', 'end .48']})
  const words = children.split(' ')
  return <h2 ref={target} className="scroll-heading">{words.map((word, index) => <Word key={index} word={word} progress={scrollYProgress} start={index / words.length} end={(index + 1) / words.length}/>)}</h2>
}

function Example() {
  const [fixed, setFixed] = useState(false)
  const [file, setFile] = useState('telemetry.ts')
  const [reports, setReports] = useState({original: examples.original.report as ScanReport, corrected: examples.corrected.report as ScanReport})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('Engine-generated example · not a live wallet')
  const worker = useRef<Worker | null>(null)
  const entry = fixed ? examples.corrected : examples.original
  const report = fixed ? reports.corrected : reports.original
  const source = entry.sources.find(item => item.path === file) ?? entry.sources[0]
  const address = report.findings.find(item => item.ruleId === 'ZT003')
  useEffect(() => () => worker.current?.terminate(), [])
  const change = (value: boolean) => {worker.current?.terminate(); setBusy(false); setFixed(value); setFile(value ? 'checkout.ts' : 'telemetry.ts'); setResult('Engine-generated example · not a live wallet')}
  const run = () => {
    setBusy(true); setResult('Loading the local analysis worker…')
    worker.current?.terminate()
    const instance = new Worker(new URL('../workers/scanner.worker.ts', import.meta.url), {type: 'module'})
    worker.current = instance
    instance.onmessage = ({data}: MessageEvent<{report?: ScanReport; elapsedMs: number; error?: string}>) => {
      setBusy(false)
      if (data.report) {setReports(previous => ({...previous, [fixed ? 'corrected' : 'original']: data.report!})); setResult(`Checked locally in ${Math.round(data.elapsedMs)} ms · source was not uploaded`)}
      else setResult(data.error ?? 'Analysis failed. Try the CLI quickstart.')
      instance.terminate(); worker.current = null
    }
    instance.onerror = () => {setBusy(false); setResult('Worker unavailable. Use the CLI quickstart.'); instance.terminate(); worker.current = null}
    instance.postMessage({id: 1, files: entry.sources, options: {}})
  }
  return <Reveal className="example-wrap" delay={.1}>
    <div className="example-top"><div><span className="section-kicker">Follow the data</span><h2>A private address. A public event.</h2></div><div className="segmented" aria-label="Example version"><button aria-pressed={!fixed} onClick={() => change(false)}>The leak</button><button aria-pressed={fixed} onClick={() => change(true)}>The correction</button></div></div>
    <div className="example-body">
      <div className="example-source"><div className="source-tabs">{entry.sources.map(item => <button key={item.path} aria-pressed={source.path === item.path} onClick={() => setFile(item.path)}><FileCode2 size={14}/>{item.path}</button>)}<CopyButton value={source.content} label="Copy example source"/></div><pre tabIndex={0} aria-label={`Example source: ${source.path}`}><code>{source.content.split('\n').map((line, index) => <span key={index} className={line.includes('posthog.capture') || line.includes('recordCheckout(connection') ? 'example-highlight' : ''}><span className="line-no" aria-hidden="true">{index + 1}</span>{line || ' '}{'\n'}</span>)}</code></pre></div>
      <div className="example-result"><span className="result-label">{fixed ? <CircleCheck size={16}/> : <GitBranch size={16}/>} {fixed ? 'Corrected fixture' : 'ZT003 · Analytics disclosure'}</span><h3>{fixed ? 'Report the event. Keep the address.' : 'Your wallet address takes a detour.'}</h3><p>{fixed ? 'The event carries a public status. Wallet data remains in local application state.' : 'ZTrace follows the shielded address through a local function and into PostHog.'}</p>
        <ol className="trace-path">{(fixed ? [{label: 'Wallet data stays local',detail: 'connection + balance → localState'}, {label: 'Only a public status leaves', detail: "posthog.capture({ status: 'ready' })"}] : [{label: 'Read from the wallet', detail: address ? `${address.source.file}:${address.source.line} · getAccounts()` : 'checkout.ts · getAccounts()'}, {label: 'Pass through your application', detail: 'recordCheckout(connection.shielded)'}, {label: 'Disclose to analytics', detail: address ? `${address.sink.file}:${address.sink.line} · posthog.capture()` : 'telemetry.ts · posthog.capture()'}]).map((step, index) => <li key={step.label}><span className="trace-dot">{fixed ? <Check size={11}/> : index + 1}</span><div><strong>{step.label}</strong><code>{step.detail}</code></div></li>)}</ol>
        <div className="example-verdict"><span>{report.findings.length} {report.findings.length === 1 ? 'finding' : 'findings'} in {report.summary.filesScanned} {report.summary.filesScanned === 1 ? 'file' : 'files'}</span><span>Limited coverage</span></div>
      </div>
    </div><div className="example-bottom"><span role="status">{result}</span><button className="text-button" disabled={busy} onClick={run}>{busy ? 'Checking…' : 'Run local check'}{busy ? <span className="spinner"/> : <Play size={13}/>}</button></div>
  </Reveal>
}

const technologies = [
  {name: 'TypeScript', asset: 'typescript.png'},
  {name: 'React', asset: 'react.svg'},
  {name: 'Zcash', asset: 'zcash.svg'},
  {name: 'Noir Wallet', asset: 'noir.png'},
  {name: 'RHEA', asset: 'rhea.svg'},
  {name: 'Ledger', asset: 'ledger.svg', wordmark: true},
  {name: 'PostHog', asset: 'posthog.svg'},
  {name: 'Sentry', asset: 'sentry.svg'},
  {name: 'Axios', asset: 'axios-mark.svg'},
]
function TechnologyStrip() {
  const [paused, setPaused] = useState(false)
  return <section className="technology-section ruled">
    <div className="strip-label"><p>Built for the application layer</p><button aria-label={paused ? 'Resume technology strip' : 'Pause technology strip'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'} {paused ? <Play size={10}/> : <Pause size={10}/>}</button></div>
    <div className={`marquee ${paused ? 'paused' : ''}`}><div className="marquee-track">
      {[0, 1].map(copy => <div className="marquee-group" aria-hidden={copy === 1 ? true : undefined} key={copy}>
        {technologies.map(tech => <span className="technology" key={tech.name}>
          <img className={`technology-logo${tech.wordmark ? ' technology-wordmark' : ''}`} src={'/brands/' + tech.asset} width={tech.wordmark ? 108 : 32} height={32} alt="" decoding="async"/>
          <span className={tech.wordmark ? 'sr-only' : undefined}>{tech.name}</span>
        </span>)}
      </div>)}
    </div></div>
    <p className="strip-note">Language support and modeled source/destination integrations.</p>
  </section>
}

function FlowIllustration() {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const {scrollYProgress} = useScroll({target: ref, offset: ['start .9', 'end .45']})
  const pathLength = useTransform(scrollYProgress, [0, 1], [.02, 1])
  return <div className="flow-illustration" ref={ref}><div className="flow-top"><span className="mono">Application boundary</span><LockKeyhole size={16}/></div><svg viewBox="0 0 540 210" fill="none" aria-label="Sensitive data moves from wallet through application code to a disclosure boundary" role="img"><path d="M55 105H470" stroke="#dedede" strokeWidth="1.5"/><motion.path d="M55 105H263C330 105 320 48 376 48H477" stroke="#1a1a1a" strokeWidth="2" style={{pathLength: reduced ? 1 : pathLength}}/><motion.path d="M263 105C330 105 320 162 376 162H477" stroke="#1a1a1a" strokeWidth="2" style={{pathLength: reduced ? 1 : pathLength}}/><rect x="29" y="79" width="52" height="52" rx="26" fill="#fbfbfb" stroke="#1a1a1a"/><text x="55" y="113" textAnchor="middle" fill="#1a1a1a" fontFamily="Space Grotesk" fontSize="24">Z</text><rect x="237" y="79" width="52" height="52" fill="#fbfbfb" stroke="#1a1a1a"/><path d="m254 98-7 7 7 7m18-14 7 7-7 7m-7-17-5 20" stroke="#1a1a1a" strokeWidth="1.5"/><circle cx="477" cy="48" r="5" fill="#fbfbfb" stroke="#1a1a1a"/><circle cx="477" cy="162" r="5" fill="#fbfbfb" stroke="#1a1a1a"/><text x="55" y="159" textAnchor="middle" fill="#707070" fontFamily="Inter" fontSize="12">Wallet</text><text x="263" y="159" textAnchor="middle" fill="#707070" fontFamily="Inter" fontSize="12">Your code</text><text x="477" y="28" textAnchor="middle" fill="#707070" fontFamily="Inter" fontSize="12">Analytics</text><text x="477" y="195" textAnchor="middle" fill="#707070" fontFamily="Inter" fontSize="12">Network</text></svg><div className="flow-caption"><span className="small-dot"/> Shielded onchain. Still sensitive in your app.</div></div>
}

const checks = [
  {number: '01', title: 'Trace private data through your code.', text: 'Follow supported wallet values across files, functions, object fields, React hooks, and common transports. Find the source, destination, and path between them.', link: 'Explore scanner coverage', href: 'coverage', icon: Code2, label: 'STATIC ANALYSIS'},
  {number: '02', title: 'Exercise the flows your users take.', text: 'Run a trusted local app with synthetic test values. Observe console, HTTP, and WebSocket exposure in a fresh Chromium context, with external traffic blocked.', link: 'Set up a runtime test', href: 'runtime', icon: Radio, label: 'RUNTIME TESTING'},
  {number: '03', title: 'Know what a Zcash artifact reveals.', text: 'Decode viewing-key capabilities and inspect a bounded PCZT signer projection. Make disclosure decisions before sharing sensitive material with another service.', link: 'Understand disclosure checks', href: 'protocol', icon: ShieldCheck, label: 'ZCASH INSPECTION'},
]

export default function Landing() {
  return <>
    <section className="hero"><Reveal><p className="hero-eyebrow"><span className="small-dot"/> Local privacy tooling for Zcash applications</p><h1>Keep private wallet data<br className="desktop-break"/> out of public places.</h1><p className="hero-description">A shielded transaction can still leave a trail in your app. ZTrace follows sensitive wallet data into logs, analytics, and network requests—so you can fix the leak before you ship.</p><div className="hero-actions"><a className="button button-dark" href="#docs/quickstart">Start building <ArrowUpRight size={17}/></a><a className="button button-light" href="#example">See a leak traced <ArrowDown size={16}/></a></div><p className="hero-footnote">Runs locally. Your source code stays with you.</p></Reveal></section>
    <section id="example" className="example-section"><Example/></section>
    <TechnologyStrip/>
    <section id="problem" className="problem-section section-space ruled"><p className="section-kicker centered">The problem, told plainly</p><ScrollHeading>Zcash shields the transaction. Your application can still reveal the person.</ScrollHeading><Reveal><p className="section-description centered">A debug log. A support upload. An innocent-looking analytics event. Once wallet data reaches your application, the protocol can’t decide where your JavaScript sends it.</p></Reveal><div className="comparison"><Reveal><span className="comparison-label">The transaction layer</span><h3>Privacy built into the protocol.</h3><p>Zcash protects shielded transaction details onchain.</p><div className="comparison-line"><Check size={17}/><span>Shielded values and recipients</span></div><div className="comparison-line"><Check size={17}/><span>Cryptographic transaction privacy</span></div></Reveal><Reveal delay={.1}><span className="comparison-label">The application layer</span><h3>Privacy depends on your code.</h3><p>ZTrace checks supported flows after the wallet responds.</p><div className="comparison-line"><ArrowRight size={17}/><span>Private values reaching telemetry</span></div><div className="comparison-line"><ArrowRight size={17}/><span>Unintended disclosure in your app</span></div></Reveal></div></section>
    <section id="how-it-works" className="section-space workflow-section ruled"><div className="split-intro"><Reveal><p className="section-kicker">From source to destination</p><h2>See where the<br/>privacy boundary breaks.</h2><p className="section-description">ZTrace connects the wallet call to the line that shares its result. You get a location, a data path, and a concrete place to make a change.</p><a className="text-link" href="#docs/quickstart">Run your first check <ArrowUpRight size={17}/></a></Reveal><FlowIllustration/></div><div className="workflow-steps">{[{n: '01', title: 'Point it at your project', text: 'Scan TypeScript and JavaScript locally. Static analysis reads your files without running your application.'}, {n: '02', title: 'Follow the finding', text: 'Inspect the source, the intermediate calls, and the destination. Review coverage diagnostics alongside the result.'}, {n: '03', title: 'Fix, then check again', text: 'Keep sensitive values local, narrow an intended disclosure, and rerun. Use exit codes to bring the check into CI.'}].map((step, index) => <Reveal key={step.n} delay={index * .06}><span className="step-number mono">{step.n}</span><h3>{step.title}</h3><p>{step.text}</p></Reveal>)}</div></section>
    <section id="coverage" className="section-space capabilities-section ruled"><p className="section-kicker centered">Three ways to inspect a boundary</p><ScrollHeading>Read the code. Exercise the flow. Inspect the disclosure.</ScrollHeading><div className="capability-list">{checks.map(item => <Reveal key={item.number} className="capability-row"><span className="capability-number mono">{item.number}</span><div className="capability-heading"><item.icon size={23} strokeWidth={1.3}/><h3>{item.title}</h3></div><div><p>{item.text}</p><a href={'#docs/' + item.href} className="text-link">{item.link}<ArrowUpRight size={15}/></a></div></Reveal>)}</div></section>
    <section id="evidence" className="section-space evidence-section ruled"><Reveal><p className="section-kicker centered">Evidence you can inspect</p><h2 className="section-title centered">Show the work.<br/>Including the gaps.</h2><p className="section-description centered">A useful privacy tool needs an honest boundary. The benchmark, runtime fixtures, and protocol vectors are included with the project.</p></Reveal><div className="evidence-metrics"><Reveal><span className="metric-value">{validation.cases}</span><p>self-authored synthetic<br/>scanner cases</p></Reveal><Reveal delay={.06}><span className="metric-value">{validation.runtimeFlows}</span><p>controlled browser<br/>test flows</p></Reveal><Reveal delay={.12}><span className="metric-value">{validation.protocolVectors}</span><p>upstream protocol<br/>test vectors</p></Reveal></div><Reveal className="benchmark-explainer"><div><span className="section-kicker">Default scanner · synthetic corpus</span><h3>{validation.detected} detected.<br/>{validation.missed} missed.<br/><span>No hidden asterisk.</span></h3></div><div><div className="benchmark-bar" role="img" aria-label="Of 30 synthetic leaking cases, 28 were detected and 2 were missed"><span/><span/></div><div className="bar-legend"><span><i/>{validation.detected} detected leaks</span><span><i/>{validation.missed} missed leaks</span></div><p>The default scanner detects 28 of 30 leaking fixtures and flags none of the 30 safe fixtures. Two explicit custom-library adapters cover the remaining leaks in this corpus.</p><p className="benchmark-note">These are self-authored examples, not an independent evaluation or a measure of production accuracy. Unsupported code can still hide leaks.</p><a href="#docs/evidence" className="text-link">Read the benchmark methodology <ArrowUpRight size={16}/></a></div></Reveal></section>
    <section className="section-space integration-section ruled"><div className="split-intro"><Reveal><p className="section-kicker">Fits into the way you build</p><h2>Your editor.<br/>Your terminal.<br/>Your boundaries.</h2><p className="section-description">Start with the CLI. Add source and sink adapters for your own libraries. Use the exported APIs in local development and test automation.</p><a href="#docs/cli" className="text-link">CLI & integration guide <ArrowUpRight size={17}/></a></Reveal><Reveal className="terminal-example"><div className="terminal-heading"><Terminal size={16}/><span>From the project checkout</span><CopyButton value={'npm install\nnpm run build:tools\nnpm run scan -- ./your-app'} label="Copy setup commands"/></div><pre><code><span className="terminal-comment"># Install and build ZTrace locally</span>{'\n'}npm install{'\n'}npm run build:tools{'\n\n'}<span className="terminal-comment"># Check your application</span>{'\n'}npm run scan -- ./your-app{'\n\n'}<span className="terminal-comment"># Write a structured report</span>{'\n'}node dist-tools/packages/cli/src/cli.js \{'\n'}  scan ./your-app --format json \{'\n'}  --output report.json</code></pre><div className="terminal-note"><LockKeyhole size={14}/><span>No hosted scanner or public npm release required.</span></div></Reveal></div></section>
    <section className="section-space faq-section ruled"><Reveal><p className="section-kicker">Before you build</p><h2>Good questions.<br/>Straight answers.</h2></Reveal><div className="faq-list">{[
      ['Is this a wallet or a block explorer?', 'Neither. ZTrace is developer tooling: a local CLI, reusable analysis APIs, and a controlled browser test harness. It checks application code and supported disclosures around Zcash integrations.'],
      ['Does my source code leave my machine?', 'The scanner reads and analyzes files locally. The example on this page runs in a browser worker without uploading source. ZTrace does not require an account or a hosted scanning service.'],
      ['Can I use my own wallet or telemetry library?', 'Yes. Explicit source and sink adapters let you describe imported functions from your own libraries. They extend supported API boundaries; they do not make arbitrary third-party code automatically understood.'],
      ['Does a clean report prove the app is private?', 'No. Static coverage is limited, and runtime testing sees only the paths and representations exercised. Read the coverage diagnostics and threat model. ZTrace does not prove cryptographic security or network anonymity.'],
      ['Is it available as a public package?', 'This is a development release, used from the project checkout. The scanner, runtime, and protocol APIs are exported for local integration. Public package distribution is not available yet.'],
    ].map(([question, answer]) => <details key={question}><summary>{question}<Plus size={18} strokeWidth={1.4}/></summary><p>{answer}</p></details>)}</div></section>
    <section className="closing-section ruled"><Reveal><p className="section-kicker">Build something that keeps a secret.</p><h2>Privacy shouldn’t end<br/>at the wallet.</h2><div className="hero-actions"><a className="button button-dark" href="#docs/quickstart">Start building <ArrowUpRight size={17}/></a><a className="button button-light" href="#docs/boundaries">Understand the limits <ArrowRight size={16}/></a></div></Reveal><div className="closing-mark" aria-hidden="true"><svg viewBox="0 0 240 240" fill="none"><path d="M40 60h160L40 180h160" stroke="currentColor" strokeWidth="1"/><path d="M40 40h160L40 160h160M40 80h160L40 200h160" stroke="currentColor" strokeWidth=".6"/><circle cx="40" cy="180" r="6" fill="#fbfbfb" stroke="currentColor"/><circle cx="200" cy="60" r="6" fill="#fbfbfb" stroke="currentColor"/></svg></div></section>
  </>
}
