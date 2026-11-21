import { useState, type FormEvent } from 'react'
import { ArrowRight, Building2, Plus, Settings2 } from 'lucide-react'
import { api, useAction, useResource } from './api'
import { Button } from './ui/button'
import { Empty, Feedback, LoadState, PageTitle } from './ui/common'

export type Workspace = { id:string;name:string;active:number;archived:number;logo:string;color:string;language:'vi'|'en';version:number;channels:number;calls:number;neurons:number }
export const roleLabels:Record<string,string>={ 'super-admin':'Super Admin','brand-admin':'Brand Admin','ai-trainer':'AI Trainer','customer-service':'Customer Service',viewer:'Viewer' }
export async function switchWorkspace(id:string) {
  await api('workspaces/'+id+'/switch','POST')
  window.location.hash='dashboard'
  // Discard every previous workspace resource, open transcript and pending form.
  window.location.reload()
}
export function WorkspaceSelector({ current }: { current:string }) {
  const list=useResource<{ items:Workspace[] }>('workspaces'),action=useAction()
  return <div className="workspace-selector"><label>Không gian làm việc<select aria-label="Chọn không gian làm việc" value={current} disabled={!list.value || action.busy}
    onChange={event=>void action.run(()=>switchWorkspace(event.target.value))}>
    {!current && <option value="">Chọn không gian</option>}{list.value?.items.map(row=><option key={row.id} value={row.id}>{row.name}{row.archived ? ' · Lưu trữ' : !row.active ? ' · Tạm ngưng' : ''}</option>)}
  </select></label><Feedback error={action.error??list.error}/></div>
}
export function Bootstrap({ refresh }: { refresh:()=>void }) {
  const action=useAction()
  return <section className="card padded onboarding"><div className="inline-heading"><Building2/><div><h2>Thiết lập tài khoản nhà sáng lập</h2><p>Giữ nguyên dữ liệu NẾP MÙI và chuyển quyền quản trị sang tài khoản cá nhân.</p></div></div>
    <form className="form-stack" onSubmit={event=>{ event.preventDefault();const form=new FormData(event.currentTarget);void action.run(async()=>{
      await api('bootstrap','POST',Object.fromEntries(form));refresh()
    }) }}><div className="field-grid"><label>Tên quản trị viên<input name="name" required maxLength={80}/></label><label>Email tài khoản<input name="email" type="email" autoComplete="username" required/></label></div>
      <label>Mật khẩu mới<input name="password" type="password" minLength={16} maxLength={128} autoComplete="new-password" required/></label>
      <p>Sau khi tạo tài khoản, khóa truy cập cũ sẽ ngừng đăng nhập. Lưu mật khẩu trong trình quản lý mật khẩu của bạn.</p>
      <Feedback error={action.error}/><div><Button type="submit" disabled={action.busy}>Tạo tài khoản nhà sáng lập</Button></div></form></section>
}
function WorkspaceForm({ current,done }: { current?:Workspace;done:()=>void }) {
  const [step,setStep]=useState(1),action=useAction()
  const [form,setForm]=useState({ name:current?.name??'',logo:current?.logo??'',color:current?.color??'#235568',language:current?.language??'vi',active:current ? !!current.active : true,archived:current ? !!current.archived : false })
  function submit(event:FormEvent) {
    event.preventDefault()
    if (!current && step===1) { setStep(2);return }
    void action.run(async()=>{
      if (current) await api('workspaces/'+current.id,'PUT',{ ...form,version:current.version })
      else await api('workspaces','POST',form)
      done()
    })
  }
  return <form className="card padded form-stack" onSubmit={submit} aria-label={current ? 'Chỉnh sửa không gian' : 'Tạo không gian'}>
    <div className="card-heading"><h2>{current ? 'Chỉnh sửa không gian' : `Không gian mới · Bước ${step}/2`}</h2><Button variant="ghost" type="button" onClick={done}>Đóng</Button></div>
    {step===1 ? <><div className="field-grid"><label>Tên thương hiệu<input value={form.name} onChange={e=>setForm({ ...form,name:e.target.value })} required maxLength={80}/></label>
      <label>Ngôn ngữ mặc định<select value={form.language} onChange={e=>setForm({ ...form,language:e.target.value as 'vi'|'en' })}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label></div>
      <div className="field-grid"><label>Logo (HTTPS)<input type="url" value={form.logo} onChange={e=>setForm({ ...form,logo:e.target.value })} maxLength={1000}/></label>
        <label>Màu thương hiệu<input type="color" value={form.color} onChange={e=>setForm({ ...form,color:e.target.value })}/></label></div>
      {current && <div className="actions"><label className="checkbox"><input type="checkbox" checked={form.active} onChange={e=>setForm({ ...form,active:e.target.checked })}/> Đang hoạt động</label>
        <label className="checkbox"><input type="checkbox" checked={form.archived} onChange={e=>setForm({ ...form,archived:e.target.checked })}/> Lưu trữ (chỉ đọc, dừng AI và kênh)</label></div>}</> :
      <div className="setup-review"><h3>{form.name}</h3><p>Không gian độc lập với kho tri thức, sản phẩm, nhân cách và lịch sử riêng.</p>
        <ol><li>Thêm tài liệu và duyệt nội dung trước khi xuất bản.</li><li>Thiết lập trợ lý AI và giới hạn sử dụng.</li><li>Kết nối Page mô phỏng, thử phản hồi rồi phân quyền cho nhóm.</li></ol>
        <p>Mặc định dùng mô phỏng, chưa tiêu thụ Workers AI. Bạn có thể tiếp tục thiết lập sau khi tạo.</p></div>}
    <Feedback error={action.error}/><div className="actions">{step===2 && <Button type="button" variant="outline" onClick={()=>setStep(1)}>Quay lại</Button>}
      <Button type="submit" disabled={action.busy}>{current ? 'Lưu không gian' : step===1 ? 'Tiếp tục' : 'Tạo không gian'}<ArrowRight size={16}/></Button></div></form>
}
export function PlatformDashboard() {
  const data=useResource<{ workspaces:Workspace[];limits:{calls:number;neurons:number};usage:{calls:number;neurons:number};audit:{id:string;action:string;actor:string;at:number}[] }>('platform')
  const [editing,setEditing]=useState<Workspace|'new'>(),action=useAction()
  return <><PageTitle kicker="SUPER ADMIN" title="Tổng quan nền tảng" copy="Quản lý không gian, đội ngũ và tài nguyên dùng chung của AI Studio."
    action={<Button onClick={()=>setEditing('new')}><Plus size={16}/> Tạo không gian</Button>}/>
    {!data.value ? <LoadState error={data.error} retry={data.refresh}/> : <>
      <div className="platform-metrics"><div><small>Không gian hoạt động</small><strong>{data.value.workspaces.filter(w=>w.active).length}<span> / {data.value.workspaces.length}</span></strong></div>
        <div><small>Lượt AI hôm nay · UTC</small><strong>{data.value.usage.calls}<span> / {data.value.limits.calls}</span></strong></div>
        <div><small>Neuron đã giữ chỗ</small><strong>{data.value.usage.neurons.toLocaleString('vi-VN')}<span> / {data.value.limits.neurons.toLocaleString('vi-VN')}</span></strong></div></div>
      {editing && <WorkspaceForm key={editing==='new'?'new':editing.id} current={editing==='new'?undefined:editing} done={()=>{setEditing(undefined);data.refresh()}}/>}
      <Feedback error={action.error}/><section className="card padded"><div className="card-heading"><h2>Không gian làm việc</h2><small>Dữ liệu và cấu hình tách biệt</small></div>
        {!data.value.workspaces.length ? <Empty title="Chưa có không gian">Tạo không gian đầu tiên để bắt đầu.</Empty> :
          <div className="table-scroll"><table className="platform-table"><thead><tr><th>Thương hiệu</th><th>Trạng thái</th><th>Kênh</th><th>AI hôm nay</th><th>Thao tác</th></tr></thead>
            <tbody>{data.value.workspaces.map(row=><tr key={row.id}><td><div className="brand-cell"><span className="workspace-avatar">{row.name.slice(0,1)}</span><div><strong>{row.name}</strong><small>{row.language==='vi'?'Tiếng Việt':'English'}</small></div></div></td>
              <td><span className="status-label">{row.archived?'Đã lưu trữ':row.active?'Hoạt động':'Tạm ngưng'}</span></td><td>{row.channels}</td><td>{row.calls} lượt · {row.neurons} Neuron</td>
              <td><div className="actions"><Button variant="outline" onClick={()=>void action.run(()=>switchWorkspace(row.id))}>Mở</Button><Button variant="ghost" aria-label={'Chỉnh sửa '+row.name} onClick={()=>setEditing(row)}><Settings2 size={16}/></Button></div></td></tr>)}</tbody></table></div>}</section>
      <section className="card padded"><h2>Giới hạn toàn nền tảng</h2><p className="muted">Mỗi không gian được dùng tối đa một nửa hạn mức chung. Lượt giữ chỗ được tính đồng thời theo không gian, kênh và tài khoản Cloudflare.</p>
        <form className="form-stack" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void action.run(async()=>{
          await api('platform/limits','PUT',{calls:Number(form.get('calls')),neurons:Number(form.get('neurons'))});data.refresh()
        },'Đã cập nhật giới hạn chung.')}}><div className="field-grid"><label>Lượt gọi mỗi ngày<input key={'c'+data.value.limits.calls} name="calls" type="number" required min={0} max={1000} defaultValue={data.value.limits.calls}/></label>
          <label>Neuron mỗi ngày<input key={'n'+data.value.limits.neurons} name="neurons" type="number" required min={0} max={8000} defaultValue={data.value.limits.neurons}/></label></div><div><Button type="submit" disabled={action.busy}>Lưu giới hạn chung</Button></div></form><Feedback notice={action.notice}/></section>
      <section className="card padded"><h2>Hoạt động quản trị gần đây</h2><ul className="activity-list">{data.value.audit.slice(0,8).map(row=><li key={row.id}><strong>{row.action}</strong><small>{new Date(row.at).toLocaleString('vi-VN')} · {row.actor.slice(0,8)}</small></li>)}</ul></section>
    </>}</>
}
