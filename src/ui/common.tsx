import { Archive, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { label } from '../locale'
import { Button } from './button'

export function PageTitle({ kicker, title, copy, action }: { kicker: string; title: string; copy: string; action?: ReactNode }) {
  return <div className="page-title">
    <div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{copy}</p></div>
    {action}
  </div>
}
export function Empty({ title = 'Chưa có dữ liệu', children }: { title?: string; children: ReactNode }) {
  return <div className="empty"><span className="icon-tile"><Archive size={19} /></span><strong>{title}</strong><p>{children}</p></div>
}
export function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return <>{error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback" role="status">{notice}</p>}</>
}
export function LoadState({ error, retry }: { error?: string; retry: () => void }) {
  if (error) return <div className="card padded"><Feedback error={error} />
    <Button variant="outline" onClick={retry}><RefreshCw size={15} /> Thử lại</Button></div>
  return <div className="card skeleton" role="status" aria-busy="true"><span className="sr-only">Đang tải dữ liệu</span><i /><i /><i /></div>
}
export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{label[value] ?? value}</span>
}
