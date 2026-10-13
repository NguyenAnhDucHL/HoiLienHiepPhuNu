import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppSignalR } from '../contexts/SignalRContext'
import AdminHeader from '../components/AdminHeader'
import { toast } from 'sonner'
import { ConfirmationModal } from '../components/ui/confirmation-modal'
import { adminService } from '../services/admin.service'
import { ScheduleForm } from '../features/schedules/components/ScheduleForm'
import { ScheduleTable } from '../features/schedules/components/ScheduleTable'
import { SchedulePagination } from '../features/schedules/components/SchedulePagination'

const EMPTY_FORM = {
  dateStr: '',
  timeStr: '',
  department: '',
  title: '',
  invitationNumber: '',
  location: '',
  presider: '',
  content: '',
  isPublic: true,
  participants: '',
  updatedAt: '',
}

const cleanHtmlContent = (html) => {
  if (!html) return ''
  let result = html
  const emptyParagraphRegex =
    /^(\s*<p[^>]*>(\s|&nbsp;|<br>|<\/?span[^>]*>)*<\/p>\s*)+|(\s*<p[^>]*>(\s|&nbsp;|<br>|<\/?span[^>]*>)*<\/p>\s*)+$/gi
  let prev = ''
  while (result !== prev) {
    prev = result
    result = result.replace(emptyParagraphRegex, '')
  }
  return result.trim()
}

