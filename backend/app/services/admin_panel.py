from typing import Optional, List, Any, Dict, Union
from app.services.rbac_portal import validating_admin_role, validating_parent_role
from app.models.model import User, AcademicYear, Attendance, Course, Enrollment, Grade, ParentStudent, StaffAttendance, Room, TimeTable, Payment, ActivityLog, Batch, RefreshToken, Subject
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas.academic_year import AdminAcademicYearCreate, AdminAcademicYearUpdate
from app.schemas.attendance import AttendanceMarkRequest, AttendanceUpdateRequest
from sqlalchemy import and_, select, update, delete, Integer, text
from sqlalchemy.orm import defer
from fastapi.responses import JSONResponse
from fastapi import Request
from app.schemas.user import UserUpdate, AdminStudentCreate, AdminParentCreate, AdminParentLinkChild, AdminStaffCreate, AdminStudentApprove, UserPasswordChange, AdminUserPasswordChange
from datetime import datetime, date, time, timedelta, timezone
from app.security.password_hashing import hash_password
from sqlalchemy import func
from app.schemas.course import AdminCourseCreate, AdminCourseUpdate
from app.schemas.enrollment import AdminEnrollmentCreate, AdminEnrollmentUpdate
from app.schemas.room import AdminRoomCreate, AdminRoomUpdate
from collections import defaultdict
from app.schemas.time_table import AdminTimeTableCreate, AdminTimeTableUpdate
from app.schemas.payment import PaymentCreate, PaymentUpdate
from app.schemas.batch import AdminBatchCreate, AdminBatchUpdate
from app.schemas.subject import AdminSubjectCreate, AdminSubjectUpdate
from app.core.timezone_utils import get_now_local
from app.core.config import settings
from app.services.activity_log_service import log_activity
from app.models.model import Account, JournalEntry, JournalEntryLine

async def _create_journal_entry_for_payment(session: AsyncSession, pay: Payment):
    from app.models.model import Account, JournalEntry, JournalEntryLine, Enrollment
    
    # Get enrollment and student ID
    enroll_q = select(Enrollment).where(Enrollment.enrollment_id == pay.enrollment_id)
    enroll_res = await session.execute(enroll_q)
    enroll = enroll_res.scalars().first()
    student_id = enroll.student_id if enroll else None

    # Get accounts helper
    async def get_acc(name: str, acc_type: str, cur: str = "MMK"):
        q = select(Account).where(Account.account_name == name)
        res = await session.execute(q)
        acc = res.scalars().first()
        if not acc:
            acc = Account(account_name=name, account_type=acc_type, currency=cur)
            session.add(acc)
            await session.flush()
        return acc

    # Create journal entry
    entry = JournalEntry(
        entry_date=pay.payment_date.date() if isinstance(pay.payment_date, datetime) else pay.payment_date,
        description=f"Student Payment: {pay.receipt_id}",
        reference=pay.receipt_id,
        entry_type="payment",
        student_id=student_id
    )
    session.add(entry)
    await session.flush()

    # Determine asset debit accounts
    pay_method = pay.payment_method or "Cash"
    deb_acc_name = "CB Bank (MMK)" if pay_method in ["Bank Transfer", "Banking", "CB Bank", "Bank"] else ("Petty Cash (MMK)" if pay_method == "Petty Cash" else ("KBZ Bank (MMK)" if pay_method in ["KBZPay", "KPay", "Wave", "WavePay", "Wave Pay", "AYA Pay", "MMQR"] else "Cash in Hand (MMK)"))
    deb_acc = await get_acc(deb_acc_name, "Asset")

    # Debit lines
    if pay.amount > 0:
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=deb_acc.account_id,
            debit_mmk=pay.amount,
            credit_mmk=0.0
        ))

    # Split payment
    if pay.amount_2 and pay.amount_2 > 0:
        pay_method_2 = pay.payment_method_2 or "Cash"
        deb_acc_2_name = "CB Bank (MMK)" if pay_method_2 in ["Bank Transfer", "Banking", "CB Bank", "Bank"] else ("Petty Cash (MMK)" if pay_method_2 == "Petty Cash" else ("KBZ Bank (MMK)" if pay_method_2 in ["KBZPay", "KPay", "Wave", "WavePay", "Wave Pay", "AYA Pay", "MMQR"] else "Cash in Hand (MMK)"))
        deb_acc_2 = await get_acc(deb_acc_2_name, "Asset")
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=deb_acc_2.account_id,
            debit_mmk=pay.amount_2,
            credit_mmk=0.0
        ))

    # Tuition credit
    total_tuition = (pay.amount or 0.0) + (pay.amount_2 or 0.0)
    if total_tuition > 0:
        rev_acc = await get_acc("Tuition Revenue (MMK)", "Revenue")
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=rev_acc.account_id,
            debit_mmk=0.0,
            credit_mmk=total_tuition
        ))

    # Fine Amount
    if pay.fine_amount and pay.fine_amount > 0:
        fine_acc = await get_acc("Fine Revenue (MMK)", "Revenue")
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=deb_acc.account_id,
            debit_mmk=pay.fine_amount,
            credit_mmk=0.0
        ))
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=fine_acc.account_id,
            debit_mmk=0.0,
            credit_mmk=pay.fine_amount
        ))

    # Extra Items Fee
    if pay.extra_items_fee and pay.extra_items_fee > 0:
        import json
        items = []
        if pay.extra_items:
            try:
                items = json.loads(pay.extra_items)
            except Exception:
                pass
        
        # Check if it's a valid list of dicts with price
        if isinstance(items, list) and len(items) > 0 and all(isinstance(it, dict) and "price" in it for it in items):
            extra_rev_acc = await get_acc("Extra Items Revenue (MMK)", "Revenue")
            for it in items:
                price = float(it.get("price") or 0)
                if price <= 0:
                    continue
                item_method = it.get("method") or pay.extra_items_payment_method or pay.payment_method or "Cash"
                deb_extra_name = "CB Bank (MMK)" if item_method in ["Bank Transfer", "Banking", "CB Bank", "Bank"] else ("Petty Cash (MMK)" if item_method == "Petty Cash" else ("KBZ Bank (MMK)" if item_method in ["KBZPay", "KPay", "Wave", "WavePay", "Wave Pay", "AYA Pay", "MMQR"] else "Cash in Hand (MMK)"))
                deb_extra_acc = await get_acc(deb_extra_name, "Asset")
                
                session.add(JournalEntryLine(
                    entry_id=entry.entry_id,
                    account_id=deb_extra_acc.account_id,
                    debit_mmk=price,
                    credit_mmk=0.0
                ))
                session.add(JournalEntryLine(
                    entry_id=entry.entry_id,
                    account_id=extra_rev_acc.account_id,
                    debit_mmk=0.0,
                    credit_mmk=price
                ))
        else:
            extra_method = pay.extra_items_payment_method or pay.payment_method or "Cash"
            deb_extra_name = "CB Bank (MMK)" if extra_method in ["Bank Transfer", "Banking", "CB Bank", "Bank"] else ("Petty Cash (MMK)" if extra_method == "Petty Cash" else ("KBZ Bank (MMK)" if extra_method in ["KBZPay", "KPay", "Wave", "WavePay", "Wave Pay", "AYA Pay", "MMQR"] else "Cash in Hand (MMK)"))
            deb_extra_acc = await get_acc(deb_extra_name, "Asset")
            extra_rev_acc = await get_acc("Extra Items Revenue (MMK)", "Revenue")
            
            session.add(JournalEntryLine(
                entry_id=entry.entry_id,
                account_id=deb_extra_acc.account_id,
                debit_mmk=pay.extra_items_fee,
                credit_mmk=0.0
            ))
            session.add(JournalEntryLine(
                entry_id=entry.entry_id,
                account_id=extra_rev_acc.account_id,
                debit_mmk=0.0,
                credit_mmk=pay.extra_items_fee
            ))

    # Exam Fee Paid GBP
    if pay.exam_fee_paid_gbp and pay.exam_fee_paid_gbp > 0:
        deb_gbp_acc = await get_acc("Cash/Bank (GBP)", "Asset", "GBP")
        rev_gbp_acc = await get_acc("Exam Fees Revenue (GBP)", "Revenue", "GBP")
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=deb_gbp_acc.account_id,
            debit_gbp=pay.exam_fee_paid_gbp,
            credit_gbp=0.0
        ))
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=rev_gbp_acc.account_id,
            debit_gbp=0.0,
            credit_gbp=pay.exam_fee_paid_gbp
        ))

    # Exam Fee Paid MMK
    if pay.exam_fee_paid_mmk and pay.exam_fee_paid_mmk > 0:
        exam_method = pay.exam_fee_payment_method or pay.payment_method or "Cash"
        deb_exam_mmk_name = "CB Bank (MMK)" if exam_method in ["Bank Transfer", "Banking", "CB Bank", "Bank"] else ("Petty Cash (MMK)" if exam_method == "Petty Cash" else ("KBZ Bank (MMK)" if exam_method in ["KBZPay", "KPay", "Wave", "WavePay", "Wave Pay", "AYA Pay", "MMQR"] else "Cash in Hand (MMK)"))
        deb_exam_mmk_acc = await get_acc(deb_exam_mmk_name, "Asset")
        rev_exam_mmk_acc = await get_acc("Exam Fees Revenue (MMK)", "Revenue")
        
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=deb_exam_mmk_acc.account_id,
            debit_mmk=pay.exam_fee_paid_mmk,
            credit_mmk=0.0
        ))
        session.add(JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=rev_exam_mmk_acc.account_id,
            debit_mmk=0.0,
            credit_mmk=pay.exam_fee_paid_mmk
        ))

    await session.flush()


def _safe_get(obj: Any, key: str, default: Any = None) -> Any:
    """
    Safely retrieve an attribute or column value from a model instance or dict
    without triggering SQLAlchemy async lazy-load descriptors (MissingGreenlet).
    """
    if obj is None:
        return default
    if isinstance(obj, dict):
        val = obj.get(key)
        return val if val is not None else default
    d = getattr(obj, "__dict__", None)
    if isinstance(d, dict) and key in d:
        val = d[key]
        return val if val is not None else default
    return default


def _serialize_user_lite(u: User) -> dict:
    dob = _safe_get(u, "data_of_birth")
    created = _safe_get(u, "created_at")
    return {
        "user_id": _safe_get(u, "user_id"),
        "user_code": _safe_get(u, "user_code"),
        "username": _safe_get(u, "username"),
        "email": _safe_get(u, "email"),
        "role": _safe_get(u, "role"),
        "is_active": _safe_get(u, "is_active", True),
        "phone": _safe_get(u, "phone"),
        "data_of_birth": dob.isoformat() if dob else None,
        "profile_picture": _safe_get(u, "profile_picture"),
        "created_at": f"{created.isoformat()}Z" if created else None,
    }

def _serialize_user(u: User) -> dict:
    dob = _safe_get(u, "data_of_birth")
    created = _safe_get(u, "created_at")
    updated = _safe_get(u, "updated_at")
    return {
        "user_id": _safe_get(u, "user_id"),
        "user_code": _safe_get(u, "user_code"),
        "username": _safe_get(u, "username"),
        "email": _safe_get(u, "email"),
        "role": _safe_get(u, "role"),
        "is_active": _safe_get(u, "is_active", True),
        "nrc": _safe_get(u, "nrc"),
        "gender": _safe_get(u, "gender"),
        "phone": _safe_get(u, "phone"),
        "parent_name": _safe_get(u, "parent_name"),
        "parent_phone": _safe_get(u, "parent_phone"),
        "address": _safe_get(u, "address"),
        "profile_picture": _safe_get(u, "profile_picture"),
        "signature": _safe_get(u, "signature"),
        "data_of_birth": dob.isoformat() if dob else None,
        "how_did_you_hear": _safe_get(u, "how_did_you_hear"),
        "student_type": _safe_get(u, "student_type"),
        "intended_course_code": _safe_get(u, "intended_course_code"),
        "created_at": f"{created.isoformat()}Z" if created else None,
        "updated_at": f"{updated.isoformat()}Z" if updated else None,
    }


async def _next_student_code(session: AsyncSession, department: str = "College", manual_prefix: str = None) -> str:
    """
    Generate a unique student_code like CO0001226 (4-digit seq).
    Supports 10000 students.
    Month is unpadded (1-12).
    """
    import re
    prefix = manual_prefix if manual_prefix else ("IN" if department == "Institute" else "CO")
    
    # Retrieve existing student codes with matching prefix to extract highest sequence number safely
    result = await session.execute(
        select(User.user_code)
        .where(and_(
            User.role == "student", 
            User.user_code.like(f"{prefix}%")
        ))
    )
    existing_codes = result.scalars().all()
    
    max_seq = 0
    pattern = re.compile(rf"^{prefix}(\d{{3,4}})")
    for code in existing_codes:
        m = pattern.match(code)
        if m:
            try:
                val = int(m.group(1))
                if val > max_seq:
                    max_seq = val
            except ValueError:
                pass

    seq = max_seq + 1
    now = get_now_local()
    month_str = str(now.month)
    year_str = str(now.year)[-2:]
    
    # Collision check loop to ensure absolute uniqueness
    while True:
        candidate = f"{prefix}{seq:04d}{month_str}{year_str}"
        check = await session.execute(select(User.user_id).where(User.user_code == candidate))
        if not check.scalar_one_or_none():
            return candidate
        seq += 1

async def _next_parent_code(session: AsyncSession) -> str:
    """
    Generate a stable parent_code like PAR0001.
    """
    # Optimized: DB-level max sequence lookup
    result = await session.execute(
        select(func.max(func.cast(func.substr(User.user_code, 4), Integer)))
        .where(and_(User.role == "parent", User.user_code.like("PAR%")))
    )
    max_seq = result.scalar() or 0
    return f"PAR{max_seq + 1:04d}"

async def _next_staff_code(session: AsyncSession, role: str) -> str:
    """
    Generate stable code like SAL0001 (sales), TCH0001 (teacher).
    """
    prefix_map = {
        "sales": "SAL",
        "teacher": "TCH",
        "hr": "HRX",
        "manager": "MGR",
        "accountant": "ACC",
        "student_affairs": "STA"
    }
    prefix = prefix_map.get(role, "STF")
    
    # Optimized: DB-level max sequence lookup
    result = await session.execute(
        select(func.max(func.cast(func.substr(User.user_code, len(prefix) + 1), Integer)))
        .where(and_(User.role == role, User.user_code.like(f"{prefix}%")))
    )
    max_seq = result.scalar() or 0
    return f"{prefix}{max_seq + 1:04d}"


async def _next_course_code(session: AsyncSession) -> str:
    result = await session.execute(select(Course.course_id).order_by(Course.course_id.desc()).limit(1))
    last_id = result.scalar_one_or_none() or 0
    return f"CRS{last_id + 1:04d}"


async def _next_enrollment_code(session: AsyncSession) -> str:
    result = await session.execute(select(Enrollment.enrollment_id).order_by(Enrollment.enrollment_id.desc()).limit(1))
    last_id = result.scalar_one_or_none() or 0
    return f"ENR{last_id + 1:04d}"


def _serialize_academic_year(y: AcademicYear) -> dict:
    s_date = _safe_get(y, "start_date")
    e_date = _safe_get(y, "end_date")
    return {
        "academic_year_id": _safe_get(y, "academic_year_id"),
        "academic_year_name": _safe_get(y, "academic_year_name"),
        "start_date": s_date.isoformat() if s_date else None,
        "end_date": e_date.isoformat() if e_date else None,
    }


def _serialize_course(c: Course) -> dict:
    return {
        "course_id": _safe_get(c, "course_id"),
        "course_code": _safe_get(c, "course_code"),
        "course_name": _safe_get(c, "course_name"),
        "academic_year_id": _safe_get(c, "academicyear_id"),
        "instructor_id": _safe_get(c, "instructor_id"),
        "fee_full_payment": _safe_get(c, "fee_full_payment"),
        "fee_installment": _safe_get(c, "fee_installment"),
        "exam_fee_gbp": _safe_get(c, "exam_fee_gbp"),
        "foc_items": _safe_get(c, "foc_items"),
        "foc_items_installment": _safe_get(c, "foc_items_installment"),
        "discount": _safe_get(c, "discount", 0.0),
        "category": _safe_get(c, "category"),
    }


def _serialize_batch(b: Batch) -> dict:
    s_date = _safe_get(b, "start_date")
    e_date = _safe_get(b, "end_date")
    return {
        "batch_id": _safe_get(b, "batch_id"),
        "batch_no": _safe_get(b, "batch_no"),
        "course_id": _safe_get(b, "course_id"),
        "start_date": s_date.isoformat() if s_date else None,
        "end_date": e_date.isoformat() if e_date else None,
        "room": _safe_get(b, "room"),
        "instructor_id": _safe_get(b, "instructor_id"),
        "is_active": _safe_get(b, "is_active", True),
    }


