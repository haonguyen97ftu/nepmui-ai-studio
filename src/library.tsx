import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Check, Download, Package, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import Papa from 'papaparse'
import type { Data, Entry } from '../worker/contracts'
import { api, useAction, useResource } from './api'
import { date, number } from './locale'
import { SourceLinks } from './sources'
import { Button } from './ui/button'
import { Badge, Empty, Feedback, LoadState, PageTitle } from './ui/common'

type LibraryKind = 'knowledge' | 'products' | 'training'
type Item = Entry<LibraryKind>
type Draft = { title: string; category: string; body: string; incorrect: string; notes: string; price: string; availability: string; image: string }
const blank: Draft = { title: '', category: '', body: '', incorrect: '', notes: '', price: '', availability: 'unknown', image: '' }
const words = {
  knowledge: { title: 'Kho tri thức', copy: 'Quản lý thông tin đã xác thực để trợ lý tham chiếu khi trả lời.', singular: 'bài viết', kicker: 'NỘI DUNG' },
  products: { title: 'Sản phẩm', copy: 'Quản lý danh mục, tầng hương, giá bán và tình trạng hàng.', singular: 'sản phẩm', kicker: 'NỘI DUNG' },
  training: { title: 'Huấn luyện AI', copy: 'Ghi nhận phản hồi sai, duyệt câu sửa và đưa vào kho tri thức.', singular: 'bản sửa', kicker: 'VẬN HÀNH AI' },
}

function fieldsFor(item?: Item) {
  if (!item) return blank
  const { data } = item
  return { ...blank, ...data, price: 'price' in data ? String(data.price) : '' }
}
function payload(kind: LibraryKind, fields: Draft) {
  const { title, category, body, incorrect, notes, price, availability, image } = fields
  if (kind === 'products') return { title, notes, price: Number(price), availability, image }
  return kind === 'knowledge' ? { title, category, body, status: 'draft' } : { title, body, incorrect, status: 'draft' }
}

async function importFile(file: File) {
  if (file.size > 140_000) throw new Error('Tệp tối đa 140 KB.')
  const content = (await file.text()).replace(/^\uFEFF/, '').trim()
  if (!content) throw new Error('Tệp không có nội dung.')
  if (/\.csv$/i.test(file.name)) {
    const parsed = Papa.parse<Pick<Data<'knowledge'>, 'title' | 'category' | 'body'>>(content, { header: true, skipEmptyLines: 'greedy' })
    if (parsed.errors.length || !['title', 'category', 'body'].every(field => parsed.meta.fields?.includes(field))) {
      throw new Error('CSV cần ba cột title, category, body và các hàng hợp lệ.')
    }
    return parsed.data
  }
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error('Chọn tệp TXT, Markdown hoặc CSV.')
  return [{ title: file.name.replace(/\.[^.]+$/, '').slice(0, 160), category: 'Nhập từ tệp', body: content }]
}