export default function AdminSchedules() {
  const { lastScheduleUpdate } = useAppSignalR()

  const [schedules, setSchedules] = useState([])
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [selectedParticipants, setSelectedParticipants] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [loadError, setLoadError] = useState('')
  // isInitializing: true cho đến khi lần fetch đầu tiên hoàn tất (thành công hoặc lỗi).
  // Ngăn bảng render rỗng trong khoảng thời gian đang refresh token (401 → refresh → retry).
  const [isInitializing, setIsInitializing] = useState(true)
  const isFirstKeywordRun = useRef(true)

  const fetchSchedules = useCallback(async (page = 1, kw = '', size = 10) => {
    try {
      const data = await adminService.getSchedulesPaginated(page, size, kw)
      setLoadError('')
      // Server trả về { items, totalCount, page, pageSize, totalPages }
      if (data && 'items' in data) {
        setSchedules(Array.isArray(data.items) ? data.items : [])
        setTotalCount(data.totalCount ?? 0)
        setTotalPages(data.totalPages ?? 1)
        setCurrentPage(data.page ?? page)
      } else {
        // Fallback backward-compat nếu server trả array thẳng
        setSchedules(Array.isArray(data) ? data : data?.data || [])
      }
    } catch (err) {
      // Không được nuốt lỗi: nếu không, UI hiện "0 bản ghi" như thể DB rỗng
      setLoadError(err?.message || 'Không tải được danh sách lịch. Vui lòng thử lại.')
    } finally {
      // Dù thành công hay thất bại, đã có kết quả → bỏ trạng thái khởi tạo
      setIsInitializing(false)
    }
  }, [])

  // Search với debounce 400ms tránh gọi API mỗi ký tự (bỏ qua lần chạy đầu — đã có effect tải ban đầu)
  useEffect(() => {
    if (isFirstKeywordRun.current) {
      isFirstKeywordRun.current = false
      return undefined
    }
    const timer = setTimeout(() => {
      setCurrentPage(1)
      fetchSchedules(1, keyword, pageSize)
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword])

  // Tải danh sách lịch: lần mở trang đầu tiên + mỗi khi có cập nhật realtime từ SignalR
  useEffect(() => {
    fetchSchedules(currentPage, keyword, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastScheduleUpdate])

  // Danh mục người dùng / phòng ban chỉ cần tải 1 lần khi mở trang
  useEffect(() => {
    // Lỗi phiên đăng nhập đã được apiClient phát sự kiện auth:unauthorized và banner danh sách lịch báo lỗi
    adminService
      .getUsers()
      .then((d) => setUsers(Array.isArray(d) ? d : d?.data || []))
      .catch(() => { })
    adminService
      .getDepartments()
      .then((d) => setDepartments(Array.isArray(d) ? d : d?.data || []))
      .catch(() => { })
  }, [])

  const handleReset = () => {
    setEditId(null)
    setFormData({ ...EMPTY_FORM, dateStr: new Date().toISOString().split('T')[0] })
    setSelectedParticipants([])
  }

  const handleEdit = (item) => {
    setEditId(item.id)
    setFormData({
      dateStr: item.date ? item.date.split('T')[0] : new Date().toISOString().split('T')[0],
      timeStr: item.startTime || '',
      department: item.preparingUnit || 'CƠ QUAN',
      title: item.title || '',
      invitationNumber: item.invitationNumber || '',
      location: item.location || '',
      presider: item.presider || '',
      content: item.content || '',
      isPublic: item.isPublic === 1 || item.isPublic === true,
      participants: item.participants || '',
      updatedAt: item.updatedAt || '',
    })
    setSelectedParticipants(
      item.participants
        ? item.participants
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        : []
    )
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const cleanedContent = cleanHtmlContent(formData.content)
    const cleanedInvitationNumber = (formData.invitationNumber || '').trim()

    const plainContent = cleanedContent.replace(/<[^>]*>?/gm, '').trim()
    if (!plainContent) {
      setError('Vui lòng nhập Nội dung chi tiết')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setLoading(true)
    setError('')
    try {
      const payload = {
        title: plainContent.substring(0, 50) || 'Lịch công tác',
        invitationNumber: cleanedInvitationNumber,
        date: formData.dateStr,
        startTime: formData.timeStr,
        location: formData.location,
        content: cleanedContent,
        presider: formData.presider,
        preparingUnit: formData.department,
        participants: selectedParticipants.join(', '),
        isPublic: formData.isPublic ? 1 : 0,
        updatedAt: formData.updatedAt || null,
      }
      if (editId) {
        await adminService.updateSchedule(editId, payload)
        toast.success('Cập nhật lịch công tác thành công!')
      } else {
        await adminService.createSchedule(payload)
        toast.success('Thêm lịch công tác thành công!')
      }
      handleReset()
      fetchSchedules(currentPage, keyword, pageSize)
    } catch (err) {
      setError(err.message || 'Lỗi kết nối máy chủ')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return
    setIsDeleting(true)
    try {
      await adminService.deleteSchedule(itemToDelete)
      toast.success('Xóa lịch công tác thành công!')
      // Sau khi xóa: nếu trang hiện tại chỉ còn 1 item thì quay về trang trước
      const newPage = schedules.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage
      fetchSchedules(newPage, keyword, pageSize)
    } catch (e) {
      toast.error(e.message || 'Xóa thất bại')
    } finally {
      setIsDeleting(false)
      setDeleteConfirmOpen(false)
      setItemToDelete(null)
    }
  }

  return (
    <div className="min-h-screen bg-white font-sans text-[15px] text-gray-800">
      <AdminHeader />

      <main className="max-w-[1000px] mx-auto px-4 py-6">
        <h2 className="text-[#c2185b] font-bold text-lg mb-6">Quản trị lịch</h2>

        <ScheduleForm
          formData={formData}
          setFormData={setFormData}
          editId={editId}
          loading={loading}
          error={error}
          users={users}
          departments={departments}
          selectedParticipants={selectedParticipants}
          setSelectedParticipants={setSelectedParticipants}
          onSubmit={handleSubmit}
          onReset={handleReset}
        />

        <div className="flex items-center justify-between mb-2 gap-4">
          <span className="text-gray-500 text-[15px]">
            Danh sách lịch làm việc ({totalCount} bản ghi)
          </span>
          <div className="flex items-center gap-3">
            <select
              value={pageSize}
              onChange={(e) => {
                const newSize = parseInt(e.target.value, 10)
                setPageSize(newSize)
                setCurrentPage(1)
                fetchSchedules(1, keyword, newSize)
              }}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400 bg-white"
            >
              <option value={10}>10 dòng</option>
              <option value={20}>20 dòng</option>
              <option value={50}>50 dòng</option>
            </select>
            <input
              type="text"
              placeholder="Tìm kiếm..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-44 focus:outline-none focus:border-blue-400"
            />
            <span className="text-gray-400 text-xs whitespace-nowrap">
              Trang {currentPage}/{totalPages}
            </span>
          </div>
        </div>

        {isInitializing ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm gap-2">
            <svg className="animate-spin h-5 w-5 text-[#c2185b]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Đang tải danh sách lịch...
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="mb-3 flex items-center justify-between gap-3 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <span>Không tải được danh sách lịch: {loadError}</span>
            <button
              type="button"
              onClick={() => fetchSchedules(currentPage, keyword, pageSize)}
              className="shrink-0 rounded border border-red-400 bg-white px-3 py-1 font-medium text-red-700 hover:bg-red-100"
            >
              Tải lại
            </button>
          </div>
        ) : (
          <>
            <ScheduleTable
              schedules={schedules}
              currentPage={currentPage}
              pageSize={pageSize}
              serverSide={true}
              onEdit={handleEdit}
              onDelete={(id) => {
                setItemToDelete(id)
                setDeleteConfirmOpen(true)
              }}
            />

            <SchedulePagination
              currentPage={currentPage}
              setCurrentPage={(p) => {
                setCurrentPage(p)
                fetchSchedules(p, keyword, pageSize)
              }}
              totalItems={totalCount}
              pageSize={pageSize}
            />
          </>
        )}
      </main>

      <ConfirmationModal
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Xác nhận xóa"
        description="Bạn có chắc chắn muốn xóa lịch công tác này? Thao tác này không thể hoàn tác."
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
      />
    </div>
  )
}
