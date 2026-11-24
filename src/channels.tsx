import { useState } from 'react'
import { Link2,Plus } from 'lucide-react'
import { api,useAction,useResource } from './api'
import { Button } from './ui/button'
import { Empty,Feedback,LoadState,PageTitle } from './ui/common'

type Channel={id:string;kind:'messenger'|'instagram'|'website';external_id:string;name:string;state:'connected'|'disconnected';paused:number;mock:number;agent_id:string|null;
  overrides:{model?:string;persona?:{voice?:string;language?:'vi'|'en';prompt?:string;rules?:string}};version:number;hasToken:number;verified:number;pending:number;attention:number;last_event:number|null}
function payload(row:Channel) { return {name:row.name,kind:row.kind,externalId:row.external_id,mock:!!row.mock,paused:!!row.paused,state:row.state,agentId:row.agent_id,overrides:row.overrides,version:row.version} }
export function Channels({editable,superAdmin}:{editable:boolean;superAdmin:boolean}) {
  const list=useResource<{items:Channel[];encryptionReady:boolean;liveEnabled:boolean}>('channels'),agents=useResource<{items:{id:string;name:string}[]}>('agents')
  const [editing,setEditing]=useState<Channel|'new'>(),[mock,setMock]=useState<Channel>(),action=useAction()
  return <><PageTitle kicker="KẾT NỐI ĐA KÊNH" title="Kênh & Pages" copy="Quản lý nhiều Page trong một không gian, theo dõi trạng thái và kiểm thử bằng dữ liệu tổng hợp."
    action={editable && <Button onClick={()=>setEditing('new')}><Plus size={16}/> Kết nối kênh</Button>}/>
    <div className="notice-panel"><Link2 size={19}/><p>{list.value?.liveEnabled?'Cổng Messenger đã bật theo cấu hình môi trường.':'Messenger thật đang tắt. Các Page mô phỏng dùng để kiểm thử nội bộ.'} Instagram và website đã có registry; adapter tiếp nhận công khai chưa được bật.</p></div>
    <Feedback error={action.error} notice={action.notice}/>
    {editing && <form key={editing==='new'?'new':editing.id} className="card padded form-stack" onSubmit={event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),voice=String(form.get('voice')??'').trim(),language=String(form.get('language')??'')
      const prompt=String(form.get('prompt')??'').trim(),rules=String(form.get('rules')??'').trim(),model=String(form.get('model')??'')
      const persona={ ...(voice?{voice}:{}),...(language?{language}: {}),...(prompt?{prompt}:{}),...(rules?{rules}:{}) }
      const data={name:form.get('name'),kind:editing==='new'?form.get('kind'):editing.kind,externalId:form.get('externalId'),agentId:form.get('agentId')||null,mock:form.get('mock')==='on',paused:form.get('paused')==='on',
        state:editing==='new'?'connected':editing.state,overrides:{...(Object.keys(persona).length ? {persona} : {}),...(model?{model}:{})},...(form.get('token')?{accessToken:form.get('token')}:{})}
      void action.run(async()=>{await api(editing==='new'?'channels':'channels/'+editing.id,editing==='new'?'POST':'PUT',editing==='new'?data:{...data,version:editing.version});setEditing(undefined);list.refresh()},'Đã lưu cấu hình kênh.')
    }}><h2>{editing==='new'?'Kênh mới':'Cấu hình kênh'}</h2><div className="field-grid"><label>Tên hiển thị<input name="name" required maxLength={80} defaultValue={editing==='new'?'':editing.name}/></label>
      <label>Loại kênh<select name="kind" defaultValue={editing==='new'?'messenger':editing.kind} disabled={editing!=='new'}>{['messenger','instagram','website'].map(kind=><option key={kind}>{kind}</option>)}</select></label></div>
      <label>Page / tài khoản / widget ID<input name="externalId" required maxLength={100} readOnly={editing!=='new'} pattern="[a-zA-Z0-9_-]+" defaultValue={editing==='new'?'':editing.external_id}/></label>
      <label>Trợ lý mặc định<select name="agentId" defaultValue={editing==='new'?'':editing.agent_id??''}><option value="">Kế thừa nhân cách không gian</option>{agents.value?.items.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <div className="field-grid"><label>Giọng điệu riêng (tùy chọn)<input name="voice" maxLength={160} defaultValue={editing==='new'?'':editing.overrides.persona?.voice??''}/></label>
        <label>Ngôn ngữ riêng<select name="language" defaultValue={editing==='new'?'':editing.overrides.persona?.language??''}><option value="">Kế thừa</option><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label></div>
      <label>Chỉ dẫn riêng (tùy chọn)<textarea name="prompt" maxLength={4000} rows={3} defaultValue={editing==='new'?'':editing.overrides.persona?.prompt??''}/></label>
      <label>Quy tắc riêng (tùy chọn)<textarea name="rules" maxLength={4000} rows={2} defaultValue={editing==='new'?'':editing.overrides.persona?.rules??''}/></label>
      <label>Mô hình riêng<select name="model" defaultValue={editing==='new'?'':editing.overrides.model??''}><option value="">Kế thừa</option><option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B FP8 fast</option></select></label>
      <div className="actions"><label className="checkbox"><input name="mock" type="checkbox" defaultChecked={editing==='new'||!!editing.mock}/> Kênh mô phỏng</label>
        <label className="checkbox"><input name="paused" type="checkbox" defaultChecked={editing==='new'||!!editing.paused}/> Tạm dừng xử lý</label></div>
      <label>Page access token (tùy chọn)<input name="token" type="password" autoComplete="off" maxLength={4096} disabled={!list.value?.encryptionReady}/></label>
      <p>Page thật cần Super Admin xác minh token thuộc đúng Page trước khi nhận sự kiện. Kênh mô phỏng không giữ quyền sở hữu Page thật.</p>
      <p>{list.value?.encryptionReady?'Token được mã hóa trên máy chủ, không hiển thị lại sau khi lưu. Để trống để giữ token hiện tại.':'Chưa có khóa mã hóa máy chủ. Có thể tạo kênh mô phỏng không dùng token.'}</p>
      <div className="actions"><Button type="submit" disabled={action.busy}>Lưu kênh</Button><Button variant="outline" type="button" onClick={()=>setEditing(undefined)}>Hủy</Button></div></form>}
    {mock && <form className="card padded form-stack" onSubmit={event=>{event.preventDefault();const question=String(new FormData(event.currentTarget).get('question'));void action.run(async()=>{
      const result=await api<{accepted:number;duplicate:number;sent:number}>('channels/'+mock.id+'/mock','POST',{object:'page',entry:[{id:mock.external_id,messaging:[{timestamp:Date.now(),sender:{id:'209'},recipient:{id:mock.external_id},message:{mid:crypto.randomUUID(),text:question}}]}]})
      list.refresh();return result
    },'Đã tiếp nhận sự kiện mô phỏng. Mở Hội thoại để kiểm tra kết quả.')}}><h2>Thử Page: {mock.name}</h2><label>Câu hỏi tổng hợp<input name="question" required maxLength={1000}/></label><div className="actions"><Button type="submit" disabled={action.busy}>Gửi sự kiện mô phỏng</Button><Button variant="outline" type="button" onClick={()=>setMock(undefined)}>Đóng</Button></div></form>}
    {!list.value ? <LoadState error={list.error} retry={list.refresh}/> : !list.value.items.length ? <Empty title="Chưa có kênh kết nối">Tạo Page mô phỏng đầu tiên để kiểm tra định tuyến và nhân cách.</Empty> :
      <section className="card padded"><h2>Registry kênh</h2><ul className="channel-list">{list.value.items.map(row=><li key={row.id}><div className="card-heading"><div><strong>{row.name}</strong><small>{row.kind} · {row.external_id}</small></div><span className="status-label">{row.state==='disconnected'?'Đã ngắt kết nối':row.paused?'Tạm dừng':'Sẵn sàng'}{row.mock?' · Mô phỏng':''}</span></div>
        <dl className="channel-stats"><div><dt>Đang chờ</dt><dd>{row.pending}</dd></div><div><dt>Cần xem lại</dt><dd>{row.attention}</dd></div><div><dt>Thông tin xác thực</dt><dd>{row.hasToken?'Đã lưu bảo mật':'Chưa lưu token'}{!row.mock && (row.verified?' · Đã xác minh':' · Chưa xác minh')}</dd></div><div><dt>Sự kiện gần nhất</dt><dd>{row.last_event?new Date(row.last_event).toLocaleString('vi-VN'):'Chưa có'}</dd></div></dl>
        {editable && <div className="actions"><Button variant="outline" onClick={()=>setEditing(row)}>Cấu hình</Button>
          <Button variant="outline" disabled={action.busy || row.state!=='connected'} onClick={()=>void action.run(async()=>{await api('channels/'+row.id,'PUT',{...payload(row),paused:!row.paused});list.refresh()})}>{row.paused?'Tiếp tục':'Tạm dừng'}</Button>
          {superAdmin && !row.mock && !!row.hasToken && !row.verified && <Button variant="outline" disabled={action.busy} onClick={()=>void action.run(async()=>{await api('channels/'+row.id+'/verify','POST');list.refresh()},'Đã xác minh Page. Kênh vẫn tạm dừng cho đến khi bạn tiếp tục.')}>Xác minh Page</Button>}
          {row.mock && row.kind==='messenger' && <Button variant="outline" disabled={!!row.paused || row.state!=='connected'} onClick={()=>setMock(row)}>Thử Page</Button>}
          <Button variant="ghost" disabled={action.busy} onClick={()=>void action.run(async()=>{await api('channels/'+row.id,'PUT',{...payload(row),state:row.state==='connected'?'disconnected':'connected',paused:true});list.refresh()},'Đã cập nhật kết nối.')}>{row.state==='connected'?'Ngắt kết nối':'Kết nối lại'}</Button></div>}</li>)}</ul></section>}
  </>
}
export function Usage() {
  const data=useResource<{channels:{channel_id:string;day:string;calls:number;neurons:number}[];limits:{calls:number;neurons:number}}> ('analytics')
  const channels=useResource<{items:Channel[]}>('channels')
  return <><PageTitle kicker="TÀI NGUYÊN" title="Phân tích sử dụng" copy="Lượt giữ chỗ theo không gian và kênh trong 7 ngày gần nhất, tính theo UTC."/>
    {!data.value ? <LoadState error={data.error} retry={data.refresh}/> : <section className="card padded"><h2>Workers AI theo kênh</h2><p className="muted">Giới hạn chung: {data.value.limits.calls} lượt / {data.value.limits.neurons} Neuron. Mỗi không gian tối đa một nửa, đồng thời chịu giới hạn riêng đã cấu hình.</p>
      {!data.value.channels.length ? <Empty title="Chưa có lượt Workers AI">Các lượt mô phỏng không tiêu thụ Neuron và không được tính ở đây.</Empty> : <div className="table-scroll"><table className="platform-table"><thead><tr><th>Ngày UTC</th><th>Kênh</th><th>Lượt gọi</th><th>Neuron giữ chỗ</th></tr></thead><tbody>{data.value.channels.map(row=><tr key={row.day+row.channel_id}><td>{row.day}</td><td>{channels.value?.items.find(c=>c.id===row.channel_id)?.name??'Playground'}</td><td>{row.calls}</td><td>{row.neurons}</td></tr>)}</tbody></table></div>}</section>}
  </>
}
