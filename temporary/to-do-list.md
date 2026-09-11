# To-Do List: Performance Optimization & Memory Reduction

- [x] 1. In-Memory Cache Optimization (Memory Leak Prevention)
  - [x] Implement LRU cache with `OrderedDict` and `maxsize=1000` in `backend/app/core/cache.py`
  - [x] Add eviction on set and automatic expired key cleanup

- [x] 2. Backend Service Optimizations & Blob Deferrals
  - [x] Defer `User.profile_picture` in `get_students_details` (`backend/app/services/admin_panel.py`)
  - [x] Remove explicit Base64 photo & signature queries in `list_enrollments` (`backend/app/services/admin_panel.py`)
  - [x] Remove `profile_picture` serialization from every attendance row in `get_all_attendance` (`backend/app/services/admin_panel.py`)
  - [x] Remove `User.signature` from `list_payments` query (`backend/app/services/admin_panel.py`)
  - [x] Optimize `get_dashboard_summary` sequential scalar queries (`backend/app/services/admin_panel.py`)

- [x] 3. Accounting & Backup Optimization
  - [x] Replace N+1 queries in `list_accounts` with a single `GROUP BY` query (`backend/app/services/accounting_service.py`)
  - [x] Eager load journal entry relations in `list_journal_entries` (`backend/app/services/accounting_service.py`)
  - [x] Defer large Base64 blobs during Excel export in `backend/app/services/backup_service.py`

- [x] 4. Frontend Data Fetching & Perceived Speed
  - [x] Decouple dashboard loading states in `frontend/hooks/useDashboardData.ts`
  - [x] Increase `staleTime` and `gcTime` on `useCourses` and `useAcademicYears` in `frontend/hooks/useAdmin.ts`
  - [x] Ensure on-demand student signature loading for PDF receipts in `frontend/app/(portal)/admin/payments/page.tsx`
  - [x] Remove UI blocking on course dropdowns in `frontend/app/(portal)/admin/enrollments/page.tsx`

- [x] 5. Verification & Testing
  - [x] Verify Python syntax compilation (`py_compile`)
  - [x] Verify frontend build (`npm run build`)
