import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Bot, Check, Globe, History, Camera, LockKeyhole, MessageCircle, Save, Send, ShieldCheck, Sparkles } from 'lucide-react'
import type { Data, Entry } from '../worker/contracts'
import { models } from '../shared/models'
import { api, useAction, useResource } from './api'
import { date, label } from './locale'
import { Transcript } from './playground'
import { Button } from './ui/button'
import { Badge, Empty, Feedback, LoadState, PageTitle } from './ui/common'

type Config<K extends 'persona' | 'models'> = { data: Data<K>; version: number; aiEnabled: boolean }
function ModelForm({ config }: { config: Config<'models'> }) {
  const [form, setForm] = useState(config.data)
  const [version, setVersion] = useState(config.version)
  const action = useAction()
  const usage = useResource<{ calls: number; reservedNeurons: number }>('overview')
  return <form className="card padded form-stack" onSubmit={event => {
    event.preventDefault()
    void action.run(async () => { setVersion((await api<Entry<'models'>>('models', 'PUT', { data: form, version })).version) }, 'Đã lưu cấu hình mô hình.')
  }}>
    <div className="inline-heading"><span className="icon-tile olive"><Bot size={20} /></span><h2>Nhà cung cấp và ngân sách</h2></div>
    <label>Nhà cung cấp<select value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value as Data<'models'>['provider'] })}>
      <option value="mock">Mô phỏng · Không tốn chi phí</option><option value="workers-ai" disabled={!config.aiEnabled}>Cloudflare Workers AI</option>
    </select></label>
    <label>Mô hình Workers AI<select value={form.model} onChange={event => setForm({ ...form, model: event.target.value as Data<'models'>['model'] })}>
      {models.map(model => <option key={model}>{model}</option>)}</select></label>
    <label>Giới hạn lượt gọi mỗi ngày (UTC)<input type="number" min="0" max="100" required value={form.dailyLimit}
      onChange={event => setForm({ ...form, dailyLimit: event.target.valueAsNumber })} /></label>
    <label>Ngân sách Neuron ước tính mỗi ngày (UTC)<input type="number" min="0" max="8000" required value={form.dailyNeurons}
      onChange={event => setForm({ ...form, dailyNeurons: event.target.valueAsNumber })} /></label>
    <p className="muted">Hôm nay đã giữ chỗ {usage.value?.calls ?? '—'} lượt và {usage.value?.reservedNeurons ?? '—'} Neuron ước tính. Khi chạm một trong hai giới hạn, câu hỏi sẽ chuyển cho nhân viên.</p>
    <Feedback error={action.error} notice={action.notice} /><div><Button type="submit" disabled={action.busy}><Save size={16} /> Lưu cấu hình</Button></div>
  </form>
}
function PersonaForm({ config }: { config: Config<'persona'> }) {
  const [form, setForm] = useState(config.data)
  const [version, setVersion] = useState(config.version)
  const action = useAction()
  const formField = (key: keyof typeof form, value: string) => setForm(old => ({ ...old, [key]: value }))
  return <form className="card padded form-stack" onSubmit={event => {
    event.preventDefault()
    void action.run(async () => { setVersion((await api<Entry<'persona'>>('persona', 'PUT', { data: form, version })).version) }, 'Đã lưu nhân cách.')
  }}>
    <div className="inline-heading"><span className="icon-tile olive"><Sparkles size={19} /></span><h2>Cách trợ lý giao tiếp</h2></div>
    <label>Chỉ dẫn hệ thống<textarea required rows={4} maxLength={4000} value={form.prompt} onChange={event => formField('prompt', event.target.value)} /></label>
    <div className="field-grid"><label>Giọng thương hiệu<input required maxLength={160} value={form.voice} onChange={event => formField('voice', event.target.value)} /></label>
      <label>Ngôn ngữ hỗ trợ<select value={form.language} onChange={event => formField('language', event.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label></div>
    <label>Quy tắc phản hồi<textarea rows={4} maxLength={4000} value={form.rules} onChange={event => formField('rules', event.target.value)} /></label>
    <p>Workers AI dùng chỉ dẫn này để chọn giọng điệu, cách tư vấn và nguồn. Giá và tồn kho lấy từ danh mục hiện tại.</p>
    <Feedback error={action.error} notice={action.notice} /><div><Button type="submit" disabled={action.busy}><Save size={16} /> Lưu nhân cách</Button></div>
  </form>
}
export function Persona() {
  const config = useResource<Config<'persona'>>('persona')
  return <><PageTitle kicker="VẬN HÀNH AI" title="Nhân cách AI" copy="Thiết lập giọng điệu, ngôn ngữ và quy tắc của trợ lý." />
    {config.value ? <PersonaForm config={config.value} /> : <LoadState error={config.error} retry={config.refresh} />}</>
}
export function Models() {
  const config = useResource<Config<'models'>>('models')
  return <><PageTitle kicker="KHÔNG GIAN LÀM VIỆC" title="Mô hình AI" copy="Chọn mô hình và kiểm soát mức sử dụng Workers AI." />
    {config.value ? <ModelForm config={config.value} /> : <LoadState error={config.error} retry={config.refresh} />}</>
}

export function Conversations({ selectedId, canDelete, correct }: { selectedId?: string; canDelete: boolean; correct?: (id: string) => void }) {
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState(false)
  const list = useResource<{ items: Entry<'conversations'>[]; more: boolean }>(`conversations?page=${page}${pending ? '&status=handover' : ''}`)
  const detail = useResource<{ item: Entry<'conversations'> | null; delivery?: { state: string; attempts: number; received: number }[] }>(selectedId ? 'conversations/' + encodeURIComponent(selectedId) : 'conversations/detail-empty')
  const item = detail.value?.item
  const detailPanel = useRef<HTMLElement>(null)
  const loadedId = item?.id
  useEffect(() => {
    if (loadedId && window.matchMedia('(max-width: 640px)').matches) detailPanel.current?.scrollIntoView({ block: 'start' })
  }, [loadedId])
  const action = useAction()
  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!item) return
    const data = new FormData(event.currentTarget)
    void action.run(async () => {
      await api('conversations/' + encodeURIComponent(item.id), 'PATCH', { version: item.version, status: data.get('status'), reply: data.get('reply'), paused: data.get('paused') === 'on' })
      detail.refresh()
      list.refresh()
    }, 'Đã lưu xử lý nội bộ.')
  }
  return <>
    <PageTitle kicker="NỘI DUNG" title="Hội thoại" copy="Xem lịch sử và xử lý những câu hỏi cần nhân viên hỗ trợ." />
    <Feedback error={action.error} notice={action.notice} />
    <div className="dashboard-grid conversation-grid">
      <section className="card padded">
        <div className="card-heading"><h2>Hộp thư</h2><label className="checkbox"><input type="checkbox" checked={pending} onChange={event => { setPending(event.target.checked); setPage(0) }} /> Cần hỗ trợ</label></div>
        {!list.value ? <LoadState error={list.error} retry={list.refresh} /> : list.value.items.length ?
          <ul className="entries">{list.value.items.map(entry => <li key={entry.id}><a className="entry-link" aria-current={entry.id === selectedId ? 'page' : undefined}
            href={'#conversations/' + encodeURIComponent(entry.id)}>
            <div className="entry-title"><strong>{entry.data.title}</strong><small>{label[entry.data.channel] ?? entry.data.channel} · {date.format(entry.updated)}</small></div>
            <Badge value={entry.data.status} /></a></li>)}</ul> :
          <Empty title={pending ? 'Không có câu hỏi đang chờ' : 'Chưa có hội thoại'}>Hội thoại mới sẽ xuất hiện ở đây.</Empty>}
        {list.value && (page > 0 || list.value.more) && <div className="actions pagination">
          <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Trang trước</Button>
          <Button variant="outline" disabled={!list.value.more} onClick={() => setPage(page + 1)}>Trang sau</Button>
        </div>}
      </section>
      <section className="card padded" ref={detailPanel} aria-label="Chi tiết hội thoại">
        {!selectedId ? <Empty title="Chọn một hội thoại">Chọn tiêu đề trong hộp thư để xem chi tiết.</Empty> :
          !detail.value ? <LoadState error={detail.error} retry={detail.refresh} /> : item && <>
            <div className="card-heading"><div><h2>{item.data.title}</h2><p>{label[item.data.channel] ?? item.data.channel}</p></div><Badge value={item.data.status} /></div>
            <Transcript messages={item.data.messages} />
            {!!detail.value?.delivery?.length && <details className="delivery-status">
              <summary>Trạng thái gửi Messenger ({detail.value.delivery.length})</summary>
              <ul>{detail.value.delivery.map((entry, index) => <li key={index}>
                {label[entry.state] ?? entry.state} · {entry.attempts} lượt thử
              </li>)}</ul>
            </details>}
            <div className="actions">
              <Button variant="outline" disabled={action.busy} onClick={() => void action.run(async () => {
                const draft = await api<Entry<'training'>>('conversations/' + encodeURIComponent(item.id) + '/training', 'POST')
                correct?.(draft.id)
              }, 'Đã tạo bản nháp huấn luyện.')}>Tạo bản sửa phản hồi <ArrowRight size={15} /></Button>
              {canDelete && <Button variant="danger" disabled={action.busy} onClick={() => {
                if (window.confirm('Xóa vĩnh viễn hội thoại và dữ liệu kênh liên quan?')) void action.run(async () => {
                  await api('conversations/' + encodeURIComponent(item.id) + '?version=' + item.version, 'DELETE')
                  window.location.hash = 'conversations'
                  list.refresh()
                }, 'Đã xóa dữ liệu hội thoại.')
              }}>Xóa dữ liệu</Button>}
            </div>
            <form className="form-stack handover" key={item.version} onSubmit={update}>
              <label>Trạng thái xử lý<select name="status" defaultValue={item.data.status === 'resolved' ? 'resolved' : 'handover'}>
                <option value="handover">Cần hỗ trợ</option><option value="resolved">Đã xử lý</option>
              </select></label>
              <label className="checkbox"><input name="paused" type="checkbox" defaultChecked={item.data.paused} /> Tạm dừng trả lời tự động</label>
              <label>Phản hồi nội bộ<textarea name="reply" maxLength={4000} placeholder="Ghi lại cách nhân viên xử lý câu hỏi…" /></label>
              <div><Button type="submit" disabled={action.busy}>Lưu xử lý</Button></div>
            </form>
          </>}
      </section>
    </div>
  </>
}

