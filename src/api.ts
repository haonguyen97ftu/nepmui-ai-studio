import { useCallback, useEffect, useState } from 'react'

const errors: Record<string, string> = {
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
    method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!response.ok) {
    if (response.status === 401 && path !== 'session') window.dispatchEvent(new Event('studio-session-expired'))
    const { error } = await response.json<{ error: string }>().catch(() => ({ error: '' }))
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
