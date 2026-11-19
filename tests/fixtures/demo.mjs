const threads = [
  ['Quy trình kiểm tra nội bộ', 'answered', 'playground'],
  ['Cần xác nhận thông tin giao hàng', 'handover', 'messenger-mock'],
  ['Câu hỏi thử ngoài kho tri thức', 'handover', 'playground'],
  ['Kiểm tra tài liệu nội bộ', 'answered', 'playground'],
  ['Yêu cầu nhân viên hỗ trợ', 'resolved', 'messenger-mock'],
]
const response = 'Đây là nội dung mô phỏng phục vụ kiểm thử nội bộ.'
const dayMs = 86_400_000

export async function seedDemo(db) {
  const rows = []
  const activity = [2, 4, 3, 6, 5, 8, 7]
  for (const [index, count] of activity.entries()) {
    for (let sequence = 0; sequence < count; sequence++) {
      const [title, status, channel] = threads[(sequence + index) % threads.length]
      const reason = status === 'answered' ? 'grounded' : 'no_source'
      const messages = [{ role: 'user', text: title }]
      if (channel === 'playground') messages.push({ role: 'assistant', text: response, reason, latency: 4 + sequence, provider: 'mock' })
      rows.push(db.prepare('INSERT INTO records (brand_id,kind,id,data,updated) VALUES (?,?,?,?,?)').bind(
        'nepmui', 'conversations', crypto.randomUUID(), JSON.stringify({ title, status, channel, messages }),
        Date.now() - (6 - index) * dayMs - sequence,
      ))
    }
  }
  rows.push(db.prepare('INSERT INTO records (brand_id,kind,id,data,updated) VALUES (?,?,?,?,?)').bind(
    'nepmui', 'knowledge', crypto.randomUUID(), JSON.stringify({
      title: 'Quy trình kiểm tra nội bộ', category: 'Dữ liệu mô phỏng', body: response, status: 'published',
    }), Date.now(),
  ))
  await db.batch(rows)
}