def _serialize_subject(s: Subject) -> dict:
    created = _safe_get(s, "created_at")
    return {
        "subject_id": _safe_get(s, "subject_id"),
        "subject_code": _safe_get(s, "subject_code"),
        "subject_name": _safe_get(s, "subject_name"),
        "course_id": _safe_get(s, "course_id"),
        "is_active": _safe_get(s, "is_active", True),
        "created_at": f"{created.isoformat()}Z" if created else None,
    }


def _serialize_enrollment(e: Enrollment) -> dict:
    enr_date = _safe_get(e, "enrollment_date")
    return {
        "enrollment_id": _safe_get(e, "enrollment_id"),
        "enrollment_code": _safe_get(e, "enrollment_code"),
        "student_id": _safe_get(e, "student_id"),
        "course_id": _safe_get(e, "course_id"),
        "batch_id": _safe_get(e, "batch_id"),
        "enrollment_date": f"{enr_date.isoformat()}Z" if enr_date else None,
        "status": bool(_safe_get(e, "status", False)),
        "batch_no": _safe_get(e, "batch_no"),
        "payment_plan": _safe_get(e, "payment_plan"),
        "downpayment": _safe_get(e, "downpayment"),
        "installment_amount": _safe_get(e, "installment_amount"),
        "total_fee": _safe_get(e, "total_fee"),
        "exam_fee_gbp": _safe_get(e, "exam_fee_gbp"),
    }


def _serialize_room(r: Room) -> dict:
    created = _safe_get(r, "created_at")
    updated = _safe_get(r, "updated_at")
    return {
        "room_id": _safe_get(r, "room_id"),
        "room_name": _safe_get(r, "room_name"),
        "capacity": _safe_get(r, "capacity"),
        "is_active": _safe_get(r, "is_active", True),
        "created_at": f"{created.isoformat()}Z" if created else None,
        "updated_at": f"{updated.isoformat()}Z" if updated else None,
    }



