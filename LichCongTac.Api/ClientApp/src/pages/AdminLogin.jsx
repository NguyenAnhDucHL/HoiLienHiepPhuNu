import React, { useState, useEffect } from 'react'
import { Eye, EyeOff, ArrowLeft, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate, useSearchParams, Navigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { authService } from '../services/auth.service'

export default function AdminLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const { login, token, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('reason') === 'expired') {
      toast.error(
        'Phiên đăng nhập đã hết hạn hoặc tài khoản đang được đăng nhập ở nơi khác. Vui lòng đăng nhập lại.',
        {
          duration: 5000,
        }
      )
      // Xóa query param để không hiện lại khi F5
      setSearchParams({})
    }
  }, [searchParams, setSearchParams])

  if (authLoading) return null
  if (token) return <Navigate to="/manager/schedules" replace />

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await authService.login({ username, password })

      let resToken, resUserName, resRole, resRefreshToken
      if (data.token) {
        resToken = data.token
        resRefreshToken = data.refreshToken
        resUserName = data.username || data.fullName
        resRole = data.role
      } else if (data.data && data.data.token) {
        resToken = data.data.token
        resRefreshToken = data.data.refreshToken
        resUserName = data.data.username || data.data.fullName
        resRole = data.data.role
      }

      if (resToken) {
        login({ name: resUserName, role: resRole }, resToken, resRefreshToken)
        navigate('/manager/schedules', { replace: true })
      } else {
        setError('Đăng nhập thành công nhưng không lấy được token.')
      }
    } catch (err) {
      setError(err.message || 'Lỗi kết nối máy chủ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center font-sans bg-gradient-to-br from-slate-100 via-[#f8f5fb] to-[#fce4ec] p-4">
      {/* Subtle decorative background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-200/40 rounded-full blur-3xl pointer-events-none" />

      {/* Login Box */}
      <div className="relative z-10 w-full max-w-[420px] bg-white rounded-2xl shadow-[0_15px_40px_rgba(123,31,162,0.1)] border border-purple-100/80 p-8 sm:p-10 -mt-8">
        {/* Header Icon & Title */}
        <div className="text-center mb-7">
          <div className="w-13 h-13 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center mx-auto mb-3 text-[#7b1fa2] shadow-sm">
            <Lock size={24} className="text-[#7b1fa2]" />
          </div>
          <p className="text-[11px] font-bold text-[#7b1fa2] uppercase tracking-wider mb-1">
            Hội Liên Hiệp Phụ Nữ Phường Cẩm Phả
          </p>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            Đăng nhập Quản trị
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Nhập tài khoản để truy cập hệ thống quản lý
          </p>
        </div>

        {error && (
          <div className="text-red-700 text-sm mb-5 text-center bg-red-50 border border-red-200 p-3 rounded-lg font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Tên đăng nhập
            </label>
            <input
              type="text"
              placeholder="Nhập tên đăng nhập"
              className="w-full bg-white border border-gray-300 focus:border-[#7b1fa2] focus:ring-4 focus:ring-[#7b1fa2]/15 rounded-xl text-gray-900 placeholder:text-gray-400 py-2.5 px-3.5 text-sm font-medium outline-none transition-all shadow-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Nhập mật khẩu"
                className="w-full bg-white border border-gray-300 focus:border-[#7b1fa2] focus:ring-4 focus:ring-[#7b1fa2]/15 rounded-xl text-gray-900 placeholder:text-gray-400 py-2.5 pl-3.5 pr-10 text-sm font-medium outline-none transition-all shadow-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-gray-400 hover:text-[#7b1fa2] transition-colors focus:outline-none"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#7b1fa2] hover:bg-[#6a1391] text-white py-2.5 rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Đang xác thực...' : 'Đăng nhập'}
            </button>
          </div>

          <div className="text-center pt-2">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#7b1fa2] transition-colors"
            >
              <ArrowLeft size={14} />
              Quay về xem Lịch công tác
            </Link>
          </div>
        </form>
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 w-full z-20">
        <footer className="bg-[#7b1fa2] text-white text-center py-2.5 text-xs font-medium shadow-inner">
          Bản quyền thuộc về Hội Liên Hiệp Phụ Nữ phường Cẩm Phả
        </footer>
      </div>
    </div>
  )
}
