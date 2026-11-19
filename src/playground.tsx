import { useState, type FormEvent } from 'react'
import { ArrowUp, Bot, Plus, ScanLine } from 'lucide-react'
import type { Entry } from '../worker/contracts'
import { api, useAction } from './api'
import { label } from './locale'
import { Button } from './ui/button'
import { Badge, Empty, Feedback, PageTitle } from './ui/common'

type Session = {
  conversation: Entry<'conversations'>
  result: { text: string; reason: string; sourceId?: string; sources: { id: string; title: string; body: string }[]; provider: string; latency: number }
}

export function Transcript({ messages }: { messages: Entry<'conversations'>['data']['messages'] }) {
  return <ol className="transcript">{messages.map((message, index) => <li key={index} className={`bubble bubble-${message.role}`}>
    <small>{message.role === 'user' ? 'Người hỏi' : message.role === 'assistant' ? 'Trợ lý AI' : 'Nhân viên'}</small>
    <p>{message.text}</p>{message.reason && <Badge value={message.reason} />}
  </li>)}</ol>
}

export function Playground() {
  const [session, setSession] = useState<Session>()
  const [question, setQuestion] = useState('')
  const action = useAction()
  function send(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || action.busy) return
    const input = { question, conversationId: session?.conversation.id }
    void action.run(async () => {
      const result = await api<Session>('playground', 'POST', input)
      setSession(result)
      setQuestion(value => value === input.question ? '' : value)
    })
  }
  return <>
    <PageTitle kicker="VẬN HÀNH AI" title="Phòng thử nghiệm" copy="Thử câu trả lời và kiểm tra nguồn tri thức trong một hội thoại thử."
      action={<Button variant="outline" disabled={action.busy || !session} onClick={() => { setSession(undefined); setQuestion('') }}>
        <Plus size={16} /> Hội thoại mới</Button>} />
    <div className="dashboard-grid playground-grid">
      <section className="card padded chat-card">
        <div className="card-heading"><div className="inline-heading"><span className="icon-tile olive"><Bot size={19} /></span>
          <div><h2>Trợ lý NẾP MÙI</h2><p>Hội thoại thử</p></div></div><span className="badge badge-draft">Thử nghiệm</span></div>
        <div className="chat-body" aria-live="polite">{session ?
          <Transcript messages={session.conversation.data.messages} /> :
          <Empty title="Bắt đầu bằng một câu hỏi">Hãy thử một câu hỏi có trong kho tri thức đã xuất bản.</Empty>}
          {action.busy && <p className="muted" role="status">Đang tìm nguồn tri thức…</p>}
        </div>
        <Feedback error={action.error} />
        <form className="chat-form" onSubmit={send}>
          <label className="sr-only" htmlFor="test-question">Câu hỏi thử nghiệm</label>
          <textarea id="test-question" rows={2} maxLength={1000} value={question} placeholder="Nhập câu hỏi của bạn…" onChange={event => setQuestion(event.target.value)} />
          <Button type="submit" aria-label="Gửi câu hỏi" disabled={action.busy || !question.trim()}><ArrowUp size={18} /></Button>
        </form>
      </section>
      <section className="card padded diagnostics">
        <div className="inline-heading"><span className="icon-tile stone"><ScanLine size={18} /></span><h2>Kiểm tra phản hồi</h2></div>
        {session ? <>
          <dl><div><dt>Kết quả</dt><dd>{label[session.result.reason] ?? session.result.reason}</dd></div>
            <div><dt>Nhà cung cấp</dt><dd>{session.result.provider}</dd></div><div><dt>Thời gian</dt><dd>{session.result.latency} ms</dd></div></dl>
          <h3>Nguồn truy xuất ({session.result.sources.length})</h3>
          {session.result.sources.length ? session.result.sources.map(source => <details key={source.id}>
            <summary>{source.title}{source.id === session.result.sourceId ? ' · Đã dùng' : ''}</summary><p>{source.body}</p>
          </details>) : <p>Không có nguồn phù hợp.</p>}
        </> : <p className="muted">Nguồn đã truy xuất và lý do trả lời sẽ hiển thị sau khi gửi câu hỏi.</p>}
      </section>
    </div>
  </>
}
