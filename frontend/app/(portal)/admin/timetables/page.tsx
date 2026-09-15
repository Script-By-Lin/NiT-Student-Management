"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AdminCourse, AdminRoom, AdminService, AdminTimeTableRow, AdminUser, TeachingHoursReport } from "@/services/admin.service";
import { Plus, Search, Trash2, Pencil, RefreshCw, X, Clock, GraduationCap, AlertCircle, Calendar } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import { TableBodySkeleton } from "@/components/ui/Skeleton";
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

function SortIcon({ active, order }: { active: boolean; order: "asc" | "desc" }) {
  if (!active) return (
    <div className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="translate-y-0.5"><path d="m7 15 5 5 5-5"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="-translate-y-0.5"><path d="m7 9 5-5 5 5"/></svg>
    </div>
  );
  return (
    <div className="w-3 h-3 text-brand-600 transition-transform flex items-center justify-center">
      {order === "asc" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      )}
    </div>
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  return new Date(dateStr);
}

function getDayDate(dayName: string, batchStartDateStr?: string | null, courseStartDateStr?: string | null) {
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const targetIndex = weekday.indexOf(dayName);
  if (targetIndex === -1) return null;

  const now = new Date();
  
  let startDate: Date | null = null;
  if (batchStartDateStr) {
    startDate = parseLocalDate(batchStartDateStr);
  } else if (courseStartDateStr) {
    startDate = parseLocalDate(courseStartDateStr);
  }

  if (startDate && !isNaN(startDate.getTime())) {
    const startDayIndex = startDate.getDay();
    let diff = targetIndex - startDayIndex;
    if (diff < 0) diff += 7;
    const firstOccurrence = new Date(startDate);
    firstOccurrence.setDate(startDate.getDate() + diff);

    const firstOccMidnight = new Date(firstOccurrence.getFullYear(), firstOccurrence.getMonth(), firstOccurrence.getDate());
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (firstOccMidnight > nowMidnight) {
      return firstOccurrence;
    }
  }

  const todayIndex = now.getDay();
  let diff = targetIndex - todayIndex;
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + diff);
  return targetDate;
}

const formatDate = (date: Date | null) => {
  if (!date) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); // e.g. 30 Mar
};

