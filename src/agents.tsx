import { useState } from 'react'
import { Bot,Plus } from 'lucide-react'
import { api,useAction,useResource } from './api'
import { models } from '../shared/models'
import type { Data } from '../worker/contracts'
import { Button } from './ui/button'
import { Empty,Feedback,LoadState,PageTitle } from './ui/common'

type Agent={id:string;name:string;version:number;config:{persona?:Partial<Data<'persona'>>;model?:typeof models[number]}}
export function Agents({editable}:{editable:boolean}) {
  const list=useResource<{items:Agent[]}>('agents'),action=useAction(),[editing,setEditing]=useState<Agent|'new'>()
  return <><PageTitle kicker="CẤU HÌNH DÙNG LẠI" title="Trợ lý AI" copy="Tạo các cấu hình trợ lý trong không gian và gán cho từng kênh. Giá và tồn kho luôn lấy từ dữ liệu đã xác thực."
    action={editable && <Button onClick={()=>setEditing('new')}><Plus size={16}/> Tạo trợ lý</Button>}/>
    <Feedback error={action.error} notice={action.notice}/>
    {editing && <form key={editing==='new'?'new':editing.id} className="card padded form-stack" onSubmit={event=>{
      event.preventDefault();const data=new FormData(event.currentTarget)
      void action.run(async()=>{
        const body={name:data.get('name'),config:{persona:{prompt:data.get('prompt'),voice:data.get('voice'),rules:data.get('rules'),language:data.get('language')},model:data.get('model')}}
        await api(editing==='new'?'agents':'agents/'+editing.id,editing==='new'?'POST':'PUT',editing==='new'?body:{...body,version:editing.version})
        setEditing(undefined);list.refresh()
      },'Đã lưu trợ lý.')
    }}><h2>{editing==='new'?'Trợ lý mới':'Chỉnh sửa trợ lý'}</h2><label>Tên trợ lý<input name="name" required maxLength={80} defaultValue={editing==='new'?'':editing.name}/></label>
      <label>Chỉ dẫn<textarea name="prompt" rows={4} maxLength={4000} required defaultValue={editing==='new'?'Bạn là trợ lý chăm sóc khách hàng.':editing.config.persona?.prompt??'Bạn là trợ lý chăm sóc khách hàng.'}/></label>
      <div className="field-grid"><label>Giọng điệu<input name="voice" required maxLength={160} defaultValue={editing==='new'?'Rõ ràng, thân thiện':editing.config.persona?.voice??'Rõ ràng, thân thiện'}/></label>
        <label>Ngôn ngữ<select name="language" defaultValue={editing==='new'?'vi':editing.config.persona?.language??'vi'}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label></div>
      <label>Quy tắc<textarea name="rules" rows={3} maxLength={4000} defaultValue={editing==='new'?'Chuyển thông tin chưa có căn cứ cho nhân viên.':editing.config.persona?.rules??''}/></label>
      <label>Mô hình<select name="model" defaultValue={editing==='new'?models[0]:editing.config.model??models[0]}>{models.map(model=><option key={model}>{model}</option>)}</select></label>
      <p>Ngân sách và nhà cung cấp dùng thiết lập của không gian. Cấu hình kênh được ưu tiên sau cấu hình trợ lý.</p>
      <div className="actions"><Button type="submit" disabled={action.busy}>Lưu trợ lý</Button><Button type="button" variant="outline" onClick={()=>setEditing(undefined)}>Hủy</Button></div></form>}
    {!list.value ? <LoadState error={list.error} retry={list.refresh}/> : !list.value.items.length ? <Empty title="Chưa có trợ lý dùng lại">Thiết lập mặc định trong Nhân cách AI vẫn áp dụng cho mọi kênh.</Empty> :
      <section className="card padded"><h2>Cấu hình trong không gian</h2><ul className="entries">{list.value.items.map(agent=><li key={agent.id} className="team-row"><div className="brand-cell"><span className="icon-tile"><Bot size={19}/></span><div><strong>{agent.name}</strong><small>{agent.config.persona?.voice??'Kế thừa nhân cách không gian'} · Bản {agent.version}</small></div></div>
        {editable && <Button variant="outline" onClick={()=>setEditing(agent)}>Chỉnh sửa</Button>}</li>)}</ul></section>}
  </>
}
