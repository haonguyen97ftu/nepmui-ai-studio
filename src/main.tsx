import React, { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, BookOpen, ChevronRight, CircleHelp, Flame, FlaskConical, Home, Layers3, LogOut, Menu, MessageSquare, Package, Plug, Settings2, Sparkles, UserRound, X } from 'lucide-react'
import '@fontsource/be-vietnam-pro/vietnamese-400.css'
import '@fontsource/be-vietnam-pro/vietnamese-500.css'
import '@fontsource/be-vietnam-pro/vietnamese-600.css'
import '@fontsource/be-vietnam-pro/latin-400.css'
import '@fontsource/be-vietnam-pro/latin-500.css'
import '@fontsource/be-vietnam-pro/latin-600.css'
import '@fontsource/lora/vietnamese-500.css'
import '@fontsource/lora/latin-500.css'
import './style.css'
import { api, useAction, useResource } from './api'
import { navigation, type Page } from './locale'
import { Dashboard } from './dashboard'
import { Library } from './library'
import { Conversations, Integrations, Models, Persona, Settings } from './operations'
import { Playground } from './playground'
import { Button } from './ui/button'
import { Feedback, LoadState } from './ui/common'

const groups = [
  { title: 'ĐIỀU HÀNH', items: [['dashboard', Home], ['conversations', MessageSquare]] },
  { title: 'NỘI DUNG & AI', items: [['knowledge', BookOpen], ['products', Package], ['persona', UserRound], ['training', Sparkles], ['playground', FlaskConical]] },
  { title: 'HỆ THỐNG', items: [['integrations', Plug], ['models', Layers3], ['settings', Settings2]] },
] as const
type Session = { authenticated: boolean; demo: boolean; brand?: { name: string } }
function route() {
  const [segment, ...rest] = window.location.hash.slice(1).split('/')
  const page = Object.hasOwn(navigation, segment) ? segment as Page : 'dashboard'
  let id: string | undefined
  try { id = rest.length ? decodeURIComponent(rest.join('/')) : undefined } catch { /* Ignore malformed deep links. */ }
  return { page, id }
}

function Logo({ name = 'NẾP MÙI' }: { name?: string }) {
  return <a className="logo" href="#dashboard"><span className="brand-mark"><Flame size={22} strokeWidth={1.55} /></span>
    <span><strong>{name}</strong><small>AI STUDIO</small></span></a>
}

function Login({ refresh }: { refresh: () => void }) {
  const action = useAction()
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = new FormData(event.currentTarget).get('token')
    void action.run(async () => { await api('session', 'POST', { token }); refresh() })
  }
  return <main className="login"><form className="card padded form-stack" onSubmit={login}>
    <Logo /><h1>Đăng nhập</h1><p>Sử dụng khóa truy cập của quản trị viên để mở AI Studio.</p>
    <label>Khóa truy cập<input autoComplete="current-password" type="password" name="token" required maxLength={512} /></label>
    <Feedback error={action.error} /><Button type="submit" disabled={action.busy}>Đăng nhập <ArrowRight size={16} /></Button>
  </form></main>
}

function App() {
  const session = useResource<Session>('session')
  const [{ page, id }, setRoute] = useState(route)
  const [mobileNav, setMobileNav] = useState(false)
  const [correction, setCorrection] = useState<{ title: string; incorrect: string }>()
  const [brandName, setBrandName] = useState<string>()
  const logout = useAction()
  useEffect(() => {
    const navigate = () => {
      const next = route()
      setRoute(next)
      setMobileNav(false)
      if (next.page !== 'training') setCorrection(undefined)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', navigate)
    window.addEventListener('studio-session-expired', session.refresh)
    return () => {
      window.removeEventListener('hashchange', navigate)
      window.removeEventListener('studio-session-expired', session.refresh)
    }
  }, [session.refresh])
  useEffect(() => {
    document.title = `${navigation[page][0]} · NẾP MÙI AI Studio`
  }, [page])
  if (!session.value) return <main className="login"><LoadState error={session.error} retry={session.refresh} /></main>
  if (!session.value.authenticated) return <Login refresh={session.refresh} />
  if (!session.value.brand) return <main className="login"><LoadState error="Thương hiệu chưa được kích hoạt." retry={session.refresh} /></main>
  const { demo, brand } = session.value
  const name = brandName ?? brand.name
  const pages = {
    dashboard: <Dashboard demo={demo} />,
    knowledge: <Library key="knowledge" kind="knowledge" />,
    products: <Library key="products" kind="products" />,
    training: <Library key="training" kind="training" correction={correction} />,
    persona: <Persona />,
    playground: <Playground />,
    conversations: <Conversations selectedId={id} correct={(title, incorrect) => { setCorrection({ title, incorrect }); window.location.hash = 'training' }} />,
    integrations: <Integrations />,
    models: <Models />,
    settings: <Settings name={name} demo={demo} refresh={() => {
      void api<Session>('session').then(value => setBrandName(value.brand?.name)).catch(() => undefined)
    }} />,
  }
  return <div className="shell">
    <a className="skip" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Đến nội dung</a>
    {mobileNav && <button className="mobile-shade" aria-label="Đóng menu" onClick={() => setMobileNav(false)} />}
    <aside data-open={mobileNav} className="sidebar" aria-label="Thanh bên" onKeyDown={event => { if (event.key === 'Escape') setMobileNav(false) }}>
      <div className="sidebar-brand"><Logo name={name} /><Button variant="ghost" className="close-menu" aria-label="Đóng menu" onClick={() => setMobileNav(false)}><X size={22} /></Button></div>
      <div className="workspace-name"><span className="workspace-avatar">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>Không gian làm việc</small></span></div>
      <nav id="studio-navigation" aria-label="Điều hướng chính">{groups.map(group =>
        <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.map(([key, Icon]) =>
          <a key={key} href={`#${key}`} aria-current={key === page ? 'page' : undefined} onClick={() => setMobileNav(false)}><Icon size={17} /><span>{navigation[key][0]}</span></a>)}</div>)}</nav>
      <div className="sidebar-footer"><span className="avatar"><UserRound size={17} /></span><span><strong>Quản trị viên</strong><small>{demo ? 'Phiên mô phỏng' : 'Phiên quản trị'}</small></span>
        {!demo && <Button variant="ghost" aria-label="Đăng xuất" disabled={logout.busy} onClick={() => void logout.run(async () => {
          await api('session', 'DELETE'); setBrandName(undefined); session.refresh()
        })}><LogOut size={17} /></Button>}</div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumbs">
          <Button variant="ghost" className="menu-toggle" aria-label="Mở menu" aria-expanded={mobileNav} aria-controls="studio-navigation" onClick={() => setMobileNav(value => !value)}><Menu size={21} /></Button>
          <span className="breadcrumb-studio">AI Studio</span><ChevronRight className="breadcrumb-chevron" size={14} /><strong>{navigation[page][0]}</strong>
        </div>
        <div className="topbar-right"><span className="environment"><span className="status-dot" /> {demo ? 'Chế độ mô phỏng' : name}</span>
          <a href="#settings" className="help-link" aria-label="Cài đặt truy cập"><CircleHelp size={19} /></a></div>
      </header>
      <main className="content" id="main-content" tabIndex={-1}>
        {demo && <div className="demo-banner"><FlaskConical size={16} /><span><strong>Dữ liệu mô phỏng</strong> · Dùng để thử nghiệm quy trình nội bộ.</span></div>}
        <Feedback error={logout.error} />
        {pages[page]}
        <footer className="content-footer"><Flame size={15} /> {name} AI Studio</footer>
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
