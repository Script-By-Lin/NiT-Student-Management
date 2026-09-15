"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AdminService, AdminStudent, AdminStudentRelations, AdminCourse } from "@/services/admin.service";
import { useAuth } from "@/hooks/useAuth";

import { Plus, Search, Trash2, Pencil, RefreshCw, X, Download, Check, AlertCircle, ShieldCheck, Mail, Calendar, Key, UserPlus, CalendarClock, CreditCard, Users, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import clsx from "clsx";
import * as XLSX from "xlsx";
import { useStudents, useCourses, useCreateStudent, useDeleteUser, useUpdateUser, useApproveStudent, useCreateEnrollment, useBatches } from "@/hooks/useAdmin";
import { formatAmount, parseExtraItems } from "@/utils/format";
import ConfirmModal from "@/components/ConfirmModal";
import { toast } from "sonner";
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
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-50 text-slate-500"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 overflow-y-auto custom-scrollbar">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Initialize canvas only once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0d4d4d"; // Brand color
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Adjust canvas resolution for crisp rendering
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
  }, []);

  // Clear canvas when value is reset externally
  useEffect(() => {
    if (!value) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [value]);

  const getCoordinates = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: any) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e: any) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <div className="space-y-3">
      <div className="relative border-2 border-dashed border-slate-200 rounded-3xl overflow-hidden bg-slate-50 h-52 group hover:border-[#0d4d4d]/30 transition-all">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-full cursor-crosshair touch-none"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute top-4 right-4 px-4 py-2 bg-white text-xs font-bold border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 hover:text-slate-950 transition-all shadow-sm active:scale-[0.98]"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 text-center font-medium">Draw your signature inside the box above. Touchscreen and mouse drawing are supported.</p>
    </div>
  );
}

