import { useCallback, useEffect, useState } from 'react'

let workspaceScope:string|undefined
export const setWorkspaceScope=(id:string|undefined)=>{ workspaceScope=id }

const errors: Record<string, string> = {
  auth_unavailable:'Đăng nhập tài khoản chưa được cấu hình. Liên hệ người triển khai.',
  forbidden:'Bạn không có quyền thực hiện thao tác này.',
  workspace_archived:'Không gian này đã tạm ngưng hoặc lưu trữ. Dữ liệu ở chế độ chỉ đọc.',
  workspace_required:'Chọn một không gian để tiếp tục.',
  workspace_changed:'Không gian đã thay đổi trong một cửa sổ khác. Đang tải lại.',
  channel_unverified:'Page chưa được Super Admin xác minh quyền sở hữu. Kênh thật phải tạm dừng trước khi xác minh.',
  channel_paused:'Kênh đang tạm dừng hoặc đã ngắt kết nối.',
  encryption_unavailable:'Chưa có khóa mã hóa kênh trên máy chủ.',
  bootstrap_required:'Hoàn tất tài khoản nhà sáng lập trước khi chuyển không gian.',
  bootstrap_closed:'Tài khoản nhà sáng lập đã được tạo.',
  login_limit: 'Quá nhiều lần thử. Vui lòng đợi 10 phút.',
  unauthorized: 'Phiên đăng nhập đã hết hạn hoặc khóa truy cập không đúng.',
  invalid_input: 'Dữ liệu chưa hợp lệ. Kiểm tra các trường và thử lại.',
  invalid_transition: 'Hãy lưu bản nháp, duyệt rồi xuất bản.',
  conflict: 'Dữ liệu đã thay đổi. Tải lại và thử lại.',
  missing: 'Không tìm thấy dữ liệu.',
  provider_unavailable: 'Workers AI chưa được bật trong môi trường này.',
  body_limit: 'Dữ liệu vượt quá giới hạn cho phép.',
}

export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method, headers: { ...(data===undefined?{}:{'Content-Type':'application/json'}),...(workspaceScope && path!=='session'?{'X-Workspace-ID':workspaceScope}:{}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!response.ok) {
    if (response.status === 401 && path !== 'session') window.dispatchEvent(new Event('studio-session-expired'))
    const { error } = await response.json<{ error: string }>().catch(() => ({ error: '' }))
    if (error==='workspace_changed') window.location.reload()
    throw new Error(errors[error] ?? 'Yêu cầu chưa thành công. Vui lòng thử lại.')
  }
  return response.json()
}

export function useResource<T>(path: string) {
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key: '' })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const key = path + '|' + revision
  useEffect(() => {
    if (!path) return
    let active = true
    api<T>(path).then(
      value => { if (active) setState({ key, value }) },
      error => { if (active) setState({ key, error: error.message }) },
    )
    return () => { active = false }
  }, [path, key])
  return { value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined, refresh }
}

export function useAction() {
  const [state, setState] = useState({ busy: false, error: '', notice: '' })
  async function run(action: () => Promise<unknown>, notice = '') {
    setState({ busy: true, notice: '', error: '' })
    try {
      await action()
      setState({ busy: false, error: '', notice })
    } catch (error) {
      setState({ busy: false, notice: '', error: error instanceof Error ? error.message : 'Đã xảy ra lỗi.' })
    }
  }
  return { ...state, run }
}
