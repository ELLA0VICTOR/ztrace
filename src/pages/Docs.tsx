import {isValidElement, useEffect, useState} from 'react'
import type {ReactNode} from 'react'
import {motion} from 'motion/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Braces, ChartNoAxesCombined, ChevronRight, FileText, KeyRound, LifeBuoy, Radio, Route, ShieldCheck, Terminal} from 'lucide-react'
import introduction from '../../docs/INTRODUCTION.md?raw'
import quickstart from '../../docs/QUICKSTART.md?raw'
import handsOn from '../../docs/HANDS-ON.md?raw'
import cli from '../../docs/CLI.md?raw'
import scanner from '../../docs/SCANNER.md?raw'
import runtime from '../../docs/RUNTIME.md?raw'
import protocol from '../../docs/PROTOCOL.md?raw'
import threat from '../../docs/THREAT-MODEL.md?raw'
import methodology from '../../benchmarks/METHODOLOGY.md?raw'
import troubleshooting from '../../docs/TROUBLESHOOTING.md?raw'
import integration from '../../docs/INTEGRATION.md?raw'
import releasing from '../../docs/RELEASING.md?raw'
import {CopyButton} from '../components/primitives'
import './Docs.css'

const documents = {
  introduction: {title: 'Introduction', navigation: 'Introduction', body: introduction, file: 'INTRODUCTION.md', group: 'Getting started', icon: FileText},
  quickstart: {title: 'Quickstart', navigation: 'Quickstart', body: quickstart, file: 'QUICKSTART.md', group: 'Getting started', icon: Terminal},
  'hands-on': {title: 'Hands-on walkthrough', navigation: 'Hands-on walkthrough', body: handsOn, file: 'HANDS-ON.md', group: 'Getting started', icon: BookOpen},
  cli: {title: 'CLI & integration', navigation: 'CLI & integration', body: cli, file: 'CLI.md', group: 'Getting started', icon: Braces},
  integration: {title: 'Consumer walkthrough', navigation: 'Consumer walkthrough', body: integration, file: 'INTEGRATION.md', group: 'Getting started', icon: Route},
  coverage: {title: 'Sources, adapters & policies', navigation: 'Sources & policies', body: scanner, file: 'SCANNER.md', group: 'Guides', icon: Route},
  runtime: {title: 'Runtime testing', navigation: 'Runtime testing', body: runtime, file: 'RUNTIME.md', group: 'Guides', icon: Radio},
  protocol: {title: 'Disclosure inspection', navigation: 'Disclosure inspection', body: protocol, file: 'PROTOCOL.md', group: 'Guides', icon: KeyRound},
  evidence: {title: 'Benchmark methodology', navigation: 'Benchmark methodology', body: methodology, file: 'METHODOLOGY.md', group: 'Reference', icon: ChartNoAxesCombined},
  boundaries: {title: 'Threat model', navigation: 'Threat model', body: threat, file: 'THREAT-MODEL.md', group: 'Reference', icon: ShieldCheck},
  troubleshooting: {title: 'Troubleshooting', navigation: 'Troubleshooting', body: troubleshooting, file: 'TROUBLESHOOTING.md', group: 'Reference', icon: LifeBuoy},
  releasing: {title: 'Verification & release', navigation: 'Verification & release', body: releasing, file: 'RELEASING.md', group: 'Reference', icon: ShieldCheck},
}
const entries = Object.entries(documents)
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const plain = (children: ReactNode): string => Array.isArray(children) ? children.map(plain).join('') : typeof children === 'string' || typeof children === 'number' ? String(children) : children && typeof children === 'object' && 'props' in children ? plain((children.props as {children: ReactNode}).children) : ''
const codeLabel = (children: ReactNode) => {
  const language = isValidElement<{className?: string}>(children) ? children.props.className?.replace('language-', '') : undefined
  const labels: Record<string, string> = {sh: 'Terminal', shell: 'Terminal', powershell: 'PowerShell', ts: 'TypeScript', js: 'JavaScript', json: 'JSON', typescript: 'TypeScript', javascript: 'JavaScript'}
  return language ? labels[language] ?? language : 'Code example'
}