const mockExample = { object: 'page', entry: [{ id: '100', messaging: [{ sender: { id: '200' }, recipient: { id: '100' }, message: { mid: 'studio-mock-001', text: 'Quy trình kiểm tra nội bộ' } }] }] }
export function Integrations() {
  const status = useResource<{ messenger: boolean; outbound: boolean }>('integrations')
  const [payload, setPayload] = useState(JSON.stringify(mockExample, null, 2))
  const action = useAction()
  const [result, setResult] = useState<{ accepted: number; duplicate: number; sent: number }>()
  return <>
    <PageTitle kicker="KHÔNG GIAN LÀM VIỆC" title="Tích hợp" copy="Theo dõi trạng thái kênh và thử luồng Messenger bằng dữ liệu giả lập." />
    <div className="integration-grid">
      {[
        { name: 'Messenger', icon: MessageCircle, text: 'Webhook và luồng thử nghiệm', state: status.value ? status.value.messenger ? 'Nhận tin đã bật' : 'Nhận tin đang tắt' : 'Đang tải…' },
        { name: 'Instagram', icon: Camera, text: 'Bộ điều hợp dữ liệu', state: 'Chưa kết nối' },
        { name: 'Website', icon: Globe, text: 'Bộ điều hợp dữ liệu', state: 'Chưa kết nối' },
      ].map(({ name, icon: Icon, text, state }) => <article className="card padded integration" key={name}>
        <span className="icon-tile olive"><Icon size={20} /></span><h2>{name}</h2><p>{text}</p><span className="badge badge-draft">{state}</span>
      </article>)}
    </div>
    {status.error && <LoadState error={status.error} retry={status.refresh} />}
    <form className="card padded form-stack" onSubmit={event => {
      event.preventDefault()
      void action.run(async () => {
        let body: unknown
        try { body = JSON.parse(payload) } catch { throw new Error('JSON chưa hợp lệ.') }
        setResult(await api('integrations/messenger/mock', 'POST', body))
      })
    }}>
      <h2>Mô phỏng webhook Messenger</h2><p>{status.value?.outbound ? 'Gửi thật đang bật.' : 'Gửi thật đang tắt.'}</p><p>Gửi một mẫu sự kiện vào hộp thư thử. Gửi lại cùng mã tin nhắn để kiểm tra chống trùng.</p>
      <label>Dữ liệu sự kiện<textarea className="code" value={payload} rows={10} onChange={event => { setPayload(event.target.value); setResult(undefined) }} /></label>
      <Feedback error={action.error} notice={result && !action.error ? `Đã nhận ${result.accepted} · Trùng lặp ${result.duplicate} · Đã phản hồi ${result.sent}` : undefined} />
      <div><Button type="submit" disabled={action.busy}><Send size={16} /> Gửi sự kiện mô phỏng</Button></div>
    </form>
  </>
}

