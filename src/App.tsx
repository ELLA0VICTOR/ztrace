import {lazy, Suspense, useEffect, useRef, useState} from 'react'
import {MotionConfig} from 'motion/react'
import {ArrowLeft, ArrowRight, Menu, X} from 'lucide-react'
import {Logo} from './components/primitives'
import Landing from './pages/Landing'
import './App.css'

const Docs = lazy(() => import('./pages/Docs'))

function Site() {
  const [route, setRoute] = useState(() => location.hash.slice(1))
  const [menu, setMenu] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const docs = route.startsWith('docs')
  useEffect(() => {
    const update = () => {
      const next = location.hash.slice(1)
      setRoute(next); setMenu(false)
      if (next.startsWith('docs') || !next) window.scrollTo({top: 0, behavior: 'instant'})
      else requestAnimationFrame(() => document.getElementById(next)?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {document.title = docs ? 'Documentation — ZTrace' : 'ZTrace — Keep private wallet data private.'}, [docs])
  useEffect(() => {
    const close = (event: KeyboardEvent) => {if (event.key === 'Escape' && menu) {setMenu(false); menuButton.current?.focus()}}
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menu])
  return <>
    <a href="#main-content" className="skip-link" onClick={event => {event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView()}}>Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a href="#" className="home-link" aria-label="ZTrace home"><Logo/></a>
      <nav className="desktop-nav" aria-label="Main navigation"><a href="#problem">The problem</a><a href="#how-it-works">How it works</a><a href="#coverage">What it checks</a><a href="#evidence">The evidence</a></nav>
      <a className={'button button-dark header-cta' + (docs ? ' header-back' : '')} href={docs ? '#' : '#docs/introduction'}>{docs ? <><ArrowLeft size={16}/>Back</> : <>Documentation <ArrowRight size={16}/></>}</a>
      <button ref={menuButton} className="menu-button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="mobile-navigation" onClick={() => setMenu(!menu)}>{menu ? <X/> : <Menu/>}</button>
    </div>{menu && <nav className="mobile-nav" id="mobile-navigation" aria-label="Mobile navigation" onClick={() => setMenu(false)}><a href="#problem">The problem</a><a href="#how-it-works">How it works</a><a href="#coverage">What it checks</a><a href="#evidence">The evidence</a><a href={docs ? '#' : '#docs/introduction'}>{docs ? <>Back <ArrowLeft size={17}/></> : <>Documentation <ArrowRight size={17}/></>}</a></nav>}</header>
    <main id="main-content" tabIndex={-1} className={docs ? 'site-main docs-main' : 'site-main'}>{docs ? <Suspense fallback={<div className="loading-docs">Loading documentation…</div>}><Docs section={route.split('/')[1]}/></Suspense> : <Landing/>}</main>
    <footer className="site-footer"><div className="footer-intro"><a href="#" aria-label="ZTrace home"><Logo/></a><p>Local privacy analysis for<br/>applications built on Zcash.</p><span className="version-label">Development release · v0.1.0</span></div>
      <div><h2>Start here</h2><a href="#docs/introduction">Introduction</a><a href="#docs/quickstart">Quickstart</a><a href="#how-it-works">How it works</a></div>
      <div><h2>Build with it</h2><a href="#docs/coverage">Sources & policies</a><a href="#docs/runtime">Runtime testing</a><a href="#docs/protocol">Disclosure inspection</a></div>
      <div><h2>Understand it</h2><a href="#docs/evidence">Benchmarks</a><a href="#docs/boundaries">Threat model</a><a href="#docs/troubleshooting">Troubleshooting</a></div>
      <div className="footer-bottom"><span>Designed for private development.</span><span>No accounts. No source uploads. No analytics.</span></div>
    </footer>
  </>
}

export default function App() {return <MotionConfig reducedMotion="user" transition={{type: 'spring', bounce: 0, duration: 0.4}}><Site/></MotionConfig>}