function ArticleContents({headings, section}: {headings: string[]; section: string}) {
  const [activeHeading, setActiveHeading] = useState('')
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const sections = [...window.document.querySelectorAll<HTMLElement>('.markdown-document h2[id]')]
      const current = sections.findLast(heading => heading.getBoundingClientRect().top <= 180) ?? sections[0]
      setActiveHeading(current?.id ?? '')
    }
    const onScroll = () => {if (!frame) frame = requestAnimationFrame(update)}
    update()
    window.addEventListener('scroll', onScroll, {passive: true})
    return () => {window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame)}
  }, [section])
  const toc = (text: string) => window.document.getElementById('doc-' + slug(text))?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'})
  return <aside className="doc-toc" aria-label="On this page"><p>On this page</p><nav aria-label="Article sections">{headings.map(heading => <button key={heading} aria-current={activeHeading === 'doc-' + slug(heading) ? 'location' : undefined} onClick={() => toc(heading)}>{heading}</button>)}</nav></aside>
}

export default function Docs({section = 'introduction'}: {section?: string}) {
  const key = section in documents ? section as keyof typeof documents : 'introduction'
  const document = documents[key]
  const index = entries.findIndex(([id]) => id === key)
  const headings = [...document.body.matchAll(/^## (.+)$/gm)].map(match => match[1].replace(/\r/g, ''))
  useEffect(() => {window.scrollTo({top: 0, behavior: 'instant'}); window.document.title = `${document.title} — ZTrace documentation`}, [key, document.title])
  return <div className="docs-layout"><aside className="docs-sidebar" aria-label="Documentation navigation"><div className="docs-sidebar-heading"><BookOpen size={20} strokeWidth={1.6}/><span>Documentation</span></div><p className="docs-sidebar-description">Build with ZTrace.</p>{['Getting started', 'Guides', 'Reference'].map(group => <section className="docs-nav-group" key={group}><h2>{group}</h2><nav aria-label={group}>{entries.filter(([, doc]) => doc.group === group).map(([id, doc]) => <a key={id} href={'#docs/' + id} aria-current={key === id ? 'page' : undefined}>
      {key === id && <motion.span className="docs-active-background" layoutId="docs-active-page" transition={{type: 'spring', bounce: 0, duration: .3}}/>}
      <doc.icon size={18} strokeWidth={1.6} aria-hidden="true"/><span className="docs-nav-label">{doc.navigation}</span>{key === id && <ChevronRight className="docs-current-arrow" size={14} aria-hidden="true"/>}
    </a>)}</nav></section>)}<div className="docs-version"><span>Development release</span><span>v0.1.0 <span aria-hidden="true">/</span> Node.js 24+</span></div></aside>
    <div className="docs-mobile-select"><label htmlFor="documentation-page"><BookOpen size={18} strokeWidth={1.6}/>Documentation</label><select id="documentation-page" value={key} onChange={event => {location.hash = 'docs/' + event.target.value}}>{['Getting started', 'Guides', 'Reference'].map(group => <optgroup label={group} key={group}>{entries.filter(([, doc]) => doc.group === group).map(([id, doc]) => <option key={id} value={id}>{doc.navigation}</option>)}</optgroup>)}</select></div>
    <div className="docs-article"><div className="docs-breadcrumb"><a href="#docs/introduction">Documentation</a><ChevronRight size={13}/><span>{document.title}</span></div><article className="markdown-document"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      h2: ({children}) => <h2 id={'doc-' + slug(plain(children))}>{children}</h2>,
      a: ({href, children}) => {
        const matched = entries.find(([, doc]) => href?.includes(doc.file))
        if (matched) return <a href={'#docs/' + matched[0]}>{children}</a>
        if (href?.startsWith('https://') || href?.startsWith('http://')) return <a href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={11}/></a>
        return <span>{children}</span>
      },
      img: ({alt}) => <span>{alt}</span>,
      pre: ({children}) => <div className="doc-code"><div className="doc-code-heading"><span>{codeLabel(children)}</span><CopyButton value={plain(children).replace(/\n$/, '')} label="Copy documentation code"/></div><pre tabIndex={0} aria-label={codeLabel(children) + ' example'}>{children}</pre></div>,
      table: ({children}) => <div className="doc-table" tabIndex={0} aria-label="Reference table"><table>{children}</table></div>,
    }}>{document.body}</Markdown></article><nav className="doc-pagination" aria-label="Documentation pages">{index > 0 && <a href={'#docs/' + entries[index - 1][0]}><span><ArrowLeft size={14}/>Previous</span><strong>{entries[index - 1][1].navigation}</strong></a>}{index < entries.length - 1 && <a href={'#docs/' + entries[index + 1][0]}><span>Next<ArrowRight size={14}/></span><strong>{entries[index + 1][1].navigation}</strong></a>}</nav></div>
    <ArticleContents headings={headings} section={key}/>
  </div>
}
