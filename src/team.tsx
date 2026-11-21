import { useState } from 'react'
import { Plus, ShieldCheck } from 'lucide-react'
import { api,useAction,useResource } from './api'
import { Button } from './ui/button'
import { Empty,Feedback,LoadState,PageTitle } from './ui/common'
import { roleLabels } from './workspaces'

type Account={id:string;name:string;email:string;active:number;super_admin:number;role:string|null}
const roles=['brand-admin','ai-trainer','customer-service','viewer']
export function Team({superAdmin,currentId}:{superAdmin:boolean;currentId:string}) {
  const list=useResource<{items:Account[]}>('accounts'),action=useAction(),[create,setCreate]=useState(false)
  return <><PageTitle kicker="QUẢN TRỊ TRUY CẬP" title="Thành viên & quyền" copy="Phân quyền theo không gian. Quyền Super Admin áp dụng trên toàn nền tảng."
    action={superAdmin?<Button onClick={()=>setCreate(!create)}><Plus size={16}/> Thêm thành viên</Button>:undefined}/>
    {superAdmin && create && <form className="card padded form-stack" onSubmit={event=>{
      event.preventDefault();const form=new FormData(event.currentTarget)
      void action.run(async()=>{await api('accounts','POST',{name:form.get('name'),email:form.get('email'),password:form.get('password'),role:form.get('role'),superAdmin:form.get('superAdmin')==='on'});setCreate(false);list.refresh()},'Đã tạo tài khoản và quyền trong không gian này.')
    }}><h2>Tài khoản mới</h2><div className="field-grid"><label>Họ tên<input name="name" required maxLength={80}/></label><label>Email<input name="email" type="email" autoComplete="off" required/></label></div>
      <label>Mật khẩu ban đầu<input name="password" type="password" minLength={16} maxLength={128} autoComplete="new-password" required/></label>
      <label>Vai trò trong không gian<select name="role" defaultValue="viewer">{roles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
      {superAdmin && <label className="checkbox"><input type="checkbox" name="superAdmin"/> Cấp quyền Super Admin toàn nền tảng</label>}
      <p>Tạo tài khoản nội bộ và chuyển mật khẩu qua kênh bảo mật đã thống nhất. Hệ thống không gửi email mời.</p>
      <div className="actions"><Button type="submit" disabled={action.busy}>Tạo thành viên</Button><Button type="button" variant="outline" onClick={()=>setCreate(false)}>Hủy</Button></div></form>}
    <Feedback error={action.error} notice={action.notice}/>
    {!list.value ? <LoadState error={list.error} retry={list.refresh}/> : !list.value.items.length ? <Empty title="Chưa có thành viên">Thêm thành viên để chia sẻ công việc trong không gian.</Empty> :
      <section className="card padded"><h2>Đội ngũ</h2><div className="team-list">{list.value.items.map(user=><article key={user.id} className="team-row">
        <div className="brand-cell"><span className="icon-tile"><ShieldCheck size={19}/></span><div><strong>{user.name}</strong><small>{user.email} · {user.active?'Hoạt động':'Đã khóa'}{user.super_admin?' · Super Admin':''}</small></div></div>
        <div className="actions"><label>Quyền không gian<select aria-label={'Vai trò của '+user.name} value={user.role??''} disabled={action.busy || (!superAdmin && (user.id===currentId || !!user.super_admin))}
          onChange={event=>void action.run(async()=>{await api('memberships/'+user.id,'PUT',{role:event.target.value||null});list.refresh()},'Đã cập nhật quyền.')}>
          <option value="">Không có quyền</option>{roles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
          {superAdmin && user.id!==currentId && <label className="checkbox"><input type="checkbox" checked={!!user.super_admin} disabled={action.busy} onChange={event=>{const granted=event.target.checked;void action.run(async()=>{await api('accounts/'+user.id,'PUT',{active:!!user.active,superAdmin:granted});list.refresh()},'Đã cập nhật quyền nền tảng và thu hồi phiên.')}}/> Super Admin</label>}
          {superAdmin && user.id!==currentId && <Button variant="outline" disabled={action.busy} onClick={()=>void action.run(async()=>{
            await api('accounts/'+user.id,'PUT',{active:!user.active,superAdmin:!!user.super_admin});list.refresh()
          },'Đã cập nhật trạng thái và thu hồi phiên đăng nhập.')}>{user.active?'Khóa tài khoản':'Mở tài khoản'}</Button>}
          <Button variant="ghost" disabled={action.busy || (!superAdmin && user.id!==currentId)} onClick={()=>void action.run(()=>api('accounts/'+user.id+'/revoke','POST'),'Đã thu hồi mọi phiên.')}>Thu hồi phiên</Button>
          {superAdmin && user.id!==currentId && <details><summary>Đặt lại mật khẩu</summary><form className="form-stack" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void action.run(async()=>{
            await api('accounts/'+user.id,'PUT',{active:!!user.active,superAdmin:!!user.super_admin,password:form.get('password')});list.refresh()
          },'Đã đổi mật khẩu và thu hồi phiên.')}}><label>Mật khẩu mới<input type="password" name="password" minLength={16} maxLength={128} autoComplete="new-password" required/></label><Button type="submit" disabled={action.busy}>Đặt lại</Button></form></details>}
        </div></article>)}</div></section>}
    <section className="card padded"><h2>Phạm vi vai trò</h2><dl className="role-guide"><dt>Brand Admin</dt><dd>Quản lý nội dung, kênh, thành viên và cấu hình của không gian.</dd><dt>AI Trainer</dt><dd>Soạn tri thức, huấn luyện, nhân cách và cấu hình trợ lý; xuất bản cần Brand Admin.</dd>
      <dt>Customer Service</dt><dd>Xem và tiếp quản hội thoại, tạo bản sửa phản hồi, thử AI.</dd><dt>Viewer</dt><dd>Xem nội dung và số liệu tổng hợp; không xem nội dung hội thoại khách hàng.</dd></dl></section>
  </>
}

export function AccountSettings({email,demo,refresh}:{email:string;demo:boolean;refresh:()=>void}) {
  const action=useAction()
  return <><PageTitle kicker="TRUY CẬP CÁ NHÂN" title="Tài khoản của tôi" copy={email||'Phiên thiết lập nhà sáng lập'}/>
    <form className="card padded form-stack" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void action.run(async()=>{
      await api('account/password','POST',{currentPassword:data.get('currentPassword'),password:data.get('password')});refresh()
    })}}><h2>Đổi mật khẩu</h2><p>Mật khẩu mới sẽ thu hồi mọi phiên hiện tại. Bạn sẽ cần đăng nhập lại.</p>
      <label>Mật khẩu hiện tại<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128}/></label>
      <label>Mật khẩu mới<input type="password" name="password" autoComplete="new-password" required minLength={16} maxLength={128}/></label>
      <Feedback error={action.error}/>{demo && <p>Phiên mô phỏng không thay đổi thông tin xác thực.</p>}<div><Button type="submit" disabled={action.busy||demo}>Đổi mật khẩu và đăng xuất</Button></div></form></>
}
