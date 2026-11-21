import React, { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, Building2, Users, BarChart3, Bot, BookOpen, ChevronRight, CircleHelp, Flame, FlaskConical, Home, Layers3, LogOut, Menu, MessageSquare, Package, Plug, Settings2, Sparkles, UserRound, X } from 'lucide-react'
import '@fontsource/be-vietnam-pro/vietnamese-400.css'
import '@fontsource/be-vietnam-pro/vietnamese-500.css'
import '@fontsource/be-vietnam-pro/vietnamese-600.css'
import '@fontsource/be-vietnam-pro/latin-400.css'
import '@fontsource/be-vietnam-pro/latin-500.css'
import '@fontsource/be-vietnam-pro/latin-600.css'
import '@fontsource/lora/vietnamese-500.css'
import '@fontsource/lora/latin-500.css'
import './style.css'
import { api, setWorkspaceScope, useAction, useResource } from './api'
import { navigation, type Page } from './locale'
import { Dashboard } from './dashboard'
import { Library } from './library'
import { Conversations, Integrations, Models, Persona, Settings } from './operations'
import { Playground } from './playground'
import { Button } from './ui/button'
import { Feedback, LoadState } from './ui/common'

import { Bootstrap, PlatformDashboard, WorkspaceSelector, roleLabels } from './workspaces'
import { Channels, Usage } from './channels'
import { Team,AccountSettings } from './team'
import { Agents } from './agents'

const groups = [
  { title:'NỀN TẢNG',items:[['platform',Building2]] },
  { title: 'ĐIỀU HÀNH', items: [['dashboard', Home], ['conversations', MessageSquare]] },
  { title: 'NỘI DUNG & AI', items: [['knowledge', BookOpen], ['products', Package], ['persona', UserRound], ['training', Sparkles], ['playground', FlaskConical]] },
  { title: 'HỆ THỐNG', items: [['channels',Plug],['users',Users],['agents',Bot],['usage',BarChart3],['integrations', Plug], ['models', Layers3], ['settings', Settings2],['account',UserRound]] },
] as const
type Session = { authenticated:boolean;demo:boolean;staging?:boolean;bootstrapRequired?:boolean;user?:{id:string;email:string;role:string;superAdmin:boolean};brand?:{id:string;name:string;active:number;archived:number;logo:string;color:string;language:string} }
function route() {
  const [segment, ...rest] = window.location.hash.slice(1).split('/')
  const page = Object.hasOwn(navigation, segment) ? segment as Page : 'dashboard'
  let id: string | undefined
  try { id = rest.length ? decodeURIComponent(rest.join('/')) : undefined } catch { /* Ignore malformed deep links. */ }
  return { page, id }
}

function Logo() {
  return <a className="logo" href="#dashboard"><span className="brand-mark"><Layers3 size={22} strokeWidth={1.55} /></span>
    <span><strong>AI Studio</strong><small>WORKSPACE PLATFORM</small></span></a>
}

function Login({ refresh }: { refresh: () => void }) {
  const action = useAction()
  const [bootstrap,setBootstrap]=useState(false)
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form=new FormData(event.currentTarget)
    const input=bootstrap?{token:form.get('token')}:{email:form.get('email'),password:form.get('password')}
    void action.run(async () => { await api('session', 'POST', input); refresh() })
  }
  return <main className="login"><form className="card padded form-stack" onSubmit={login}>
    <Logo /><h1>Đăng nhập</h1><p>Một tài khoản, các không gian được phân quyền cho bạn.</p>
    {bootstrap ? <label>Khóa nhà sáng lập<input autoComplete="off" type="password" name="token" required maxLength={512}/></label> : <><label>Email<input type="email" name="email" autoComplete="username" required/></label><label>Mật khẩu<input type="password" name="password" autoComplete="current-password" required maxLength={128}/></label></>}
    <button type="button" className="text-button" onClick={()=>setBootstrap(!bootstrap)}>{bootstrap?'Đăng nhập bằng tài khoản':'Thiết lập nhà sáng lập lần đầu'}</button>
    <Feedback error={action.error} /><Button type="submit" disabled={action.busy}>Đăng nhập <ArrowRight size={16} /></Button>
  </form></main>
}