export default function AdminStudentsPage() {
  const router = useRouter();
  const { isAdminOrSales, isAdminOrSalesOrAccountant, isAdminOrSalesOrAccountantOrManager, isAdmin, user, loading: authLoading } = useAuth();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Form states moved up to avoid ReferenceError
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<keyof AdminStudent | "">("user_code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selected, setSelected] = useState<AdminStudent | null>(null);
  const [relations, setRelations] = useState<AdminStudentRelations | null>(null);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveManualCode, setApproveManualCode] = useState("");
  const [approvePrefix, setApprovePrefix] = useState<"CO" | "IN" | "">("");

  // Create form
  const [cUserCode, setCUserCode] = useState("");
  const [cUsername, setCUsername] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cDob, setCDob] = useState<string>("");
  const [cActive, setCActive] = useState(true);
  const [cDepartment, setCDepartment] = useState("College");
  const [cStudentType, setCStudentType] = useState("New Student");
  const [cHowDidYouHear, setCHowDidYouHear] = useState<string[]>([]);
  const [cOtherHear, setCOtherHear] = useState("");

  // Additional Contact Info
  const [cNrc, setCNrc] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cParentName, setCParentName] = useState("");
  const [cParentPhone, setCParentPhone] = useState("");
  const [cAddress, setCAddress] = useState("");
  const [cProfilePicture, setCProfilePicture] = useState("");

  // Enrollment form integration
  const [cCategory, setCCategory] = useState("");
  const [cCourseCode, setCCourseCode] = useState("");
  const [cBatchNo, setCBatchNo] = useState("");
  const [cPaymentPlan, setCPaymentPlan] = useState("");
  const [cDownpayment, setCDownpayment] = useState<number | "">(0);
  const [cInstallment, setCInstallment] = useState<number | "">(0);
  const [cTotalFee, setCTotalFee] = useState<number | "">("");
  const [cExamFeeGbp, setCExamFeeGbp] = useState<number | "">("");
  const [cBatchId, setCBatchId] = useState<number | "" | "manual">("");

  // Formalize enrollment state
  const [formalizeOpen, setFormalizeOpen] = useState(false);
  const [fCategory, setFCategory] = useState("");
  const [fCourseCode, setFCourseCode] = useState("");
  const [fUserCode, setFUserCode] = useState("");
  const [fBatchNo, setFBatchNo] = useState("");
  const [fPlan, setFPlan] = useState("");
  const [fDown, setFDown] = useState<number | "">("");
  const [fInst, setFInst] = useState<number | "">("");
  const [fTotalFee, setFTotalFee] = useState<number | "">("");
  const [fExamFeeGbp, setFExamFeeGbp] = useState<number | "">("");
  const [fBatchId, setFBatchId] = useState<number | "" | "manual">("");

  // Edit form
  const [eUserCode, setEUserCode] = useState("");
  const [eUsername, setEUsername] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eDob, setEDob] = useState<string>("");
  const [eActive, setEActive] = useState(true);
  const [ePhone, setEPhone] = useState("");
  const [eNrc, setENrc] = useState("");
  const [eGender, setEGender] = useState("");
  const [eAddress, setEAddress] = useState("");
  const [eParentName, setEParentName] = useState("");
  const [eParentPhone, setEParentPhone] = useState("");
  const [eHowDidYouHear, setEHowDidYouHear] = useState("");
  const [eStudentType, setEStudentType] = useState("");
  const [eIntendedCourse, setEIntendedCourse] = useState("");
  const [eSignature, setESignature] = useState("");

  // Enrollment edit state
  const [enrollToEdit, setEnrollToEdit] = useState<any | null>(null);
  const [enrollEditOpen, setEnrollEditOpen] = useState(false);
  const [eBatch, setEBatch] = useState("");
  const [ePlan, setEPlan] = useState("");
  const [eDown, setEDown] = useState("");
  const [eInst, setEInst] = useState("");
  const [eTotalFee, setETotalFee] = useState("");
  const [eExamFeeGbp, setEExamFeeGbp] = useState("");

  const [studentToDelete, setStudentToDelete] = useState<AdminStudent | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);

  // Queries and Mutations
  const { data: studentResponse, isLoading: studentsLoading, refetch: refetchStudents } = useStudents(page, limit);
  const { data: coursesResponse, isLoading: coursesLoading } = useCourses(1, 1000); // Fetch all for dropdowns
  const courses = coursesResponse?.data || [];
  const categories = useMemo(() => {
    const cats = new Set<string>();
    courses.forEach((c: AdminCourse) => {
      if (c.category) cats.add(c.category);
    });
    return Array.from(cats).sort();
  }, [courses]);

  const filteredCourses_C = useMemo(() => {
    return courses.filter((c: AdminCourse) => !cCategory || c.category === cCategory);
  }, [courses, cCategory]);

  const filteredCourses_F = useMemo(() => {
    return courses.filter((c: AdminCourse) => !fCategory || c.category === fCategory);
  }, [courses, fCategory]);

  const cSelectedCourseId = courses.find(c => c.course_code === cCourseCode)?.course_id;
  const { data: cBatchesResponse, isLoading: cBatchesLoading } = useBatches(cSelectedCourseId);
  const cBatches = cBatchesResponse?.data || [];

  const fSelectedCourseId = courses.find(c => c.course_code === fCourseCode)?.course_id;
  const { data: fBatchesResponse, isLoading: fBatchesLoading } = useBatches(fSelectedCourseId);
  const fBatches = fBatchesResponse?.data || [];

  const createMutation = useCreateStudent();
  const deleteMutation = useDeleteUser();
  const updateMutation = useUpdateUser();
  const approveMutation = useApproveStudent();
  const fastEnrollMutation = useCreateEnrollment();

  const rows = studentResponse?.data || [];
  const pagination = studentResponse?.pagination;

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error]);

  const handleError = (e: any, fallback: string) => {
    const d = e?.response?.data?.detail;
    if (Array.isArray(d)) setError(d.map((x: any) => x.msg).join(", "));
    else if (typeof d === "string") setError(d);
    else setError(e?.response?.data?.message || e.message || fallback);
  };

  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCProfilePicture(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!authLoading && !isAdminOrSalesOrAccountantOrManager) router.replace("/dashboard");
  }, [authLoading, isAdminOrSalesOrAccountantOrManager, router]);

  const filtered = useMemo(() => {
    let result = [...rows];
    const term = q.trim().toLowerCase();
    
    if (term) {
      result = result.filter((s: AdminStudent) => {
        return (
          (s.user_code || "").toLowerCase().includes(term) ||
          (s.username || "").toLowerCase().includes(term) ||
          (s.email || "").toLowerCase().includes(term)
        );
      });
    }

    if (sortKey) {
      result.sort((a: any, b: any) => {
        const valA = a[sortKey] || "";
        const valB = b[sortKey] || "";
        
        if (valA < valB) return sortOrder === "asc" ? -1 : 1;
        if (valA > valB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [q, rows, sortKey, sortOrder]);

  const requestSort = (key: keyof AdminStudent) => {
    let order: "asc" | "desc" = "asc";
    if (sortKey === key && sortOrder === "asc") {
      order = "desc";
    }
    setSortKey(key);
    setSortOrder(order);
  };

  const load = async () => {
    await refetchStudents();
  };

  const combinedLoading = authLoading || studentsLoading || coursesLoading || busy || createMutation.isPending || deleteMutation.isPending || updateMutation.isPending;

  const openCreate = () => {
    setCUserCode("");
    setCUsername("");
    setCEmail("");
    setCPassword("");
    setCDob("");
    setCActive(true);
    setCDepartment("College");
    setCStudentType("New Student");
    setCHowDidYouHear([]);
    setCOtherHear("");
    setCNrc("");
    setCPhone("");
    setCParentName("");
    setCParentPhone("");
    setCAddress("");
    setCProfilePicture("");
    setCCategory("");
    setCCourseCode("");
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
    setError("");
    if (!cUsername.trim()) { setError("Full name is required"); return; }
    if (!cDob) { setError("Date of Birth is required"); return; }
    try {
      await createMutation.mutateAsync({
        user_code: cUserCode.trim() || undefined,
        username: cUsername.trim(),
        email: cEmail.trim() || undefined,
        password: cPassword,
        date_of_birth: cDob || undefined,
        is_active: cActive,
        department: cDepartment,
        student_type: cStudentType,
        how_did_you_hear: [
          ...cHowDidYouHear.filter((item) => item !== "Other (Please Specify)"),
          ...(cHowDidYouHear.includes("Other (Please Specify)") && cOtherHear ? [`Other: ${cOtherHear}`] : [])
        ].join(", ") || null,
        nrc: cNrc.trim() || null,
        phone: cPhone.trim() || null,
        parent_name: cParentName.trim() || null,
        parent_phone: cParentPhone.trim() || null,
        address: cAddress.trim() || null,
        profile_picture: cProfilePicture || null,
        course_code: cCourseCode || null,
        batch_no: cBatchNo || null,
        batch_id: Number(cBatchId) || null,
        payment_plan: cPaymentPlan || null,
        downpayment: cDownpayment !== "" ? Number(cDownpayment) : null,
        installment_amount: cInstallment !== "" ? Number(cInstallment) : null,
        total_fee: cTotalFee !== "" ? Number(cTotalFee) : null,
        exam_fee_gbp: cExamFeeGbp !== "" ? Number(cExamFeeGbp) : null,
      });
      setCreateOpen(false);
      toast.success("Student created successfully");
    } catch (e: any) {
      handleError(e, "Failed to create student");
    }
  };

  const openView = (s: AdminStudent) => {
    setSelected(s);
    setRelations(null);
    setRelationsLoading(true);
    setViewOpen(true);

    AdminService.getStudentRelations(s.user_code)
      .then(data => {
        setRelations(data);
        if (data.student) setSelected(data.student);
      })
      .catch(() => setRelations(null))
      .finally(() => setRelationsLoading(false));
  };

  const openEdit = (s: AdminStudent) => {
    setSelected(s);
    setEUserCode(s.user_code || "");
    setEUsername(s.username || "");
    setEEmail(s.email || "");
    setEDob(s.data_of_birth ? s.data_of_birth.slice(0, 10) : "");
    setEActive(!!s.is_active);
    setEPhone(s.phone || "");
    setENrc(s.nrc || "");
    setEGender(s.gender || "");
    setEAddress(s.address || "");
    setEParentName(s.parent_name || "");
    setEParentPhone(s.parent_phone || "");
    setEHowDidYouHear(s.how_did_you_hear || "");
    setEStudentType(s.student_type || "");
    setEIntendedCourse(s.intended_course_code || "");
    setESignature((s as any).signature || "");
    setRelations(null);
    setRelationsLoading(true);
    setEditOpen(true);

    AdminService.getStudentRelations(s.user_code)
      .then(data => {
        setRelations(data);
        if (data.student) {
          setSelected(data.student);
          setEUserCode(data.student.user_code || "");
          setEUsername(data.student.username || "");
          setEEmail(data.student.email || "");
          setEDob(data.student.data_of_birth ? data.student.data_of_birth.slice(0, 10) : "");
          setEActive(!!data.student.is_active);
          setEPhone(data.student.phone || "");
          setENrc(data.student.nrc || "");
          setEGender(data.student.gender || "");
          setEAddress(data.student.address || "");
          setEParentName(data.student.parent_name || "");
          setEParentPhone(data.student.parent_phone || "");
          setEHowDidYouHear(data.student.how_did_you_hear || "");
          setEStudentType(data.student.student_type || "");
          setEIntendedCourse(data.student.intended_course_code || "");
          setESignature(data.student.signature || "");
        }
      })
      .catch(() => setRelations(null))
      .finally(() => setRelationsLoading(false));
  };

  const submitEdit = async () => {
    if (!selected) return;
    setError("");
    if (!eUsername.trim()) { setError("Full name is required"); return; }
    if (!eDob) { setError("Date of Birth is required"); return; }
    try {
      const payload: any = {};
      if (eUserCode.trim() !== (selected.user_code || "")) payload.user_code = eUserCode.trim() || undefined;
      if (eUsername.trim() !== (selected.username || "")) payload.username = eUsername.trim();
      if (eEmail.trim() !== (selected.email || "")) payload.email = eEmail.trim();
      
      const originalDob = selected.data_of_birth ? selected.data_of_birth.slice(0, 10) : "";
      if (eDob !== originalDob) payload.date_of_birth = eDob ? eDob : null;
      
      if (eActive !== !!selected.is_active) payload.is_active = eActive;
      if (ePhone.trim() !== (selected.phone || "")) payload.phone = ePhone.trim() || null;
      if (eNrc.trim() !== (selected.nrc || "")) payload.nrc = eNrc.trim() || null;
      if (eGender !== (selected.gender || "")) payload.gender = eGender || null;
      if (eAddress.trim() !== (selected.address || "")) payload.address = eAddress.trim() || null;
      if (eParentName.trim() !== (selected.parent_name || "")) payload.parent_name = eParentName.trim() || null;
      if (eParentPhone.trim() !== (selected.parent_phone || "")) payload.parent_phone = eParentPhone.trim() || null;
      if (eHowDidYouHear !== (selected.how_did_you_hear || "")) payload.how_did_you_hear = eHowDidYouHear || null;
      if (eStudentType !== (selected.student_type || "")) payload.student_type = eStudentType || null;
      if (eIntendedCourse !== (selected.intended_course_code || "")) payload.intended_course_code = eIntendedCourse || null;
      if (eSignature !== (selected.signature || "")) payload.signature = eSignature || null;

      await updateMutation.mutateAsync({
        code: selected.user_code,
        payload
      });
      setEditOpen(false);
      setSelected(null);
      toast.success("Student updated successfully");
    } catch (e: any) {
      handleError(e, "Failed to update student");
    }
  };

  const doDelete = async (s: AdminStudent) => {
    setStudentToDelete(s);
  };

  const executeDelete = async () => {
    if (!studentToDelete) return;
    setError("");
    try {
      await deleteMutation.mutateAsync(studentToDelete.user_code);
      toast.success("Student deleted successfully");
    } catch (e: any) {
      handleError(e, "Failed to delete student");
    } finally {
      setStudentToDelete(null);
    }
  };

  const openEnrollEdit = (enr: any) => {
    setEnrollToEdit(enr);
    setEBatch(enr.batch_no || "");
    setEPlan(enr.payment_plan || "");
    setEDown(enr.downpayment ? String(enr.downpayment) : "");
    setEInst(enr.installment_amount ? String(enr.installment_amount) : "");
    setETotalFee(enr.total_fee ? String(enr.total_fee) : "");
    setEExamFeeGbp(enr.exam_fee_gbp ? String(enr.exam_fee_gbp) : "");
    setEnrollEditOpen(true);
  };

  const submitEnrollEdit = async () => {
    if (!enrollToEdit || !selected) return;
    setBusy(true);
    setError("");
    try {
      await AdminService.updateEnrollment(enrollToEdit.enrollment_code, {
        batch_no: eBatch.trim() || null,
        payment_plan: ePlan || null,
        downpayment: eDown !== "" ? Number(eDown) : null,
        installment_amount: eInst !== "" ? Number(eInst) : null,
        total_fee: eTotalFee !== "" ? Number(eTotalFee) : null,
        exam_fee_gbp: eExamFeeGbp !== "" ? Number(eExamFeeGbp) : null,
      });

      // Refresh relations
      const updated = await AdminService.getStudentRelations(selected.user_code);
      setRelations(updated);
      setEnrollEditOpen(false);
      toast.success("Enrollment updated successfully");
    } catch (e: any) {
      handleError(e, "Failed to update enrollment");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = (s: AdminStudent) => {
    setSelected(s);
    setApproveManualCode(s.user_code || "");
    setApprovePrefix("");
    setApproveOpen(true);
  };

  const submitApprove = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await approveMutation.mutateAsync({
        id: selected.user_id,
        payload: {
          user_code: approvePrefix === "" ? approveManualCode : undefined,
          auto_prefix: approvePrefix !== "" ? approvePrefix : undefined,
        }
      });
      setApproveOpen(false);
      toast.success("Student approved successfully");
      await load();
    } catch (e: any) {
      handleError(e, "Failed to approve student");
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (s: AdminStudent) => {
    setBusy(true);
    setError("");
    try {
      await updateMutation.mutateAsync({
        code: s.user_code,
        payload: { is_active: !s.is_active }
      });
      toast.success(`Student ${s.is_active ? 'deactivated' : 'activated'} successfully`);
      await load();
    } catch (e: any) {
      handleError(e, "Failed to toggle student status");
    } finally {
      setBusy(false);
    }
  };

  const handleFastEnroll = (uCode: string, cCode: string) => {
    setFUserCode(uCode);
    setFCourseCode(cCode);

    // Auto-select category if course is found
    if (cCode) {
      const course = courses.find(c => c.course_code === cCode);
      if (course && course.category) {
        setFCategory(course.category);
      } else {
        setFCategory("");
      }
    } else {
      setFCategory("");
    }

    setFBatchNo("");
    setFBatchId("");
    setFPlan("");
    setFDown("");
    setFInst("");
    setFTotalFee("");
    setFExamFeeGbp("");
    setError("");
    setBusy(false);
    setFormalizeOpen(true);
  };

  const submitFormalize = async () => {
    setBusy(true);
    setError("");
    try {
      await fastEnrollMutation.mutateAsync({
        student_code: fUserCode,
        course_code: fCourseCode,
        batch_no: fBatchNo || undefined,
        batch_id: Number(fBatchId) || undefined,
        payment_plan: fPlan || undefined,
        downpayment: fDown !== "" ? Number(fDown) : undefined,
        installment_amount: fInst !== "" ? Number(fInst) : undefined,
        total_fee: fTotalFee !== "" ? Number(fTotalFee) : undefined,
        exam_fee_gbp: fExamFeeGbp !== "" ? Number(fExamFeeGbp) : undefined,
      });

      // Refresh relations
      if (selected && selected.user_code === fUserCode) {
        const updated = await AdminService.getStudentRelations(fUserCode);
        setRelations(updated);
      }

      setFormalizeOpen(false);
      toast.success("Enrollment formalized!");
    } catch (e: any) {
      handleError(e, "Failed to formalize enrollment");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) return null;
  if (!isAdminOrSalesOrAccountantOrManager) return null;

  const exportSelectedStudent = () => {
    if (!selected || !relations) return;

    // Sheet 1: Student Information
    const infoData = [{
      "Code": selected.user_code,
      "Name": selected.username,
      "Email": selected.email,
      "DOB": selected.data_of_birth ? selected.data_of_birth.slice(0, 10) : "",
      "Status": selected.is_active ? "Active" : "Inactive",
      "NRC": selected.nrc || "",
      "Phone": selected.phone || "",
      "Address": selected.address || "",
      "Parent Name": selected.parent_name || "",
      "Parent Phone": selected.parent_phone || "",
      "Student Type": selected.student_type || "-",
      "How Did You Hear": selected.how_did_you_hear || "-",
      "Intended Course": selected.intended_course_code || "-",
      "Created At": selected.created_at ? selected.created_at.slice(0, 10) : "-"
    }];

    // Sheet 2: Enrollment Info with course cost and left amount
    const enrollmentData = relations.enrollments.map(e => {
      const courseCost = (e as any).course_cost || 0;
      // Sum all payments for this enrollment
      const totalPaid = (relations.payments || [])
        .filter(p => p.enrollment_id === e.enrollment_id)
        .reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalDiscount = (relations.payments || [])
        .filter(p => p.enrollment_id === e.enrollment_id)
        .reduce((sum, p) => sum + (p.discount_amount || 0), 0);
      const leftAmount = Math.max(0, courseCost - (totalPaid + totalDiscount));
      return {
        "Course Code": e.course_code,
        "Course Name": e.course_name,
        "Category": (courses.find((c: AdminCourse) => c.course_code === e.course_code))?.category || "-",
        "Status": e.status ? "Active" : "Inactive",
        "Batch": e.batch_no || "-",
        "Payment Plan": e.payment_plan === "full" ? "Cash Down" : e.payment_plan === "installment" ? "Installment" : "-",
        "Course Amount (MMK)": courseCost,
        "Deposit (MMK)": e.downpayment || 0,
        "Monthly Installment (MMK)": e.installment_amount || 0,
        "Total Paid (MMK)": totalPaid,
        "Total Discount (MMK)": totalDiscount,
        "Left Amount (MMK)": leftAmount,
        "FOC Items": (e as any).foc_items || "-",
        "Discount Plan": (e as any).discount_plan || "-",
        "Enrollment Date": e.enrollment_date ? e.enrollment_date.slice(0, 10) : "-"
      };
    });

    // Sheet 3: Payment Receipts Detail with course amount and running left
    let paymentData: any[] = [];
    if (relations.payments && relations.payments.length > 0) {
      // Group total paid per enrollment for computing left
      const paidPerEnrollment: Record<number, number> = {};
      for (const p of relations.payments) {
        paidPerEnrollment[p.enrollment_id] = (paidPerEnrollment[p.enrollment_id] || 0) + (p.amount || 0);
      }
      paymentData = relations.payments.map(p => {
        const courseCost = (p as any).course_cost || 0;
        const totalPaidForEnrollment = paidPerEnrollment[p.enrollment_id] || 0;
        return {
          "Receipt ID": p.payment_id,
          "Date": p.payment_date ? new Date(p.payment_date).toLocaleString() : "-",
          "Course Name": p.course_name,
          "Category": (courses.find((c: AdminCourse) => c.course_name === p.course_name))?.category || "-",
          "Month": p.month,
          "Method": p.payment_method || "N/A",
          "Course Amount (MMK)": courseCost,
          "Amount Paid (MMK)": p.amount,
          "Fine Amount (MMK)": p.fine_amount || 0,
          "Extra Items Fee (MMK)": p.extra_items_fee || 0,
          "Extra Items": parseExtraItems(p.extra_items) || "-",
          "Exam Fee Paid (GBP)": p.exam_fee_paid_gbp || 0,
          "Exam Fee Paid (MMK)": p.exam_fee_paid_mmk || 0,
          "Total Paid for Enrollment (MMK)": totalPaidForEnrollment,
          "Left Amount (MMK)": Math.max(0, courseCost - totalPaidForEnrollment - ((p as any).totalDiscountForEnrollment || 0)),
          "Status": p.status
        };
      });
    }

    // Sheet 4: Monthly Payment Summary
    const monthlyMap: Record<string, { totalPaid: number; count: number }> = {};
    if (relations.payments && relations.payments.length > 0) {
      for (const p of relations.payments) {
        const key = p.month || "Unknown";
        if (!monthlyMap[key]) monthlyMap[key] = { totalPaid: 0, count: 0 };
        monthlyMap[key].totalPaid += p.amount || 0;
        monthlyMap[key].count += 1;
      }
    }
    const monthlySummary = Object.entries(monthlyMap).map(([month, v]) => ({
      "Month": month,
      "Total Paid (MMK)": v.totalPaid,
      "No. of Payments": v.count
    }));

    // Sheet 5: Attendance Detail
    const attendanceData = relations.attendance.map(a => ({
      "Date": a.attendance_date,
      "Status": a.check_today ? "Present" : "Absent"
    }));

    const wb = XLSX.utils.book_new();

    const wsInfo = XLSX.utils.json_to_sheet(infoData);
    XLSX.utils.book_append_sheet(wb, wsInfo, "Student Info");

    const wsEnroll = XLSX.utils.json_to_sheet(enrollmentData.length ? enrollmentData : [{ "Info": "No enrollments found" }]);
    XLSX.utils.book_append_sheet(wb, wsEnroll, "Enrollments");

    const wsPayment = XLSX.utils.json_to_sheet(paymentData.length ? paymentData : [{ "Info": "No payments recorded" }]);
    XLSX.utils.book_append_sheet(wb, wsPayment, "Payment Receipts");

    const wsMonthlySummary = XLSX.utils.json_to_sheet(monthlySummary.length ? monthlySummary : [{ "Info": "No monthly data" }]);
    XLSX.utils.book_append_sheet(wb, wsMonthlySummary, "Monthly Summary");

    const wsAttendance = XLSX.utils.json_to_sheet(attendanceData.length ? attendanceData : [{ "Info": "No attendance records" }]);
    XLSX.utils.book_append_sheet(wb, wsAttendance, "Attendance Details");

    XLSX.writeFile(wb, `Student_${selected.user_code}_Details.xlsx`);
  };

  const exportAllData = async () => {
    try {
      setBusy(true);
      const [studentsRes, enrollmentsRes, attendance, paymentsRes] = await Promise.all([
        AdminService.listStudents(1, -1),
        AdminService.listEnrollments(undefined, 1, -1),
        AdminService.listAttendance(),
        AdminService.listPayments(1, -1)
      ]);

      const students = studentsRes.data || [];
      const enrollments = enrollmentsRes.data || [];
      const payments = paymentsRes.data || [];

      const wb = XLSX.utils.book_new();

      const wsStudents = XLSX.utils.json_to_sheet(students.length ? students.map((s: AdminStudent) => ({
        "User Code": s.user_code,
        "Name": s.username,
        "Email": s.email,
        "DOB": s.data_of_birth ? s.data_of_birth.slice(0, 10) : "-",
        "Status": s.is_active ? "Active" : "Inactive",
        "NRC": s.nrc || "-",
        "Phone": s.phone || "-",
        "Address": s.address || "-",
        "Parent": s.parent_name || "-",
        "Parent Phone": s.parent_phone || "-",
        "Student Type": s.student_type || "-",
        "How Did You Hear": s.how_did_you_hear || "-",
        "Intended Course Code": s.intended_course_code || "-",
        "Created At": s.created_at ? s.created_at.slice(0, 10) : "-"
      })) : [{ "Info": "No students recorded" }]);
      XLSX.utils.book_append_sheet(wb, wsStudents, "All Students");

      // Compute total paid per enrollment for left amount
      const paidPerEnrollment: Record<number, number> = {};
      const discountPerEnrollment: Record<number, number> = {};
      for (const p of (payments as any[])) {
        paidPerEnrollment[p.enrollment_id] = (paidPerEnrollment[p.enrollment_id] || 0) + (p.amount || 0);
        discountPerEnrollment[p.enrollment_id] = (discountPerEnrollment[p.enrollment_id] || 0) + (p.discount_amount || 0);
      }

      const wsPayments = XLSX.utils.json_to_sheet(payments.length ? payments.map((p: any) => {
        const courseCost = p.course_cost || 0;
        const totalPaidForEnroll = paidPerEnrollment[p.enrollment_id] || 0;
        return {
          "Receipt ID": p.payment_id,
          "Student Code": p.student_code,
          "Student Name": p.student_name,
          "Course Name": p.course_name,
          "Category": (courses.find((c: AdminCourse) => c.course_name === p.course_name))?.category || "-",
          "Month": p.month,
          "Method": p.payment_method || "-",
          "Date": p.payment_date ? new Date(p.payment_date).toLocaleString() : "-",
          "Course Amount (MMK)": courseCost,
          "Amount Paid (MMK)": p.amount,
          "Discount (MMK)": p.discount_amount || 0,
          "Fine Amount (MMK)": p.fine_amount || 0,
          "Extra Items Fee (MMK)": p.extra_items_fee || 0,
          "Extra Items": parseExtraItems(p.extra_items) || "-",
          "Exam Fee Paid (GBP)": p.exam_fee_paid_gbp || 0,
          "Exam Fee Paid (MMK)": p.exam_fee_paid_mmk || 0,
          "Total Paid (MMK)": totalPaidForEnroll,
          "Left Amount (MMK)": Math.max(0, courseCost - totalPaidForEnroll - (discountPerEnrollment[p.enrollment_id] || 0)),
          "Status": p.status
        };
      }) : [{ "Info": "No payments recorded" }]);
      XLSX.utils.book_append_sheet(wb, wsPayments, "All Payments");

      // Monthly Summary across the entire system
      const monthlyMap: Record<string, { totalPaid: number; count: number }> = {};
      for (const p of (payments as any[])) {
        const key = p.month || "Unknown";
        if (!monthlyMap[key]) monthlyMap[key] = { totalPaid: 0, count: 0 };
        monthlyMap[key].totalPaid += p.amount || 0;
        monthlyMap[key].count += 1;
      }
      const monthlySummary = Object.entries(monthlyMap).map(([month, v]) => ({
        "Month": month,
        "Total Paid (MMK)": v.totalPaid,
        "No. of Payments": v.count
      }));
      const wsMonthlySummary = XLSX.utils.json_to_sheet(monthlySummary.length ? monthlySummary : [{ "Info": "No monthly data" }]);
      XLSX.utils.book_append_sheet(wb, wsMonthlySummary, "Monthly Summary");

      const wsEnrollments = XLSX.utils.json_to_sheet(enrollments.length ? enrollments.map((e: any) => {
        const courseCost = e.course_cost || 0;
        const totalPaid = paidPerEnrollment[e.enrollment_id] || 0;
        const totalDiscount = discountPerEnrollment[e.enrollment_id] || 0;
        const leftAmount = Math.max(0, courseCost - (totalPaid + totalDiscount));
        return {
          "Enrollment ID": e.enrollment_id,
          "Student Name": e.student_name,
          "Course Name": e.course_name,
          "Category": (courses.find((c: AdminCourse) => c.course_name === e.course_name))?.category || "-",
          "Batch": e.batch_no || "-",
          "Plan": e.payment_plan || "-",
          "Course Amount (MMK)": courseCost,
          "Deposit (MMK)": e.downpayment || 0,
          "Monthly Installment (MMK)": e.installment_amount || 0,
          "Total Paid (MMK)": totalPaid,
          "Total Discount (MMK)": totalDiscount,
          "Left Amount (MMK)": leftAmount,
          "FOC Items": e.foc_items || "-",
          "Status": e.status ? "Active" : "Inactive"
        };
      }) : [{ "Info": "No enrollments found" }]);
      XLSX.utils.book_append_sheet(wb, wsEnrollments, "All Enrollments");

      const wsAttendance = XLSX.utils.json_to_sheet(attendance.length ? attendance.map((a: any) => ({
        "Date": a.attendance_date,
        "Student Name": a.username,
        "Slot": a.slot,
        "Status": a.check_today ? "Present" : "Absent"
      })) : [{ "Info": "No attendance records" }]);
      XLSX.utils.book_append_sheet(wb, wsAttendance, "All Attendance");

      XLSX.writeFile(wb, `System_Backup_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      toast.error("Failed to export backup. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Students</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Create, update, and delete student accounts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              const link = `${window.location.origin}/register`;
              if (navigator.share) {
                navigator.share({
                  title: 'NiT Student Registration',
                  text: 'Please register using this link:',
                  url: link,
                }).catch(console.error);
              } else {
                navigator.clipboard.writeText(link).then(() => toast.success("Registration link copied to clipboard!"));
              }
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold hover:bg-indigo-100 shadow-sm text-sm transition-all active:scale-95 whitespace-nowrap"
          >
            <span className="hidden xs:inline">Share Link</span>
            <span className="xs:hidden">Link</span>
          </button>
          <button
            onClick={load}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-60 text-sm transition-all active:scale-95"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            <span className="hidden xs:inline">Refresh</span>
          </button>
          {isAdmin && (
            <button
              onClick={() => setClearAllOpen(true)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow-sm disabled:opacity-60 text-sm transition-all active:scale-95"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Purge</span>
            </button>
          )}
          <button
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-sm text-sm transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span className="whitespace-nowrap">New Student</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100/50 overflow-hidden">
        <div className="px-4 sm:px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by code, name, or email…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium text-sm sm:text-base"
            />
          </div>
          {error && (
            <div
              ref={errorRef}
              className="px-4 py-3 bg-red-50 border border-red-100 text-red-700 text-sm font-bold rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm"
            >
              <AlertCircle size={16} className="shrink-0" />
              <div className="flex-1">{error}</div>
              <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-lg transition-colors"><X size={14} /></button>
            </div>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => requestSort("user_code")}>
                  <div className="flex items-center gap-2">
                    Code
                    {sortKey === "user_code" ? (
                      sortOrder === "asc" ? <ChevronUp className="w-4 h-4 text-brand-600" /> : <ChevronDown className="w-4 h-4 text-brand-600" />
                    ) : (
                      <ChevronsUpDown className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4">Pic</th>
                <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => requestSort("username")}>
                  <div className="flex items-center gap-2">
                    Name
                    {sortKey === "username" ? (
                      sortOrder === "asc" ? <ChevronUp className="w-4 h-4 text-brand-600" /> : <ChevronDown className="w-4 h-4 text-brand-600" />
                    ) : (
                      <ChevronsUpDown className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => requestSort("email")}>
                  <div className="flex items-center gap-2">
                    Email
                    {sortKey === "email" ? (
                      sortOrder === "asc" ? <ChevronUp className="w-4 h-4 text-brand-600" /> : <ChevronDown className="w-4 h-4 text-brand-600" />
                    ) : (
                      <ChevronsUpDown className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4">DOB</th>
                <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => requestSort("is_active")}>
                  <div className="flex items-center gap-2">
                    Status
                    {sortKey === "is_active" ? (
                      sortOrder === "asc" ? <ChevronUp className="w-4 h-4 text-brand-600" /> : <ChevronDown className="w-4 h-4 text-brand-600" />
                    ) : (
                      <ChevronsUpDown className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {studentsLoading ? (
                <TableBodySkeleton columns={7} />
              ) : (
                <>
                  {filtered.map((s: AdminStudent) => (
                    <tr key={s.user_code} className="hover:bg-blue-50 hover:shadow-md transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">{s.user_code}</td>
                      <td className="px-6 py-4">
                        {s.profile_picture ? (
                          <div className="relative group w-8 h-8">
                            <img src={s.profile_picture} alt="Profile" className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 shadow-sm" />
                            <a href={s.profile_picture} download={`pic_${s.user_code}`} className="absolute inset-0 bg-black/40 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Download Image" onClick={e => e.stopPropagation()}>
                              <Download className="w-3 h-3" />
                            </a>
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-400 uppercase">
                            {s.username?.[0] || "?"}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-6 py-4 font-semibold text-brand-600 hover:text-brand-700 hover:underline cursor-pointer"
                        onClick={() => openView(s)}
                      >
                        {s.username}
                      </td>
                      <td className="px-6 py-4">{s.email}</td>
                      <td className="px-6 py-4 text-nowrap">{s.data_of_birth ? s.data_of_birth.slice(0, 10) : "-"}</td>
                      <td className="px-6 py-4">
                        <span
                          className={[
                            "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border",
                            s.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-100 text-slate-600 border-slate-200",
                          ].join(" ")}
                        >
                          {s.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          {isAdminOrSales && (
                            <>
                              {!s.is_active ? (
                                <div className="flex gap-1.5 items-center">
                                  <button
                                    onClick={() => handleApprove(s)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-sm disabled:opacity-60 transition-all active:scale-95 text-xs"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    {user?.role === "sales" ? "Approve (Assign Code)" : "Approve"}
                                  </button>
                                  {s.student_type !== "New Student" && (
                                    <button
                                      onClick={() => toggleStatus(s)}
                                      disabled={busy}
                                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 font-bold hover:bg-emerald-100 shadow-sm transition-all active:scale-95"
                                      title="Quick Activate Again"
                                    >
                                      <ShieldCheck className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <button
                                  onClick={() => toggleStatus(s)}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 hover:text-slate-800 shadow-sm disabled:opacity-60 transition-all active:scale-95 text-xs"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Leave
                                </button>
                              )}
                            </>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => openEdit(s)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-all active:scale-95 text-xs"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => doDelete(s)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 font-bold hover:bg-red-50 transition-all active:scale-95 text-xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
                        No students found.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
        {/* Mobile/Tablet Card View */}
        <div className="block lg:hidden divide-y divide-slate-100 bg-slate-50/50">
          {studentsLoading ? (
            <div className="p-4 space-y-4">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : (
            <>
              {filtered.map((s: AdminStudent) => (
                <div key={s.user_code} className="p-5 bg-white mb-2 last:mb-0 shadow-sm active:bg-slate-50 transition-all border-y border-slate-100 first:border-t-0">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-4">
                      <div className="relative group">
                        {s.profile_picture ? (
                          <img src={s.profile_picture} alt="Profile" className="w-14 h-14 rounded-2xl object-cover ring-2 ring-white shadow-xl" />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-200 flex items-center justify-center text-lg font-black text-brand-600 uppercase shadow-inner">
                            {s.username?.[0] || "?"}
                          </div>
                        )}
                        <div className={clsx(
                          "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm",
                          s.is_active ? "bg-emerald-500" : "bg-slate-300"
                        )} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5 font-mono">{s.user_code}</div>
                        <h3 className="text-lg font-black text-slate-800 leading-tight truncate hover:text-brand-600 transition-colors" onClick={() => openView(s)}>
                          {s.username}
                        </h3>
                        <p className="text-xs font-medium text-slate-500 truncate">{s.email}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0 gap-2">
                      <span className={clsx(
                        "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border whitespace-nowrap",
                        s.is_active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                          : "bg-slate-50 text-slate-500 border-slate-200"
                      )}>
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-0.5">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                        <CalendarClock size={10} /> DOB
                      </span>
                      <span className="text-xs font-bold text-slate-700">
                        {s.data_of_birth ? s.data_of_birth.slice(0, 10) : "-"}
                      </span>
                    </div>
                    <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-0.5">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                        <CreditCard size={10} /> Phone
                      </span>
                      <span className="text-xs font-bold text-slate-700 truncate">
                        {s.phone || "-"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                    <div className="flex-1">
                      <p className="font-premium text-[10px] text-slate-400 uppercase tracking-widest leading-none">Quick Actions</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdminOrSales && (
                        <div className="flex items-center gap-2">
                          {!s.is_active ? (
                            <>
                              <button
                                onClick={() => handleApprove(s)}
                                disabled={busy}
                                className="btn-primary btn-xs gap-1.5 shadow-lg shadow-brand-200/50"
                              >
                                <Check size={14} className="stroke-[3]" /> {user?.role === "sales" ? "Approve" : "Approve"}
                              </button>
                              {s.student_type !== "New Student" && (
                                <button
                                  onClick={() => toggleStatus(s)}
                                  disabled={busy}
                                  className="btn-icon-sm bg-emerald-50 text-emerald-600 border border-emerald-100"
                                  title="Quick Activate"
                                >
                                  <ShieldCheck size={16} />
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={() => toggleStatus(s)}
                              disabled={busy}
                              className="btn-secondary btn-xs gap-1.5"
                            >
                              <ShieldCheck size={14} className="stroke-[3]" /> Leave
                            </button>
                          )}
                        </div>
                      )}

                      {isAdmin && (
                        <button
                          onClick={() => openEdit(s)}
                          className="btn-icon-sm bg-slate-50 text-slate-500 border border-slate-200"
                        >
                          <Pencil size={14} />
                        </button>
                      )}

                      {isAdmin && (
                        <button
                          onClick={() => doDelete(s)}
                          className="btn-icon-sm bg-red-50 text-red-500 border border-red-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="p-16 text-center text-slate-300">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p className="font-black text-xs uppercase tracking-widest">No results found</p>
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

      <Modal title="Create Student" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {error && (
            <div className="sm:col-span-2 p-4 bg-red-50 border border-red-100 text-red-700 text-xs font-bold rounded-2xl flex items-start gap-3 animate-in fade-in duration-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-extrabold mb-0.5 uppercase tracking-tighter">Registration Error</p>
                {error}
              </div>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Profile Picture</label>
            <div className="flex items-center gap-4">
              {cProfilePicture ? (
                <div className="relative group w-12 h-12 shrink-0">
                  <img src={cProfilePicture} alt="Preview" className="w-12 h-12 rounded-full object-cover ring-2 ring-slate-100 shadow-sm" />
                  <button onClick={() => setCProfilePicture("")} className="absolute inset-0 bg-black/40 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Remove image">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="w-12 h-12 shrink-0 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                  <Plus className="w-5 h-5" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleProfilePicChange}
                className="w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 cursor-pointer"
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Student Code (Optional)</label>
            <input
              value={cUserCode}
              onChange={(e) => setCUserCode(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="Leave empty to auto-calculate (e.g. CO0011226)"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full name <span className="text-red-500">*</span></label>
            <input
              value={cUsername}
              onChange={(e) => setCUsername(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="Student name"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email <span className="text-red-500">*</span></label>
            <input
              value={cEmail}
              onChange={(e) => setCEmail(e.target.value)}
              type="email"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="student@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Date of birth <span className="text-red-500">*</span></label>
            <input
              value={cDob}
              onChange={(e) => setCDob(e.target.value)}
              type="date"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">NRC</label>
            <input
              value={cNrc}
              onChange={(e) => setCNrc(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="e.g. 12/DaGaMa(N)123456"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Phone Number</label>
            <input
              value={cPhone}
              onChange={(e) => setCPhone(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="e.g. 0912345678"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Department</label>
            <select
              value={cDepartment}
              onChange={(e) => setCDepartment(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium cursor-pointer"
            >
              <option value="College">College (CO)</option>
              <option value="Institute">Institute (IN)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Student Type</label>
            <select
              value={cStudentType}
              onChange={(e) => setCStudentType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-800 font-medium cursor-pointer"
            >
              <option value="New Student">New Student</option>
              <option value="Old Student">Old Student</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">How Did You Hear About Us?</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {["Facebook", "TikTok", "Friend Referral", "Family Referral", "Online Search", "NiT Event", "Other (Please Specify)"].map((option) => (
                <label key={option} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cHowDidYouHear.includes(option)}
                    onChange={(e) => {
                      if (e.target.checked) setCHowDidYouHear((prev) => [...prev, option]);
                      else setCHowDidYouHear((prev) => prev.filter((item) => item !== option));
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-slate-700">{option}</span>
                </label>
              ))}
            </div>
            {cHowDidYouHear.includes("Other (Please Specify)") && (
              <input
                type="text"
                value={cOtherHear}
                onChange={(e) => setCOtherHear(e.target.value)}
                placeholder="Please specify"
                className="mt-2 w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 text-sm"
              />
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Address</label>
            <input
              value={cAddress}
              onChange={(e) => setCAddress(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="Full address details"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Parent Name</label>
            <input
              value={cParentName}
              onChange={(e) => setCParentName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="e.g. U Kyaw"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Parent Phone</label>
            <input
              value={cParentPhone}
              onChange={(e) => setCParentPhone(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              placeholder="e.g. 0987654321"
            />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={cActive}
                onChange={(e) => setCActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Active
            </label>
          </div>

          {/* New Enrollment Block */}
          <div className="sm:col-span-2 mt-4 pt-4 border-t border-slate-100">
            <h4 className="font-bold text-slate-800 mb-3">Course Enrollment (Optional)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Course Category</label>
                <select
                  value={cCategory}
                  onChange={(e) => {
                    setCCategory(e.target.value);
                    setCCourseCode("");
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value="">All Categories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Select Course</label>
                <select
                  value={cCourseCode}
                  onChange={(e) => setCCourseCode(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value="">No course (skip enrollment)</option>
                  {filteredCourses_C.map(c => (
                    <option key={c.course_code} value={c.course_code}>{c.course_name}</option>
                  ))}
                </select>
              </div>

              {cCourseCode && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Batch</label>
                    {cBatches.length > 0 ? (
                      <select
                        value={cBatchId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCBatchId(val ? (val === "manual" ? "manual" : Number(val)) : "");
                          if (val !== "manual" && val !== "") {
                            const b = cBatches.find(x => x.batch_id === Number(val));
                            if (b) setCBatchNo(b.batch_no);
                          } else if (val === "manual") {
                            setCBatchNo("");
                          }
                        }}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                      >
                        <option value="">Select Existing Batch...</option>
                        {cBatches.map(b => (
                          <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                        ))}
                        <option value="manual">Enter New Batch Name...</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={cBatchNo}
                        onChange={(e) => setCBatchNo(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                        placeholder="e.g. Batch 1"
                      />
                    )}
                    {cBatchId === "manual" && (
                      <input
                        type="text"
                        value={cBatchNo}
                        onChange={(e) => setCBatchNo(e.target.value)}
                        className="mt-2 w-full px-3 py-2.5 rounded-xl bg-yellow-50 border border-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                        placeholder="Enter new batch name..."
                      />
                    )}
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

                  <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-brand-50/50 p-4 rounded-2xl border border-brand-100">
                    <div className="sm:col-span-1">
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Total Course Fee (MMK)</label>
                      <input
                        type="number"
                        value={cTotalFee}
                        onChange={(e) => setCTotalFee(e.target.value ? Number(e.target.value) : "")}
                        className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        placeholder="Default from course"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exam Fee (GBP)</label>
                      <input
                        type="number"
                        value={cExamFeeGbp}
                        onChange={(e) => setCExamFeeGbp(e.target.value ? Number(e.target.value) : "")}
                        className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        placeholder="Default from course"
                      />
                    </div>
                  </div>

                  {cPaymentPlan === "installment" && (
                    <>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Deposit (Optional, MMK)</label>
                        <input
                          type="number"
                          value={cDownpayment}
                          onChange={(e) => setCDownpayment(e.target.value ? Number(e.target.value) : "")}
                          className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                          placeholder="e.g. 2000000"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Monthly Installment (MMK)</label>
                        <input
                          type="number"
                          value={cInstallment}
                          onChange={(e) => setCInstallment(e.target.value ? Number(e.target.value) : "")}
                          className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                          placeholder="e.g. 300000"
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          {/* End New Enrollment Block */}

          <div className="sm:col-span-2 flex justify-end">
            <button
              onClick={submitCreate}
              disabled={combinedLoading || !cUsername.trim() || !cEmail.trim() || !cDob}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60 transition-all active:scale-95 shadow-sm"
            >
              {createMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
              {createMutation.isPending ? "Creating..." : "Create Student"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal title={`Edit Student${selected ? ` — ${selected.user_code}` : ""}`} open={editOpen} onClose={() => setEditOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {error && (
            <div className="sm:col-span-2 p-4 bg-red-50 border border-red-100 text-red-700 text-xs font-bold rounded-2xl flex items-start gap-3 animate-in fade-in duration-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-extrabold mb-0.5 uppercase tracking-tighter">Update Error</p>
                {error}
              </div>
            </div>
          )}
          <div className="sm:col-span-1">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Student Code <span className="text-red-500">*</span></label>
            <input
              value={eUserCode}
              onChange={(e) => setEUserCode(e.target.value)}
              placeholder="Student Code"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-medium"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full name <span className="text-red-500">*</span></label>
            <input
              value={eUsername}
              onChange={(e) => setEUsername(e.target.value)}
              placeholder="Full name"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-medium"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email address <span className="text-red-500">*</span></label>
            <input
              value={eEmail}
              onChange={(e) => setEEmail(e.target.value)}
              type="email"
              placeholder="email@example.com"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-medium"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Date of birth <span className="text-red-500">*</span></label>
            <input
              value={eDob}
              onChange={(e) => setEDob(e.target.value)}
              type="date"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-medium"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Student Status</label>
            <div className="flex items-center gap-4 h-[46px]">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={eActive}
                  onChange={(e) => setEActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Active Student
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Phone Number</label>
            <input
              value={ePhone}
              onChange={(e) => setEPhone(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">NRC</label>
            <input
              value={eNrc}
              onChange={(e) => setENrc(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Gender</label>
            <select
              value={eGender}
              onChange={(e) => setEGender(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            >
              <option value="">Select Gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Student Type</label>
            <select
              value={eStudentType}
              onChange={(e) => setEStudentType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            >
              <option value="New Student">New Student</option>
              <option value="Online Student">Online Student</option>
              <option value="Self Study">Self Study</option>
              <option value="Returning">Returning</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Address</label>
            <textarea
              value={eAddress}
              onChange={(e) => setEAddress(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 min-h-[80px]"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Parent Name</label>
            <input
              value={eParentName}
              onChange={(e) => setEParentName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Parent Phone</label>
            <input
              value={eParentPhone}
              onChange={(e) => setEParentPhone(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">How Did You Hear About Us?</label>
            <input
              value={eHowDidYouHear}
              onChange={(e) => setEHowDidYouHear(e.target.value)}
              placeholder="e.g. Facebook, Friend"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Intended Course Code</label>
            <input
              value={eIntendedCourse}
              onChange={(e) => setEIntendedCourse(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5 font-bold">E-Signature</label>
            {eSignature ? (
              <div className="relative border border-slate-200 bg-white rounded-2xl p-4 flex flex-col items-center justify-center min-h-[140px] group shadow-sm">
                <img src={eSignature} alt="Signature Preview" className="max-h-[100px] object-contain" />
                <button
                  type="button"
                  onClick={() => setESignature("")}
                  className="absolute top-2 right-2 px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-lg border border-rose-200 transition-colors cursor-pointer"
                >
                  Clear & Re-draw
                </button>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
                <SignaturePad value={eSignature} onChange={setESignature} />
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-800">Relations</div>
                {relationsLoading && <div className="text-xs font-semibold text-slate-500">Loading…</div>}
              </div>
              {!relationsLoading && relations && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-white border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-500">Enrollments</div>
                    <div className="text-xl font-extrabold text-slate-800 mt-1">{relations.enrollments.length}</div>
                  </div>
                  <div className="rounded-xl bg-white border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-500">Attendance</div>
                    <div className="text-xl font-extrabold text-slate-800 mt-1">{relations.attendance.length}</div>
                  </div>
                  <div className="rounded-xl bg-white border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-500">Parents</div>
                    <div className="text-xl font-extrabold text-slate-800 mt-1">{relations.parents.length}</div>
                  </div>
                </div>
              )}
              {!relationsLoading && !relations && (
                <div className="mt-2 text-sm text-slate-500 font-medium">No relation data available.</div>
              )}
            </div>
          </div>

          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button
              onClick={() => setEditOpen(false)}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={submitEdit}
              disabled={combinedLoading || !selected}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60 transition-all active:scale-95 shadow-sm"
            >
              {updateMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal title={`Configure Enrollment${enrollToEdit ? ` — ${enrollToEdit.course_name}` : ""}`} open={enrollEditOpen} onClose={() => setEnrollEditOpen(false)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Batch Number</label>
            <input
              value={eBatch}
              onChange={(e) => setEBatch(e.target.value)}
              placeholder="e.g. Batch 1"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Payment Plan</label>
            <select
              value={ePlan}
              onChange={(e) => setEPlan(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            >
              <option value="full">Cash Down</option>
              <option value="installment">Installment</option>
            </select>
          </div>
          <div className="sm:col-span-2 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Downpayment (MMK)</label>
              <input
                value={eDown}
                onChange={(e) => setEDown(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Monthly Paid (MMK)</label>
              <input
                value={eInst}
                onChange={(e) => setEInst(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Total Fee (MMK)</label>
              <input
                value={eTotalFee}
                onChange={(e) => setETotalFee(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exam Fee (GBP)</label>
              <input
                value={eExamFeeGbp}
                onChange={(e) => setEExamFeeGbp(e.target.value)}
                type="number"
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
          </div>

          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button
              onClick={() => setEnrollEditOpen(false)}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={submitEnrollEdit}
              disabled={busy}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 disabled:opacity-60"
            >
              Update Info
            </button>
          </div>
        </div>
      </Modal>

      <Modal title="Student Details" open={viewOpen} onClose={() => setViewOpen(false)}>
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-6 items-start bg-slate-50 p-6 rounded-xl border border-slate-100">
              <div className="flex flex-col items-center gap-3 shrink-0 w-full sm:w-auto">
                {selected.profile_picture ? (
                  <>
                    <img src={selected.profile_picture} alt="Profile" className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover ring-4 ring-white shadow-sm" />
                    <a href={selected.profile_picture} download={`pic_${selected.user_code}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 font-semibold text-xs hover:bg-slate-50 shadow-sm">
                      <Download className="w-3.5 h-3.5" />
                      Download Pic
                    </a>
                  </>
                ) : (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-slate-200 border-4 border-white shadow-sm flex items-center justify-center text-4xl font-bold text-slate-400 uppercase">
                    {selected.username?.[0] || "?"}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 w-full">
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase">Student Code</div>
                  <div className="font-semibold text-slate-800 mt-1">{selected.user_code}</div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase">Full Name</div>
                  <div className="font-semibold text-slate-800 mt-1">{selected.username}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase">Email</div>
                  <div className="font-semibold text-slate-800 mt-1">{selected.email}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Date of Birth</div>
                  <div className="font-semibold text-slate-800 mt-1">{selected.data_of_birth ? selected.data_of_birth.slice(0, 10) : "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">Status</div>
                  <div className="mt-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${selected.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                      {selected.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase">Student Type</div>
                  <div className="font-semibold text-slate-800 mt-1">{selected.student_type || "New Student"}</div>
                </div>
                {selected.intended_course_code && (
                  <div className="col-span-2 mt-2">
                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm transition-all hover:bg-amber-100/50">
                      <div>
                        <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Interest Showcase (From Register)</div>
                        <div className="font-bold text-slate-800 mt-1 flex items-center gap-2 text-lg">
                          <Check className="w-5 h-5 text-amber-500" />
                          {(courses.find(c => c.course_code === selected.intended_course_code))?.course_name || selected.intended_course_code}
                        </div>
                      </div>
                      {(!relations || relations.enrollments.length === 0) && (
                        <button
                          onClick={() => handleFastEnroll(selected.user_code, selected.intended_course_code!)}
                          className="w-full sm:w-auto bg-amber-600 text-wrap text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-700 shadow-lg shadow-amber-200/50 flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                          <Plus className="w-4 h-4" strokeWidth={3} />
                          Formalize Enrollment
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="col-span-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">NRC</div>
                <div className="font-semibold text-slate-800 mt-1">{selected.nrc || "-"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase">Phone Number</div>
                <div className="font-semibold text-slate-800 mt-1">{selected.phone || "-"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">Address</div>
                <div className="font-semibold text-slate-800 mt-1">{selected.address || "-"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">How Did You Hear About Us?</div>
                <div className="font-semibold text-slate-800 mt-1">{selected.how_did_you_hear || "-"}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase">Parent Name</div>
                <div className="font-semibold text-slate-800 mt-1">{selected.parent_name || "-"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase">Parent Phone</div>
                <div className="font-semibold text-slate-800 mt-1">{selected.parent_phone || "-"}</div>
              </div>
            </div>

            {selected.signature && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">E-Signature</div>
                <div className="bg-white border border-slate-200 rounded-2xl p-2.5 flex items-center justify-center h-20 shadow-sm">
                  <img src={selected.signature} alt="E-Signature" className="max-h-full max-w-full object-contain" />
                </div>
              </div>
            )}

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
              <div className="text-xs font-semibold text-slate-500 uppercase">E-Sign Link (Request)</div>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  readOnly
                  value={typeof window !== "undefined" ? `${window.location.origin}/esign/${selected.user_code}` : ""}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 font-mono focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      navigator.clipboard.writeText(`${window.location.origin}/esign/${selected.user_code}`);
                      toast.success("E-Sign link copied to clipboard!");
                    }
                  }}
                  className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors active:scale-95 cursor-pointer shrink-0"
                >
                  Copy Link
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">Enrollments & Payment Info</div>
                {relationsLoading && <div className="text-xs font-semibold text-slate-400">Loading...</div>}
              </div>
              {!relationsLoading && relations && relations.enrollments.length > 0 ? (
                <div className="space-y-3">
                  {relations.enrollments.map((enr, i) => (
                    <div key={i} className="bg-white p-3 rounded-lg border border-slate-200">
                      <div className="font-semibold text-slate-800 flex items-center justify-between">
                        <span>{enr.course_name}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEnrollEdit(enr)}
                            className="bg-brand-50 text-brand-700 px-2 py-1 rounded text-[10px] uppercase font-bold border border-brand-100 hover:bg-brand-100"
                          >
                            Settings
                          </button>
                          <button
                            onClick={() => router.push(`/admin/payments?q=${selected?.user_code}`)}
                            className="bg-brand-50 text-brand-700 px-2 py-1 rounded text-[10px] uppercase font-bold border border-brand-100 hover:bg-brand-100"
                          >
                            Add Payment
                          </button>
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${enr.status ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                            {enr.status ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-sm grid grid-cols-2 gap-2 text-slate-600">
                        <div><span className="font-semibold text-slate-500">Batch:</span> {enr.batch_no || "-"}</div>
                        <div><span className="font-semibold text-slate-500">Schedule:</span> {enr.batch_start_date ? `${enr.batch_start_date} to ${enr.batch_end_date || '?'}` : 'TBA'}</div>
                        <div><span className="font-semibold text-slate-500">Room:</span> {enr.room || "-"}</div>
                        <div><span className="font-semibold text-slate-500">Plan:</span> {enr.payment_plan === "full" ? "Cash Down" : enr.payment_plan === "installment" ? "Installment" : "-"}</div>
                        {enr.payment_plan === "installment" && (
                          <>
                            <div><span className="font-semibold text-slate-500">Downpayment:</span> {enr.downpayment ? `${formatAmount(enr.downpayment)} MMK` : "-"}</div>
                            <div><span className="font-semibold text-slate-500">Monthly:</span> {enr.installment_amount ? `${formatAmount(enr.installment_amount)} MMK` : "-"}</div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : !relationsLoading && relations && relations.enrollments.length === 0 ? (
                <div className="text-sm font-medium text-slate-500">No enrollments found for this student.</div>
              ) : null}
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">Payment Receipts</div>
                {relationsLoading && <div className="text-xs font-semibold text-slate-400">Loading...</div>}
              </div>
              {!relationsLoading && relations && relations.payments && relations.payments.length > 0 ? (
                <div className="space-y-3">
                  {relations.payments.map((p, i) => (
                    <div key={`pay-${i}`} className="bg-white p-3 rounded-lg border border-slate-200">
                      <div className="font-semibold text-slate-800 flex items-center justify-between">
                        <span>{p.course_name} ({p.month})</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${p.status?.toLowerCase() === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-200'}`}>
                          {p.status || "Unknown"}
                        </span>
                      </div>
                      <div className="mt-2 text-sm grid grid-cols-2 gap-2 text-slate-600">
                        <div><span className="font-semibold text-slate-500">Method:</span> {p.payment_method || "-"}</div>
                        <div><span className="font-semibold text-slate-500">Amount:</span> {formatAmount(p.amount)} MMK</div>
                        {p.discount_amount != null && p.discount_amount > 0 && (
                          <div className="col-span-2 text-emerald-600 font-semibold italic"><span className="font-semibold text-slate-500">Discount:</span> -{formatAmount(p.discount_amount)} MMK</div>
                        )}
                        <div><span className="font-semibold text-slate-500">Date:</span> {p.payment_date ? p.payment_date.slice(0, 10) : "-"}</div>
                        <div><span className="font-semibold text-slate-500">Receipt ID:</span> #{p.payment_id}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !relationsLoading && relations && (!relations.payments || relations.payments.length === 0) ? (
                <div className="text-sm font-medium text-slate-500">No payment receipts found for this student.</div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {isAdminOrSales && (
                <>
                  {!selected.is_active ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(selected)}
                        disabled={busy}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-sm disabled:opacity-60 transition-all active:scale-95"
                      >
                        <Check className="w-4 h-4" />
                        Approve Student
                      </button>
                      {selected.student_type !== "New Student" && (
                        <button
                          onClick={() => toggleStatus(selected)}
                          disabled={busy}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-sm disabled:opacity-60 transition-all active:scale-95"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          Quick Activate
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => toggleStatus(selected)}
                      disabled={busy}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 shadow-sm disabled:opacity-60 transition-all active:scale-95"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Mark as Leave
                    </button>
                  )}
                </>
              )}
              <button
                onClick={exportSelectedStudent}
                disabled={relationsLoading}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                Export to Excel
              </button>
              <button
                onClick={() => setViewOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>


      {/* Formalize Enrollment Modal */}
      <Modal
        title={`Formalize Enrollment — ${(courses.find(c => c.course_code === fCourseCode))?.course_name || fCourseCode}`}
        open={formalizeOpen}
        onClose={() => setFormalizeOpen(false)}
      >
        <div className="space-y-4">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-700 text-xs font-bold rounded-2xl animate-in fade-in duration-300">
              {error}
            </div>
          )}
          <div className="p-4 bg-brand-50 rounded-2xl border border-brand-100 text-sm text-brand-800">
            Completing this will convert the student's interest into a formal course enrollment.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Course Category</label>
              <select
                value={fCategory}
                onChange={(e) => {
                  setFCategory(e.target.value);
                  setFCourseCode("");
                }}
                className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:outline-none transition-all"
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Course</label>
              <select
                value={fCourseCode}
                onChange={(e) => setFCourseCode(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:outline-none transition-all"
              >
                <option value="">Select Course...</option>
                {filteredCourses_F.map(c => (
                  <option key={c.course_code} value={c.course_code}>{c.course_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Batch</label>
              {fBatches.length > 0 ? (
                <select
                  value={fBatchId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFBatchId(val ? (val === "manual" ? "manual" : Number(val)) : "");
                    if (val !== "manual" && val !== "") {
                      const b = fBatches.find(x => x.batch_id === Number(val));
                      if (b) setFBatchNo(b.batch_no);
                    } else if (val === "manual") {
                      setFBatchNo("");
                    }
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">Select Existing Batch...</option>
                  {fBatches.map(b => (
                    <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                  ))}
                  <option value="manual">Enter New Batch Name...</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={fBatchNo}
                  onChange={(e) => setFBatchNo(e.target.value)}
                  placeholder="e.g. Batch 1"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              )}
              {fBatchId === "manual" && (
                <input
                  type="text"
                  value={fBatchNo}
                  onChange={(e) => setFBatchNo(e.target.value)}
                  placeholder="Enter manual batch name..."
                  className="mt-2 w-full px-3 py-2.5 rounded-xl bg-yellow-50 border border-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Payment Plan</label>
              <select
                value={fPlan}
                onChange={(e) => {
                  setFPlan(e.target.value);
                  if (e.target.value && fCourseCode) {
                    const c = courses.find(x => x.course_code === fCourseCode);
                    if (c) {
                      setFTotalFee(e.target.value === "full" ? (c.fee_full_payment || 0) : (c.fee_installment || 0));
                      if (c.exam_fee_gbp) setFExamFeeGbp(c.exam_fee_gbp);
                    }
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="">Select Plan...</option>
                <option value="full">Cash Down</option>
                <option value="installment">Installment</option>
              </select>
            </div>

            <div className="sm:col-span-2 grid grid-cols-2 gap-4 bg-brand-50 p-4 rounded-2xl border border-brand-100/50">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Total Fee (MMK)</label>
                <input
                  type="number"
                  value={fTotalFee}
                  onChange={(e) => setFTotalFee(e.target.value ? Number(e.target.value) : "")}
                  placeholder="Default from course"
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Exam Fee (GBP)</label>
                <input
                  type="number"
                  value={fExamFeeGbp}
                  onChange={(e) => setFExamFeeGbp(e.target.value ? Number(e.target.value) : "")}
                  placeholder="Default from course"
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>

            {fPlan === "installment" && (
              <>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">Deposit (MMK)</label>
                  <input
                    type="number"
                    value={fDown}
                    onChange={(e) => setFDown(e.target.value ? Number(e.target.value) : "")}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">Monthly Paid (MMK)</label>
                  <input
                    type="number"
                    value={fInst}
                    onChange={(e) => setFInst(e.target.value ? Number(e.target.value) : "")}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 flex gap-3">
            <button
              onClick={() => setFormalizeOpen(false)}
              className="flex-1 py-3 text-slate-500 font-bold rounded-xl hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={submitFormalize}
              disabled={busy || !fPlan}
              className="flex-[2] py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-all shadow-lg shadow-brand-200/50 disabled:opacity-50"
            >
              Formalize Enrollment
            </button>
          </div>
        </div>
      </Modal>

      {/* Approval Modal */}
      <Modal
        title={user?.role === "sales" ? "Assign Student Code & Approve" : "Approve Student Account"}
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
      >
        <div className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-700 text-xs font-bold rounded-2xl flex items-start gap-3 animate-in fade-in duration-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-extrabold mb-0.5 uppercase tracking-tighter">Approval Error</p>
                {error}
              </div>
            </div>
          )}
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 italic text-sm text-amber-800">
            Review or change the student code before activating the account.
            You can either set a manual code or auto-generate one with a prefix.
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">Code Assignment Method</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setApprovePrefix("")}
                className={`py-3 rounded-2xl border-2 text-sm font-bold transition-all ${approvePrefix === "" ? 'border-[#0d4d4d] bg-[#0d4d4d]/5 text-[#0d4d4d]' : 'border-slate-100 text-slate-500 hover:border-slate-200'}`}
              >
                Manual
              </button>
              <button
                onClick={() => setApprovePrefix("CO")}
                className={`py-3 rounded-2xl border-2 text-sm font-bold transition-all ${approvePrefix === "CO" ? 'border-[#0d4d4d] bg-[#0d4d4d]/5 text-[#0d4d4d]' : 'border-slate-100 text-slate-500 hover:border-slate-200'}`}
              >
                Auto CO
              </button>
              <button
                onClick={() => setApprovePrefix("IN")}
                className={`py-3 rounded-2xl border-2 text-sm font-bold transition-all ${approvePrefix === "IN" ? 'border-[#0d4d4d] bg-[#0d4d4d]/5 text-[#0d4d4d]' : 'border-slate-100 text-slate-500 hover:border-slate-200'}`}
              >
                Auto IN
              </button>
            </div>
          </div>

          {approvePrefix === "" && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
              <label className="block text-sm font-bold text-slate-700">Student Code (Manual)</label>
              <input
                value={approveManualCode}
                onChange={(e) => setApproveManualCode(e.target.value)}
                className="w-full px-4 py-3.5 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#0d4d4d] focus:bg-white focus:outline-none transition-all font-mono tracking-wider text-slate-900"
              />
            </div>
          )}

          {approvePrefix !== "" && (
            <div className="p-5 bg-[#0d4d4d]/5 rounded-3xl border border-[#0d4d4d]/10 flex items-center gap-4 animate-in fade-in slide-in-from-top-1">
              <div className="w-12 h-12 bg-[#0d4d4d] text-white rounded-2xl flex items-center justify-center font-bold text-xl">
                {approvePrefix}
              </div>
              <div className="text-sm text-[#0d4d4d]">
                <p className="font-bold">System Managed</p>
                <p className="opacity-70">A new sequence number will be generated for prefix <span className="font-mono">{approvePrefix}</span></p>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex gap-3">
            <button
              onClick={() => setApproveOpen(false)}
              className="flex-1 py-4 text-slate-500 font-bold rounded-2xl hover:bg-slate-50 transition-all border-2 border-transparent"
            >
              Cancel
            </button>
            <button
              onClick={submitApprove}
              disabled={busy}
              className="flex-[2] py-4 bg-[#0d4d4d] text-white font-bold rounded-2xl hover:bg-[#0d4d4d]/90 active:scale-95 transition-all shadow-lg shadow-[#0d4d4d]/20 disabled:opacity-50"
            >
              {user?.role === "sales" ? "Assign Code & Approve" : "Confirm Approval"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modals */}
      <ConfirmModal
        open={!!studentToDelete}
        onClose={() => setStudentToDelete(null)}
        onConfirm={executeDelete}
        title="Delete Student"
        message={`Are you sure you want to delete student ${studentToDelete?.user_code} (${studentToDelete?.username})? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />



      <ConfirmModal
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        onConfirm={async () => {
          try {
            setBusy(true);
            await AdminService.purgeData();
            await refetchStudents();
          } catch (err: any) {
            handleError(err, "Failed to purge data");
          } finally {
            setBusy(false);
            setClearAllOpen(false);
          }
        }}
        title="CRITICAL: Purge All Data"
        message="This will DELETE all system data including students, courses, enrollments, attendance, and more. Only administrator accounts will remain. Are you absolutely certain?"
        confirmText="YES, I AM SURE"
        variant="danger"
        isLoading={busy}
      />
    </div>
  );
}