class AdminPanelService:

    async def get_activity_logs(request: Request, session: AsyncSession, page: int = 1, limit: int = 50):
        if not await validating_admin_role(request):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
            
        from sqlalchemy.orm import joinedload
        offset = (page - 1) * limit
        query = select(ActivityLog).options(joinedload(ActivityLog.user)).order_by(ActivityLog.timestamp.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        logs = result.scalars().all()
        
        # Also get total count for pagination metadata
        count_query = select(func.count(ActivityLog.log_id))
        count_result = await session.execute(count_query)
        total_count = count_result.scalar()
        
        data = []
        for log in logs:
            data.append({
                "log_id": log.log_id,
                "user_id": log.user_id,
                "username": log.user.username if log.user else "Unknown",
                "role": log.user.role if log.user else "Unknown",
                "action": log.action,
                "details": log.details,
                "timestamp": f"{log.timestamp.isoformat()}Z" if log.timestamp else None
            })
            
        return JSONResponse({
            "status_code": 200, 
            "message": "Activity logs fetched", 
            "data": data,
            "pagination": {
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit,
                "current_page": page,
                "limit": limit
            }
        })
            
    async def delete_activity_log(request: Request, session: AsyncSession, log_id: int):
        if not await validating_admin_role(request):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
            
        await session.execute(delete(ActivityLog).where(ActivityLog.log_id == log_id))
        await session.commit()
        return JSONResponse({"status_code": 200, "message": f"Log {log_id} deleted successfully"})

    async def clear_all_activity_logs(request: Request, session: AsyncSession):
        if not await validating_admin_role(request):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
            
        await session.execute(delete(ActivityLog))
        await session.commit()
        return JSONResponse({"status_code": 200, "message": "All activity logs cleared successfully"})


    
    async def get_all_users(request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
            
        result = await session.execute(
            select(User).options(
                defer(User.profile_picture),
                defer(User.address),
                defer(User.password_hash)
            ).order_by(User.created_at.desc())
        )
        users = result.scalars().all()
        return JSONResponse(
            {
                "status_code": 200,
                "message": "All users fetched successfully",
                "data": [_serialize_user_lite(u) for u in users],
            }
        )

    async def get_students_details(request: Request, session: AsyncSession, page: int = 1, limit: int = 50):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        # Check cache
        from app.core.cache import cache_manager
        cache_key = f"students:list:{page}:{limit}"
        cached = await cache_manager.get(cache_key)
        if cached is not None:
            return JSONResponse(cached)

        # Base query optimized to exclude large columns
        base_query = select(User).where(User.role == "student").options(
            defer(User.address),
            defer(User.password_hash),
            defer(User.signature),
            defer(User.profile_picture)
        )
        
        # Paginated query
        if limit > 0:
            offset = (page - 1) * limit
            query = base_query.order_by(User.created_at.desc()).offset(offset).limit(limit)
        else:
            query = base_query.order_by(User.created_at.desc())
            
        result = await session.execute(query)
        students = result.scalars().all()
        
        # Total count for pagination metadata
        count_query = select(func.count(User.user_id)).where(User.role == "student")
        count_result = await session.execute(count_query)
        total_count = count_result.scalar() or 0
        
        total_pages = 0
        if limit > 0:
            total_pages = (total_count + limit - 1) // limit
        
        response_body = {
            "status_code": 200,
            "message": "Students details fetched successfully",
            "data": [_serialize_user_lite(s) for s in students],
            "pagination": {
                "total_count": total_count,
                "total_pages": total_pages,
                "current_page": page,
                "limit": limit
            }
        }
        await cache_manager.set(cache_key, response_body, expire=60)
        return JSONResponse(response_body)

    async def create_student(payload: AdminStudentCreate, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # Email uniqueness
        existing = await session.execute(select(User).where(User.email == payload.email))
        if existing.scalars().first():
            return JSONResponse({"status_code": 409, "message": "Email already exists"}, status_code=409)

        if payload.user_code and payload.user_code.strip():
            user_code = payload.user_code.strip()
            # Verify uniqueness of user_code
            existing_code = await session.execute(select(User).where(User.user_code == user_code))
            if existing_code.scalars().first():
                return JSONResponse({"status_code": 409, "message": "Student code already exists"}, status_code=409)
        else:
            user_code = await _next_student_code(session, getattr(payload, "department", "College"))
            
        if payload.password and payload.password.strip():
            hashed = await hash_password(payload.password)
        else:
            import secrets
            hashed = await hash_password(secrets.token_urlsafe(16))

        dob_dt = datetime.combine(payload.date_of_birth, time.min)
        new_user = User(
            user_code=user_code,
            username=payload.username,
            email=payload.email,
            password_hash=hashed,
            data_of_birth=dob_dt,
            role="student",
            nrc=payload.nrc,
            phone=payload.phone,
            parent_name=payload.parent_name,
            parent_phone=payload.parent_phone,
            address=payload.address,
            profile_picture=payload.profile_picture,
            how_did_you_hear=payload.how_did_you_hear,
            student_type=payload.student_type,
            is_active=payload.is_active if payload.is_active is not None else True,
        )
        session.add(new_user)
        await session.flush()
        await log_activity(request, session, "Create Student", f"Student {user_code} created")
        
        # Auto-enroll if course is given
        if payload.course_code:
            c_r = await session.execute(select(Course).where(Course.course_code == payload.course_code))
            course_obj = c_r.scalars().first()
            if course_obj:
                e_code = await _next_enrollment_code(session)
                batch_id = payload.batch_id if payload.batch_id and payload.batch_id != 0 else None
                if not batch_id and payload.batch_no:
                    b_r = await session.execute(
                        select(Batch).where(
                            and_(
                                Batch.course_id == course_obj.course_id, 
                                func.lower(func.trim(Batch.batch_no)) == func.lower(payload.batch_no.strip())
                            )
                        )
                    )
                    batch_o = b_r.scalars().first()
                    if batch_o:
                        batch_id = batch_o.batch_id
                    else:
                        new_batch = Batch(
                            batch_no=payload.batch_no.strip(),
                            course_id=course_obj.course_id,
                            is_active=True
                        )
                        session.add(new_batch)
                        await session.flush()
                        batch_id = new_batch.batch_id
                
                enroll = Enrollment(
                    enrollment_code=e_code,
                    student_id=new_user.user_id,
                    course_id=course_obj.course_id,
                    status=True,
                    batch_id=batch_id,
                    batch_no=payload.batch_no,
                    payment_plan=payload.payment_plan,
                    downpayment=payload.downpayment,
                    installment_amount=payload.installment_amount,
                    total_fee=payload.total_fee if payload.total_fee is not None else (course_obj.fee_full_payment if payload.payment_plan == "full" else course_obj.fee_installment),
                    exam_fee_gbp=payload.exam_fee_gbp if payload.exam_fee_gbp is not None else course_obj.exam_fee_gbp
                )
                session.add(enroll)


        await session.commit()
        await session.refresh(new_user)
        
        # Invalidate student list, dashboard, and enrollment caches
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("students:list:*")
        await cache_manager.delete("dashboard:summary")
        if payload.course_code:
            await cache_manager.delete_pattern("enrollment:list:*")

        return JSONResponse(
            {
                "status_code": 201,
                "message": "Student created successfully",
                "data": _serialize_user(new_user),
            },
            status_code=201,
        )
    
    async def get_specific_student(user_code: str ,request: Request , session:AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True):
            return {"message": "You are not authorized to perform this action"}
        
        query = select(User).where(and_(User.user_code == user_code , User.role == "student"))
        result = await session.execute(query)
        student = result.scalars().first()
        if not student:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)
        return JSONResponse(
            {
                "status_code": 200,
                "message": "Student details fetched successfully",
                "data": _serialize_user(student),
            }
        )

    async def get_student_relations(user_code: str, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(User).where(and_(User.user_code == user_code, User.role == "student")))
        student = r.scalars().first()
        if not student:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)

        enroll_r = await session.execute(
            select(Enrollment, Course, Batch)
            .join(Course, Enrollment.course_id == Course.course_id)
            .outerjoin(Batch, Enrollment.batch_id == Batch.batch_id)
            .where(Enrollment.student_id == student.user_id)
        )
        enrollment_rows = enroll_r.all()
        enrollments = [e for e, c, b in enrollment_rows]

        att_r = await session.execute(select(Attendance).where(Attendance.user_id == student.user_id))
        attendance = att_r.scalars().all()

        parents_r = await session.execute(
            select(ParentStudent, User)
            .join(User, ParentStudent.parent_id == User.user_id)
            .where(ParentStudent.student_id == student.user_id)
        )
        parent_rows = parents_r.all()

        enroll_ids = [e.enrollment_id for e in enrollments]
        payments = []
        if enroll_ids:
            pay_r = await session.execute(
                select(Payment, Enrollment, Course)
                .join(Enrollment, Payment.enrollment_id == Enrollment.enrollment_id)
                .join(Course, Course.course_id == Enrollment.course_id)
                .where(Enrollment.enrollment_id.in_(enroll_ids))
            )
            for p, e, c in pay_r.all():
                payments.append({
                    "payment_id": p.payment_id,
                    "receipt_id": getattr(p, "receipt_id", None) or "N/A",
                    "enrollment_id": p.enrollment_id,
                    "enrollment_code": e.enrollment_code,
                    "amount": p.amount,
                    "payment_date": f"{p.payment_date.isoformat()}Z" if p.payment_date else None,
                    "month": p.month,
                    "status": p.status,
                    "payment_method": getattr(p, "payment_method", None),
                    "amount_2": getattr(p, "amount_2", 0.0) or 0.0,
                    "payment_method_2": getattr(p, "payment_method_2", None),
                    "course_name": c.course_name,
                    "course_code": c.course_code,
                    "course_cost": float(getattr(e, "total_fee", 0.0) or (c.fee_full_payment if getattr(e, "payment_plan", None) == "full" else (c.fee_installment if getattr(e, "payment_plan", None) == "installment" else 0.0)) or 0.0),
                    "foc_items": (c.foc_items_installment if getattr(e, "payment_plan", None) == "installment" else c.foc_items),
                    "payment_plan": getattr(e, "payment_plan", None),
                    "downpayment": getattr(e, "downpayment", 0) or 0,
                    "installment_amount": getattr(e, "installment_amount", 0) or 0,
                    "fine_amount": getattr(p, "fine_amount", 0) or 0,
                    "extra_items_fee": getattr(p, "extra_items_fee", 0) or 0,
                    "extra_items": getattr(p, "extra_items", None),
                    "fine_reason": getattr(p, "fine_reason", None),
                    "exam_fee_paid_gbp": getattr(p, "exam_fee_paid_gbp", 0) or 0,
                    "exam_fee_paid_mmk": getattr(p, "exam_fee_paid_mmk", 0) or 0,
                    "exam_fee_total_gbp": float(getattr(e, "exam_fee_gbp", 0.0) or c.exam_fee_gbp or 0.0),
                    "exam_fee_currency": getattr(p, "exam_fee_currency", "MMK"),
                    "discount_amount": getattr(p, "discount_amount", 0.0) or 0.0
                })

        return JSONResponse(
            {
                "status_code": 200,
                "message": "Student relations fetched successfully",
                "data": {
                    "student": _serialize_user(student),
                    "enrollments": [
                        {
                            **_serialize_enrollment(e),
                            "course_code": c.course_code,
                            "course_name": c.course_name,
                            "course_cost": float(getattr(e, "total_fee", 0.0) or (c.fee_full_payment if getattr(e, "payment_plan", None) == "full" else (c.fee_installment if getattr(e, "payment_plan", None) == "installment" else 0.0)) or 0.0),
                            "foc_items": (c.foc_items_installment if getattr(e, "payment_plan", None) == "installment" else c.foc_items),
                            "batch_start_date": b.start_date.isoformat() if b and b.start_date else None,
                            "batch_end_date": b.end_date.isoformat() if b and b.end_date else None,
                            "room": b.room if b and b.room else getattr(e, "room", None)
                        }
                        for e, c, b in enrollment_rows
                    ],
                    "attendance": [
                        {
                            "attendance_id": a.attendance_id,
                            "attendance_date": str(a.attendance_date),
                            "check_today": a.check_today,
                        }
                        for a in attendance
                    ],
                    "parents": [
                        {
                            "parent_code": p.user_code,
                            "parent_name": p.username,
                            "parent_email": p.email,
                            "relationship": ps.relationship_label,
                        }
                        for ps, p in parent_rows
                    ],
                    "payments": payments,
                },
            }
        )
    
    async def get_teachers_details(request: Request, session: AsyncSession, page: int = 1, limit: int = 50):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        offset = (page - 1) * limit
        # Only defer password_hash (never serialized); address/profile_picture/signature
        # are needed by _serialize_user — deferring them caused MissingGreenlet (500) in async.
        query = select(User).where(User.role == "teacher").options(
            defer(User.password_hash)
        ).order_by(User.created_at.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        teachers = result.scalars().all()

        count_query = select(func.count(User.user_id)).where(User.role == "teacher")
        count_result = await session.execute(count_query)
        total_count = count_result.scalar() or 0

        return JSONResponse({
            "status_code": 200,
            "message": "Teachers details fetched successfully",
            "data": [_serialize_user(t) for t in teachers],
            "pagination": {
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit if limit > 0 else 0,
                "current_page": page,
                "limit": limit
            }
        })
    
    async def get_specific_teacher(user_code: str ,request: Request , session:AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return {"message": "You are not authorized to perform this action"}
        
        query = select(User).where(and_(User.user_code == user_code , User.role == "teacher"))
        result = await session.execute(query)
        teachers = result.scalars().all()
        response = JSONResponse({
            "status_code": 200,
            "message": "Teacher details fetched successfully",
            "data": [_serialize_user(t) for t in teachers]
        })
        return response
    
    async def get_parents_details(request: Request, session: AsyncSession, page: int = 1, limit: int = 50):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        offset = (page - 1) * limit
        query = select(User).where(User.role == "parent").order_by(User.created_at.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        parents = result.scalars().all()

        count_query = select(func.count(User.user_id)).where(User.role == "parent")
        count_result = await session.execute(count_query)
        total_count = count_result.scalar() or 0

        return JSONResponse({
            "status_code": 200,
            "message": "Parents details fetched successfully",
            "data": [_serialize_user(p) for p in parents],
            "pagination": {
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit if limit > 0 else 0,
                "current_page": page,
                "limit": limit
            }
        })
    
    async def get_specific_parent(user_code: str ,request: Request , session:AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
        
        query = select(User).where(and_(User.user_code == user_code , User.role == "parent"))
        result = await session.execute(query)
        parent = result.scalars().first()
        if not parent:
            return JSONResponse({"status_code": 404, "message": "Parent not found"}, status_code=404)
        return JSONResponse({"status_code": 200, "message": "Parent details fetched successfully", "data": _serialize_user(parent)})

    async def create_parent(payload: AdminParentCreate, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        existing = await session.execute(select(User).where(User.email == payload.email))
        if existing.scalars().first():
            return JSONResponse({"status_code": 409, "message": "Email already exists"}, status_code=409)

        user_code = await _next_parent_code(session)
        hashed = await hash_password(payload.password)
        dob_dt = datetime.combine(payload.date_of_birth, time.min)

        new_user = User(
            user_code=user_code,
            username=payload.username,
            email=payload.email,
            password_hash=hashed,
            data_of_birth=dob_dt,
            role="parent",
            is_active=payload.is_active if payload.is_active is not None else True,
        )
        session.add(new_user)
        await session.commit()
        await session.refresh(new_user)
        await log_activity(request, session, "Create Parent", f"Parent {user_code} ({payload.username}) created")
        return JSONResponse(
            {"status_code": 201, "message": "Parent created successfully", "data": _serialize_user(new_user)},
            status_code=201,
        )

    async def create_staff(payload: AdminStaffCreate, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=False):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to create staff accounts"}, status_code=403)

        existing = await session.execute(select(User).where(User.email == payload.email))
        if existing.scalars().first():
            return JSONResponse({"status_code": 409, "message": "Email already exists"}, status_code=409)

        user_code = await _next_staff_code(session, payload.role)
        hashed = await hash_password(payload.password)
        dob_dt = datetime.combine(payload.date_of_birth, time.min)

        new_user = User(
            user_code=user_code,
            username=payload.username,
            email=payload.email,
            password_hash=hashed,
            data_of_birth=dob_dt,
            role=payload.role,
            is_active=payload.is_active if payload.is_active is not None else True,
        )
        session.add(new_user)
        await session.commit()
        await session.refresh(new_user)
        
        # Log the activity
        await log_activity(
            request, 
            session, 
            action="Create Staff", 
            details=f"Created {payload.role} account '{payload.username}' ({user_code})"
        )
        
        return JSONResponse(
            {"status_code": 201, "message": "Staff created successfully", "data": _serialize_user(new_user)},
            status_code=201,
        )

    async def link_parent_child(parent_code: str, payload: AdminParentLinkChild, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        pr = await session.execute(select(User).where(and_(User.user_code == parent_code, User.role == "parent")))
        parent = pr.scalars().first()
        if not parent:
            return JSONResponse({"status_code": 404, "message": "Parent not found"}, status_code=404)

        sr = await session.execute(select(User).where(and_(User.user_code == payload.student_code, User.role == "student")))
        student = sr.scalars().first()
        if not student:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)

        dup = await session.execute(
            select(ParentStudent).where(and_(ParentStudent.parent_id == parent.user_id, ParentStudent.student_id == student.user_id))
        )
        link = dup.scalars().first()
        if link:
            # allow relationship label updates
            link.relationship_label = payload.relationship_label or link.relationship_label
            await session.commit()
            await log_activity(request, session, "Update Parent Link", f"Parent {parent_code} linked to {payload.student_code} - relationship updated")
            return JSONResponse({"status_code": 200, "message": "Parent already linked to student; relationship updated"})

        session.add(
            ParentStudent(
                parent_id=parent.user_id,
                student_id=student.user_id,
                relationship_label=payload.relationship_label or "parent",
            )
        )
        await session.commit()
        await log_activity(request, session, "Link Parent-Student", f"Parent {parent_code} linked to student {payload.student_code}")
        return JSONResponse({"status_code": 201, "message": "Parent linked to student successfully"}, status_code=201)
    
    async def update_user(user_code: str, user_update: UserUpdate, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
            
        query = select(User).where(User.user_code == user_code)
        result = await session.execute(query)
        user = result.scalars().first()
        
        if not user:
            return JSONResponse({"message": "User not found"}, status_code=404)
            
        update_data = user_update.dict(exclude_unset=True)
        
        # Check if user_code is being modified
        if "user_code" in update_data:
            new_code = update_data["user_code"].strip() if update_data["user_code"] else None
            if not new_code:
                return JSONResponse({"status_code": 400, "message": "Student code cannot be empty"}, status_code=400)
            if new_code != user.user_code:
                # Check for conflict
                dup = await session.execute(select(User).where(User.user_code == new_code))
                if dup.scalars().first():
                    return JSONResponse({"status_code": 409, "message": f"Student code {new_code} already exists"}, status_code=409)
                user.user_code = new_code
            update_data.pop("user_code", None)
        
        # Schema uses date_of_birth (date); model uses data_of_birth (DateTime)
        if "date_of_birth" in update_data:
            val = update_data.pop("date_of_birth")
            if val:
                user.data_of_birth = datetime.combine(val, time.min)
            else:
                user.data_of_birth = None
            
        for key, value in update_data.items():
            if hasattr(user, key):
                setattr(user, key, value)
            
        # Synchronize enrollments if is_active is toggled
        if "is_active" in update_data:
            from app.models.model import Enrollment
            from sqlalchemy import update as sqlalchemy_update
            await session.execute(
                sqlalchemy_update(Enrollment)
                .where(Enrollment.student_id == user.user_id)
                .values(status=update_data["is_active"])
            )
            
        await session.commit()
        await log_activity(request, session, "Update User", f"User {user_code} updated")
        
        # Invalidate user session, list, and profile caches
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("students:list:*")
        await cache_manager.delete_pattern("teachers:list:*")
        await cache_manager.delete_pattern("parents:list:*")
        await cache_manager.delete(f"user:{user_code.lower()}")
        await cache_manager.delete(f"me:{user_code.lower()}")

        return JSONResponse({"status_code": 200, "message": "User updated successfully"})
        
    async def delete_user(user_code: str, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
            
        query = select(User).where(User.user_code == user_code)
        result = await session.execute(query)
        user = result.scalars().first()
        
        if not user:
            return JSONResponse({"message": "User not found"}, status_code=404)

        # Defensive cleanup: some FKs (e.g. Attendance.user_id) don't specify ondelete="CASCADE",
        # and ORM cascades won't always trigger unless relationships are loaded.
        # So we explicitly delete dependent records first.
        uid = user.user_id

        # Detach instructor courses/batches/timetables (if deleting a teacher/staff)
        await session.execute(update(Course).where(Course.instructor_id == uid).values(instructor_id=None))
        await session.execute(update(Batch).where(Batch.instructor_id == uid).values(instructor_id=None))
        await session.execute(update(TimeTable).where(TimeTable.teacher_id == uid).values(teacher_id=None))

        # Remove links/child records
        await session.execute(delete(ParentStudent).where(ParentStudent.parent_id == uid))
        await session.execute(delete(ParentStudent).where(ParentStudent.student_id == uid))
        await session.execute(delete(Enrollment).where(Enrollment.student_id == uid))
        await session.execute(delete(Grade).where(Grade.student_id == uid))
        await session.execute(delete(Attendance).where(Attendance.user_id == uid))
        await session.execute(delete(StaffAttendance).where(StaffAttendance.user_id == uid))

        await session.delete(user)
        await session.commit()
        await log_activity(request, session, "Delete User", f"User {user_code} deleted")

        # Invalidate caches
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("students:list:*")
        await cache_manager.delete_pattern("teachers:list:*")
        await cache_manager.delete_pattern("parents:list:*")
        await cache_manager.delete_pattern("enrollment:list:*")
        await cache_manager.delete("dashboard:summary")
        await cache_manager.delete(f"user:{user_code.lower()}")
        await cache_manager.delete(f"me:{user_code.lower()}")

        return JSONResponse({"status_code": 200, "message": "User deleted successfully"})

    async def change_user_password(user_code: str, payload: AdminUserPasswordChange, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=False):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
            
        # Find user
        query = select(User).where(User.user_code == user_code)
        result = await session.execute(query)
        user = result.scalars().first()
        
        if not user:
            return JSONResponse({"status_code": 404, "message": "User not found"}, status_code=404)
            
        hashed = await hash_password(payload.new_password)
        user.password_hash = hashed
        await session.commit()
        
        await log_activity(request, session, "Change Password", f"Password changed for user {user_code}")
        
        return JSONResponse({"status_code": 200, "message": "Password updated successfully"})

    async def change_self_password(payload: UserPasswordChange, request: Request, session: AsyncSession):
        from app.services.rbac_portal import _get_user
        from app.security.password_hashing import verify_password
        
        user_info = _get_user(request)
        user_code = user_info.get("user_code")
        
        if not user_code:
            return JSONResponse({"status_code": 401, "message": "Not authenticated"}, status_code=401)
            
        query = select(User).where(User.user_code == user_code)
        result = await session.execute(query)
        user = result.scalars().first()
        
        if not user:
            return JSONResponse({"status_code": 404, "message": "User not found"}, status_code=404)
            
        # Verify old password
        if not await verify_password(payload.old_password, user.password_hash):
            return JSONResponse({"status_code": 400, "message": "Incorrect old password"}, status_code=400)
            
        hashed = await hash_password(payload.new_password)
        user.password_hash = hashed
        await session.commit()
        
        await log_activity(request, session, "Change Self Password", "Changed own password")
        
        return JSONResponse({"status_code": 200, "message": "Your password has been changed successfully"})

    async def seed_sample_data(request: Request, session: AsyncSession):
        """Create a small set of sample records for quickly testing admin CRUD."""
        if not await validating_admin_role(request):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        created = {"academic_years": 0, "teachers": 0, "courses": 0, "students": 0, "enrollments": 0, "attendance": 0}

        # Academic year
        local_now = get_now_local()
        year_name = f"{local_now.year}/{local_now.year + 1}"
        yr_r = await session.execute(select(AcademicYear).where(AcademicYear.academic_year_name == year_name))
        year = yr_r.scalars().first()
        if not year:
            year = AcademicYear(
                academic_year_name=year_name,
                start_date=datetime(date.today().year, 1, 1),
                end_date=datetime(date.today().year, 12, 31),
            )
            session.add(year)
            await session.flush()
            created["academic_years"] += 1

        # Teacher (instructor)
        teacher_email = "teacher.sample@nit.local"
        t_r = await session.execute(select(User).where(User.email == teacher_email))
        teacher = t_r.scalars().first()
        if not teacher:
            teacher = User(
                user_code=f"TEA{(await session.execute(select(func.coalesce(func.max(User.user_id), 0)))).scalar_one() + 1:04d}",
                username="Sample Teacher",
                email=teacher_email,
                password_hash=await hash_password("teacher123"),
                data_of_birth=datetime(1990, 1, 1),
                role="teacher",
                is_active=True,
            )
            session.add(teacher)
            await session.flush()
            created["teachers"] += 1

        # Courses
        course_names = ["Web Development", "UI/UX Design", "Cyber Security"]
        courses = []
        for name in course_names:
            c_r = await session.execute(select(Course).where(Course.course_name == name))
            c = c_r.scalars().first()
            if not c:
                c = Course(
                    course_code=await _next_course_code(session),
                    course_name=name,
                    academicyear_id=year.academic_year_id,
                    instructor_id=teacher.user_id,
                    start_date=get_now_local().date(),
                    end_date=date.today().replace(month=12, day=31),
                    room="Room 1",
                )
                session.add(c)
                await session.flush()
                created["courses"] += 1
            courses.append(c)

        # Students
        student_emails = ["student1.sample@nit.local", "student2.sample@nit.local", "student3.sample@nit.local"]
        students = []
        for i, email in enumerate(student_emails, start=1):
            s_r = await session.execute(select(User).where(User.email == email))
            s = s_r.scalars().first()
            if not s:
                s = User(
                    user_code=await _next_student_code(session),
                    username=f"Sample Student {i}",
                    email=email,
                    password_hash=await hash_password("student123"),
                    data_of_birth=datetime(2006, 1, 1),
                    role="student",
                    is_active=True,
                )
                session.add(s)
                await session.flush()
                created["students"] += 1
            students.append(s)

        # Enrollments + today's attendance
        for s in students:
            for i, c in enumerate(courses):
                if i >= 2: break
                dup = await session.execute(select(Enrollment).where(and_(Enrollment.student_id == s.user_id, Enrollment.course_id == c.course_id)))
                if not dup.scalars().first():
                    e = Enrollment(enrollment_code=await _next_enrollment_code(session), student_id=s.user_id, course_id=c.course_id, status=True)
                    session.add(e)
                    created["enrollments"] += 1

            att_dup = await session.execute(select(Attendance).where(and_(Attendance.user_id == s.user_id, Attendance.attendance_date == get_now_local().date())))
            if not att_dup.scalars().first():
                session.add(Attendance(user_id=s.user_id, attendance_date=get_now_local().date(), check_today=True))
                created["attendance"] += 1

        await session.commit()
        return JSONResponse({"status_code": 200, "message": "Sample data seeded", "data": created})

    async def purge_all_data_except_admin(request: Request, session: AsyncSession):
        if not await validating_admin_role(request):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # Tables that can be fully wiped
        tables = [
            "activity_logs", "refresh_tokens", "parent_student", "grades",
            "attendances", "staff_attendance", "payments", "enrollments",
            "timetables", "batches", "subjects", "courses", "academic_years", "rooms",
            "journal_entry_lines", "journal_entries", "expenses"
        ]
        
        from app.core.database_initialization import engine
        dialect_name = engine.dialect.name
        if "sqlite" in dialect_name:
            # SQLite does not support TRUNCATE and CASCADE
            await session.execute(text("PRAGMA foreign_keys = OFF;"))
            for t in tables:
                await session.execute(text(f"DELETE FROM {t};"))
            # Delete non-admin users
            await session.execute(delete(User).where(User.role != "admin"))
            # Reset SQLite sequences
            await session.execute(text("DELETE FROM sqlite_sequence;"))
            await session.execute(text("PRAGMA foreign_keys = ON;"))
        else:
            # PostgreSQL or other dialects
            truncate_query = f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE;"
            await session.execute(text(truncate_query))
            
            # Delete non-admin users
            await session.execute(delete(User).where(User.role != "admin"))
            
            # Reset users sequence to avoid gaps
            res = await session.execute(select(func.max(User.user_id)))
            max_id = res.scalar() or 0
            if "postgresql" in dialect_name:
                await session.execute(text(f"SELECT setval('users_user_id_seq', {max_id}, true)"))

        await session.commit()
        return JSONResponse({"status_code": 200, "message": "Purged all data except admin accounts and base structure"})
        
    async def get_all_users(request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
            
        query = select(User)
        result = await session.execute(query)
        users = result.scalars().all()
        return {"status_code": 200, "message": "All users fetched", "data": users}

    # CRUD - Academic Year

    async def create_academic_year(request: Request, session: AsyncSession, payload: AdminAcademicYearCreate):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        existing = await session.execute(select(AcademicYear).where(AcademicYear.academic_year_name == payload.academic_year_name))
        if existing.scalars().first():
            return JSONResponse({"status_code": 409, "message": "Academic year already exists"}, status_code=409)

        new_academic_year = AcademicYear(
            academic_year_name=payload.academic_year_name,
            start_date=datetime.strptime(payload.start_date, "%Y-%m-%d"),
            end_date=datetime.strptime(payload.end_date, "%Y-%m-%d"),
        )
        session.add(new_academic_year)
        await session.commit()
        await session.refresh(new_academic_year)
        await log_activity(request, session, "Create Academic Year", f"Academic year '{payload.academic_year_name}' created")
        return JSONResponse({"status_code": 201, "message": "Academic year created successfully", "data": _serialize_academic_year(new_academic_year)}, status_code=201)
        
    async def get_all_academic_years(request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True, allow_student_affairs=True):
            return {"message": "You are not authorized to perform this action"}
        
        from app.core.cache import cache_manager
        cache_key = "academic_years:list"
        cached = await cache_manager.get(cache_key)
        if cached is not None:
            return JSONResponse({"status_code": 200, "message": "Fetched all academic years", "data": cached})
        
        query = select(AcademicYear)
        result = await session.execute(query)
        years = result.scalars().all()
        data = [_serialize_academic_year(y) for y in years]
        await cache_manager.set(cache_key, data, expire=300)  # 5 min TTL
        return JSONResponse({"status_code": 200, "message": "Fetched all academic years", "data": data})
        
    async def get_specific_academic_details(academic_year_id: int ,request: Request , session:AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True, allow_student_affairs=True):
            return {"message": "You are not authorized to perform this action"}
        
        query = select(AcademicYear).where(AcademicYear.academic_year_id == academic_year_id)
        result = await session.execute(query)
        academic_year = result.scalars().first()
        if not academic_year:
            return JSONResponse({"message": "Academic year not found"}, status_code=404)
        return {"status_code": 200, "message": "Academic detail fetched successfully", "data": academic_year}
        
    async def update_academic_year(academic_year_id: int, request: Request, session: AsyncSession, payload: AdminAcademicYearUpdate):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
            
        query = select(AcademicYear).where(AcademicYear.academic_year_id == academic_year_id)
        result = await session.execute(query)
        target_year = result.scalars().first()
        
        if not target_year:
            return JSONResponse({"message": "Academic year not found"}, status_code=404)
            
        if payload.academic_year_name is not None:
            target_year.academic_year_name = payload.academic_year_name
        if payload.start_date is not None:
            target_year.start_date = datetime.strptime(payload.start_date, "%Y-%m-%d")
        if payload.end_date is not None:
            target_year.end_date = datetime.strptime(payload.end_date, "%Y-%m-%d")
        
        await session.commit()
        await log_activity(request, session, "Update Academic Year", f"Academic year ID {academic_year_id} updated")
        return JSONResponse({"status_code": 200, "message": "Academic year updated successfully", "data": _serialize_academic_year(target_year)})
        
    async def delete_academic_year(academic_year_id: int, request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True):
            return {"message": "You are not authorized to perform this action"}
            
        query = select(AcademicYear).where(AcademicYear.academic_year_id == academic_year_id)
        result = await session.execute(query)
        target_year = result.scalars().first()
        
        if not target_year:
            return JSONResponse({"message": "Academic year not found"}, status_code=404)
            
        await session.delete(target_year)
        await session.commit()
        await log_activity(request, session, "Delete Academic Year", f"Academic year ID {academic_year_id} deleted")
        return JSONResponse({"status_code": 200, "message": "Academic year deleted successfully"})

    # CRUD - Courses

    async def list_courses(request: Request, session: AsyncSession, page: int = 1, limit: int = 50):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        from app.core.cache import cache_manager
        cache_key = f"courses:list:{page}:{limit}"
        cached = await cache_manager.get(cache_key)
        if cached is not None:
            return JSONResponse(cached)
        
        offset = (page - 1) * limit
        query = select(Course).order_by(Course.created_at.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        courses = result.scalars().all()

        count_query = select(func.count(Course.course_id))
        count_result = await session.execute(count_query)
        total_count = count_result.scalar() or 0

        response_data = {
            "status_code": 200,
            "message": "Courses fetched successfully",
            "data": [_serialize_course(c) for c in courses],
            "pagination": {
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit if limit > 0 else 0,
                "current_page": page,
                "limit": limit
            }
        }
        await cache_manager.set(cache_key, response_data, expire=120)  # 2 min TTL
        return JSONResponse(response_data)

    async def get_dashboard_summary(request: Request, session: AsyncSession):
        """Fetch multiple KPI counts efficiently for the dashboard. Results cached for 60s."""
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        from app.core.cache import cache_manager
        cache_key = "dashboard:summary"
        cached = await cache_manager.get(cache_key)
        if cached is not None:
            return JSONResponse({"status_code": 200, "message": "Dashboard summary fetched successfully", "data": cached})
        
        # Execute count queries cleanly
        stu_q = select(func.count(User.user_id)).where(User.role == "student")
        crs_q = select(func.count(Course.course_id))
        enr_q = select(func.count(Enrollment.enrollment_id)).where(Enrollment.status == True)
        from datetime import date
        today = date.today()
        att_q = select(func.count(Attendance.attendance_id)).where(Attendance.attendance_date == today)
        
        total_students = (await session.execute(stu_q)).scalar() or 0
        total_courses = (await session.execute(crs_q)).scalar() or 0
        active_enrollments = (await session.execute(enr_q)).scalar() or 0
        today_attendance = (await session.execute(att_q)).scalar() or 0
        
        summary = {
            "total_students": total_students,
            "total_courses": total_courses,
            "active_enrollments": active_enrollments,
            "today_attendance_count": today_attendance
        }
        await cache_manager.set(cache_key, summary, expire=60)  # 60s TTL — refreshes every minute
        
        return JSONResponse({
            "status_code": 200,
            "message": "Dashboard summary fetched successfully",
            "data": summary
        })

    async def create_course(request: Request, session: AsyncSession, payload: AdminCourseCreate):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        year = await session.execute(select(AcademicYear).where(AcademicYear.academic_year_id == payload.academic_year_id))
        if not year.scalars().first():
            return JSONResponse({"status_code": 404, "message": "Academic year not found"}, status_code=404)

        instructor_id = None
        if payload.instructor_user_code:
            u = await session.execute(select(User).where(User.user_code == payload.instructor_user_code))
            inst = u.scalars().first()
            if not inst:
                return JSONResponse({"status_code": 404, "message": "Instructor not found"}, status_code=404)
            instructor_id = inst.user_id

        course_code = await _next_course_code(session)
        new_course = Course(
            course_code=course_code,
            course_name=payload.course_name,
            academicyear_id=payload.academic_year_id,
            instructor_id=instructor_id,
            fee_full_payment=payload.fee_full_payment,
            fee_installment=payload.fee_installment,
            exam_fee_gbp=payload.exam_fee_gbp,
            foc_items=payload.foc_items,
            foc_items_installment=payload.foc_items_installment,
            category=payload.category,
        )
        session.add(new_course)
        await session.commit()
        await session.refresh(new_course)
        await log_activity(request, session, "Create Course", f"Course {course_code} ({payload.course_name}) created")
        # Invalidate courses and dashboard caches
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("courses:list:*")
        await cache_manager.delete("dashboard:summary")
        return JSONResponse({"status_code": 201, "message": "Course created successfully", "data": _serialize_course(new_course)}, status_code=201)

    async def update_course(request: Request, session: AsyncSession, course_code: str, payload: AdminCourseUpdate):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        r = await session.execute(select(Course).where(Course.course_code == course_code))
        course = r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)

        if payload.course_name is not None:
            course.course_name = payload.course_name
        if payload.academic_year_id is not None:
            y = await session.execute(select(AcademicYear).where(AcademicYear.academic_year_id == payload.academic_year_id))
            if not y.scalars().first():
                return JSONResponse({"status_code": 404, "message": "Academic year not found"}, status_code=404)
            course.academicyear_id = payload.academic_year_id
        if payload.instructor_user_code is not None:
            if payload.instructor_user_code == "":
                course.instructor_id = None
            else:
                u = await session.execute(select(User).where(User.user_code == payload.instructor_user_code))
                inst = u.scalars().first()
                if inst: course.instructor_id = inst.user_id
        if getattr(payload, "fee_full_payment", None) is not None:
            course.fee_full_payment = payload.fee_full_payment
        if getattr(payload, "fee_installment", None) is not None:
            course.fee_installment = payload.fee_installment
        if getattr(payload, "exam_fee_gbp", None) is not None:
            course.exam_fee_gbp = payload.exam_fee_gbp
        if getattr(payload, "foc_items", None) is not None:
            course.foc_items = payload.foc_items
        if getattr(payload, "foc_items_installment", None) is not None:
            course.foc_items_installment = payload.foc_items_installment
        if getattr(payload, "category", None) is not None:
            course.category = payload.category

        await session.commit()
        await log_activity(request, session, "Update Course", f"Course {course_code} updated")
        # Invalidate courses cache
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("courses:list:*")
        return JSONResponse({"status_code": 200, "message": "Course updated successfully", "data": _serialize_course(course)})

    async def delete_course(request: Request, session: AsyncSession, course_code: str):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        r = await session.execute(select(Course).where(Course.course_code == course_code))
        course = r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)
        await session.delete(course)
        await session.commit()
        await log_activity(request, session, "Delete Course", f"Course {course_code} deleted")
        # Invalidate courses and dashboard caches
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("courses:list:*")
        await cache_manager.delete("dashboard:summary")
        return JSONResponse({"status_code": 200, "message": "Course deleted successfully"})

    # --- CRUD - Batches ---

    async def list_batches(request: Request, session: AsyncSession, course_id: Optional[int] = None):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        q = select(Batch, Course).join(Course, Batch.course_id == Course.course_id)
        if course_id:
            q = q.where(Batch.course_id == course_id)
        
        res = await session.execute(q)
        data = []
        for b, c in res:
            d = _serialize_batch(b)
            d["course_name"] = c.course_name
            data.append(d)
            
        return JSONResponse({"status_code": 200, "message": "Batches fetched successfully", "data": data})

    async def create_batch(request: Request, session: AsyncSession, payload: AdminBatchCreate):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        # Check course
        c_r = await session.execute(select(Course).where(Course.course_id == payload.course_id))
        course = c_r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)
        
        # Check for duplicate
        dup_r = await session.execute(select(Batch).where(and_(Batch.course_id == payload.course_id, Batch.batch_no == payload.batch_no)))
        if dup_r.scalars().first():
            return JSONResponse({"status_code": 409, "message": f"A batch with number '{payload.batch_no}' already exists for this course"}, status_code=409)
            
        # Optional instructor
        inst_id = None
        if payload.instructor_user_code:
            i_r = await session.execute(select(User).where(User.user_code == payload.instructor_user_code))
            inst = i_r.scalars().first()
            if inst:
                inst_id = inst.user_id

        new_batch = Batch(
            batch_no=payload.batch_no,
            course_id=payload.course_id,
            start_date=datetime.strptime(payload.start_date, "%Y-%m-%d").date() if payload.start_date else None,
            end_date=datetime.strptime(payload.end_date, "%Y-%m-%d").date() if payload.end_date else None,
            room=payload.room,
            instructor_id=inst_id
        )
        session.add(new_batch)
        await session.commit()
        await session.refresh(new_batch)
        await log_activity(request, session, "Create Batch", f"Batch {payload.batch_no} created for course {course.course_name}")
        return JSONResponse({"status_code": 201, "message": "Batch created successfully", "data": _serialize_batch(new_batch)}, status_code=201)

    async def update_batch(request: Request, session: AsyncSession, batch_id: int, payload: AdminBatchUpdate):
        if not await validating_admin_role(request, allow_sales=True, allow_sales_update=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
            
        r = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
        batch = r.scalars().first()
        if not batch:
            return JSONResponse({"status_code": 404, "message": "Batch not found"}, status_code=404)
            
        if payload.batch_no is not None:
             if payload.batch_no != batch.batch_no:
                 # Check for duplicate
                 dup_r = await session.execute(select(Batch).where(and_(Batch.course_id == batch.course_id, Batch.batch_no == payload.batch_no)))
                 if dup_r.scalars().first():
                     return JSONResponse({"status_code": 409, "message": f"A batch with number '{payload.batch_no}' already exists for this course"}, status_code=409)
             batch.batch_no = payload.batch_no
        if payload.start_date is not None: batch.start_date = datetime.strptime(payload.start_date, "%Y-%m-%d").date()
        if payload.end_date is not None: batch.end_date = datetime.strptime(payload.end_date, "%Y-%m-%d").date()
        if payload.room is not None: batch.room = payload.room
        if payload.is_active is not None: batch.is_active = payload.is_active
        
        if payload.instructor_user_code is not None:
            i_r = await session.execute(select(User).where(User.user_code == payload.instructor_user_code))
            inst = i_r.scalars().first()
            if inst:
                batch.instructor_id = inst.user_id
            else:
                batch.instructor_id = None
                
        await session.commit()
        await log_activity(request, session, "Update Batch", f"Batch ID {batch_id} updated")
        return JSONResponse({"status_code": 200, "message": "Batch updated successfully", "data": _serialize_batch(batch)})

    async def delete_batch(request: Request, session: AsyncSession, batch_id: int):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        r = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
        batch = r.scalars().first()
        if not batch:
            return JSONResponse({"status_code": 404, "message": "Batch not found"}, status_code=404)
        await session.delete(batch)
        await session.commit()
        await log_activity(request, session, "Delete Batch", f"Batch ID {batch_id} deleted")
        return JSONResponse({"status_code": 200, "message": "Batch deleted successfully"})

    # --- CRUD - Subjects ---

    async def list_subjects(request: Request, session: AsyncSession, course_id: Optional[int] = None):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        q = select(Subject, Course).join(Course, Subject.course_id == Course.course_id)
        if course_id:
            q = q.where(Subject.course_id == course_id)
        
        res = await session.execute(q)
        data = []
        for s, c in res:
            d = _serialize_subject(s)
            d["course_name"] = c.course_name
            data.append(d)
            
        return JSONResponse({"status_code": 200, "message": "Subjects fetched successfully", "data": data})

    async def create_subject(request: Request, session: AsyncSession, payload: AdminSubjectCreate):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        # Check course
        c_r = await session.execute(select(Course).where(Course.course_id == payload.course_id))
        course = c_r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)
            
        # Check code uniqueness
        dup = await session.execute(select(Subject).where(Subject.subject_code == payload.subject_code))
        if dup.scalars().first():
            return JSONResponse({"status_code": 409, "message": f"Subject code {payload.subject_code} already exists"}, status_code=409)

        new_subject = Subject(
            subject_code=payload.subject_code,
            subject_name=payload.subject_name,
            course_id=payload.course_id,
            is_active=payload.is_active
        )
        session.add(new_subject)
        await session.commit()
        await session.refresh(new_subject)
        await log_activity(request, session, "Create Subject", f"Subject {payload.subject_code} created for course {course.course_name}")
        return JSONResponse({"status_code": 201, "message": "Subject created successfully", "data": _serialize_subject(new_subject)}, status_code=201)

    async def update_subject(request: Request, session: AsyncSession, subject_id: int, payload: AdminSubjectUpdate):
        if not await validating_admin_role(request, allow_sales=True, allow_sales_update=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
            
        r = await session.execute(select(Subject).where(Subject.subject_id == subject_id))
        subject = r.scalars().first()
        if not subject:
            return JSONResponse({"status_code": 404, "message": "Subject not found"}, status_code=404)
            
        if payload.subject_code is not None:
            # Check uniqueness if code is changed
            if payload.subject_code != subject.subject_code:
                dup = await session.execute(select(Subject).where(Subject.subject_code == payload.subject_code))
                if dup.scalars().first():
                    return JSONResponse({"status_code": 409, "message": f"Subject code {payload.subject_code} already exists"}, status_code=409)
            subject.subject_code = payload.subject_code
            
        if payload.subject_name is not None: subject.subject_name = payload.subject_name
        if payload.is_active is not None: subject.is_active = payload.is_active
                
        await session.commit()
        await log_activity(request, session, "Update Subject", f"Subject ID {subject_id} updated")
        return JSONResponse({"status_code": 200, "message": "Subject updated successfully", "data": _serialize_subject(subject)})

    async def delete_subject(request: Request, session: AsyncSession, subject_id: int):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        r = await session.execute(select(Subject).where(Subject.subject_id == subject_id))
        subject = r.scalars().first()
        if not subject:
            return JSONResponse({"status_code": 404, "message": "Subject not found"}, status_code=404)
        await session.delete(subject)
        await session.commit()
        await log_activity(request, session, "Delete Subject", f"Subject ID {subject_id} deleted")
        return JSONResponse({"status_code": 200, "message": "Subject deleted successfully"})

    # --- CRUD - Enrollments ---

    async def list_enrollments(request: Request, session: AsyncSession, status: bool = None, page: int = 1, limit: int = 50):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # --- Cache check ---
        from app.core.cache import cache_manager
        cache_key = f"enrollment:list:{page}:{limit}:{status}"
        cached = await cache_manager.get(cache_key)
        if cached is not None:
            return JSONResponse(cached)

        offset = (page - 1) * limit
        from app.models.model import Batch
        # Defer large text blobs: profile_picture (base64), address, password_hash
        base_q = select(Enrollment, User, Course, Batch).join(User, Enrollment.student_id == User.user_id).join(Course, Enrollment.course_id == Course.course_id).outerjoin(Batch, Enrollment.batch_id == Batch.batch_id).options(
            defer(User.address), defer(User.password_hash), defer(User.profile_picture), defer(User.signature)
        ).order_by(Enrollment.enrollment_date.desc(), Enrollment.enrollment_id.desc())

        if status is not None:
            base_q = base_q.where(Enrollment.status == status)

        # Count (run in parallel with data query context)
        count_q = select(func.count(Enrollment.enrollment_id))
        if status is not None:
            count_q = count_q.where(Enrollment.status == status)

        res_count = await session.execute(count_q)
        total_count = res_count.scalar() or 0

        paginated_q = base_q.offset(offset).limit(limit)
        r = await session.execute(paginated_q)
        rows = r.all()

        # Bulk-fetch payment summaries for this page's enrollments only
        enroll_ids = [row[0].enrollment_id for row in rows]

        pay_sums = {}
        pay_discounts = {}
        exam_paid_gbp = {}
        pay_counts = {}

        if enroll_ids:
            sum_q = select(
                Payment.enrollment_id,
                func.sum(Payment.amount + func.coalesce(Payment.amount_2, 0)).label("total"),
                func.sum(func.coalesce(Payment.discount_amount, 0)).label("discount"),
                func.sum(func.coalesce(Payment.exam_fee_paid_gbp, 0)).label("exam_gbp"),
                func.count(Payment.payment_id).label("p_count")
            ).where(Payment.enrollment_id.in_(enroll_ids)).group_by(Payment.enrollment_id)

            p_res = await session.execute(sum_q)
            for eid, total, disc, e_gbp, pcount in p_res:
                pay_sums[eid] = float(total or 0)
                pay_discounts[eid] = float(disc or 0)
                exam_paid_gbp[eid] = float(e_gbp or 0)
                pay_counts[eid] = int(pcount or 0)

        data = []
        for e, u, c, b in rows:
            d = _serialize_enrollment(e)
            d["student_code"] = u.user_code
            d["student_name"] = u.username
            d["course_code"] = c.course_code
            d["course_name"] = c.course_name
            d["room"] = getattr(c, "room", None)
            d["batch_start_date"] = b.start_date.isoformat() if b and b.start_date else None
            d["batch_end_date"] = b.end_date.isoformat() if b and b.end_date else None

            plan = getattr(e, "payment_plan", None)
            course_cost = float(getattr(e, "total_fee", 0.0) or (c.fee_full_payment if plan == "full" else (c.fee_installment if plan == "installment" else 0.0)) or 0.0)

            total_paid = pay_sums.get(e.enrollment_id, 0.0)
            total_discount = pay_discounts.get(e.enrollment_id, 0.0)
            paid_gbp = exam_paid_gbp.get(e.enrollment_id, 0.0)

            d["course_cost"] = course_cost
            d["total_paid"] = total_paid
            d["balance_due"] = max(0.0, course_cost - (total_paid + total_discount))
            d["exam_fee_paid_gbp"] = paid_gbp
            d["exam_fee_total_gbp"] = float(getattr(e, "exam_fee_gbp", 0.0) or c.exam_fee_gbp or 0.0)
            d["exam_fee_pending_gbp"] = max(0.0, d["exam_fee_total_gbp"] - paid_gbp)
            d["payment_count"] = pay_counts.get(e.enrollment_id, 0)

            d["foc_items"] = (c.foc_items_installment if plan == "installment" else c.foc_items)
            # Profile picture & signature are deferred from list to keep responses fast and lightweight
            d["profile_picture"] = None
            d["signature"] = None
            data.append(d)

        response_body = {
            "status_code": 200,
            "message": "Enrollments fetched successfully",
            "data": data,
            "pagination": {
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit if limit > 0 else 0,
                "current_page": page,
                "limit": limit
            }
        }
        # Cache the serialized response for 60 seconds
        await cache_manager.set(cache_key, response_body, expire=60)
        return JSONResponse(response_body)

    async def create_enrollment(request: Request, session: AsyncSession, payload: AdminEnrollmentCreate):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        stu_r = await session.execute(select(User).where(and_(User.user_code == payload.student_code, User.role == "student")))
        student = stu_r.scalars().first()
        if not student:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)

        c_r = await session.execute(select(Course).where(Course.course_code == payload.course_code))
        course = c_r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)

        # prevent duplicates
        dup_r = await session.execute(select(Enrollment).where(and_(Enrollment.student_id == student.user_id, Enrollment.course_id == course.course_id)))
        if dup_r.scalars().first():
            return JSONResponse({"status_code": 409, "message": "Student already enrolled in this course"}, status_code=409)

        # Find matching Batch if possible
        batch_id = payload.batch_id if payload.batch_id and payload.batch_id != 0 else None
        batch_no = payload.batch_no
        
        if not batch_id and batch_no:
            b_r = await session.execute(
                select(Batch).where(
                    and_(
                        Batch.course_id == course.course_id, 
                        func.lower(func.trim(Batch.batch_no)) == func.lower(batch_no.strip())
                    )
                )
            )
            batch = b_r.scalars().first()
            if batch:
                batch_id = batch.batch_id
                batch_no = batch.batch_no # Keep exact case from DB
            else:
                new_batch = Batch(
                    batch_no=batch_no.strip(),
                    course_id=course.course_id,
                    is_active=True
                )
                session.add(new_batch)
                await session.flush()
                batch_id = new_batch.batch_id
                batch_no = new_batch.batch_no
        elif batch_id and not batch_no:
            b_res = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
            batch = b_res.scalars().first()
            if batch:
                batch_no = batch.batch_no
            else:
                # If batch_id is provided but no matching batch found, clear batch_id
                batch_id = None


        enrollment_code = await _next_enrollment_code(session)
        e = Enrollment(
            enrollment_code=enrollment_code,
            student_id=student.user_id,
            course_id=course.course_id,
            batch_id=batch_id,
            status=payload.status,
            batch_no=batch_no,
            payment_plan=payload.payment_plan,
            downpayment=payload.downpayment,
            installment_amount=payload.installment_amount,
            total_fee=payload.total_fee if payload.total_fee is not None else (course.fee_full_payment if payload.payment_plan == "full" else course.fee_installment),
            exam_fee_gbp=payload.exam_fee_gbp if payload.exam_fee_gbp is not None else course.exam_fee_gbp
        )
        session.add(e)
        await session.commit()
        await session.refresh(e)
        await log_activity(request, session, "Create Enrollment", f"Enrollment {enrollment_code} created for student {payload.student_code} in course {payload.course_code}")
        # Invalidate enrollment list and room capacity caches so next read is fresh
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("enrollment:list:*")
        await cache_manager.delete("rooms:list")
        return JSONResponse({"status_code": 201, "message": "Enrollment created successfully", "data": _serialize_enrollment(e)}, status_code=201)

    async def update_enrollment(request: Request, session: AsyncSession, enrollment_code: str, payload: AdminEnrollmentUpdate):
        if not await validating_admin_role(request, allow_sales=True, allow_sales_update=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        r = await session.execute(select(Enrollment).where(Enrollment.enrollment_code == enrollment_code))
        e = r.scalars().first()
        if not e:
            return JSONResponse({"status_code": 404, "message": "Enrollment not found"}, status_code=404)

        # Only update fields that were explicitly sent in the request body
        update_fields = payload.dict(exclude_unset=True)

        if "status" in update_fields and update_fields["status"] is not None:
            e.status = update_fields["status"]

        # Batch resolution — only if batch_id or batch_no was explicitly sent
        if "batch_id" in update_fields or "batch_no" in update_fields:
            batch_id = update_fields.get("batch_id")
            batch_no = update_fields.get("batch_no")

            if batch_id and batch_id != 0:
                e.batch_id = batch_id
                b_res = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
                batch_o = b_res.scalars().first()
                if batch_o:
                    e.batch_no = batch_o.batch_no
            elif batch_no:
                b_r = await session.execute(
                    select(Batch).where(
                        and_(
                            Batch.course_id == e.course_id,
                            func.lower(func.trim(Batch.batch_no)) == func.lower(batch_no.strip())
                        )
                    )
                )
                batch = b_r.scalars().first()
                if batch:
                    e.batch_id = batch.batch_id
                    e.batch_no = batch.batch_no
                else:
                    new_batch = Batch(
                        batch_no=batch_no.strip(),
                        course_id=e.course_id,
                        is_active=True
                    )
                    session.add(new_batch)
                    await session.flush()
                    e.batch_id = new_batch.batch_id
                    e.batch_no = new_batch.batch_no
            else:
                e.batch_id = None
                e.batch_no = None

        if "payment_plan" in update_fields:
            e.payment_plan = update_fields["payment_plan"]
        if "downpayment" in update_fields:
            e.downpayment = update_fields["downpayment"]
        if "installment_amount" in update_fields:
            e.installment_amount = update_fields["installment_amount"]
        if "total_fee" in update_fields:
            e.total_fee = update_fields["total_fee"]
        if "exam_fee_gbp" in update_fields:
            e.exam_fee_gbp = update_fields["exam_fee_gbp"]

        await session.commit()
        await log_activity(request, session, "Update Enrollment", f"Enrollment {enrollment_code} updated")
        # Invalidate enrollment list and rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("enrollment:list:*")
        await cache_manager.delete("rooms:list")
        return JSONResponse({"status_code": 200, "message": "Enrollment updated successfully", "data": _serialize_enrollment(e)})

    async def delete_enrollment(request: Request, session: AsyncSession, enrollment_code: str):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        r = await session.execute(select(Enrollment).where(Enrollment.enrollment_code == enrollment_code))
        e = r.scalars().first()
        if not e:
            return JSONResponse({"status_code": 404, "message": "Enrollment not found"}, status_code=404)
        await session.delete(e)
        await session.commit()
        await log_activity(request, session, "Delete Enrollment", f"Enrollment {enrollment_code} deleted")
        # Invalidate enrollment list and rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("enrollment:list:*")
        await cache_manager.delete("rooms:list")
        return JSONResponse({"status_code": 200, "message": "Enrollment deleted successfully"})

    async def approve_student(request: Request, session: AsyncSession, user_id: int, payload: AdminStudentApprove):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        r = await session.execute(select(User).where(User.user_id == user_id))
        u = r.scalars().first()
        if not u:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)
        
        old_code = u.user_code
        # Apply new code if provided or auto-generated
        if payload.user_code:
            # Check for conflict
            dup = await session.execute(select(User).where(and_(User.user_code == payload.user_code, User.user_id != user_id)))
            if dup.scalars().first():
                 return JSONResponse({"status_code": 409, "message": f"Student code {payload.user_code} already exists"}, status_code=409)
            u.user_code = payload.user_code
        elif payload.auto_prefix:
            new_code = await _next_student_code(session, manual_prefix=payload.auto_prefix)
            u.user_code = new_code
            
        u.is_active = True
        u.student_type = "Active Student"
        
        # Also activate all their enrollments
        en_r = await session.execute(select(Enrollment).where(Enrollment.student_id == u.user_id))
        enrollments = en_r.scalars().all()
        for e in enrollments:
            e.status = True
            
        await session.commit()
        await log_activity(request, session, "Approve Student", f"Student {u.user_code} (was {old_code}) and their enrollments were approved and activated")

        # Invalidate student list, enrollment list, and dashboard cache
        from app.core.cache import cache_manager
        await cache_manager.delete_pattern("students:list:*")
        await cache_manager.delete_pattern("enrollment:list:*")
        await cache_manager.delete("dashboard:summary")
        await cache_manager.delete(f"user:{u.user_code.lower()}")
        await cache_manager.delete(f"me:{u.user_code.lower()}")

        return JSONResponse({"status_code": 200, "message": "Student approved successfully", "data": {"user_code": u.user_code}})

    # CRUD - Attendance

    async def mark_attendance(request: Request, session: AsyncSession, payload: AttendanceMarkRequest):
        """Mark attendance for a student. One record allowed per student per day per slot/subject."""
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # Resolve user_code -> user_id
        user_query = select(User).where(and_(User.user_code == payload.student_code, User.role == "student"))
        user_result = await session.execute(user_query)
        student = user_result.scalars().first()
        if not student:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)

        today = get_now_local().date()
        if payload.attendance_date:
            try:
                today = datetime.strptime(payload.attendance_date, "%Y-%m-%d").date()
            except ValueError:
                pass

        # Resolve Course/Batch if not explicitly provided
        course_id = payload.course_id
        batch_id = None
        # subject_id comes from payload first (staff override), fall back to timetable default later
        subject_id = payload.subject_id
        
        # If timetable_id is provided, resolve course_id and batch_id from it.
        # subject_id from timetable is only used as fallback if staff did NOT explicitly pick one.
        if payload.timetable_id:
            tt_r = await session.execute(select(TimeTable).where(TimeTable.timetable_id == payload.timetable_id))
            tt = tt_r.scalars().first()
            if tt:
                if not course_id: course_id = tt.course_id
                if not batch_id: batch_id = tt.batch_id
                # Only use timetable subject as default if staff didn't pass an explicit subject
                if subject_id is None: subject_id = tt.subject_id

        # If course_id is still not resolved, we try to find the active enrollment
        if not course_id:
            enroll_q = select(Enrollment, Batch, Course).outerjoin(Batch, Enrollment.batch_id == Batch.batch_id).join(Course, Enrollment.course_id == Course.course_id).where(
                and_(
                    Enrollment.student_id == student.user_id,
                    Enrollment.status == True
                )
            )
            er = await session.execute(enroll_q)
            row = er.first()
            if row:
                active_enroll, active_batch, active_course = row
                course_id = active_course.course_id
                if not batch_id: batch_id = active_batch.batch_id if active_batch else None
            else:
                return JSONResponse({"status_code": 404, "message": "No active enrollment found for student, and no course_id could be resolved."}, status_code=404)
        elif not batch_id:
            # If course_id provided but no batch_id yet, still try to find matching batch for this student if any
            batch_q = select(Enrollment.batch_id).where(and_(Enrollment.student_id == student.user_id, Enrollment.course_id == course_id, Enrollment.status == True))
            br = await session.execute(batch_q)
            batch_id = br.scalars().first()

        # ── Batch start date guard ─────────────────────────────────────────
        if batch_id:
            batch_r = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
            batch_obj = batch_r.scalars().first()
            if batch_obj:
                if not batch_obj.is_active:
                    return JSONResponse(
                        {"status_code": 400, "message": "This batch has ended and no longer accepts attendance."},
                        status_code=400
                    )
                if batch_obj.start_date and today < batch_obj.start_date:
                    return JSONResponse(
                        {
                            "status_code": 400,
                            "message": f"This batch has not started yet. Batch starts on {batch_obj.start_date}. Attendance can only be marked from the start date."
                        },
                        status_code=400
                    )
        # ──────────────────────────────────────────────────────────────────

        # ── One-per-day-per-subject guard ──────────────────────────────────
        dup_filters = [
            Attendance.user_id == student.user_id,
            Attendance.attendance_date == today
        ]
        if subject_id:
            dup_filters.append(Attendance.subject_id == subject_id)
        else:
            dup_filters.append(Attendance.slot == payload.slot)
            dup_filters.append(Attendance.subject_id == None)

        duplicate_query = select(Attendance).where(and_(*dup_filters))
        duplicate_result = await session.execute(duplicate_query)
        existing = duplicate_result.scalars().first()
        if existing:
            subject_msg = f" for subject ID {payload.subject_id}" if payload.subject_id else ""
            return JSONResponse(
                {
                    "status_code": 409,
                    "message": f"Attendance already marked for student '{payload.student_code}' today ({today}) slot '{payload.slot}'{subject_msg}"
                },
                status_code=409
            )
        # ──────────────────────────────────────────────────────────────────

        new_record = Attendance(
            user_id=student.user_id,
            course_id=course_id,
            batch_id=batch_id,
            subject_id=subject_id,
            timetable_id=payload.timetable_id,
            attendance_date=today,
            slot=payload.slot,
            check_today=payload.check_today
        )
        session.add(new_record)
        await session.commit()
        await session.refresh(new_record)
        
        log_msg = f"Attendance marked for {payload.student_code} slot={payload.slot}"
        if payload.subject_id: log_msg += f" subject_id={payload.subject_id}"
        await log_activity(request, session, "Mark Attendance", log_msg)
        
        return JSONResponse({
            "status_code": 201,
            "message": "Attendance marked successfully",
            "data": {
                "attendance_id": new_record.attendance_id,
                "student_code": payload.student_code,
                "attendance_date": str(new_record.attendance_date),
                "slot": new_record.slot,
                "check_today": new_record.check_today,
                "course_id": new_record.course_id,
                "subject_id": new_record.subject_id
            }
        }, status_code=201)

    async def get_all_attendance(request: Request, session: AsyncSession, days: int = 30):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        q = (
            select(Attendance, User, TimeTable, User.username.label("teacher_name"))
            .join(User, Attendance.user_id == User.user_id)
            .outerjoin(TimeTable, Attendance.timetable_id == TimeTable.timetable_id)
            .outerjoin(User, TimeTable.teacher_id == User.user_id) # This gives us the teacher's name
            .options(
                # Use a specific label alias for the teacher's name to avoid conflict with student's name
                defer(User.address), 
                defer(User.password_hash)
            )
            .order_by(Attendance.attendance_date.desc(), Attendance.attendance_id.desc())
        )
        
        # We need a way to get the teacher's name specifically.
        # SQLAlchemy join with the same table multiple times requires aliased()
        from sqlalchemy.orm import aliased
        Teacher = aliased(User)
        q = (
            select(Attendance, User, TimeTable, Teacher.username.label("teacher_name"), Course.course_name, Subject.subject_name)
            .join(User, Attendance.user_id == User.user_id)
            .outerjoin(Course, Attendance.course_id == Course.course_id)
            .outerjoin(Subject, Attendance.subject_id == Subject.subject_id)
            .outerjoin(TimeTable, Attendance.timetable_id == TimeTable.timetable_id)
            .outerjoin(Teacher, TimeTable.teacher_id == Teacher.user_id)
            .order_by(Attendance.attendance_date.desc(), Attendance.attendance_id.desc())
        )

        if days is not None:
            cutoff = get_now_local().date() - timedelta(days=days)
            q = q.where(Attendance.attendance_date >= cutoff)
            
        result = await session.execute(q)
        rows = result.all()
        return JSONResponse({
            "status_code": 200,
            "message": "Attendance records fetched successfully",
            "data": [
                {
                    "attendance_id": a.attendance_id,
                    "user_id": a.user_id,
                    "user_code": u.user_code,
                    "username": u.username,
                    "attendance_date": str(a.attendance_date),
                    "slot": a.slot,
                    "check_today": a.check_today,
                    "profile_picture": None,
                    "timetable_id": a.timetable_id,
                    "teacher_name": teacher_name,
                    "course_name": course_name,
                    "subject_name": subject_name,
                    "time_range": f"{t.start_time} - {t.end_time}" if t else None
                }
                for a, u, t, teacher_name, course_name, subject_name in rows
            ],
        })

    async def get_specific_attendance(request: Request, session: AsyncSession, student_code: str):
        """Get all attendance records for a specific student (admin or parent)."""
        is_admin = await validating_admin_role(request)
        is_parent = await validating_parent_role(request)
        if not is_admin and not is_parent:
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # Resolve student_code -> user_id
        user_query = select(User).where(and_(User.user_code == student_code, User.role == "student"))
        user_result = await session.execute(user_query)
        student = user_result.scalars().first()
        if not student:
            return JSONResponse({"status_code": 404, "message": "Student not found"}, status_code=404)

        query = select(Attendance).where(Attendance.user_id == student.user_id)
        result = await session.execute(query)
        records = result.scalars().all()
        return JSONResponse({
            "status_code": 200,
            "message": "Attendance records fetched successfully",
            "data": [
                {
                    "attendance_id": r.attendance_id,
                    "user_id": r.user_id,
                    "attendance_date": str(r.attendance_date),
                    "slot": r.slot,
                    "check_today": r.check_today
                }
                for r in records
            ]
        })

    async def update_attendance(request: Request, session: AsyncSession, attendance_id: int, payload: AttendanceUpdateRequest):
        """Update the check_today status of an attendance record."""
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        query = select(Attendance).where(Attendance.attendance_id == attendance_id)
        result = await session.execute(query)
        record = result.scalars().first()
        if not record:
            return JSONResponse({"status_code": 404, "message": "Attendance record not found"}, status_code=404)

        record.check_today = payload.check_today
        await session.commit()
        await log_activity(request, session, "Update Attendance", f"Attendance ID {attendance_id} updated to {payload.check_today}")
        return JSONResponse({
            "status_code": 200,
            "message": "Attendance updated successfully",
            "data": {
                "attendance_id": record.attendance_id,
                "attendance_date": str(record.attendance_date),
                "check_today": record.check_today
            }
        })

    # ── Batch lifecycle ────────────────────────────────────────────────────

    async def end_batch(request: Request, session: AsyncSession, batch_id: int):
        """Explicitly end a batch — sets is_active = False regardless of dates."""
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
        batch = r.scalars().first()
        if not batch:
            return JSONResponse({"status_code": 404, "message": "Batch not found"}, status_code=404)

        if not batch.is_active:
            return JSONResponse({"status_code": 409, "message": "Batch is already ended"}, status_code=409)

        batch.is_active = False
        if not batch.end_date:
            batch.end_date = get_now_local().date()
        await session.commit()
        await log_activity(request, session, "End Batch", f"Batch ID {batch_id} ({batch.batch_no}) explicitly ended")
        return JSONResponse({
            "status_code": 200,
            "message": "Batch ended successfully",
            "data": {"batch_id": batch_id, "batch_no": batch.batch_no, "is_active": False}
        })

    async def get_batch_students(request: Request, session: AsyncSession, batch_id: int):
        """Return all students enrolled in a specific batch."""
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
        batch = r.scalars().first()
        if not batch:
            return JSONResponse({"status_code": 404, "message": "Batch not found"}, status_code=404)

        q = (
            select(Enrollment, User)
            .join(User, Enrollment.student_id == User.user_id)
            .where(and_(Enrollment.batch_id == batch_id, Enrollment.status == True))
        )
        res = await session.execute(q)
        students = [
            {
                "student_code": u.user_code,
                "student_name": u.username,
                "enrollment_id": e.enrollment_id,
                "profile_picture": u.profile_picture,
            }
            for e, u in res.all()
        ]
        return JSONResponse({"status_code": 200, "message": "Batch students fetched", "data": students})

    async def get_batch_attendance(request: Request, session: AsyncSession, batch_id: int, start_date: str = None, end_date: str = None):
        """Return attendance records for a specific batch, optionally filtered by date range."""
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        from sqlalchemy.orm import aliased
        Teacher = aliased(User)
        q = (
            select(Attendance, User, Subject, Teacher.username.label("teacher_name"), TimeTable)
            .join(User, Attendance.user_id == User.user_id)
            .outerjoin(Subject, Attendance.subject_id == Subject.subject_id)
            .outerjoin(TimeTable, Attendance.timetable_id == TimeTable.timetable_id)
            .outerjoin(Teacher, TimeTable.teacher_id == Teacher.user_id)
            .where(Attendance.batch_id == batch_id)
            .order_by(Attendance.attendance_date.desc(), Attendance.attendance_id.desc())
        )
        if start_date:
            try:
                sd = datetime.strptime(start_date, "%Y-%m-%d").date()
                q = q.where(Attendance.attendance_date >= sd)
            except ValueError:
                pass
        if end_date:
            try:
                ed = datetime.strptime(end_date, "%Y-%m-%d").date()
                q = q.where(Attendance.attendance_date <= ed)
            except ValueError:
                pass

        res = await session.execute(q)
        rows = res.all()
        return JSONResponse({
            "status_code": 200,
            "message": "Batch attendance fetched successfully",
            "data": [
                {
                    "attendance_id": a.attendance_id,
                    "user_id": a.user_id,
                    "user_code": u.user_code,
                    "username": u.username,
                    "profile_picture": u.profile_picture,
                    "attendance_date": str(a.attendance_date),
                    "slot": a.slot,
                    "check_today": a.check_today,
                    "subject_id": a.subject_id,
                    "subject_name": sub.subject_name if sub else None,
                    "timetable_id": a.timetable_id,
                    "teacher_name": teacher_name,
                    "time_range": f"{t.start_time} - {t.end_time}" if t else None,
                }
                for a, u, sub, teacher_name, t in rows
            ],
        })

    async def get_batch_attendance_report(request: Request, session: AsyncSession, batch_id: int, month: Optional[str] = None):
        """Compute per-student attendance report for a batch: overall, monthly, weekly breakdowns and specific month filters."""
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(Batch).where(Batch.batch_id == batch_id))
        batch = r.scalars().first()
        if not batch:
            return JSONResponse({"status_code": 404, "message": "Batch not found"}, status_code=404)

        today = get_now_local().date()
        one_week_ago = today - timedelta(days=7)
        one_month_ago = today - timedelta(days=30)

        # Get all enrolled students
        enroll_q = (
            select(Enrollment, User)
            .join(User, Enrollment.student_id == User.user_id)
            .where(and_(Enrollment.batch_id == batch_id, Enrollment.status == True))
        )
        enroll_res = await session.execute(enroll_q)
        students = {u.user_id: {"user_code": u.user_code, "username": u.username, "profile_picture": u.profile_picture} for e, u in enroll_res.all()}

        if not students:
            return JSONResponse({
                "status_code": 200,
                "message": "No students enrolled in this batch",
                "data": {"batch_id": batch_id, "batch_no": batch.batch_no, "students": [], "available_months": [], "month_filter": month}
            })

        # Get all attendance for this batch
        att_q = select(Attendance).where(Attendance.batch_id == batch_id).order_by(Attendance.attendance_date)
        att_res = await session.execute(att_q)
        all_records = att_res.scalars().all()

        # Get distinct months of attendance
        available_months = sorted(list(set(rec.attendance_date.strftime("%Y-%m") for rec in all_records)), reverse=True)

        # Build per-student stats
        student_stats = {}
        for uid, info in students.items():
            student_stats[uid] = {
                "user_code": info["user_code"],
                "username": info["username"],
                "profile_picture": info["profile_picture"],
                "overall_total": 0, "overall_present": 0,
                "month_total": 0, "month_present": 0,
                "week_total": 0, "week_present": 0,
                "specific_total": 0, "specific_present": 0,
            }

        for rec in all_records:
            uid = rec.user_id
            if uid not in student_stats:
                continue
            stats = student_stats[uid]
            # Overall
            stats["overall_total"] += 1
            if rec.check_today:
                stats["overall_present"] += 1
            # Monthly (last 30 days)
            if rec.attendance_date >= one_month_ago:
                stats["month_total"] += 1
                if rec.check_today:
                    stats["month_present"] += 1
            # Weekly (last 7 days)
            if rec.attendance_date >= one_week_ago:
                stats["week_total"] += 1
                if rec.check_today:
                    stats["week_present"] += 1
            # Specific month filter (YYYY-MM)
            if month and rec.attendance_date.strftime("%Y-%m") == month:
                stats["specific_total"] += 1
                if rec.check_today:
                    stats["specific_present"] += 1

        def pct(present, total):
            if total == 0:
                return None
            return round((present / total) * 100, 1)

        report_students = []
        for uid, stats in student_stats.items():
            report_students.append({
                "user_code": stats["user_code"],
                "username": stats["username"],
                "profile_picture": stats["profile_picture"],
                "overall": {
                    "present": stats["overall_present"],
                    "total": stats["overall_total"],
                    "percentage": pct(stats["overall_present"], stats["overall_total"]),
                },
                "month": {
                    "present": stats["month_present"],
                    "total": stats["month_total"],
                    "percentage": pct(stats["month_present"], stats["month_total"]),
                },
                "week": {
                    "present": stats["week_present"],
                    "total": stats["week_total"],
                    "percentage": pct(stats["week_present"], stats["week_total"]),
                },
                "monthly_specific": {
                    "present": stats["specific_present"],
                    "total": stats["specific_total"],
                    "percentage": pct(stats["specific_present"], stats["specific_total"]),
                } if month else None
            })

        # Sort by specific month percentage if filtered, else overall percentage desc
        if month:
            report_students.sort(key=lambda x: x["monthly_specific"]["percentage"] if x["monthly_specific"]["percentage"] is not None else -1, reverse=True)
        else:
            report_students.sort(key=lambda x: x["overall"]["percentage"] if x["overall"]["percentage"] is not None else -1, reverse=True)

        # Batch-level totals (all unique class dates for the batch)
        unique_dates = set(r.attendance_date for r in all_records)
        total_classes = len(unique_dates)
        recent_month_dates = {r.attendance_date for r in all_records if r.attendance_date >= one_month_ago}
        recent_week_dates = {r.attendance_date for r in all_records if r.attendance_date >= one_week_ago}
        specific_month_dates = {r.attendance_date for r in all_records if month and r.attendance_date.strftime("%Y-%m") == month}

        return JSONResponse({
            "status_code": 200,
            "message": "Batch attendance report generated",
            "data": {
                "batch_id": batch_id,
                "batch_no": batch.batch_no,
                "start_date": str(batch.start_date) if batch.start_date else None,
                "end_date": str(batch.end_date) if batch.end_date else None,
                "is_active": batch.is_active,
                "total_classes_overall": total_classes,
                "total_classes_month": len(recent_month_dates),
                "total_classes_week": len(recent_week_dates),
                "total_classes_specific_month": len(specific_month_dates) if month else 0,
                "available_months": available_months,
                "month_filter": month,
                "students": report_students,
            }
        })

    # CRUD - Rooms + Availability


    async def list_rooms(request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # Check Cache
        from app.core.cache import cache_manager
        cache_key = "rooms:list"
        cached = await cache_manager.get(cache_key)
        if cached is not None:
            return JSONResponse(cached)

        r = await session.execute(select(Room))
        rooms = r.scalars().all()

        # Single bulk query for active enrollment counts grouped by (course_id, batch_id)
        en_q = select(
            Enrollment.course_id,
            Enrollment.batch_id,
            func.count(Enrollment.enrollment_id)
        ).where(Enrollment.status == True).group_by(Enrollment.course_id, Enrollment.batch_id)
        en_res = await session.execute(en_q)

        batch_counts = {}
        course_total_counts = defaultdict(int)
        for c_id, b_id, cnt in en_res.all():
            count_val = int(cnt or 0)
            batch_counts[(c_id, b_id)] = count_val
            course_total_counts[c_id] += count_val

        # Single bulk query for timetable room assignments
        tt_q = select(
            TimeTable.room_name,
            TimeTable.course_id,
            TimeTable.batch_id
        ).where(TimeTable.room_name.isnot(None)).distinct()
        tt_res = await session.execute(tt_q)
        room_timetable_pairs = defaultdict(list)
        for r_name, c_id, b_id in tt_res.all():
            if r_name:
                room_timetable_pairs[r_name].append((c_id, b_id))

        # Single bulk query for default courses assigned to rooms
        crs_q = select(Course.room, Course.course_id).where(Course.room.isnot(None))
        crs_res = await session.execute(crs_q)
        default_room_courses = defaultdict(list)
        for r_name, c_id in crs_res.all():
            if r_name:
                default_room_courses[r_name].append(c_id)

        data = []
        for room in rooms:
            pairs = room_timetable_pairs.get(room.room_name, [])
            max_load = 0
            for c_id, b_id in pairs:
                if b_id:
                    cnt = batch_counts.get((c_id, b_id), 0)
                else:
                    cnt = course_total_counts.get(c_id, 0)
                if cnt > max_load:
                    max_load = cnt

            # Also consider default courses for this room not already in timetable pairs
            for c_id in default_room_courses.get(room.room_name, []):
                if any(p[0] == c_id for p in pairs):
                    continue
                cnt = course_total_counts.get(c_id, 0)
                if cnt > max_load:
                    max_load = cnt

            d = _serialize_room(room)
            d["current_load"] = max_load
            d["is_full"] = max_load >= room.capacity if room.capacity > 0 else False
            data.append(d)

        response_body = {"status_code": 200, "message": "Rooms fetched successfully", "data": data}
        await cache_manager.set(cache_key, response_body, expire=60)
        return JSONResponse(response_body)

    async def create_room(request: Request, session: AsyncSession, payload: AdminRoomCreate):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        exists = await session.execute(select(Room).where(Room.room_name == payload.room_name))
        if exists.scalars().first():
            return JSONResponse({"status_code": 409, "message": "Room name already exists"}, status_code=409)

        room = Room(room_name=payload.room_name, capacity=payload.capacity, is_active=payload.is_active)
        session.add(room)
        await session.commit()
        await session.refresh(room)
        await log_activity(request, session, "Create Room", f"'{payload.room_name}' created with capacity {payload.capacity}")
        
        # Invalidate rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete("rooms:list")
        
        return JSONResponse({"status_code": 201, "message": "Room created successfully", "data": _serialize_room(room)}, status_code=201)

    async def update_room(request: Request, session: AsyncSession, room_id: int, payload: AdminRoomUpdate):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(Room).where(Room.room_id == room_id))
        room = r.scalars().first()
        if not room:
            return JSONResponse({"status_code": 404, "message": "Room not found"}, status_code=404)

        if payload.room_name is not None:
            room.room_name = payload.room_name
        if payload.capacity is not None:
            room.capacity = payload.capacity
        if payload.is_active is not None:
            room.is_active = payload.is_active

        await session.commit()
        await log_activity(request, session, "Update Room", f"{payload.room_name} updated")
        
        # Invalidate rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete("rooms:list")
        
        return JSONResponse({"status_code": 200, "message": "Room updated successfully", "data": _serialize_room(room)})

    async def delete_room(request: Request, session: AsyncSession, room_id: int):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(Room).where(Room.room_id == room_id))
        room = r.scalars().first()
        if not room:
            return JSONResponse({"status_code": 404, "message": "Room not found"}, status_code=404)

        await session.delete(room)
        await session.commit()
        await log_activity(request, session, "Delete Room", f"Room ID: {room_id} deleted")
        
        # Invalidate rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete("rooms:list")
        
        return JSONResponse({"status_code": 200, "message": "Room deleted successfully"})

    @staticmethod
    def _parse_hhmm(s: str) -> int:
        hh, mm = s.split(":")
        return int(hh) * 60 + int(mm)

    @staticmethod
    def _fmt_hhmm(m: int) -> str:
        return f"{m // 60:02d}:{m % 60:02d}"

    async def get_room_availability(request: Request, session: AsyncSession, room_id: int, day: str):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(Room).where(Room.room_id == room_id))
        room = r.scalars().first()
        if not room:
            return JSONResponse({"status_code": 404, "message": "Room not found"}, status_code=404)

        tt_r = await session.execute(
            select(TimeTable).where(and_(TimeTable.day_of_week == day, TimeTable.room_name == room.room_name))
        )
        slots = tt_r.scalars().all()

        busy = []
        for s in slots:
            try:
                busy.append((AdminPanelService._parse_hhmm(s.start_time), AdminPanelService._parse_hhmm(s.end_time)))
            except Exception:
                continue
        busy.sort()

        merged = []
        for st, en in busy:
            if not merged or st > merged[-1][1]:
                merged.append([st, en])
            else:
                merged[-1][1] = max(merged[-1][1], en)

        day_start = 7 * 60
        day_end = 21 * 60
        free = []
        cursor = day_start
        for st, en in merged:
            if st > cursor:
                free.append((cursor, st))
            cursor = max(cursor, en)
        if cursor < day_end:
            free.append((cursor, day_end))

        return JSONResponse(
            {
                "status_code": 200,
                "message": "Room availability fetched successfully",
                "data": {
                    "room": _serialize_room(room),
                    "day": day,
                    "busy": [{"start": AdminPanelService._fmt_hhmm(st), "end": AdminPanelService._fmt_hhmm(en)} for st, en in merged],
                    "free": [{"start": AdminPanelService._fmt_hhmm(st), "end": AdminPanelService._fmt_hhmm(en)} for st, en in free],
                },
            }
        )

    # Timetables

    async def list_timetables(request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(
            select(TimeTable, Course, Batch, User, Subject)
            .join(Course, TimeTable.course_id == Course.course_id)
            .outerjoin(Batch, TimeTable.batch_id == Batch.batch_id)
            .outerjoin(User, TimeTable.teacher_id == User.user_id)
            .outerjoin(Subject, TimeTable.subject_id == Subject.subject_id)
        )
        rows = r.unique().all()
        data = []
        for t, c, b, u, s in rows:
            data.append(
                {
                    "timetable_id": t.timetable_id,
                    "day_of_week": t.day_of_week,
                    "start_time": t.start_time,
                    "end_time": t.end_time,
                    "room_name": t.room_name,
                    "course_id": c.course_id,
                    "course_code": c.course_code,
                    "course_name": c.course_name,
                    "batch_id": t.batch_id,
                    "batch_no": b.batch_no if b else None,
                    "batch_start_date": b.start_date.isoformat() if b and b.start_date else None,
                    "batch_end_date": b.end_date.isoformat() if b and b.end_date else None,
                    "course_start_date": c.start_date.isoformat() if c and c.start_date else None,
                    "course_end_date": c.end_date.isoformat() if c and c.end_date else None,
                    "teacher_id": t.teacher_id,
                    "teacher_code": u.user_code if u else None,
                    "teacher_name": u.username if u else None,
                    "subject_id": t.subject_id,
                    "subject_code": s.subject_code if s else None,
                    "subject_name": s.subject_name if s else None
                }
            )
        return JSONResponse({"status_code": 200, "message": "Timetables fetched successfully", "data": data})

    async def create_timetable(request: Request, session: AsyncSession, payload: AdminTimeTableCreate):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        c_r = await session.execute(select(Course).where(Course.course_code == payload.course_code))
        course = c_r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)

        batch_id = payload.batch_id if payload.batch_id and payload.batch_id != 0 else None
        if not batch_id and payload.batch_no:
            b_r = await session.execute(
                select(Batch).where(
                    and_(
                        Batch.course_id == course.course_id, 
                        func.lower(func.trim(Batch.batch_no)) == func.lower(payload.batch_no.strip())
                    )
                )
            )
            batch = b_r.scalars().first()
            if batch:
                batch_id = batch.batch_id
            else:
                return JSONResponse({"status_code": 404, "message": f"Batch '{payload.batch_no}' not found for this course"}, status_code=404)

        teacher_id = None
        if payload.teacher_code:
            t_r = await session.execute(select(User).where(and_(User.user_code == payload.teacher_code, User.role == "teacher")))
            teacher = t_r.scalars().first()
            if teacher:
                teacher_id = teacher.user_id
            else:
                 return JSONResponse({"status_code": 404, "message": f"Teacher with code '{payload.teacher_code}' not found"}, status_code=404)

        subject_id = None
        if payload.subject_code:
            s_r = await session.execute(select(Subject).where(and_(Subject.course_id == course.course_id, Subject.subject_code == payload.subject_code)))
            sub = s_r.scalars().first()
            if sub:
                subject_id = sub.subject_id
            else:
                 return JSONResponse({"status_code": 404, "message": f"Subject with code '{payload.subject_code}' not found for this course"}, status_code=404)

        tt = TimeTable(
            course_id=course.course_id,
            batch_id=batch_id,
            teacher_id=teacher_id,
            subject_id=subject_id,
            day_of_week=payload.day_of_week,
            start_time=payload.start_time,
            end_time=payload.end_time,
            room_name=payload.room_name,
        )

        session.add(tt)
        await session.commit()
        await session.refresh(tt)
        msg = f"Timetable for {payload.course_code}"
        if payload.batch_no: msg += f" (Batch {payload.batch_no})"
        if payload.subject_code: msg += f" Subject {payload.subject_code}"
        if payload.teacher_code: msg += f" with Teacher {payload.teacher_code}"
        msg += f" on {payload.day_of_week} {payload.start_time}-{payload.end_time} created"
        await log_activity(request, session, "Create Timetable", msg)
        # Invalidate rooms cache since timetable assignments affect room loads
        from app.core.cache import cache_manager
        await cache_manager.delete("rooms:list")
        return JSONResponse({"status_code": 201, "message": "Timetable created successfully", "data": {"timetable_id": tt.timetable_id}}, status_code=201)

    async def update_timetable(request: Request, session: AsyncSession, timetable_id: int, payload: AdminTimeTableUpdate):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(TimeTable).where(TimeTable.timetable_id == timetable_id))
        tt = r.scalars().first()
        if not tt:
            return JSONResponse({"status_code": 404, "message": "Timetable not found"}, status_code=404)

        if payload.day_of_week is not None:
            tt.day_of_week = payload.day_of_week
        if payload.start_time is not None:
            tt.start_time = payload.start_time
        if payload.end_time is not None:
            tt.end_time = payload.end_time
        if payload.room_name is not None:
            tt.room_name = payload.room_name
        
        if payload.batch_id is not None or payload.batch_no is not None:
            if payload.batch_id and payload.batch_id != 0:
                tt.batch_id = payload.batch_id
            elif payload.batch_no:
                b_r = await session.execute(
                    select(Batch).where(
                        and_(
                            Batch.course_id == tt.course_id, 
                            func.lower(func.trim(Batch.batch_no)) == func.lower(payload.batch_no.strip())
                        )
                    )
                )
                batch = b_r.scalars().first()
                if batch:
                    tt.batch_id = batch.batch_id
                else:
                    return JSONResponse({"status_code": 404, "message": f"Batch '{payload.batch_no}' not found for this course"}, status_code=404)
            else:
                tt.batch_id = None
        
        if payload.teacher_code is not None:
            if payload.teacher_code:
                t_r = await session.execute(select(User).where(and_(User.user_code == payload.teacher_code, User.role == "teacher")))
                teacher = t_r.scalars().first()
                if teacher:
                    tt.teacher_id = teacher.user_id
                else:
                    return JSONResponse({"status_code": 404, "message": f"Teacher with code '{payload.teacher_code}' not found"}, status_code=404)
            else:
                tt.teacher_id = None

        if payload.subject_code is not None:
            if payload.subject_code:
                s_r = await session.execute(select(Subject).where(and_(Subject.course_id == tt.course_id, Subject.subject_code == payload.subject_code)))
                sub = s_r.scalars().first()
                if sub:
                    tt.subject_id = sub.subject_id
                else:
                    return JSONResponse({"status_code": 404, "message": f"Subject with code '{payload.subject_code}' not found for this course"}, status_code=404)
            else:
                tt.subject_id = None


        await session.commit()
        await log_activity(request, session, "Update Timetable", f"Timetable ID {timetable_id} updated")
        # Invalidate rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete("rooms:list")
        return JSONResponse({"status_code": 200, "message": "Timetable updated successfully"})

    async def delete_timetable(request: Request, session: AsyncSession, timetable_id: int):
        if not await validating_admin_role(request, allow_sales=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        r = await session.execute(select(TimeTable).where(TimeTable.timetable_id == timetable_id))
        tt = r.scalars().first()
        if not tt:
            return JSONResponse({"status_code": 404, "message": "Timetable not found"}, status_code=404)
        await session.delete(tt)
        await session.commit()
        await log_activity(request, session, "Delete Timetable", f"Timetable ID {timetable_id} deleted")
        # Invalidate rooms cache
        from app.core.cache import cache_manager
        await cache_manager.delete("rooms:list")
        return JSONResponse({"status_code": 200, "message": "Timetable deleted successfully"})

    # --- Payments CRUD ---
    async def get_income_report(request: Request, session: AsyncSession, start_date: Optional[str] = None, end_date: Optional[str] = None):
        user = getattr(request.state, "user", None)
        if not user or user.get("role") not in ["admin", "accountant"]:
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        base_q = select(
            Payment.payment_id,
            Payment.receipt_id,
            Payment.enrollment_id,
            Payment.amount,
            Payment.payment_date,
            Payment.month,
            Payment.status,
            Payment.payment_method,
            Payment.amount_2,
            Payment.payment_method_2,
            Payment.fine_amount,
            Payment.fine_reason,
            Payment.extra_items_fee,
            Payment.extra_items,
            Payment.extra_items_payment_method,
            Payment.exam_fee_paid_gbp,
            Payment.exam_fee_paid_mmk,
            Payment.exam_fee_currency,
            Payment.exam_fee_payment_method,
            Payment.discount_amount,
            Payment.created_at,
            User.user_code,
            User.username,
            Course.course_name,
            Course.course_code
        ).join(Enrollment, Payment.enrollment_id == Enrollment.enrollment_id)\
         .join(User, Enrollment.student_id == User.user_id)\
         .join(Course, Enrollment.course_id == Course.course_id)

        if start_date:
            try:
                sd = datetime.strptime(start_date, "%Y-%m-%d")
                sd_utc = sd - timedelta(hours=settings.TZ_OFFSET)
                base_q = base_q.where(Payment.payment_date >= sd_utc)
            except ValueError:
                pass
        if end_date:
            try:
                ed = datetime.strptime(end_date, "%Y-%m-%d")
                ed = ed.replace(hour=23, minute=59, second=59, microsecond=999999)
                ed_utc = ed - timedelta(hours=settings.TZ_OFFSET)
                base_q = base_q.where(Payment.payment_date <= ed_utc)
            except ValueError:
                pass

        base_q = base_q.order_by(Payment.payment_date.desc(), Payment.payment_id.desc())
        r = await session.execute(base_q)
        rows = r.all()

        weekly_map = defaultdict(lambda: {"total_mmk": 0.0, "total_gbp": 0.0, "fine_mmk": 0.0, "extra_mmk": 0.0, "tuition_mmk": 0.0, "exam_mmk": 0.0, "payment_count": 0})
        monthly_map = defaultdict(lambda: {"total_mmk": 0.0, "total_gbp": 0.0, "fine_mmk": 0.0, "extra_mmk": 0.0, "tuition_mmk": 0.0, "exam_mmk": 0.0, "payment_count": 0})
        daily_map = defaultdict(lambda: {"total_mmk": 0.0, "total_gbp": 0.0, "fine_mmk": 0.0, "extra_mmk": 0.0, "tuition_mmk": 0.0, "exam_mmk": 0.0, "payment_count": 0})
        payment_records = []

        for row in rows:
            p_date = row.payment_date or row.created_at or datetime.now()
            # Convert naive UTC datetime to local datetime
            if p_date.tzinfo is not None:
                local_p_date = p_date.astimezone(timezone(timedelta(hours=settings.TZ_OFFSET))).replace(tzinfo=None)
            else:
                local_p_date = p_date + timedelta(hours=settings.TZ_OFFSET)

            # Daily: YYYY-MM-DD
            day_key = local_p_date.strftime("%Y-%m-%d")
            
            # Weekly: Monday of that week
            monday = local_p_date - timedelta(days=local_p_date.weekday())
            week_key = monday.strftime("%Y-%m-%d")

            # Monthly: YYYY-MM
            month_key = local_p_date.strftime("%Y-%m")

            paid_mmk = (row.amount or 0.0) + (row.amount_2 or 0.0) + (row.fine_amount or 0.0) + (row.extra_items_fee or 0.0) + (row.exam_fee_paid_mmk or 0.0)
            paid_gbp = row.exam_fee_paid_gbp or 0.0
            
            fine_val = row.fine_amount or 0.0
            extra_val = row.extra_items_fee or 0.0
            tuition_val = (row.amount or 0.0) + (row.amount_2 or 0.0)
            exam_mmk_val = row.exam_fee_paid_mmk or 0.0

            # Daily mapping
            daily_map[day_key]["total_mmk"] += paid_mmk
            daily_map[day_key]["total_gbp"] += paid_gbp
            daily_map[day_key]["fine_mmk"] += fine_val
            daily_map[day_key]["extra_mmk"] += extra_val
            daily_map[day_key]["tuition_mmk"] += tuition_val
            daily_map[day_key]["exam_mmk"] += exam_mmk_val
            daily_map[day_key]["payment_count"] += 1

            # Weekly mapping
            weekly_map[week_key]["total_mmk"] += paid_mmk
            weekly_map[week_key]["total_gbp"] += paid_gbp
            weekly_map[week_key]["fine_mmk"] += fine_val
            weekly_map[week_key]["extra_mmk"] += extra_val
            weekly_map[week_key]["tuition_mmk"] += tuition_val
            weekly_map[week_key]["exam_mmk"] += exam_mmk_val
            weekly_map[week_key]["payment_count"] += 1

            # Monthly mapping
            monthly_map[month_key]["total_mmk"] += paid_mmk
            monthly_map[month_key]["total_gbp"] += paid_gbp
            monthly_map[month_key]["fine_mmk"] += fine_val
            monthly_map[month_key]["extra_mmk"] += extra_val
            monthly_map[month_key]["tuition_mmk"] += tuition_val
            monthly_map[month_key]["exam_mmk"] += exam_mmk_val
            monthly_map[month_key]["payment_count"] += 1

            payment_records.append({
                "payment_id": row.payment_id,
                "receipt_id": row.receipt_id or "N/A",
                "enrollment_id": row.enrollment_id,
                "student_code": row.user_code,
                "student_name": row.username,
                "course_name": row.course_name,
                "course_code": row.course_code,
                "amount": row.amount,
                "payment_date": f"{row.payment_date.isoformat()}Z" if row.payment_date else None,
                "month": row.month,
                "status": row.status,
                "payment_method": row.payment_method,
                "amount_2": row.amount_2 or 0.0,
                "payment_method_2": row.payment_method_2,
                "fine_amount": row.fine_amount or 0,
                "fine_reason": row.fine_reason,
                "extra_items_fee": row.extra_items_fee or 0,
                "extra_items": row.extra_items,
                "extra_items_payment_method": row.extra_items_payment_method,
                "exam_fee_paid_gbp": row.exam_fee_paid_gbp or 0,
                "exam_fee_paid_mmk": row.exam_fee_paid_mmk or 0,
                "exam_fee_currency": row.exam_fee_currency or "MMK",
                "exam_fee_payment_method": row.exam_fee_payment_method,
                "discount_amount": row.discount_amount or 0.0,
                "total_paid_mmk": paid_mmk,
                "total_paid_gbp": paid_gbp
            })

        daily_stats = []
        for dk, val in sorted(daily_map.items(), key=lambda x: x[0], reverse=True):
            try:
                dk_date = datetime.strptime(dk, "%Y-%m-%d")
                range_str = dk_date.strftime("%b %d, %Y")
            except Exception:
                range_str = dk
            daily_stats.append({
                "day": dk,
                "label": range_str,
                "total_mmk": val["total_mmk"],
                "total_gbp": val["total_gbp"],
                "fine_mmk": val["fine_mmk"],
                "extra_mmk": val["extra_mmk"],
                "tuition_mmk": val["tuition_mmk"],
                "exam_mmk": val["exam_mmk"],
                "payment_count": val["payment_count"]
            })

        weekly_stats = []
        for wk, val in sorted(weekly_map.items(), key=lambda x: x[0], reverse=True):
            try:
                wk_date = datetime.strptime(wk, "%Y-%m-%d")
                sunday = wk_date + timedelta(days=6)
                range_str = f"{wk_date.strftime('%b %d')} - {sunday.strftime('%b %d, %Y')}"
            except Exception:
                range_str = f"Week of {wk}"
            weekly_stats.append({
                "week_starting": wk,
                "label": range_str,
                "total_mmk": val["total_mmk"],
                "total_gbp": val["total_gbp"],
                "fine_mmk": val["fine_mmk"],
                "extra_mmk": val["extra_mmk"],
                "tuition_mmk": val["tuition_mmk"],
                "exam_mmk": val["exam_mmk"],
                "payment_count": val["payment_count"]
            })

        monthly_stats = []
        for mk, val in sorted(monthly_map.items(), key=lambda x: x[0], reverse=True):
            try:
                mk_date = datetime.strptime(mk, "%Y-%m")
                range_str = mk_date.strftime("%B %Y")
            except Exception:
                range_str = mk
            monthly_stats.append({
                "month": mk,
                "label": range_str,
                "total_mmk": val["total_mmk"],
                "total_gbp": val["total_gbp"],
                "fine_mmk": val["fine_mmk"],
                "extra_mmk": val["extra_mmk"],
                "tuition_mmk": val["tuition_mmk"],
                "exam_mmk": val["exam_mmk"],
                "payment_count": val["payment_count"]
            })

        return JSONResponse({
            "status_code": 200,
            "message": "Income report fetched successfully",
            "data": {
                "daily_stats": daily_stats,
                "weekly_stats": weekly_stats,
                "monthly_stats": monthly_stats,
                "payment_records": payment_records
            }
        })

    async def list_payments(request: Request, session: AsyncSession, page: int = 1, limit: int = 50, enrollment_id: Optional[int] = None, student_id: Optional[int] = None, receipt_id: Optional[str] = None):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)
        
        offset = (page - 1) * limit
        base_q = select(
            Payment.payment_id,
            Payment.receipt_id,
            Payment.enrollment_id,
            Payment.amount,
            Payment.payment_date,
            Payment.month,
            Payment.status,
            Payment.payment_method,
            Payment.amount_2,
            Payment.payment_method_2,
            Payment.discount_amount,
            Payment.fine_amount,
            Payment.extra_items_fee,
            Payment.extra_items,
            Payment.extra_items_payment_method,
            Payment.fine_reason,
            Payment.exam_fee_paid_gbp,
            Payment.exam_fee_paid_mmk,
            Payment.exam_fee_currency,
            Payment.exam_fee_payment_method,
            Enrollment.total_fee,
            Enrollment.payment_plan,
            Enrollment.downpayment,
            Enrollment.installment_amount,
            User.user_code,
            User.username,
            Course.course_name,
            Course.course_code,
            Course.fee_full_payment,
            Course.fee_installment,
            Course.foc_items,
            Course.foc_items_installment
        ).join(Enrollment, Payment.enrollment_id == Enrollment.enrollment_id)\
         .join(User, Enrollment.student_id == User.user_id)\
         .join(Course, Enrollment.course_id == Course.course_id)
            
        if enrollment_id:
            base_q = base_q.where(Payment.enrollment_id == enrollment_id)
        if student_id:
            base_q = base_q.where(Enrollment.student_id == student_id)
        if receipt_id:
            base_q = base_q.where(Payment.receipt_id == receipt_id)
            
        base_q = base_q.order_by(Payment.payment_date.desc(), Payment.payment_id.desc())
            
        count_q = select(func.count(Payment.payment_id))
        if enrollment_id:
            count_q = count_q.where(Payment.enrollment_id == enrollment_id)
        if student_id:
            count_q = count_q.join(Enrollment, Payment.enrollment_id == Enrollment.enrollment_id).where(Enrollment.student_id == student_id)
        if receipt_id:
            count_q = count_q.where(Payment.receipt_id == receipt_id)
            
        res_count = await session.execute(count_q)
        total_count = res_count.scalar() or 0

        paginated_q = base_q.offset(offset).limit(limit)
        r = await session.execute(paginated_q)
        rows = r.all()
        
        data = []
        for row in rows:
            data.append({
                "payment_id": row.payment_id,
                "receipt_id": row.receipt_id or "N/A",
                "enrollment_id": row.enrollment_id,
                "student_code": row.user_code,
                "student_name": row.username,
                "signature": None,
                "course_name": row.course_name,
                "course_code": row.course_code,
                "amount": row.amount,
                "payment_date": f"{row.payment_date.isoformat()}Z" if row.payment_date else None,
                "month": row.month,
                "status": row.status,
                "payment_method": row.payment_method,
                "amount_2": row.amount_2 or 0.0,
                "payment_method_2": row.payment_method_2,
                "course_cost": float(row.total_fee or (row.fee_full_payment if row.payment_plan == "full" else (row.fee_installment if row.payment_plan == "installment" else 0.0)) or 0.0),
                "discount_amount": row.discount_amount or 0.0,
                "foc_items": (row.foc_items_installment if row.payment_plan == "installment" else row.foc_items),
                "downpayment": row.downpayment or 0,
                "installment_amount": row.installment_amount or 0,
                "fine_amount": row.fine_amount or 0,
                "extra_items_fee": row.extra_items_fee or 0,
                "extra_items": row.extra_items,
                "extra_items_payment_method": row.extra_items_payment_method,
                "fine_reason": row.fine_reason,
                "exam_fee_paid_gbp": row.exam_fee_paid_gbp or 0,
                "exam_fee_paid_mmk": row.exam_fee_paid_mmk or 0,
                "exam_fee_currency": row.exam_fee_currency or "MMK",
                "exam_fee_payment_method": row.exam_fee_payment_method
            })
            
        return JSONResponse({
            "status_code": 200, 
            "message": "Payments fetched successfully", 
            "data": data,
            "pagination": {
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit if limit > 0 else 0,
                "current_page": page,
                "limit": limit
            }
        })

    async def create_payment(request: Request, session: AsyncSession, payload: PaymentCreate):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=False):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        enroll_r = await session.execute(select(Enrollment).where(Enrollment.enrollment_id == payload.enrollment_id))
        enroll = enroll_r.scalars().first()
        if not enroll:
            return JSONResponse({"status_code": 404, "message": "Enrollment not found"}, status_code=404)

        # Validation Logic: Ensure payment doesn't exceed course fee or exam fee
        course_r = await session.execute(select(Course).where(Course.course_id == enroll.course_id))
        course = course_r.scalars().first()
        if not course:
            return JSONResponse({"status_code": 404, "message": "Course not found"}, status_code=404)

        # 1. Course Fee Validation
        # Priority: Enrollment stored fee > Course current fee (for legacy/missing records)
        total_cost = float(enroll.total_fee if enroll.total_fee is not None else (course.fee_full_payment if enroll.payment_plan == "full" else course.fee_installment) or 0.0)
        payments_r = await session.execute(select(Payment).where(Payment.enrollment_id == enroll.enrollment_id))
        existing_payments = payments_r.scalars().all()

        total_paid_prev = sum((p.amount or 0) + (p.amount_2 or 0) for p in existing_payments)
        total_discount_prev = sum(p.discount_amount or 0 for p in existing_payments)
        left_amount = total_cost - (total_paid_prev + total_discount_prev)
        
        new_amount = (payload.amount or 0) + (getattr(payload, "amount_2", 0) or 0)
        new_discount = getattr(payload, "discount_amount", 0) or 0
        
        # We use max(0, left_amount) to handle over-payments and allow 0-amount payments
        if (new_amount + new_discount) > max(0, left_amount) + 0.1:
            return JSONResponse({
                "status_code": 400, 
                "message": f"Payment/Discount total ({new_amount + new_discount:,.0f} MMK) exceeds remaining balance ({max(0, left_amount):,.0f} MMK)"
            }, status_code=400)

        # 2. Exam Fee Validation (GBP)
        total_exam_gbp = float(getattr(enroll, "exam_fee_gbp", 0.0) or course.exam_fee_gbp or 0.0)
        if total_exam_gbp > 0:
            existing_exam_gbp = sum(p.exam_fee_paid_gbp or 0 for p in existing_payments)
            left_exam_gbp = total_exam_gbp - existing_exam_gbp
            new_exam_gbp = getattr(payload, "exam_fee_paid_gbp", 0) or 0
            
            if new_exam_gbp > max(0, left_exam_gbp) + 0.001:
                return JSONResponse({
                    "status_code": 400, 
                    "message": f"Exam fee payment ({new_exam_gbp} GBP) exceeds remaining balance ({max(0, left_exam_gbp)} GBP)"
                }, status_code=400)

        pay_date = payload.payment_date
        if pay_date and pay_date.tzinfo:
            pay_date = pay_date.replace(tzinfo=None)

        # Generate unique receipt_id in format nit-daymonthyear(of paid date)-0000001
        receipt_date = pay_date if pay_date else get_now_local()
        if receipt_date.tzinfo:
            receipt_date = receipt_date.replace(tzinfo=None)
            
        date_str = receipt_date.strftime("%d%m%Y")
        prefix = f"nit-{date_str}-"
        result_seq = await session.execute(
            select(Payment.receipt_id).where(Payment.receipt_id.isnot(None))
        )
        receipt_ids = result_seq.scalars().all()
        max_seq = 0
        for rid in receipt_ids:
            if rid:
                parts = rid.split("-")
                if len(parts) >= 3:
                    try:
                        seq = int(parts[-1])
                        if seq > max_seq:
                            max_seq = seq
                    except ValueError:
                        pass
        next_seq = max_seq + 1
        receipt_id = f"{prefix}{next_seq:07d}"

        pay = Payment(
            receipt_id=receipt_id,
            enrollment_id=payload.enrollment_id,
            amount=payload.amount,
            month=payload.month,
            payment_date=pay_date or func.now(),
            status=payload.status or "Paid",
            payment_method=payload.payment_method,
            amount_2=getattr(payload, "amount_2", 0.0),
            payment_method_2=getattr(payload, "payment_method_2", None),
            fine_amount=getattr(payload, "fine_amount", None),
            fine_reason=getattr(payload, "fine_reason", None),
            extra_items_fee=getattr(payload, "extra_items_fee", None),
            extra_items=getattr(payload, "extra_items", None),
            extra_items_payment_method=getattr(payload, "extra_items_payment_method", None),
            exam_fee_paid_gbp=getattr(payload, "exam_fee_paid_gbp", None),
            exam_fee_paid_mmk=getattr(payload, "exam_fee_paid_mmk", None),
            exam_fee_currency=getattr(payload, "exam_fee_currency", "MMK"),
            exam_fee_payment_method=getattr(payload, "exam_fee_payment_method", None),
            discount_amount=getattr(payload, "discount_amount", 0.0)
        )
        session.add(pay)
        await session.flush()
        await _create_journal_entry_for_payment(session, pay)
        await session.commit()
        await session.refresh(pay)
        log_date = str(pay.payment_date) if pay.payment_date else payload.month
        await log_activity(request, session, "Create Payment", f"Payment of {payload.amount} recorded for enrollment {payload.enrollment_id} ({log_date})")
        return JSONResponse({"status_code": 201, "message": "Payment recorded successfully"})

    async def update_payment(request: Request, session: AsyncSession, payment_id: int, payload: PaymentUpdate):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=False):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        pay_r = await session.execute(select(Payment).where(Payment.payment_id == payment_id))
        pay = pay_r.scalars().first()
        if not pay:
            return JSONResponse({"status_code": 404, "message": "Payment record not found"}, status_code=404)

        # Re-validate total fees if amount or discount is changing
        if payload.amount is not None or payload.amount_2 is not None or payload.discount_amount is not None:
             enroll_r = await session.execute(select(Enrollment).where(Enrollment.enrollment_id == pay.enrollment_id))
             enroll = enroll_r.scalars().first()
             if enroll:
                course_r = await session.execute(select(Course).where(Course.course_id == enroll.course_id))
                course = course_r.scalars().first()
                if course:
                    total_cost = float(enroll.total_fee if enroll.total_fee is not None else (course.fee_full_payment if enroll.payment_plan == "full" else course.fee_installment) or 0.0)
                    
                    # Sum other payments
                    others_r = await session.execute(select(Payment).where(and_(Payment.enrollment_id == enroll.enrollment_id, Payment.payment_id != payment_id)))
                    other_payments = others_r.scalars().all()
                    
                    total_paid_others = sum((p.amount or 0) + (p.amount_2 or 0) for p in other_payments)
                    total_discount_others = sum(p.discount_amount or 0 for p in other_payments)
                    
                    new_amount = (payload.amount if payload.amount is not None else (pay.amount or 0)) + \
                                 (payload.amount_2 if payload.amount_2 is not None else (pay.amount_2 or 0))
                    new_discount = payload.discount_amount if payload.discount_amount is not None else (pay.discount_amount or 0)
                    
                    if (total_paid_others + new_amount + total_discount_others + new_discount) > total_cost + 0.1:
                        left_amount = total_cost - (total_paid_others + total_discount_others)
                        return JSONResponse({
                            "status_code": 400, 
                            "message": f"Updated Payment/Discount total ({new_amount + new_discount:,.0f} MMK) exceeds remaining balance ({max(0, left_amount):,.0f} MMK)"
                        }, status_code=400)

        # Update fields
        update_data = payload.dict(exclude_unset=True)
        if "payment_date" in update_data and update_data["payment_date"]:
             if update_data["payment_date"].tzinfo:
                 update_data["payment_date"] = update_data["payment_date"].replace(tzinfo=None)
        
        for key, value in update_data.items():
            if hasattr(pay, key):
                setattr(pay, key, value)

        await session.flush()
        
        # Delete old journal entry if exists
        if pay.receipt_id:
            from app.models.model import JournalEntry
            je_q = select(JournalEntry).where(JournalEntry.reference == pay.receipt_id)
            je_res = await session.execute(je_q)
            je = je_res.scalars().first()
            if je:
                await session.delete(je)
                await session.flush()
        
        # Recreate new journal entry
        await _create_journal_entry_for_payment(session, pay)

        await session.commit()
        await log_activity(request, session, "Update Payment", f"Payment ID {payment_id} updated")
        return JSONResponse({"status_code": 200, "message": "Payment updated successfully"})

    async def delete_payment(request: Request, session: AsyncSession, payment_id: int):
        if not await validating_admin_role(request, allow_sales=True, allow_accountant=False):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        pay_r = await session.execute(select(Payment).where(Payment.payment_id == payment_id))
        pay = pay_r.scalars().first()
        if not pay:
            return JSONResponse({"status_code": 404, "message": "Payment record not found"}, status_code=404)

        amount = pay.amount or 0
        # Delete associated JournalEntry first
        if pay.receipt_id:
            from app.models.model import JournalEntry
            je_q = select(JournalEntry).where(JournalEntry.reference == pay.receipt_id)
            je_res = await session.execute(je_q)
            je = je_res.scalars().first()
            if je:
                await session.delete(je)
        await session.delete(pay)
        await session.commit()
        await log_activity(request, session, "Delete Payment", f"Payment ID {payment_id} (Amount: {amount}) deleted")
        return JSONResponse({"status_code": 200, "message": "Payment deleted successfully"})

    @staticmethod
    def _parse_hhmm(t: str) -> int:
        try:
            h, m = map(int, str(t).split(':'))
            return h * 60 + m
        except:
            return 0

    async def get_teaching_hours_report(request: Request, session: AsyncSession):
        if not await validating_admin_role(request, allow_sales=True, allow_student_affairs=True):
            return JSONResponse({"status_code": 403, "message": "You are not authorized to perform this action"}, status_code=403)

        # Get all teachers
        t_r = await session.execute(select(User).where(User.role == "teacher"))
        teachers = t_r.scalars().all()

        # Get all timetable entries with teachers
        tt_r = await session.execute(
            select(TimeTable, Course, Batch)
            .join(Course, TimeTable.course_id == Course.course_id)
            .outerjoin(Batch, TimeTable.batch_id == Batch.batch_id)
            .where(TimeTable.teacher_id != None)
        )
        timetable_entries = tt_r.all()

        teacher_stats = {}
        for teacher in teachers:
            teacher_stats[teacher.user_id] = {
                "teacher_code": teacher.user_code,
                "teacher_name": teacher.username,
                "total_hours": 0.0,
                "courses": set()
            }

        for tt, course, batch in timetable_entries:
            if tt.teacher_id in teacher_stats:
                try:
                    start = AdminPanelService._parse_hhmm(tt.start_time)
                    end = AdminPanelService._parse_hhmm(tt.end_time)
                    duration_minutes = end - start
                    if duration_minutes > 0:
                        teacher_stats[tt.teacher_id]["total_hours"] += round(duration_minutes / 60.0, 2)
                        course_info = f"{course.course_name}"
                        if batch:
                            course_info += f" ({batch.batch_no})"
                        teacher_stats[tt.teacher_id]["courses"].add(course_info)
                except Exception:
                    continue
        
        # Convert courses set to list for JSON serialization
        data = []
        for tid, stats in teacher_stats.items():
            stats["courses"] = list(stats["courses"])
            data.append(stats)

        return JSONResponse({
            "status_code": 200,
            "message": "Teaching hours report fetched successfully",
            "data": data
        })

