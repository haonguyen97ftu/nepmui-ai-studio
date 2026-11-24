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
  const rows = [db.prepare("INSERT INTO accounts(id,email,name,password_hash,salt,active,super_admin,created) VALUES ('demo-founder','founder@example.test','Demo Founder','disabled-demo-login','synthetic-salt',1,1,?)").bind(Date.now())]
  for (const [id,name,color] of [['synthetic-a','Không gian thử A','#235568'],['synthetic-b','Không gian thử B','#79543a']]) {
    rows.push(db.prepare('INSERT INTO brands VALUES (?,?,1)').bind(id,name))
    rows.push(db.prepare('INSERT INTO workspace_profiles(brand_id,color) VALUES (?,?)').bind(id,color))
  }
  for (const [wi,brand] of ['nepmui','synthetic-a','synthetic-b'].entries()) {
    for (let page=0;page<2;page++) rows.push(db.prepare("INSERT INTO channels(id,brand_id,kind,external_id,name,paused,mock) VALUES (?,?,'messenger',?,?,0,1)")
      .bind(crypto.randomUUID(),brand,String(7000+wi*10+page),'Page mô phỏng '+(page+1)))
  }
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