export default function AdminTimetablesPage() {
  const router = useRouter();
  const { isAdminOrSales, isAdminOrSalesOrManager, isAdmin, isStudentAffairs, loading } = useAuth();

  const [rows, setRows] = useState<AdminTimeTableRow[]>([]);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [teachingHours, setTeachingHours] = useState<TeachingHoursReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [selected, setSelected] = useState<AdminTimeTableRow | null>(null);
  const [quickSubjectOpen, setQuickSubjectOpen] = useState(false);
  const [newSubCode, setNewSubCode] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [ttToDelete, setTtToDelete] = useState<AdminTimeTableRow | null>(null);
  const [sortKey, setSortKey] = useState<keyof AdminTimeTableRow | "time">("day_of_week");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [cCourseCode, setCCourseCode] = useState("");
  const [cBatchNo, setCBatchNo] = useState("");
  const [cBatchId, setCBatchId] = useState<number | "">("");
  const [cTeacherCode, setCTeacherCode] = useState("");

  const [batches, setBatches] = useState<any[]>([]);
  const [cSlots, setCSlots] = useState<{ day_of_week: (typeof DAYS)[number]; start: string; end: string }[]>([
    { day_of_week: "Monday", start: "09:00", end: "10:00" }
  ]);
  const [cRoom, setCRoom] = useState<string>("");

  const [eDay, setEDay] = useState<(typeof DAYS)[number]>("Monday");
  const [eStart, setEStart] = useState("09:00");
  const [eEnd, setEEnd] = useState("10:00");
  const [eRoom, setERoom] = useState<string>("");
  const [eBatchNo, setEBatchNo] = useState("");
  const [eBatchId, setEBatchId] = useState<number | "">("");
  const [eTeacherCode, setETeacherCode] = useState("");

  const [eBatches, setEBatches] = useState<any[]>([]);
  const [cSubjectCode, setCSubjectCode] = useState("");
  const [eSubjectCode, setESubjectCode] = useState("");
  const [subjects, setSubjects] = useState<any[]>([]);
  const [eSubjects, setESubjects] = useState<any[]>([]);

  useEffect(() => {
    if (!loading && !isAdminOrSalesOrManager && !isStudentAffairs) router.replace("/dashboard");
  }, [loading, isAdminOrSalesOrManager, isStudentAffairs, router]);

  const filtered = useMemo(() => {
    let result = rows;
    const term = q.trim().toLowerCase();
    if (term) {
      result = result.filter((r) => {
        return (
          r.course_code.toLowerCase().includes(term) ||
          r.course_name.toLowerCase().includes(term) ||
          (r.batch_no || "").toLowerCase().includes(term) ||
          r.day_of_week.toLowerCase().includes(term) ||
          (r.room_name || "").toLowerCase().includes(term)
        );
      });
    }

    return [...result].sort((a, b) => {
      let valA: any = sortKey === "time" ? a.start_time : a[sortKey as keyof AdminTimeTableRow];
      let valB: any = sortKey === "time" ? b.start_time : b[sortKey as keyof AdminTimeTableRow];

      if (sortKey === "day_of_week") {
        valA = DAYS.indexOf(a.day_of_week as any);
        valB = DAYS.indexOf(b.day_of_week as any);
      }

      // Special case for day_of_week to sort numerically
      if (sortKey === "day_of_week") {
        if (valA !== valB) return sortOrder === "asc" ? valA - valB : valB - valA;
        // Tie breaker: sort by time
        return a.start_time.localeCompare(b.start_time);
      }

      // For others, use localeCompare for strings
      const strA = (valA ?? "").toString();
      const strB = (valB ?? "").toString();
      
      const cmp = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return sortOrder === "asc" ? cmp : -cmp;

      // Tie breaker by day then time
      const dayA = DAYS.indexOf(a.day_of_week as any);
      const dayB = DAYS.indexOf(b.day_of_week as any);
      if (dayA !== dayB) return dayA - dayB;
      return a.start_time.localeCompare(b.start_time);
    });
  }, [q, rows, sortKey, sortOrder]);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const [tt, cs, rs, ts] = await Promise.all([
        AdminService.listTimetables(),
        AdminService.listCourses(1, 1000),
        AdminService.listRooms(),
        AdminService.listTeachers(1, 1000)
      ]);
      setRows(tt);
      setCourses(cs.data || []);
      setRooms(rs);
      setTeachers(ts.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.response?.data?.message || "Failed to load timetable");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isAdminOrSalesOrManager || isStudentAffairs) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrSalesOrManager, isStudentAffairs]);

  useEffect(() => {
    if (cCourseCode) {
      const c = courses.find((x) => x.course_code === cCourseCode);
      if (c) {
        Promise.all([
          AdminService.listBatches(c.course_id),
          AdminService.listSubjects(c.course_id)
        ]).then(([bRes, sRes]) => {
          setBatches(bRes.data);
          setSubjects(sRes.data);
        });
      } else {
        setBatches([]);
        setSubjects([]);
      }
      setCBatchNo("");
      setCBatchId("");
      setCSubjectCode("");
    }

  }, [cCourseCode, courses]);

  useEffect(() => {
    if (quickSubjectOpen && cCourseCode) {
      if (subjects.length > 0) {
        let maxNum = 0;
        const prefix = `${cCourseCode}-`;
        subjects.forEach(s => {
          if (s.subject_code && s.subject_code.startsWith(prefix)) {
            const numPart = s.subject_code.slice(prefix.length);
            const num = parseInt(numPart);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });
        if (maxNum > 0) {
          setNewSubCode(`${cCourseCode}-${maxNum + 1}`);
        } else {
          setNewSubCode(`${cCourseCode}-101`);
        }
      } else {
        setNewSubCode(`${cCourseCode}-101`);
      }
    }
  }, [quickSubjectOpen, cCourseCode, subjects]);

  if (loading) return null;
  if (!isAdminOrSalesOrManager && !isStudentAffairs) return null;

  const openCreate = () => {
    const firstCourse = courses[0];
    setCCourseCode(firstCourse?.course_code ?? "");
    setCBatchNo("");
    setCBatchId("");
    setCSubjectCode("");
    setCTeacherCode("");
    setCSlots([{ day_of_week: "Monday", start: "09:00", end: "10:00" }]);
    setCRoom(rooms[0]?.room_name ?? "");
    setCreateOpen(true);

  };

  const openReport = async () => {
    setBusy(true);
    try {
      const data = await AdminService.getTeachingHoursReport();
      setTeachingHours(data);
      setReportOpen(true);
    } catch (e: any) {
      setError("Failed to load teaching hours report");
    } finally {
      setBusy(false);
    }
  };

  const submitQuickSubject = async () => {
    if (!cCourseCode || !newSubCode || !newSubName) return;
    const c = courses.find(x => x.course_code === cCourseCode);
    if (!c) return;
    setBusy(true);
    try {
      await AdminService.createSubject({
        subject_code: newSubCode,
        subject_name: newSubName,
        course_id: c.course_id
      });
      const updatedSubs = await AdminService.listSubjects(c.course_id);
      setSubjects(updatedSubs.data);
      setCSubjectCode(newSubCode);
      setQuickSubjectOpen(false);
      setNewSubCode("");
      setNewSubName("");
    } catch (e: any) {
      setError("Failed to add subject");
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    setBusy(true);
    setError("");
    try {
      await Promise.all(
        cSlots.map(slot =>
          AdminService.createTimetable({
            course_code: cCourseCode,
            batch_id: cBatchId !== "" ? Number(cBatchId) : null,
            batch_no: cBatchNo || null,
            subject_code: cSubjectCode || null,
            teacher_code: cTeacherCode || null,

            day_of_week: slot.day_of_week,
            start_time: slot.start,
            end_time: slot.end,
            room_name: cRoom || null,
          })
        )
      );
      setCreateOpen(false);
      toast.success("Timetable slot(s) created successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to create timetable";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (r: AdminTimeTableRow) => {
    setSelected(r);
    setEDay(r.day_of_week as any);
    setEStart(r.start_time);
    setEEnd(r.end_time);
    setERoom(r.room_name || "");
    setEBatchId(r.batch_id || "");
    setEBatchNo(r.batch_no || "");
    setESubjectCode(r.subject_code || "");
    setETeacherCode(r.teacher_code || "");

    AdminService.listBatches(r.course_id).then((res) => setEBatches(res.data));
    AdminService.listSubjects(r.course_id).then((res) => setESubjects(res.data));

    setEditOpen(true);

  };

  const submitEdit = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.updateTimetable(selected.timetable_id, {
        day_of_week: eDay,
        start_time: eStart,
        end_time: eEnd,
        room_name: eRoom || null,
        batch_id: eBatchId !== "" ? Number(eBatchId) : null,
        batch_no: eBatchNo || null,
        subject_code: eSubjectCode || null,
        teacher_code: eTeacherCode || null,

      });
      setEditOpen(false);
      setSelected(null);
      toast.success("Timetable slot updated successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to update timetable";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (r: AdminTimeTableRow) => {
    setTtToDelete(r);
  };

  const executeDelete = async () => {
    if (!ttToDelete) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.deleteTimetable(ttToDelete.timetable_id);
      toast.success("Timetable slot deleted successfully");
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || "Failed to delete timetable";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
      setTtToDelete(null);
    }
  };

  const format24h = (timeStr: string) => {
    if (!timeStr) return "";
    const parts = timeStr.split(":");
    const h = parts[0];
    const m = parts[1] || "00";
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Timetable</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Create weekly classes per course with times and room.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {/* <button onClick={openReport} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200">
            <Clock className="w-4 h-4" />
            Hours Report
          </button> */}
          <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-sm">
            <Plus className="w-4 h-4" />
            New Slot
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100/50 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search course/day/room…" className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium" />
          </div>
          {error && <div className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{error}</div>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-100">
              <tr>
                <th 
                  className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                  onClick={() => {
                    if (sortKey === "course_name") setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    else { setSortKey("course_name"); setSortOrder("asc"); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    Course
                    <SortIcon active={sortKey === "course_name"} order={sortOrder} />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                  onClick={() => {
                    if (sortKey === "batch_no") setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    else { setSortKey("batch_no"); setSortOrder("asc"); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    Batch
                    <SortIcon active={sortKey === "batch_no"} order={sortOrder} />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                  onClick={() => {
                    if (sortKey === "day_of_week") setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    else { setSortKey("day_of_week"); setSortOrder("asc"); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    Day
                    <SortIcon active={sortKey === "day_of_week"} order={sortOrder} />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                  onClick={() => {
                    if (sortKey === "time") setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    else { setSortKey("time"); setSortOrder("asc"); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    Time
                    <SortIcon active={sortKey === "time"} order={sortOrder} />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                  onClick={() => {
                    if (sortKey === "room_name") setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    else { setSortKey("room_name"); setSortOrder("asc"); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    Room
                    <SortIcon active={sortKey === "room_name"} order={sortOrder} />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group"
                  onClick={() => {
                    if (sortKey === "teacher_name") setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    else { setSortKey("teacher_name"); setSortOrder("asc"); }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    Teacher
                    <SortIcon active={sortKey === "teacher_name"} order={sortOrder} />
                  </div>
                </th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {busy ? (
                <TableBodySkeleton columns={7} />
              ) : (
                <>
                  {filtered.map((r) => (
                    <tr key={r.timetable_id} className="hover:bg-blue-50 hover:shadow-md transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-800">{r.course_name}</div>
                        <div className="text-xs text-brand-600 font-bold uppercase tracking-tight">{r.course_code}</div>
                        {r.subject_name && (
                          <div className="flex flex-col gap-0.5 mt-1 items-start">
                            <span className="text-[10px] font-black text-blue-600 border border-blue-100 bg-blue-50 px-1.5 py-0.5 rounded">
                              {r.subject_name}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 px-0.5">Default subject (overrideable)</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-700">{r.batch_no || "-"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-slate-900">{r.day_of_week}</span>
                          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-black text-slate-500 w-fit">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {formatDate(getDayDate(r.day_of_week, r.batch_start_date, r.course_start_date))}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold">{format24h(r.start_time)} - {format24h(r.end_time)}</td>
                      <td className="px-6 py-4">{r.room_name || "-"}</td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-700">{r.teacher_name || "-"}</div>
                        <div className="text-[10px] text-slate-400">{r.teacher_code || ""}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          {isAdmin && (
                            <button onClick={() => openEdit(r)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50">
                              <Pencil className="w-4 h-4" />
                              Edit
                            </button>
                          )}
                          {isAdmin && (
                            <button onClick={() => doDelete(r)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-red-200 text-red-600 font-semibold hover:bg-red-50">
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
                      <td colSpan={7} className="px-6 py-10 text-center text-slate-400 font-medium">
                        No timetable slots found.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal title="Create Timetable Slot" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Course</label>
            <select value={cCourseCode} onChange={(e) => setCCourseCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              {courses.map((c) => (
                <option key={c.course_code} value={c.course_code}>
                  {c.course_name} ({c.course_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Batch (Optional)</label>
            <select 
              value={cBatchId} 
              onChange={(e) => {
                const val = e.target.value;
                setCBatchId(val ? Number(val) : "");
                const b = batches.find(x => x.batch_id === Number(val));
                setCBatchNo(b?.batch_no || "");
              }} 
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            >
              <option value="">(no batch)</option>
              {batches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_no}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject (Optional)</label>
              <select value={cSubjectCode} onChange={(e) => setCSubjectCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <option value="">(no subject)</option>
                {subjects.map((s) => (
                  <option key={s.subject_id} value={s.subject_code}>
                    {s.subject_name} ({s.subject_code})
                  </option>
                ))}
              </select>
            </div>
            {cCourseCode && (
              <button
                type="button"
                onClick={() => setQuickSubjectOpen(true)}
                className="p-2.5 mb-0.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition-all font-bold text-xs flex items-center gap-1"
                title="Quick Add Subject"
              >
                <Plus className="w-4 h-4" />
                New
              </button>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Teacher (Optional)</label>
            <select value={cTeacherCode} onChange={(e) => setCTeacherCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
              <option value="">(no teacher)</option>
              {teachers.map((t) => (
                <option key={t.user_id} value={t.user_code}>
                  {t.username} ({t.user_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Room</label>
            <select value={cRoom} onChange={(e) => setCRoom(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <option value="">(no room)</option>
              {rooms.map((r) => (
                <option key={r.room_id} value={r.room_name}>
                  {r.room_name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 space-y-3">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Day and Time Slots</label>
            <div className="space-y-2">
              {cSlots.map((slot, i) => (
                <div key={i} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 relative">
                  <div className="w-full sm:w-auto flex-1">
                    <select
                      value={slot.day_of_week}
                      onChange={(e) => setCSlots(cSlots.map((s, idx) => idx === i ? { ...s, day_of_week: e.target.value as any } : s))}
                      className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold focus:outline-none"
                    >
                      {DAYS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      value={slot.start}
                      onChange={(e) => setCSlots(cSlots.map((s, idx) => idx === i ? { ...s, start: e.target.value } : s))}
                      type="time"
                      className="w-full sm:w-28 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-xs focus:outline-none"
                    />
                    <span className="text-slate-400 text-xs font-bold">to</span>
                    <input
                      value={slot.end}
                      onChange={(e) => setCSlots(cSlots.map((s, idx) => idx === i ? { ...s, end: e.target.value } : s))}
                      type="time"
                      className="w-full sm:w-28 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-xs focus:outline-none"
                    />
                  </div>
                  {cSlots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setCSlots(cSlots.filter((_, idx) => idx !== i))}
                      className="absolute top-2 right-2 sm:static p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCSlots([...cSlots, { day_of_week: cSlots[cSlots.length - 1]?.day_of_week || "Monday", start: "09:00", end: "10:00" }])}
              className="text-sm font-bold text-brand-600 hover:text-brand-700 transition-colors"
            >
              + Add another day/time slot
            </button>
          </div>
          <div className="sm:col-span-2 flex items-center justify-end pt-2">
            <button onClick={submitCreate} disabled={busy || !cCourseCode || cSlots.some(s => !s.start || !s.end)} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60">
              Create
            </button>
          </div>
        </div>
      </Modal>

      <Modal title="Edit Timetable Slot" open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 text-sm font-semibold text-slate-700">
            {selected ? `${selected.course_name} (${selected.course_code})` : ""}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Day</label>
            <select value={eDay} onChange={(e) => setEDay(e.target.value as any)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Room</label>
            <select value={eRoom} onChange={(e) => setERoom(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <option value="">(no room)</option>
              {rooms.map((r) => (
                <option key={r.room_id} value={r.room_name}>
                  {r.room_name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Batch (Optional)</label>
            <select 
              value={eBatchId} 
              onChange={(e) => {
                const val = e.target.value;
                setEBatchId(val ? Number(val) : "");
                const b = eBatches.find(x => x.batch_id === Number(val));
                setEBatchNo(b?.batch_no || "");
              }} 
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            >
              <option value="">(no batch)</option>
              {eBatches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_no}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject (Optional)</label>
            <select value={eSubjectCode} onChange={(e) => setESubjectCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <option value="">(no subject)</option>
              {eSubjects.map((s) => (
                <option key={s.subject_id} value={s.subject_code}>
                  {s.subject_name} ({s.subject_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Teacher (Optional)</label>
            <select value={eTeacherCode} onChange={(e) => setETeacherCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
              <option value="">(no teacher)</option>
              {teachers.map((t) => (
                <option key={t.user_id} value={t.user_code}>
                  {t.username} ({t.user_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start</label>
            <input value={eStart} onChange={(e) => setEStart(e.target.value)} type="time" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">End</label>
            <input value={eEnd} onChange={(e) => setEEnd(e.target.value)} type="time" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200" />
          </div>
          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button onClick={() => setEditOpen(false)} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={submitEdit} disabled={busy || !selected} className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60">
              Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal title="Teaching Hours Report" open={reportOpen} onClose={() => setReportOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500 mb-4">Total teaching hours calculated from current timetable assignments.</p>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Assigned Courses</th>
                  <th className="px-4 py-3 text-right">Total Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teachingHours.map((h) => (
                  <tr key={h.teacher_code} className="hover:bg-blue-50 hover:shadow-md">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{h.teacher_name}</div>
                      <div className="text-xs text-slate-500">{h.teacher_code}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {h.courses.join(", ") || "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-brand-600">
                      {h.total_hours} hrs
                    </td>
                  </tr>
                ))}
                {teachingHours.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-slate-400">No data available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={() => setReportOpen(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200">
              Close
            </button>
          </div>
        </div>
      </Modal>

      <Modal title="Quick Add Subject" open={quickSubjectOpen} onClose={() => setQuickSubjectOpen(false)}>
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <div className="text-[10px] font-bold text-blue-600 uppercase mb-1">Target Course</div>
            <div className="text-sm font-bold text-slate-900">{courses.find(x => x.course_code === cCourseCode)?.course_name} ({cCourseCode})</div>
            <div className="text-[10px] text-slate-500">ID: {courses.find(x => x.course_code === cCourseCode)?.course_id}</div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject Code</label>
            <input
              value={newSubCode}
              onChange={(e) => setNewSubCode(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
              placeholder="e.g. NET-101"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject Name</label>
            <input
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
              placeholder="e.g. Networking Fundamentals"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setQuickSubjectOpen(false)} className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={submitQuickSubject} disabled={busy || !newSubCode || !newSubName} className="px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60">
              Add Subject
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!ttToDelete}
        onClose={() => setTtToDelete(null)}
        onConfirm={executeDelete}
        title="Delete Timetable Slot"
        message={`Are you sure you want to delete the timetable for ${ttToDelete?.course_code} on ${ttToDelete?.day_of_week} at ${ttToDelete?.start_time}-${ttToDelete?.end_time}?`}
        confirmText="Delete Slot"
        variant="danger"
        isLoading={busy}
      />
    </div>
  );
}
