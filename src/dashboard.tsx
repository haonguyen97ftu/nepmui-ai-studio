import { ArrowDownRight, ArrowRight, ArrowUpRight, Bot, ChevronDown, Clock3, FlaskConical, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react'
import { useResource } from './api'
import { date, number } from './locale'
import { Button } from './ui/button'
import { Badge, Empty, LoadState, PageTitle } from './ui/common'
import type { Entry } from '../worker/contracts'
import { useState } from 'react'

type Overview = { total: number; pending: number; responses: number; latency: number | null; grounded: number; calls: number; series: { day: string; total: number }[] }
type List = { items: Entry<'conversations'>[] }
const weekdays = new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'UTC' })

export function Dashboard({ demo, canReadConversations }: { demo: boolean; canReadConversations: boolean }) {
  const [mode, setMode] = useState<'test' | 'live'>(demo ? 'test' : 'live')
  const overview = useResource<Overview>('overview?mode=' + mode)
  const recent = useResource<List>(canReadConversations ? 'conversations?mode=' + mode : '')
  const [days, setDays] = useState(7)
  const data = overview.value
  const points = Array.from({ length: days }, (_, index) => {
    const day = new Date(Date.now() - (days - index - 1) * 86_400_000)
    const total = data?.series.find(point => point.day === day.toISOString().slice(0, 10))?.total ?? 0
    return { day: weekdays.format(day), total }
  })
  const max = Math.max(4, Math.ceil(Math.max(...points.map(point => point.total)) / 4) * 4)
  const rate = data?.responses ? Math.round(data.grounded / data.responses * 100) : null
  const stats = data && [
    { icon: MessageCircle, title: 'Tổng hội thoại', value: number.format(data.total), detail: 'Hội thoại đã ghi nhận', tone: 'olive' },
    { icon: ArrowDownRight, title: 'Cần hỗ trợ', value: number.format(data.pending), detail: 'Đang chờ nhân viên xử lý', tone: 'sand' },
    { icon: ShieldCheck, title: 'Phản hồi có căn cứ', value: rate === null ? '—' : rate + '%', detail: `${data.responses} phản hồi AI đã ghi nhận`, tone: 'olive' },
    { icon: Clock3, title: 'Độ trễ trung bình', value: data.latency === null ? '—' : `${number.format(Math.round(data.latency))} ms`, detail: 'Từ lúc truy xuất tới phản hồi', tone: 'stone' },
  ]
  return <>
    <PageTitle kicker="TRUNG TÂM ĐIỀU HÀNH" title="Tổng quan" copy="Theo dõi hội thoại, hiệu suất AI và những câu hỏi cần bạn hỗ trợ."
      action={<div className="actions">
        {!demo && <label><span className="sr-only">Loại dữ liệu</span><select value={mode} onChange={event => setMode(event.target.value === 'test' ? 'test' : 'live')}>
          <option value="live">Dữ liệu thực</option><option value="test">Dữ liệu thử</option></select></label>}
        <Button asChild><a href="#playground"><FlaskConical size={17} /> Mở phòng thử nghiệm <ArrowUpRight size={15} /></a></Button></div>} />
    {!stats && <LoadState error={overview.error} retry={overview.refresh} />}
    {stats && <>
      <div className="stats">{stats.map(({ icon: Icon, title, value, detail, tone }) =>
        <article className="card stat" key={title}><span className={`icon-tile ${tone}`}><Icon size={18} /></span>
          <p>{title}</p><strong>{value}</strong><small>{detail}</small></article>)}</div>
      <div className="dashboard-grid">
        <section className="card padded chart-card" aria-labelledby="activity-title">
          <div className="card-heading"><div><h2 id="activity-title">Hoạt động hội thoại</h2><p>Số hội thoại theo ngày hoạt động gần nhất</p></div>
            <label className="period"><span className="sr-only">Khoảng thời gian</span>
              <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>7 ngày qua</option><option value={3}>3 ngày qua</option></select><ChevronDown size={14} /></label></div>
          <div className="chart"><div className="chart-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map(i => <span key={i}>{max * i / 4}</span>)}</div>
            <div className="chart-columns">{points.map((point, index) =>
              <div className="chart-column" key={index} aria-label={`${point.day}, ${point.total} hội thoại`}>
                <div className="bar-space"><div className="bar" title={`${point.total} hội thoại`} style={{ height: `max(3px, ${point.total / max * 100}%)` }} /></div>
                <span>{point.day}</span>
              </div>)}</div>
          </div>
        </section>
        <section className="card padded ai-card"><div className="card-heading">
          <div><span className="icon-tile olive"><Sparkles size={19} /></span><h2>Tình trạng AI</h2></div>
          <span className="badge badge-approved"><span className="status-dot" /> Đang theo dõi</span>
        </div>
          <dl><div><dt><Bot size={16} /> Lượt gọi Workers AI hôm nay</dt><dd>{data.calls}</dd></div>
            <div><dt><ShieldCheck size={16} /> Phản hồi có nguồn</dt><dd>{data.grounded}</dd></div></dl>
          <Button variant="outline" asChild><a href="#models">Cài đặt mô hình <ArrowRight size={15} /></a></Button>
        </section>
      </div>
    </>}
    {canReadConversations && <section className="card padded"><div className="card-heading"><div><h2>Hội thoại gần đây</h2><p>Xem câu hỏi mới và các trường hợp cần hỗ trợ</p></div>
      <Button variant="ghost" asChild><a href="#conversations">Xem tất cả <ArrowRight size={16} /></a></Button></div>
      {!recent.value ? <LoadState retry={recent.refresh} error={recent.error} /> : recent.value.items.length ?
        <ul className="entries">{recent.value.items.slice(0, 5).map(item => <li key={item.id}>
          <a className="entry-link" href={`#conversations/${encodeURIComponent(item.id)}`}><span className="icon-tile stone"><MessageCircle size={16} /></span>
            <span className="entry-title"><strong>{item.data.title}</strong><small>{date.format(item.updated)}</small></span><Badge value={item.data.status} />
          </a></li>)}</ul> : <Empty title="Chưa có hội thoại">Gửi một tin nhắn trong phòng thử nghiệm để bắt đầu.</Empty>}
    </section>}
  </>
}
