"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AdminCourse, AdminEnrollment, AdminService } from "@/services/admin.service";
import { Search, Plus, Pencil, Trash2, RefreshCw, X, Download, AlertCircle, LayoutGrid, List } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import { exportToExcel } from "@/utils/excelExport";
import { useCreateEnrollment, useUpdateEnrollment, useDeleteEnrollment, useCourses, useEnrollments, useBatches } from "@/hooks/useAdmin";
import { toast } from "sonner";
import { formatAmount } from "@/utils/format";
import { Pagination } from "@/components/ui/Pagination";
import { TableBodySkeleton, CardSkeleton } from "@/components/ui/Skeleton";


function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
            <h3 className="font-bold text-slate-900">{title}</h3>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-50 text-slate-500" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 overflow-y-auto custom-scrollbar">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function AdminEnrollmentsPage() {
  const router = useRouter();
  const { isAdminOrSales, isAdminOrSalesOrAccountant, isAdminOrSalesOrAccountantOrManager, isAdmin, isAccountant, isStudentAffairs, loading } = useAuth();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const { data: coursesResponse, isLoading: coursesLoading } = useCourses(1, 1000);
  const courses = coursesResponse?.data || [];

  const { data: enrollmentsResponse, isLoading: enrollmentsLoading, refetch: reload } = useEnrollments(undefined, page, limit);
  const rows = enrollmentsResponse?.data || [];
  const pagination = enrollmentsResponse?.pagination;

  const [q, setQ] = useState("");
  const [filterCourse, setFilterCourse] = useState("");
  const [filterBatch, setFilterBatch] = useState("");
  const [exporting, setExporting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<AdminEnrollment | null>(null);
  const [enrollToDelete, setEnrollToDelete] = useState<AdminEnrollment | null>(null);

  const createMutation = useCreateEnrollment();
  const deleteMutation = useDeleteEnrollment();
  const busy = createMutation.isPending || deleteMutation.isPending;

  const [cStudentCode, setCStudentCode] = useState("");
  const [cCourseCode, setCCourseCode] = useState("");
  const [cStatus, setCStatus] = useState(true);
  const [cBatchNo, setCBatchNo] = useState("");
  const [cBatchId, setCBatchId] = useState<number | "">("");
  const [cPaymentPlan, setCPaymentPlan] = useState("");
  const [cDownpayment, setCDownpayment] = useState<number | "">(0);
  const [cInstallment, setCInstallment] = useState<number | "">(0);
  const [cTotalFee, setCTotalFee] = useState<number | "">("");
  const [cExamFeeGbp, setCExamFeeGbp] = useState<number | "">("");

  const [eStatus, setEStatus] = useState(true);
  const [eBatchNo, setEBatchNo] = useState("");
  const [eBatchId, setEBatchId] = useState<number | "">("");
  const [ePaymentPlan, setEPaymentPlan] = useState("");
  const [eDownpayment, setEDownpayment] = useState<number | "">(0);
  const [eInstallment, setEInstallment] = useState<number | "">(0);
  const [eTotalFee, setETotalFee] = useState<number | "">("");
  const [eExamFeeGbp, setEExamFeeGbp] = useState<number | "">("");

  const updateMutation = useUpdateEnrollment();

  const selectedCourse = useMemo(() => {
    return courses.find(c => c.course_code === cCourseCode);
  }, [cCourseCode, courses]);

  const { data: cBatchesFull } = useBatches(selectedCourse?.course_id);
  const cBatches = cBatchesFull?.data || [];

  const { data: eBatchesFull } = useBatches(selected?.course_id);
  const eBatches = eBatchesFull?.data || [];


  useEffect(() => {
    if (!loading && !isAdminOrSalesOrAccountantOrManager && !isStudentAffairs) router.replace("/dashboard");
  }, [loading, isAdminOrSalesOrAccountantOrManager, isStudentAffairs, router]);

  // Derive unique batch options for the selected course from loaded rows
  const filterBatchOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { batch_no: string; batch_id: number | null }[] = [];
    rows.forEach((e: any) => {
      if (filterCourse && (e.course_code || "") !== filterCourse) return;
      const key = String(e.batch_id ?? "") + (e.batch_no || "");
      if ((e.batch_no || e.batch_id) && !seen.has(key)) {
        seen.add(key);
        opts.push({ batch_no: e.batch_no || `Batch #${e.batch_id}`, batch_id: e.batch_id });
      }
    });
    return opts.sort((a, b) => a.batch_no.localeCompare(b.batch_no));
  }, [rows, filterCourse]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((e: any) => {
      // Course filter
      if (filterCourse && (e.course_code || "") !== filterCourse) return false;
      // Batch filter
      if (filterBatch) {
        const matchByNo = (e.batch_no || "") === filterBatch;
        const matchById = String(e.batch_id) === filterBatch;
        if (!matchByNo && !matchById) return false;
      }
      // Text search
      if (!term) return true;
      return (
        e.enrollment_code.toLowerCase().includes(term) ||
        String(e.student_id).includes(term) ||
        String(e.course_id).includes(term) ||
        (e.student_code || "").toLowerCase().includes(term) ||
        (e.student_name || "").toLowerCase().includes(term) ||
        (e.course_code || "").toLowerCase().includes(term) ||
        (e.course_name || "").toLowerCase().includes(term) ||
        (e.room || "").toLowerCase().includes(term)
      );
    });
  }, [q, filterCourse, filterBatch, rows]);

  // Auth state has resolved; React Query will auto-fetch if stale (no manual reload needed)
  useEffect(() => {
    // React Query handles re-fetching automatically when staleTime expires
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrSalesOrAccountantOrManager, isStudentAffairs]);

  if (loading) return null;
  if (!isAdminOrSalesOrAccountantOrManager && !isStudentAffairs) return null;

  const openCreate = () => {
    setCStudentCode("");
    setCCourseCode(courses[0]?.course_code ?? "");
    setCStatus(true);
    setCBatchNo("");
    setCBatchId("");
    setCPaymentPlan("");
    setCDownpayment(0);
    setCInstallment(0);
    setCTotalFee("");
    setCExamFeeGbp("");
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    try {
      await createMutation.mutateAsync({
        student_code: cStudentCode.trim(),
        course_code: cCourseCode.trim(),
        status: cStatus,
        batch_no: cBatchNo.trim() || null,
        batch_id: cBatchId !== "" ? Number(cBatchId) : null,
        payment_plan: cPaymentPlan || null,
        downpayment: cDownpayment !== "" ? Number(cDownpayment) : null,
        installment_amount: cInstallment !== "" ? Number(cInstallment) : null,
        total_fee: cTotalFee !== "" ? Number(cTotalFee) : null,
        exam_fee_gbp: cExamFeeGbp !== "" ? Number(cExamFeeGbp) : null,
      });
      setCreateOpen(false);
      // React Query onSuccess invalidation handles the refetch automatically
      toast.success("Enrollment created");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to create enrollment");
    }
  };

  const openEdit = (e: AdminEnrollment) => {
    setSelected(e);
    setEStatus(e.status);
    setEBatchNo(e.batch_no || "");
    setEBatchId(e.batch_id || "");
    setEPaymentPlan(e.payment_plan || "");
    setEDownpayment(e.downpayment || "");
    setEInstallment(e.installment_amount || "");
    setETotalFee(e.total_fee || "");
    setEExamFeeGbp(e.exam_fee_gbp || "");
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!selected) return;
    try {
      await updateMutation.mutateAsync({
        code: selected.enrollment_code,
        payload: {
          status: eStatus,
          batch_no: eBatchNo.trim() || null,
          batch_id: eBatchId !== "" ? Number(eBatchId) : null,
          payment_plan: ePaymentPlan || null,
          downpayment: eDownpayment !== "" ? Number(eDownpayment) : null,
          installment_amount: eInstallment !== "" ? Number(eInstallment) : null,
          total_fee: eTotalFee !== "" ? Number(eTotalFee) : null,
          exam_fee_gbp: eExamFeeGbp !== "" ? Number(eExamFeeGbp) : null,
        },
      });
      setEditOpen(false);
      setSelected(null);
      // React Query onSuccess invalidation handles the refetch automatically
      toast.success("Enrollment updated");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to update enrollment");
    }
  };

  const doDelete = async (e: AdminEnrollment) => {
    setEnrollToDelete(e);
  };

  const executeDelete = async () => {
    if (!enrollToDelete) return;
    try {
      await deleteMutation.mutateAsync(enrollToDelete.enrollment_code);
      // React Query onSuccess invalidation handles the refetch automatically
      toast.success("Enrollment deleted");
    } catch (er: any) {
      toast.error(er?.response?.data?.message || "Failed to delete enrollment");
    } finally {
      setEnrollToDelete(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Enrollments</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Enroll students into courses and manage enrollment status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => reload()} disabled={busy} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-60 text-sm transition-all active:scale-95">
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            <span className="hidden xs:inline">Refresh</span>
          </button>
          <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-sm transition-all active:scale-95 text-sm whitespace-nowrap">
            <Plus className="w-4 h-4" />
            <span>New Enrollment</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100/50 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 space-y-3">
          {/* Text search */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by student, code, or course…" className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium text-sm" />
          </div>
          {/* Course + Batch filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={filterCourse}
              onChange={(e) => { setFilterCourse(e.target.value); setFilterBatch(""); setPage(1); }}
              className="flex-1 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-700 font-medium text-sm"
            >
              <option value="">All Courses</option>
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_code}>
                  {c.course_name} ({c.course_code})
                </option>
              ))}
            </select>
            <select
              value={filterBatch}
              onChange={(e) => { setFilterBatch(e.target.value); setPage(1); }}
              disabled={filterBatchOptions.length === 0}
              className="flex-1 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-700 font-medium text-sm disabled:opacity-50"
            >
              <option value="">All Batches</option>
              {filterBatchOptions.map((b) => (
                <option key={b.batch_id ?? b.batch_no} value={b.batch_no}>
                  {b.batch_no}
                </option>
              ))}
            </select>
            {(filterCourse || filterBatch || q) && (
              <button
                onClick={() => { setFilterCourse(""); setFilterBatch(""); setQ(""); setPage(1); }}
                className="px-3 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-all whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
          {/* Active filter badges */}
          {(filterCourse || filterBatch) && (
            <div className="flex flex-wrap gap-2">
              {filterCourse && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-100 text-xs font-bold">
                  Course: {courses.find(c => c.course_code === filterCourse)?.course_name || filterCourse}
                  <button onClick={() => { setFilterCourse(""); setFilterBatch(""); setPage(1); }} className="hover:text-brand-900">×</button>
                </span>
              )}
              {filterBatch && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-bold">
                  Batch: {filterBatch}
                  <button onClick={() => { setFilterBatch(""); setPage(1); }} className="hover:text-emerald-900">×</button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-bold text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">Code</th>
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Course</th>
                <th className="px-6 py-4">Batch</th>
                <th className="px-6 py-4">Payment</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {enrollmentsLoading ? (
                <TableBodySkeleton columns={8} />
              ) : (
                <>
                  {filtered.map((e) => (
                    <tr key={e.enrollment_code} className="hover:bg-blue-50 hover:shadow-md transition-colors group">
                      <td className="px-6 py-4 font-bold text-brand-600">{e.enrollment_code}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {e.profile_picture ? (
                            <img src={e.profile_picture} alt="Profile" className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-100 shadow-sm" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-400 uppercase">
                              {e.student_name?.[0] || "?"}
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900 group-hover:text-brand-600 transition-colors">{e.student_name || "-"}</div>
                            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">{e.student_code || `ID ${e.student_id}`}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 group-hover:text-brand-600 transition-colors">{(e as any).course_name || "-"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-700 text-nowrap">{e.batch_no || "-"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 uppercase tracking-tighter text-xs">{e.payment_plan || "-"}</div>
                        {e.payment_plan === "installment" && (
                          <div className="text-[10px] text-slate-400 font-bold">{formatAmount(e.installment_amount)} MMK</div>
                        )}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-600 text-nowrap">{e.enrollment_date ? new Date(e.enrollment_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : "-"}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={["inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm", e.status ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"].join(" ")}>
                          {e.status ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 text-xs">
                          {(isAdmin || isAccountant || isAdminOrSales) && (
                            <button onClick={() => openEdit(e)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200 transition-all active:scale-90 shadow-sm">
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button onClick={() => doDelete(e)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all active:scale-90 shadow-sm">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-slate-400 font-medium">
                        No enrollments found.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile/Tablet Card View */}
        <div className="block lg:hidden divide-y divide-slate-100">
          {enrollmentsLoading ? (
            <>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </>
          ) : (
            <>
              {filtered.map((e) => (
                <div key={e.enrollment_code} className="p-4 bg-white hover:bg-blue-50 hover:shadow-md transition-colors space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {e.profile_picture ? (
                        <img src={e.profile_picture} alt="Profile" className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-100 shadow-sm" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-400 uppercase">
                          {e.student_name?.[0] || "?"}
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{e.enrollment_code}</div>
                        <div className="text-base font-bold text-slate-900 leading-tight">{e.student_name || "Unknown Student"}</div>
                        <div className="text-xs text-slate-500 font-medium">{e.student_code || `ID ${e.student_id}`}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={["inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border", e.status ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-100 text-slate-600 border-slate-200"].join(" ")}>
                        {e.status ? "Active" : "Inactive"}
                      </span>
                      <div className="flex gap-2">
                        {(isAdmin || isAccountant || isAdminOrSales) && (
                          <button onClick={() => openEdit(e)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-600 border border-slate-200 transition-all active:scale-90" title="Edit">
                            <Pencil className="w-5 h-5" />
                          </button>
                        )}
                        {isAdmin && (
                          <button onClick={() => doDelete(e)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-600 border border-red-100 transition-all active:scale-90" title="Delete">
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                      <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Enrolled Course</div>
                      <div className="font-bold text-slate-800">{(e as any).course_name || "-"}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-100/50">
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Date</div>
                        <div className="font-semibold text-slate-700 text-nowrap">
                          {e.enrollment_date ? new Date(e.enrollment_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : "-"}
                        </div>
                      </div>
                      <div className="bg-slate-50 p-2 rounded-lg border border-slate-100/50">
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Batch</div>
                        <div className="font-semibold text-slate-700 truncate">
                          {e.batch_no || "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="p-10 text-center text-slate-400 font-medium text-sm">
                  No enrollments found.
                </div>
              )}
            </>
          )}
        </div>

        {/* Pagination Controls */}
        {pagination && (
          <Pagination
            currentPage={page}
            totalPages={pagination.total_pages}
            totalCount={pagination.total_count}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => { setLimit(l); setPage(1); }}
          />
        )}
      </div>

      <Modal title="Create Enrollment" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Student code</label>
            <input value={cStudentCode} onChange={(e) => setCStudentCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="STU0001" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Course</label>
            <select
              value={cCourseCode}
              onChange={(e) => setCCourseCode(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            >
              <option value="">Select Course...</option>
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_code}>{c.course_name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Select Batch (Populated from Course)</label>
            <select
              value={cBatchId}
              onChange={(e) => {
                const val = e.target.value;
                setCBatchId(val ? Number(val) : "");
                const b = cBatches.find(x => x.batch_id === Number(val));
                setCBatchNo(b?.batch_no || "");
              }}
              disabled={!cCourseCode}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 disabled:opacity-50"
            >
              <option value="">-- Select Batch --</option>
              {cBatches.map(b => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_no} ({b.start_date || "N/A"})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Payment Plan</label>
            <select
              value={cPaymentPlan}
              onChange={(e) => {
                setCPaymentPlan(e.target.value);
                if (e.target.value && cCourseCode) {
                  const c = courses.find(x => x.course_code === cCourseCode);
                  if (c) {
                    setCTotalFee(e.target.value === "full" ? (c.fee_full_payment || 0) : (c.fee_installment || 0));
                    if (c.exam_fee_gbp) setCExamFeeGbp(c.exam_fee_gbp);
                  }
                }
              }}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            >
              <option value="">Select Plan...</option>
              <option value="full">Full Payment</option>
              <option value="installment">Installment</option>
            </select>
          </div>

          <div className="sm:col-span-2 grid grid-cols-2 gap-4 bg-brand-50/50 p-4 rounded-2xl border border-brand-100">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Total Fee (MMK)</label>
              <input
                type="number"
                value={cTotalFee}
                onChange={(e) => setCTotalFee(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none"
                placeholder="Default from course"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exam Fee (GBP)</label>
              <input
                type="number"
                value={cExamFeeGbp}
                onChange={(e) => setCExamFeeGbp(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none"
                placeholder="Default from course"
              />
            </div>
          </div>

          {(cPaymentPlan === "installment" || cPaymentPlan === "cash_down") && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Deposit Amount (MMK)</label>
                <input type="number" value={cDownpayment} onChange={(e) => setCDownpayment(e.target.value ? Number(e.target.value) : "")} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="e.g. 50000" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Monthly Installment (MMK)</label>
                <input type="number" value={cInstallment} onChange={(e) => setCInstallment(e.target.value ? Number(e.target.value) : "")} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="e.g. 30000" />
              </div>
            </>
          )}

          <div className="sm:col-span-2 flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={cStatus} onChange={(e) => setCStatus(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Active
            </label>
            <button onClick={submitCreate} disabled={busy || !cStudentCode.trim() || !cCourseCode.trim()} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60">
              Create
            </button>
          </div>
        </div>
      </Modal>

      <Modal title={`Edit Enrollment${selected ? ` — ${selected.enrollment_code}` : ""}`} open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Batch</label>
            <select
              value={eBatchId}
              onChange={(e) => {
                const val = e.target.value;
                setEBatchId(val ? Number(val) : "");
                const b = eBatches.find(x => x.batch_id === Number(val));
                setEBatchNo(b?.batch_no || "");
              }}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            >
              <option value="">-- Select Batch --</option>
              {eBatches.map(b => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_no} ({b.start_date || "N/A"})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Payment Plan</label>
            <select value={ePaymentPlan} onChange={(e) => setEPaymentPlan(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
              <option value="">Select Plan...</option>
              <option value="full">Full Payment</option>
              <option value="cash_down">Cash Down</option>
              <option value="installment">Installment</option>
            </select>
          </div>

          <div className="sm:col-span-2 grid grid-cols-2 gap-4 bg-brand-50/50 p-4 rounded-2xl border border-brand-100">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Total Fee (MMK)</label>
              <input
                type="number"
                value={eTotalFee}
                onChange={(e) => setETotalFee(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exam Fee (GBP)</label>
              <input
                type="number"
                value={eExamFeeGbp}
                onChange={(e) => setEExamFeeGbp(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none"
              />
            </div>
          </div>

          {(ePaymentPlan === "installment" || ePaymentPlan === "cash_down") && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Deposit Amount (MMK)</label>
                <input type="number" value={eDownpayment} onChange={(e) => setEDownpayment(e.target.value ? Number(e.target.value) : "")} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="e.g. 50000" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Monthly Installment (MMK)</label>
                <input type="number" value={eInstallment} onChange={(e) => setEInstallment(e.target.value ? Number(e.target.value) : "")} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="e.g. 30000" />
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={eStatus} onChange={(e) => setEStatus(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Active
            </label>
          </div>
          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button onClick={() => setEditOpen(false)} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={submitEdit} disabled={busy || !selected} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60">
              Save changes
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        open={!!enrollToDelete}
        onClose={() => setEnrollToDelete(null)}
        onConfirm={executeDelete}
        title="Delete Enrollment"
        message={`Are you sure you want to delete enrollment ${enrollToDelete?.enrollment_code}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