function App() {
  const session = useResource<Session>('session')
  const [{ page, id }, setRoute] = useState(route)
  const [mobileNav, setMobileNav] = useState(false)
  const [brandName, setBrandName] = useState<string>()
  const logout = useAction()
  useEffect(() => {
    const navigate = () => {
      const next = route()
      setRoute(next)
      setMobileNav(false)
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
    document.title = `${navigation[page][0]} · AI Studio`
  }, [page])
  if (!session.value) return <main className="login"><LoadState error={session.error} retry={session.refresh} /></main>
  if (!session.value.authenticated) return <Login refresh={session.refresh} />
  if (session.value.bootstrapRequired) {
    setWorkspaceScope(undefined)
    return <main className="login"><div className="bootstrap-only"><Logo/><Bootstrap refresh={session.refresh}/><Feedback error={logout.error}/><Button variant="outline" disabled={logout.busy} onClick={()=>void logout.run(async()=>{await api('session','DELETE');session.refresh()})}>Đăng xuất phiên thiết lập</Button></div></main>
  }
  const { demo,brand,user }=session.value
  const name=brandName??brand?.name??'Chọn không gian'
  const role=user?.role??'viewer',superAdmin=!!user?.superAdmin
  const editable=superAdmin||role==='brand-admin'
  const training=editable||role==='ai-trainer'
  const canRead=(key:string)=>{
    if (key==='platform') return superAdmin
    if (key==='users') return editable
    if (['settings','integrations'].includes(key)) return editable
    if (key==='conversations') return editable||role==='customer-service'
    if (['training','persona','agents','models'].includes(key)) return training
    if (key==='channels') return editable
    if (key==='playground') return role!=='viewer'
    return true
  }
  setWorkspaceScope(brand?.id)
  const readOnly=page!=='account' && (!brand?.active || (['products','models','settings','integrations','channels','users'].includes(page)?!editable : ['knowledge','persona','training','agents'].includes(page)?!training : page==='playground'?role==='viewer':false))

  const pages = {
    account:<AccountSettings email={user?.email??''} demo={demo} refresh={session.refresh}/>,platform:<PlatformDashboard/>,channels:<Channels editable={editable} superAdmin={superAdmin}/>,users:<Team superAdmin={superAdmin} currentId={user?.id??''}/>,agents:<Agents editable={training}/>,usage:<Usage/>,
    dashboard: <Dashboard demo={demo} canReadConversations={canRead('conversations')} />,
    knowledge: <Library key={"knowledge" + (id ?? "")} kind="knowledge" selectedId={id} />,
    products: <Library key={"products" + (id ?? "")} kind="products" selectedId={id} />,
    training: <Library key={"training" + (id ?? "")} kind="training" selectedId={id} />,
    persona: <Persona />,
    playground: <Playground name={name} />,
    conversations: <Conversations canDelete={editable} selectedId={id} correct={training ? id => { window.location.hash = 'training/' + encodeURIComponent(id) } : undefined} />,
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
      <div className="sidebar-brand"><Logo /><Button variant="ghost" className="close-menu" aria-label="Đóng menu" onClick={() => setMobileNav(false)}><X size={22} /></Button></div>
      <WorkspaceSelector current={brand?.id??''}/>

      <nav id="studio-navigation" aria-label="Điều hướng chính">{groups.map(group =>
        <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.filter(([key])=>canRead(key)).map(([key, Icon]) =>
          <a key={key} href={`#${key}`} aria-current={key === page ? 'page' : undefined} onClick={() => setMobileNav(false)}><Icon size={17} /><span>{navigation[key][0]}</span></a>)}</div>)}</nav>
      <div className="sidebar-footer"><span className="avatar"><UserRound size={17} /></span><span><strong>{roleLabels[role]}</strong><small>{demo ? 'Phiên mô phỏng' : 'Phiên quản trị'}</small></span>
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
        <div className="topbar-right"><span className="environment"><span className="status-dot" /> {demo ? 'Chế độ mô phỏng' : session.value.staging ? 'Staging' : name}</span>
          <a href="#settings" className="help-link" aria-label="Cài đặt truy cập"><CircleHelp size={19} /></a></div>
      </header>
      <main className="content workspace-theme" data-brand={page==='platform'?undefined:brand?.id} id="main-content" tabIndex={-1} style={{'--workspace-accent':page==='platform'?'#235568':brand?.color??'#235568'} as CSSProperties}>
        {demo && <div className="demo-banner"><FlaskConical size={16} /><span><strong>Dữ liệu mô phỏng</strong> · Dùng để thử nghiệm quy trình nội bộ.</span></div>}
        <Feedback error={logout.error} />
        {brand && page!=='platform' && <div className="workspace-heading"><span className="workspace-avatar">{brand.logo?<img src={brand.logo} alt="" referrerPolicy="no-referrer"/>:name.slice(0,1)}</span><div><strong>{name}</strong><small>{brand.active?'Không gian làm việc':'Chỉ đọc · Đã tạm ngưng / lưu trữ'}</small></div></div>}
        {!canRead(page) ? <section className="card padded"><h1>Không có quyền truy cập</h1><p>Liên hệ Brand Admin để được cấp vai trò phù hợp.</p></section> : !brand && !['platform','account'].includes(page) ? superAdmin?<PlatformDashboard/>:<section className="card padded"><h1>Chưa được cấp không gian</h1><p>Liên hệ quản trị viên để được phân quyền.</p></section> : <section key={brand?.id??'global'} className="workspace-pages">
          {readOnly && page!=='platform' && <p className="notice-panel" role="status">Bạn đang xem ở chế độ chỉ đọc.</p>}
          <fieldset className="page-fields" disabled={readOnly && page!=='platform'}>{pages[page]}</fieldset></section>}
        <footer className="content-footer"><Flame size={15} /> AI Studio · {name}</footer>
      </main>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
