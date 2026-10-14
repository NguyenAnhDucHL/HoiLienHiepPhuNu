/* eslint-disable */
/* global Response */
import React, { useEffect, useState, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster, toast } from 'sonner'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// Trang public — load ngay (critical path)
import WorkSchedule from './pages/WorkSchedule.jsx'
import SearchSchedule from './pages/SearchSchedule.jsx'

// Tự động reload khi Vite gặp lỗi preload chunk do hệ thống vừa deploy phiên bản mới
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

// Wrapper tự động reload 1 lần khi fetch chunk thất bại do deploy phiên bản mới
const lazyWithRetry = (importFn) =>
  lazy(async () => {
    const isRetried = sessionStorage.getItem('chunk_retry_' + window.location.pathname)
    try {
      const module = await importFn()
      sessionStorage.removeItem('chunk_retry_' + window.location.pathname)
      return module
    } catch (error) {
      if (!isRetried) {
        sessionStorage.setItem('chunk_retry_' + window.location.pathname, 'true')
        window.location.reload()
        return { default: () => null }
      }
      throw error
    }
  })

// Trang Admin — lazy load có retry bảo vệ khi deploy code mới
const AdminLogin = lazyWithRetry(() => import('./pages/AdminLogin.jsx'))
const AdminAccounts = lazyWithRetry(() => import('./pages/AdminAccounts.jsx'))
const AdminSchedules = lazyWithRetry(() => import('./pages/AdminSchedules.jsx'))
const AdminChangePassword = lazyWithRetry(() => import('./pages/AdminChangePassword.jsx'))
const AdminDepartments = lazyWithRetry(() => import('./pages/AdminDepartments.jsx'))
const AdminEmployees = lazyWithRetry(() => import('./pages/AdminEmployees.jsx'))
const AdminNotifications = lazyWithRetry(() => import('./pages/AdminNotifications.jsx'))
const AdminHolidays = lazyWithRetry(() => import('./pages/AdminHolidays.jsx'))

import { SignalRProvider } from './contexts/SignalRContext.jsx'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import './styles/globals.css'

// ─── Global Request Queue for Inline Login Modal ────────────────────────────
let isLoginModalOpen = false
let failedRequestQueue = []

const processRequestQueue = (error, token = null) => {
  failedRequestQueue.forEach((prom) => {
    if (error) {
      prom.resolve(prom.originalResponse)
    } else {
      prom.resolve(token)
    }
  })
  failedRequestQueue = []
}

document.addEventListener('auth:login_success', (e) => {
  isLoginModalOpen = false
  processRequestQueue(null, e.detail.token)
})

document.addEventListener('auth:login_cancel', () => {
  isLoginModalOpen = false
  processRequestQueue(new Error('Canceled'))
})

// ─── Lắng nghe sự kiện mất mạng / có mạng ────────────────────────────────────
window.addEventListener('offline', () => {
  toast.error('Cảnh báo: Bạn đang mất kết nối mạng. Tuyệt đối không bấm Lưu dữ liệu lúc này!', {
    duration: Infinity,
    id: 'offline-toast',
  })
})

window.addEventListener('online', () => {
  toast.dismiss('offline-toast')
  toast.success('Kết nối mạng đã khôi phục!')
})

// ─── Error Boundary ─────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught crash:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={32} className="text-[#c2185b]" />
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Có lỗi xảy ra</h2>
            <p className="text-sm text-gray-500 mb-1">
              {this.state.error && this.state.error.message
                ? this.state.error.message
                : 'Lỗi không xác định'}
            </p>
            <p className="text-xs text-gray-400 mb-6">Vui lòng tải lại trang để tiếp tục.</p>
            <button
              onClick={function () {
                window.location.reload()
              }}
            className="flex items-center gap-2 mx-auto px-6 py-2.5 bg-[#7b1fa2] hover:bg-[#6a1391] text-white rounded-lg text-sm font-semibold transition"
            >
              <RefreshCw size={14} />
              Tải lại trang
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function RequireAuth({ children }) {
  const { token, loading } = useAuth()
  if (loading) return null
  if (!token) {
    return <Navigate to="/manager/login" replace />
  }
  return children
}

function RequireAdmin({ children }) {
  const { token, user, loading } = useAuth()
  if (loading) return null
  if (!token) {
    return <Navigate to="/manager/login" replace />
  }
  if (user?.role !== 'Admin') {
    return <Navigate to="/manager/change-password" replace />
  }
  return children
}

const adminChildren = [
  {
    path: 'change-password',
    element: <AdminChangePassword />,
  },
  {
    path: 'schedules',
    element: (
      <RequireAdmin>
        <AdminSchedules />
      </RequireAdmin>
    ),
  },
  {
    path: 'accounts',
    element: (
      <RequireAdmin>
        <AdminAccounts />
      </RequireAdmin>
    ),
  },
  {
    path: 'departments',
    element: (
      <RequireAdmin>
        <AdminDepartments />
      </RequireAdmin>
    ),
  },
  {
    path: 'employees',
    element: (
      <RequireAdmin>
        <AdminEmployees />
      </RequireAdmin>
    ),
  },
  {
    path: 'notifications',
    element: (
      <RequireAdmin>
        <AdminNotifications />
      </RequireAdmin>
    ),
  },
  {
    path: 'holidays',
    element: (
      <RequireAdmin>
        <AdminHolidays />
      </RequireAdmin>
    ),
  },
  {
    path: '*',
    element: <Navigate to="/manager/schedules" replace />,
  },
]

function RouteErrorFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center border border-gray-100">
        <div className="w-16 h-16 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4 text-[#7b1fa2]">
          <RefreshCw size={28} className="text-[#7b1fa2]" />
        </div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Đang tải phiên bản mới</h2>
        <p className="text-sm text-gray-500 mb-6">
          Hệ thống vừa cập nhật dữ liệu mới. Vui lòng bấm tải lại trang để tiếp tục.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 mx-auto px-6 py-2.5 bg-[#7b1fa2] hover:bg-[#6a1391] text-white rounded-xl text-sm font-semibold transition shadow-md shadow-purple-500/20"
        >
          <RefreshCw size={16} />
          Tải lại trang ngay
        </button>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  // Primary routes at root (lienhiepphunu.vpdtcampha.vn)
  {
    path: '/',
    element: <WorkSchedule />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/search',
    element: <SearchSchedule />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/manager/login',
    element: <AdminLogin />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/manager',
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    errorElement: <RouteErrorFallback />,
    children: adminChildren,
  },
  // Backward compatibility alias for /phunu/
  {
    path: '/phunu/',
    element: <WorkSchedule />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/phunu/search',
    element: <SearchSchedule />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/phunu/manager/login',
    element: <AdminLogin />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/phunu/manager',
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    errorElement: <RouteErrorFallback />,
    children: adminChildren,
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <SignalRProvider>
        <Suspense fallback={null}>
          <RouterProvider router={router} />
        </Suspense>
        <Toaster position="top-right" richColors closeButton />
      </SignalRProvider>
    </AuthProvider>
  </ErrorBoundary>
)