type Audit = { id: string; kind: string; recordId: string; action: string; data: string; at: number }
function PrivacySettings() {
  const resource = useResource<{ days: number }>('privacy')
  const action = useAction()
  return <form className="card padded form-stack" onSubmit={event => {
    event.preventDefault()
    const days = Number(new FormData(event.currentTarget).get('days'))
    void action.run(async () => { await api('privacy', 'PUT', { days }); resource.refresh() }, 'Đã lưu thời hạn lưu trữ.')
  }}>
    <h2>Lưu trữ dữ liệu hội thoại</h2>
    <p>Hệ thống tính thời hạn từ lần cập nhật gần nhất. Bạn cũng có thể xóa từng hội thoại trong hộp thư.</p>
    {resource.value ? <label>Số ngày lưu trữ<input key={resource.value.days} name="days" required type="number" min="1" max="365" defaultValue={resource.value.days} /></label> :
      <LoadState error={resource.error} retry={resource.refresh} />}
    <Feedback error={action.error} notice={action.notice} />
    <div className="actions"><Button type="submit" disabled={action.busy || !resource.value}>Lưu thời hạn</Button>
      <Button variant="outline" disabled={action.busy} onClick={() => {
        if (window.confirm('Xóa các hội thoại đã quá hạn lưu trữ?')) void action.run(async () => {
          await api('privacy/purge', 'POST')
        }, 'Đã chạy dọn dữ liệu quá hạn.')
      }}>Dọn dữ liệu quá hạn</Button></div>
  </form>
}

