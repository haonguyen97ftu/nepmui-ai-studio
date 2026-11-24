export const navigation = {
  account:['Tài khoản của tôi','My account'],
  platform: ['Nền tảng', 'Platform'],
  channels: ['Kênh & Pages', 'Channels'],
  users: ['Thành viên & quyền', 'Team'],
  agents: ['Trợ lý AI', 'Agents'],
  usage: ['Phân tích sử dụng', 'Usage'],
  dashboard: ['Tổng quan', 'Overview'],
  knowledge: ['Kho tri thức', 'Knowledge Base'],
  persona: ['Nhân cách AI', 'AI Persona'],
  training: ['Huấn luyện AI', 'AI Training'],
  playground: ['Phòng thử nghiệm', 'Playground'],
  products: ['Sản phẩm', 'Product Catalog'],
  conversations: ['Hội thoại', 'Conversations'],
  integrations: ['Tích hợp', 'Integrations'],
  models: ['Mô hình AI', 'AI Models'],
  settings: ['Cài đặt', 'Settings'],
} as const
export type Page = keyof typeof navigation
export const label: Record<string, string> = {
  draft: 'Bản nháp', approved: 'Đã duyệt', published: 'Đã xuất bản',
  available: 'Còn hàng', unavailable: 'Hết hàng', unknown: 'Chưa xác nhận',
  answered: 'Đã trả lời', handover: 'Cần hỗ trợ', resolved: 'Đã xử lý',
  playground: 'Phòng thử nghiệm', 'messenger-mock': 'Messenger mô phỏng', messenger: 'Messenger',
  grounded: 'Có nguồn xác thực', no_source: 'Thiếu nguồn phù hợp', no_selection: 'Mô hình không chọn nguồn',
  provider_unavailable: 'Mô hình chưa sẵn sàng', provider_error: 'Lỗi mô hình', sensitive: 'Câu hỏi nhạy cảm', limit_reached: 'Đạt giới hạn hằng ngày',
  queued: 'Đang chờ gửi', retry: 'Đang chờ thử lại', working: 'Đang soạn phản hồi', sending: 'Đang gửi',
  sent: 'Đã gửi', expired: 'Hết cửa sổ nhắn tin', paused: 'Đã tạm dừng', failed: 'Gửi thất bại',
  create: 'Tạo mới', update: 'Cập nhật', delete: 'Xóa', brand: 'Thương hiệu',
}
export const number = new Intl.NumberFormat('vi-VN')
export const date = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
