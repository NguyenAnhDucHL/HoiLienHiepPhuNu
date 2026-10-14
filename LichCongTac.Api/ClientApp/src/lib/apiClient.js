/* global CustomEvent */

// Refresh token "single-flight": nhiều request cùng gặp 401 chỉ gọi /api/auth/refresh đúng 1 lần,
// tất cả cùng chờ chung 1 promise rồi tự gọi lại request gốc → kết quả luôn đi qua cùng 1 luồng parse.
let refreshPromise = null

const DEFAULT_SESSION_MESSAGE = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'

const notifyUnauthorized = (message) => {
  document.dispatchEvent(
    new CustomEvent('auth:unauthorized', {
      detail: { message: message || DEFAULT_SESSION_MESSAGE },
    })
  )
}

async function readJsonSafe(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

async function performRefresh() {
  // Gửi kèm JWT cũ (có thể đã hết hạn) để server biết user; refresh_cookie HttpOnly đi theo credentials.
  const staleToken = localStorage.getItem('auth_token')
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: staleToken ? { Authorization: `Bearer ${staleToken}` } : {},
    credentials: 'include',
    cache: 'no-store',
  })

  if (response.ok) {
    const json = await readJsonSafe(response)
    const newToken = json?.data?.token
    if (!newToken) throw new Error('Máy chủ không trả về token mới.')
    localStorage.setItem('auth_token', newToken)
    return newToken
  }

  // 4xx: phiên thực sự không còn hiệu lực → báo UI đăng nhập lại.
  // 5xx / lỗi mạng: chỉ ném lỗi, KHÔNG đá người dùng ra khỏi hệ thống.
  const body = await readJsonSafe(response)
  const message = body.message || DEFAULT_SESSION_MESSAGE
  if (response.status >= 400 && response.status < 500) {
    notifyUnauthorized(message)
  }
  throw new Error(message)
}

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

async function send(url, options) {
  // Tự động thêm Content-Type: application/json khi body là JSON string
  const headers = { ...(options.headers || {}) }
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  // Luôn đọc token mới nhất từ localStorage (token có thể vừa được refresh)
  const token = localStorage.getItem('auth_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // AbortController timeout 15s — ngăn request treo vô hạn trên mạng 2G/Captive Portal
  const timeoutMs = options.timeoutMs ?? 15000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      headers,
      credentials: options.credentials || 'include',
      cache: options.cache || 'no-store',
      // Nếu caller đã truyền signal riêng thì dùng của caller, không override
      signal: options.signal ?? controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Yêu cầu quá thời gian chờ (timeout). Vui lòng kiểm tra kết nối mạng.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

async function parseResponse(response, url) {
  if (!response.ok) {
    const errorData = await readJsonSafe(response)
    const isAuthEndpoint = url.includes('/api/auth/')
    let fallback = response.statusText || 'Lỗi hệ thống'
    if (response.status === 401) {
      fallback = isAuthEndpoint
        ? 'Sai tài khoản hoặc mật khẩu'
        : 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'
    } else if (response.status === 403) {
      fallback = 'Bạn không có quyền thực hiện thao tác này.'
    } else if (response.status >= 500) {
      fallback = 'Máy chủ đang bận hoặc gặp sự cố. Vui lòng thử lại sau.'
    }
    const error = new Error(errorData.message || errorData.error || fallback)
    error.status = response.status
    throw error
  }

  const contentType = response.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    const json = await response.json()

    // Unwrap ApiResponse<T>
    if (json && typeof json === 'object' && 'success' in json) {
      if (json.success) {
        return json.data !== null ? json.data : { message: json.message }
      }
      // Backend trả 200 OK nhưng success = false (một số logic cũ)
      throw new Error(json.message || 'Lỗi xử lý yêu cầu.')
    }
    return json
  }

  // Các kiểu trả về khác (blob, text)
  return response
}

export async function apiClient(url, options = {}) {
  let response = await send(url, options)

  // 401 trên API thường (không phải /api/auth/*): thử gia hạn token rồi gọi lại đúng 1 lần
  if (response.status === 401 && !url.includes('/api/auth/')) {
    try {
      await refreshAccessToken()
      response = await send(url, options)
    } catch {
      notifyUnauthorized('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.')
    }
  }

  if (response.status === 401 && !url.includes('/api/auth/')) {
    notifyUnauthorized('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.')
  }

  return parseResponse(response, url)
}