export function Settings({ name, demo, refresh }: { name: string; demo: boolean; refresh: () => void }) {
  const audit = useResource<Audit[]>('audit')
  const action = useAction()
  return <>
    <PageTitle kicker="KHÔNG GIAN LÀM VIỆC" title="Cài đặt" copy="Quản lý thông tin thương hiệu, quyền truy cập và lịch sử thay đổi." />
    <div className="dashboard-grid">
      <form className="card padded form-stack" onSubmit={event => {
        event.preventDefault()
        const name = new FormData(event.currentTarget).get('name')
        void action.run(async () => { await api('brand', 'PATCH', { name }); audit.refresh(); refresh() }, 'Đã cập nhật thương hiệu.')
      }}>
        <h2>Thương hiệu đang hoạt động</h2><label>Tên hiển thị<input name="name" required maxLength={80} defaultValue={name} /></label>
        <Feedback error={action.error} notice={action.notice} /><div><Button type="submit" disabled={action.busy}><Save size={16} /> Lưu thương hiệu</Button></div>
      </form>
      <section className="card padded security-card"><div className="inline-heading"><span className="icon-tile olive"><LockKeyhole size={18} /></span><h2>Quyền truy cập</h2></div>
        <p><ShieldCheck size={17} /> {demo ? 'Phiên mô phỏng trong môi trường thử nghiệm' : 'Phiên quản trị được xác thực'}</p>
        <p><Check size={17} /> Dữ liệu giới hạn theo thương hiệu</p></section>
    </div>
    <PrivacySettings />
    <section className="card padded"><div className="inline-heading"><span className="icon-tile stone"><History size={18} /></span>
      <div><h2>Nhật ký và phiên bản</h2><p>50 thay đổi gần nhất của thương hiệu.</p></div></div>
      {!audit.value ? <LoadState error={audit.error} retry={audit.refresh} /> : audit.value.length ?
        <div className="audit-list">{audit.value.map(entry => <details key={entry.id}><summary>{label[entry.action] ?? entry.action} · {entry.kind}
          <time>{date.format(entry.at)}</time></summary><pre>{JSON.stringify(JSON.parse(entry.data), null, 2)}</pre></details>)}</div> :
        <Empty title="Chưa có thay đổi">Thay đổi dữ liệu sẽ xuất hiện trong nhật ký.</Empty>}
    </section>
  </>
}
