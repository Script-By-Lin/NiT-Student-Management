"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AdminRoom, AdminService, RoomAvailability } from "@/services/admin.service";
import { Plus, Search, Trash2, Pencil, RefreshCw, X, Clock, AlertCircle } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
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
        <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
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

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export default function AdminRoomsPage() {
  const router = useRouter();
  const { isAdminOrSales, isAdminOrSalesOrManager, isAdmin, loading } = useAuth();

  const [rows, setRows] = useState<AdminRoom[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "free" | "full">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<AdminRoom | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<AdminRoom | null>(null);

  const [cName, setCName] = useState("");
  const [cCapacity, setCCapacity] = useState(30);
  const [cActive, setCActive] = useState(true);

  const [eName, setEName] = useState("");
  const [eCapacity, setECapacity] = useState(30);
  const [eActive, setEActive] = useState(true);

  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [availabilityDay, setAvailabilityDay] = useState<(typeof DAYS)[number]>("Monday");
  const [availability, setAvailability] = useState<RoomAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  useEffect(() => {
    if (!loading && !isAdminOrSalesOrManager) router.replace("/dashboard");
  }, [loading, isAdminOrSalesOrManager, router]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const matches =
        !term ||
        r.room_name.toLowerCase().includes(term) ||
        r.capacity.toString().includes(term) ||
        (r.current_load?.toString() || "").includes(term);
      const matchesStatus =
        status === "all" ? true : status === "full" ? !!r.is_full : status === "free" ? !r.is_full : true;
      return matches && matchesStatus;
    });
  }, [q, rows, status]);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setRows(await AdminService.listRooms());
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.response?.data?.message || "Failed to load rooms");
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
    setCCapacity(30);
    setCActive(true);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    setBusy(true);
    setError("");
    try {
      await AdminService.createRoom({ room_name: cName.trim(), capacity: cCapacity, is_active: cActive });
      setCreateOpen(false);
      toast.success("Room created successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to create room";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (r: AdminRoom) => {
    setSelected(r);
    setEName(r.room_name || "");
    setECapacity(r.capacity || 30);
    setEActive(!!r.is_active);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.updateRoom(selected.room_id, { room_name: eName.trim(), capacity: eCapacity, is_active: eActive });
      setEditOpen(false);
      setSelected(null);
      toast.success("Room updated successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to update room";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (r: AdminRoom) => {
    setRoomToDelete(r);
  };

  const executeDelete = async () => {
    if (!roomToDelete) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.deleteRoom(roomToDelete.room_id);
      toast.success("Room deleted successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to delete room";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
      setRoomToDelete(null);
    }
  };

  const openAvailability = async (r: AdminRoom) => {
    setSelected(r);
    setAvailability(null);
    setAvailabilityDay("Monday");
    setAvailabilityOpen(true);
    setAvailabilityLoading(true);
    try {
      setAvailability(await AdminService.getRoomAvailability(r.room_id, "Monday"));
    } catch {
      setAvailability(null);
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const refreshAvailability = async () => {
    if (!selected) return;
    setAvailabilityLoading(true);
    try {
      setAvailability(await AdminService.getRoomAvailability(selected.room_id, availabilityDay));
    } catch {
      setAvailability(null);
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rooms</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Filter free/full rooms and view free time slots.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Room
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100/50 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <div className="relative w-full sm:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name / capacity / load…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-semibold"
            >
              <option value="all">All</option>
              <option value="free">Free</option>
              <option value="full">Full</option>
            </select>
          </div>
          {error && <div className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{error}</div>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">Room</th>
                <th className="px-6 py-4">Capacity</th>
                <th className="px-6 py-4">Load</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((r) => (
                <tr key={r.room_id} className="hover:bg-blue-50 hover:shadow-md transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-800">{r.room_name}</td>
                  <td className="px-6 py-4">{r.capacity}</td>
                  <td className="px-6 py-4">{r.current_load ?? 0}</td>
                  <td className="px-6 py-4">
                    <span
                      className={[
                        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border",
                        r.is_full ? "bg-red-50 text-red-700 border-red-100" : "bg-emerald-50 text-emerald-700 border-emerald-100",
                      ].join(" ")}
                    >
                      {r.is_full ? "Full" : "Free"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openAvailability(r)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
                      >
                        <Clock className="w-4 h-4" />
                        Free time
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => openEdit(r)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => doDelete(r)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-red-200 text-red-600 font-semibold hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-400 font-medium">
                    {busy ? "Loading…" : "No rooms found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal title="Create Room" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Room name</label>
            <input value={cName} onChange={(e) => setCName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" placeholder="Room 6" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Capacity</label>
            <input value={cCapacity} onChange={(e) => setCCapacity(Number(e.target.value || 0))} type="number" min={1} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 pb-1">
              <input type="checkbox" checked={cActive} onChange={(e) => setCActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Active
            </label>
          </div>
          <div className="sm:col-span-2 flex items-center justify-end pt-2">
            <button onClick={submitCreate} disabled={busy || !cName.trim() || cCapacity < 1} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60">
              Create
            </button>
          </div>
        </div>
      </Modal>

      <Modal title={`Edit Room${selected ? ` — ${selected.room_name}` : ""}`} open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Room name</label>
            <input value={eName} onChange={(e) => setEName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Capacity</label>
            <input value={eCapacity} onChange={(e) => setECapacity(Number(e.target.value || 0))} type="number" min={1} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 pb-1">
              <input type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
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

      <Modal title={`Room free time${selected ? ` — ${selected.room_name}` : ""}`} open={availabilityOpen} onClose={() => setAvailabilityOpen(false)}>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <select value={availabilityDay} onChange={(e) => setAvailabilityDay(e.target.value as any)} className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-semibold">
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button onClick={refreshAvailability} disabled={!selected || availabilityLoading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw className={`w-4 h-4 ${availabilityLoading ? "animate-spin" : ""}`} />
              Check
            </button>
          </div>

          {availabilityLoading && <div className="text-sm font-semibold text-slate-500">Loading…</div>}

          {!availabilityLoading && availability && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-bold text-slate-800">Busy</div>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {availability.busy.length === 0 && <li className="text-slate-400">No busy slots</li>}
                  {availability.busy.map((b, i) => (
                    <li key={i} className="font-semibold">
                      {formatTime(b.start)} - {formatTime(b.end)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-sm font-bold text-slate-800">Free</div>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {availability.free.length === 0 && <li className="text-slate-400">No free slots</li>}
                  {availability.free.map((f, i) => (
                    <li key={i} className="font-semibold">
                      {formatTime(f.start)} - {formatTime(f.end)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {!availabilityLoading && !availability && <div className="text-sm font-semibold text-slate-500">No availability data.</div>}
        </div>
      </Modal>

      <ConfirmModal
        open={!!roomToDelete}
        onClose={() => setRoomToDelete(null)}
        onConfirm={executeDelete}
        title="Delete Room"
        message={`Are you sure you want to delete room "${roomToDelete?.room_name}"? This will affect all timetables and courses linked to this room.`}
        confirmText="Delete Room"
        variant="danger"
        isLoading={busy}
      />
    </div>
  );
}