export function Library({ kind, selectedId }: { kind: LibraryKind; selectedId?: string }) {
  const copy = words[kind]
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [fields, setFields] = useState<Draft>(blank)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [confirm, setConfirm] = useState('')
  const [file, setFile] = useState<File>()
  const [importOpen, setImportOpen] = useState(false)
  const list = useResource<{ items: Item[]; more: boolean }>(kind + '?q=' + encodeURIComponent(search) + '&page=' + page)
  const action = useAction()
  const detail = useResource<Item>(selectedId ? kind + '/' + encodeURIComponent(selectedId) : '')
  const [historyItem, setHistoryItem] = useState<Item>()
  const historyPanel = useRef<HTMLElement>(null)
  const history = useResource<{ id: string; at: number; data: string; action: string }[]>(historyItem ? 'knowledge/' + historyItem.id + '/history' : '')
  useEffect(() => {
    if (detail.value) {
      setEditing(detail.value)
      setFields(fieldsFor(detail.value))
    }
  }, [detail.value])
  useEffect(() => {
    if (historyItem) {
      historyPanel.current?.focus({ preventScroll: true })
      historyPanel.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [historyItem])
  const set = (name: keyof Draft, value: string) => setFields(old => ({ ...old, [name]: value }))
  function edit(item?: Item) {
    setEditing(item ?? 'new')
    setFields(fieldsFor(item))
  }
  function save(event: FormEvent) {
    event.preventDefault()
    const base = payload(kind, fields)
    const sources = editing && editing !== 'new' && 'sources' in editing.data ? editing.data.sources : undefined
    const data = kind === 'training' ? { ...base, sources } : base
    void action.run(async () => {
      if (editing && editing !== 'new') await api(`${kind}/${editing.id}`, 'PUT', { version: editing.version, data })
      else await api(kind, 'POST', data)
      setEditing(null)
      list.refresh()
    }, 'Đã lưu.')
  }
  function transition(item: Item, status: 'approved' | 'published') {
    void action.run(async () => {
      if (kind === 'training' && status === 'published') await api(`${kind}/${item.id}/publish`, 'POST', { version: item.version })
      else await api(`${kind}/${item.id}`, 'PUT', { version: item.version, data: { ...item.data, status } })
      list.refresh()
    }, status === 'approved' ? 'Đã duyệt.' : 'Đã xuất bản vào kho tri thức.')
  }
  return <>
    <PageTitle kicker={copy.kicker} title={copy.title} copy={copy.copy} action={
      <div className="actions">
        {kind === 'knowledge' && <Button variant="outline" onClick={() => setImportOpen(value => !value)}><Upload size={16} /> Nhập tệp</Button>}
        <Button onClick={() => edit()}><Plus size={17} /> Thêm {copy.singular}</Button>
      </div>} />
    <Feedback error={action.error ?? detail.error} notice={action.notice} />
    {historyItem && <section className="card padded form-stack" aria-label="Lịch sử phiên bản" ref={historyPanel} tabIndex={-1}>
      <div className="card-heading"><div><h2>Lịch sử phiên bản</h2><p>{historyItem.data.title}</p></div>
        <Button variant="ghost" onClick={() => setHistoryItem(undefined)}>Đóng lịch sử</Button></div>
      {!history.value ? <LoadState error={history.error} retry={history.refresh} /> : history.value.map(revision => {
        const snapshot = JSON.parse(revision.data) as Data<'knowledge'>
        return <details key={revision.id}><summary>{date.format(revision.at)} · {snapshot.title} · {snapshot.status}</summary>
          <p>{snapshot.body}</p><Button variant="outline" disabled={action.busy} onClick={() => void action.run(async () => {
            const restored = await api<Item>('knowledge/' + historyItem.id + '/restore', 'POST', { revision: revision.id, version: historyItem.version })
            setHistoryItem(undefined)
            edit(restored)
            list.refresh()
          }, 'Đã khôi phục thành bản nháp.')}>Khôi phục thành bản nháp</Button>
        </details>
      })}
    </section>}
    {importOpen && <form className="card padded form-stack" onSubmit={event => {
      event.preventDefault()
      if (file) void action.run(async () => {
        await api('knowledge/import', 'POST', await importFile(file))
        setFile(undefined)
        setImportOpen(false)
        setPage(0)
        list.refresh()
      }, 'Đã thêm bản nháp từ tệp.')
    }}>
      <h2>Nhập vào kho tri thức</h2>
      <p>TXT hoặc Markdown tạo một bản nháp. CSV hỗ trợ tối đa 30 hàng với các cột title, category, body.</p>
      <a className="quiet-link" href="/mau-tri-thuc.csv" download><Download size={16} /> Tải mẫu CSV</a>
      <label>Tệp tri thức<input required type="file" accept=".txt,.md,.csv" onChange={event => setFile(event.target.files?.[0])} /></label>
      <div><Button type="submit" disabled={action.busy || !file}>Nhập bản nháp</Button></div>
    </form>}
    {editing && <form className="card padded form-stack" onSubmit={save}>
      <div className="card-heading"><h2>{editing === 'new' ? 'Thêm' : 'Chỉnh sửa'} {copy.singular}</h2>
        <Button variant="ghost" aria-label="Đóng biểu mẫu" onClick={() => setEditing(null)}><X size={18} /></Button></div>
      {editing !== 'new' && 'status' in editing.data && editing.data.status !== 'draft' && <p>Thay đổi sẽ được lưu thành bản nháp và cần duyệt lại.</p>}
      <label>{kind === 'products' ? 'Tên sản phẩm' : kind === 'training' ? 'Câu hỏi' : 'Tiêu đề'}
        <input autoFocus required maxLength={160} value={fields.title} onChange={event => set('title', event.target.value)} /></label>
      {kind === 'knowledge' && <label>Danh mục<input required maxLength={160} value={fields.category} onChange={event => set('category', event.target.value)} /></label>}
      {kind === 'training' && <label>Phản hồi cần sửa<textarea maxLength={4000} value={fields.incorrect} onChange={event => set('incorrect', event.target.value)} /></label>}
      {kind !== 'products' && <label>{kind === 'training' ? 'Phản hồi đã sửa' : 'Nội dung'}
        <textarea required={kind === 'knowledge'} maxLength={4000} rows={5} value={fields.body} onChange={event => set('body', event.target.value)} /></label>}
      {kind === 'products' && <>
        <label>Tầng hương<textarea maxLength={4000} value={fields.notes} onChange={event => set('notes', event.target.value)} /></label>
        <div className="field-grid"><label>Giá (VND)<input required type="number" min="0" max="1000000000" value={fields.price} onChange={event => set('price', event.target.value)} /></label>
          <label>Tình trạng<select value={fields.availability} onChange={event => set('availability', event.target.value)}>
            <option value="unknown">Chưa xác nhận</option><option value="available">Còn hàng</option><option value="unavailable">Hết hàng</option></select></label></div>
        <label>URL ảnh (HTTPS)<input type="url" maxLength={1000} value={fields.image} onChange={event => set('image', event.target.value)} placeholder="https://" /></label>
      </>}
      {editing !== 'new' && 'sources' in editing.data && <SourceLinks sources={editing.data.sources} />}
      <div className="actions"><Button type="submit" disabled={action.busy}>{kind === 'products' ? 'Lưu sản phẩm' : 'Lưu bản nháp'}</Button>
        <Button variant="ghost" onClick={() => setEditing(null)}>Hủy</Button></div>
    </form>}
    <section className="card padded">
      <div className="card-heading"><div><h2>Danh sách {copy.singular}</h2></div>
        <label className="search"><Search size={16} /><span className="sr-only">Tìm {copy.singular}</span>
          <input type="search" placeholder="Tìm kiếm…" value={search} onChange={event => { setPage(0); setSearch(event.target.value) }} /></label>
      </div>
      {!list.value ? <LoadState error={list.error} retry={list.refresh} /> : list.value.items.length ?
        <ul className="entries">{list.value.items.map(item => {
          const { data } = item
          const status = 'status' in data ? data.status : data.availability
          return <li className="library-entry" key={item.id}>
            <div className="library-row">
              {'image' in data && data.image ? <a href={data.image} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="icon-tile stone" aria-label={`Mở ảnh bên ngoài của ${data.title} (trang mới)`}><Package size={18} /></a> :
                <span className="icon-tile stone">{kind === 'products' ? <Package size={18} /> : <BookOpen size={18} />}</span>}
              <div className="entry-title"><strong>{data.title}</strong><small>{'category' in data ? data.category + ' · ' : ''}
                {'price' in data ? number.format(data.price) + ' ₫' : date.format(item.updated)}</small></div>
              <Badge value={status} />
              <div className="actions">
                {'status' in data && data.status !== 'published' &&
                  <Button variant="outline" disabled={action.busy} onClick={() => transition(item, data.status === 'draft' ? 'approved' : 'published')}>
                    <Check size={15} /> {data.status === 'draft' ? 'Duyệt' : 'Xuất bản'}</Button>}
                {kind === 'knowledge' && <Button variant="ghost" aria-label={`Lịch sử ${data.title}`} onClick={() => setHistoryItem(item)}>Lịch sử</Button>}
                <Button variant="ghost" aria-label={`Sửa ${data.title}`} onClick={() => edit(item)}><Pencil size={16} /></Button>
                <Button variant="ghost" aria-label={`Xóa ${data.title}`} onClick={() => setConfirm(item.id)}><Trash2 size={16} /></Button>
              </div>
            </div>
            {'sources' in data && <SourceLinks sources={data.sources} />}
            <p className="entry-preview">{'body' in data ? data.body : data.notes}</p>
            {confirm === item.id && <div className="actions confirm"><span>Xóa “{data.title}”?</span>
              <Button variant="danger" disabled={action.busy} onClick={() => void action.run(async () => {
                await api(`${kind}/${item.id}?version=${item.version}`, 'DELETE')
                setConfirm('')
                if (editing && editing !== 'new' && editing.id === item.id) setEditing(null)
                if (list.value?.items.length === 1 && page) setPage(page - 1)
                else list.refresh()
              }, 'Đã xóa.')}>Xác nhận xóa</Button><Button variant="ghost" onClick={() => setConfirm('')}>Hủy</Button></div>}
          </li>
        })}</ul> : <Empty title={search ? 'Không tìm thấy kết quả' : `Chưa có ${copy.singular}`}>{search ? 'Thử từ khóa khác.' : `Thêm ${copy.singular} để bắt đầu.`}</Empty>}
      {list.value && (page > 0 || list.value.more) && <div className="actions pagination">
        <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Trang trước</Button><span>Trang {page + 1}</span>
        <Button variant="outline" disabled={!list.value.more} onClick={() => setPage(page + 1)}>Trang sau</Button>
      </div>}
    </section>
  </>
}
