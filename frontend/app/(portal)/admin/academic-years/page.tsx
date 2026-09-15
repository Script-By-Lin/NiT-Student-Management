"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AdminAcademicYear, AdminService } from "@/services/admin.service";
import { Plus, Search, Trash2, Pencil, RefreshCw, X, Download } from "lucide-react";
import { exportToExcel } from "@/utils/excelExport";
import { toast } from "sonner";


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

export default function AdminAcademicYearsPage() {
  const router = useRouter();
  const { isAdminOrSales, isAdminOrSalesOrManager, isAdmin, loading } = useAuth();

  const [rows, setRows] = useState<AdminAcademicYear[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<AdminAcademicYear | null>(null);

  const [cName, setCName] = useState("");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");

  const [eName, setEName] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");

  useEffect(() => {
    if (!loading && !isAdminOrSalesOrManager) router.replace("/dashboard");
  }, [loading, isAdminOrSalesOrManager, router]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((y) => y.academic_year_name.toLowerCase().includes(term));
  }, [q, rows]);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setRows(await AdminService.listAcademicYears());
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.response?.data?.message || "Failed to load academic years");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isAdminOrSalesOrManager) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrSalesOrManager]);

  if (loading) return null;
  if (!isAdminOrSalesOrManager) return null;

  const openCreate = () => {
    setCName("");
    setCStart("");
    setCEnd("");
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    setBusy(true);
    setError("");
    try {
      await AdminService.createAcademicYear({ academic_year_name: cName.trim(), start_date: cStart, end_date: cEnd });
      setCreateOpen(false);
      toast.success("Academic year created successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to create academic year";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (y: AdminAcademicYear) => {
    setSelected(y);
    setEName(y.academic_year_name ?? "");
    setEStart((y.start_date || "").slice(0, 10));
    setEEnd((y.end_date || "").slice(0, 10));
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.updateAcademicYear(selected.academic_year_id, {
        academic_year_name: eName.trim(),
        start_date: eStart,
        end_date: eEnd,
      });
      setEditOpen(false);
      setSelected(null);
      toast.success("Academic year updated successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to update academic year";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (y: AdminAcademicYear) => {
    const ok = window.confirm(`Delete academic year "${y.academic_year_name}"?`);
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.deleteAcademicYear(y.academic_year_id);
      toast.success("Academic year deleted successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to delete academic year";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Academic Years</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Create, update, and delete academic years.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={busy}
            className="btn-secondary btn-md sm:w-auto w-full"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={openCreate} className="btn-primary btn-md">
            <Plus className="w-4 h-4" />
            New Year
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100/50 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by year name…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium"
            />
          </div>
          {error && <div className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{error}</div>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Start</th>
                <th className="px-6 py-4">End</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((y) => (
                <tr key={y.academic_year_id} className="hover:bg-blue-50 hover:shadow-md transition-colors">
                  <td className="px-6 py-4 font-semibold text-slate-800">{y.academic_year_name}</td>
                  <td className="px-6 py-4">{y.start_date ? y.start_date.slice(0, 10) : "-"}</td>
                  <td className="px-6 py-4">{y.end_date ? y.end_date.slice(0, 10) : "-"}</td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      {isAdmin && (
                        <button onClick={() => openEdit(y)} className="btn-secondary btn-sm !border-b-0">
                          <Pencil className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline ml-1">Edit</span>
                        </button>
                      )}
                      {isAdmin && (
                        <button onClick={() => doDelete(y)} className="btn-danger btn-sm">
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline ml-1">Delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-400 font-medium">
                    {busy ? "Loading…" : "No academic years found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal title="Create Academic Year" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Name</label>
            <input value={cName} onChange={(e) => setCName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="2025/2026" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start date</label>
            <input value={cStart} onChange={(e) => setCStart(e.target.value)} type="date" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">End date</label>
            <input value={cEnd} onChange={(e) => setCEnd(e.target.value)} type="date" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div className="sm:col-span-2 flex items-center justify-end pt-2">
            <button onClick={submitCreate} disabled={busy || !cName.trim() || !cStart || !cEnd} className="btn-primary btn-md">
              Create
            </button>
          </div>
        </div>
      </Modal>

      <Modal title={`Edit Academic Year${selected ? ` — ${selected.academic_year_name}` : ""}`} open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Name</label>
            <input value={eName} onChange={(e) => setEName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start date</label>
            <input value={eStart} onChange={(e) => setEStart(e.target.value)} type="date" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">End date</label>
            <input value={eEnd} onChange={(e) => setEEnd(e.target.value)} type="date" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button onClick={() => setEditOpen(false)} className="btn-secondary btn-md">
              Cancel
            </button>
            <button onClick={submitEdit} disabled={busy || !selected} className="btn-primary btn-md">
              Save changes
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

