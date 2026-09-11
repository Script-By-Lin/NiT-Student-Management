import pandas as pd
import io
from datetime import datetime
from fastapi import Request, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, insert, String, Text, Integer, Float, Boolean, DateTime, Date, and_, text
from app.models.model import (
    User, AcademicYear, Course, Enrollment, Payment, 
    Room, TimeTable, Grade, Attendance, StaffAttendance, 
    ParentStudent, ActivityLog, Batch, Subject,
    Account, JournalEntry, JournalEntryLine, Expense
)
from app.services.rbac_portal import validating_admin_role
from app.core.timezone_utils import get_now_local
from app.services.activity_log_service import log_activity
import json
from app.core.logging import logger


# Sequence maps for PostgreSQL/SQLite autoincrement reset after import
_SEQUENCE_MAPS = [
    ("users", "user_id"),
    ("academic_years", "academic_year_id"),
    ("courses", "course_id"),
    ("rooms", "room_id"),
    ("enrollments", "enrollment_id"),
    ("payments", "payment_id"),
    ("batches", "batch_id"),
    ("subjects", "subject_id"),
    ("timetables", "timetable_id"),
    ("grades", "grade_id"),
    ("attendances", "attendance_id"),
    ("staff_attendance", "id"),
    ("parent_student", "id"),
    ("activity_logs", "log_id"),
    ("refresh_tokens", "id"),
    ("accounts", "account_id"),
    ("journal_entries", "entry_id"),
    ("journal_entry_lines", "line_id"),
    ("expenses", "expense_id"),
]


async def _reset_sequences_bg():
    """Reset PostgreSQL/SQLite sequences after a data import.
    
    Runs in the background after import response is returned.
    Uses its own session from AsyncSessionLocal.
    """
    from app.core.database_initialization import AsyncSessionLocal, engine
    dialect_name = engine.dialect.name
    async with AsyncSessionLocal() as session:
        for table, pk in _SEQUENCE_MAPS:
            try:
                if "postgresql" in dialect_name:
                    await session.execute(text(f"""
                        SELECT setval(
                            pg_get_serial_sequence('"{table}"', '{pk}'),
                            COALESCE((SELECT MAX("{pk}") FROM "{table}"), 0) + 1,
                            false
                        )
                    """))
                elif "sqlite" in dialect_name:
                    await session.execute(text(f"""
                        UPDATE sqlite_sequence
                        SET seq = COALESCE((SELECT MAX("{pk}") FROM "{table}"), 0)
                        WHERE name = '{table}'
                    """))
            except Exception as e:
                logger.error(f"Sequence reset skipped for {table}: {e}")
        try:
            await session.commit()
            logger.info("Background sequence reset completed.")
        except Exception as e:
            logger.error(f"Sequence reset commit failed: {e}")

class BackupService:
    @staticmethod
    async def export_to_excel(request: Request, session: AsyncSession):
        if not await validating_admin_role(request):
            logger.warning("Unauthorized access attempt to export backup")
            return JSONResponse({"status_code": 403, "message": "Unauthorized"}, status_code=403)

        await log_activity(request, session, "Export Backup", "Administrator started database export to Excel")
        await session.commit()
        logger.info("Starting Excel export...")
        # Tables to export
        models = [
            (User, "Users"),
            (AcademicYear, "AcademicYears"),
            (Course, "Courses"),
            (Room, "Rooms"),
            (Enrollment, "Enrollments"),
            (Payment, "Payments"),
            (Batch, "Batches"),
            (Subject, "Subjects"),
            (TimeTable, "Timetables"),
            (Grade, "Grades"),
            (Attendance, "Attendances"),
            (StaffAttendance, "StaffAttendances"),
            (ParentStudent, "ParentStudentLinks"),
            (Account, "Accounts"),
            (Expense, "Expenses"),
            (JournalEntry, "JournalEntries"),
            (JournalEntryLine, "JournalEntryLines")
        ]
        from sqlalchemy.orm import defer
        # Fetch and prepare all data first to avoid database queries inside the ExcelWriter block,
        # which would trigger openpyxl IndexErrors upon exception cleanup.
        exported_sheets = {}
        for model, sheet_name in models:
            stmt = select(model)
            if model == User:
                stmt = stmt.options(defer(User.profile_picture), defer(User.signature))
            result = await session.execute(stmt)
            items = result.scalars().all()
            
            # Convert to list of dicts
            data = []
            for item in items:
                item_dict = getattr(item, "__dict__", {})
                d = {c.name: item_dict.get(c.name) for c in model.__table__.columns if c.name not in ("profile_picture", "signature")}
                # Convert datetimes and dates to strings
                from datetime import date as py_date
                for k, v in d.items():
                    if isinstance(v, datetime):
                        d[k] = v.strftime("%Y-%m-%d %H:%M:%S")
                    elif isinstance(v, py_date):
                        d[k] = v.strftime("%Y-%m-%d")
                    elif isinstance(v, (pd.Timestamp, pd.Timedelta)):
                        d[k] = str(v)
                data.append(d)
            exported_sheets[sheet_name] = data

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            for sheet_name, data in exported_sheets.items():
                df = pd.DataFrame(data)
                df.to_excel(writer, sheet_name=sheet_name, index=False)

        output.seek(0)
        filename = f"backup_{get_now_local().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        logger.info(f"Excel export completed: {filename}")
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    @staticmethod
    async def import_from_excel(file: UploadFile, request: Request, session: AsyncSession):
        if not await validating_admin_role(request):
            logger.warning("Unauthorized access attempt to import backup")
            return JSONResponse({"status_code": 403, "message": "Unauthorized"}, status_code=403)

        logger.info(f"Starting Excel import from file: {file.filename}...")
        from app.security.password_hashing import hash_password
        try:
            contents = await file.read()
            df_dict = pd.read_excel(io.BytesIO(contents), sheet_name=None)
            
            # Order is important for foreign key constraints
            import_order = [
                ("Rooms", Room),
                ("AcademicYears", AcademicYear),
                ("Accounts", Account),
                ("Users", User),
                ("Courses", Course),
                ("Batches", Batch),
                ("Subjects", Subject),
                ("Enrollments", Enrollment),
                ("Payments", Payment),
                ("Expenses", Expense),
                ("JournalEntries", JournalEntry),
                ("JournalEntryLines", JournalEntryLine),
                ("Timetables", TimeTable),
                ("Grades", Grade),
                ("Attendances", Attendance),
                ("StaffAttendances", StaffAttendance),
                ("ParentStudentLinks", ParentStudent),
                ("ActivityLogs", ActivityLog)
            ]

            stats = {}
            from datetime import date as py_date

            # Helper to normalize column names
            def normalize_key(k):
                if not isinstance(k, str): return str(k)
                # Remove spaces, dashes, dots and convert to lowercase
                return k.lower().replace(" ", "_").replace("-", "_").replace(".", "_").strip()

            for sheet_name, model in import_order:
                if sheet_name in df_dict:
                    df = df_dict[sheet_name]
                    records_raw = df.to_dict('records')
                    count = 0
                    
                    for record_raw in records_raw:
                        # Normalize all keys in record
                        record = {normalize_key(k): v for k, v in record_raw.items()}

                        # Map common misspellings or aliases
                        if model == User:
                            # Handle date_of_birth vs data_of_birth
                            if 'date_of_birth' in record:
                                record['data_of_birth'] = record.pop('date_of_birth')
                            
                            # Handle NRC/nrc
                            if 'NRC' in record:
                                record['nrc'] = record.pop('NRC')

                        if model == ParentStudent:
                            # Ensure relationship_label exists
                            if 'relationship' in record and 'relationship_label' not in record:
                                record['relationship_label'] = record.pop('relationship')
                        
                        if model == AcademicYear:
                            # Handle academic_year_name aliases
                            if 'year_name' in record:
                                record['academic_year_name'] = record.pop('year_name')
                            # Handle academic_year_id vs academicyear_id
                            if 'academicyear_id' in record:
                                record['academic_year_id'] = record.pop('academicyear_id')

                        if model == Course:
                            # Handle deprecated foc_items_cash_down (merge into foc_items if empty)
                            if 'foc_items_cash_down' in record:
                                if not record.get('foc_items'):
                                    record['foc_items'] = record['foc_items_cash_down']
                                # record.pop('foc_items_cash_down') # Handled by model_columns check later
                        
                        # Clean NaN/Null values explicitly and handle Timestamps
                        clean_record = {}
                        model_columns = {c.name for c in model.__table__.columns}
                        
                        for k, v in record.items():
                            if k not in model_columns:
                                # Still handle the pops/aliases in record for these specific cases
                                continue
                                
                            if pd.isna(v):
                                clean_record[k] = None
                            elif hasattr(v, 'to_pydatetime'):
                                clean_record[k] = v.to_pydatetime()
                            else:
                                clean_record[k] = v
                        
                        # Apply specialized transformations on the cleaned record
                        record = clean_record
                        
                        if model == User:
                            # Required fields fallbacks if they are still missing/null in the cleaned record
                            if not record.get('data_of_birth'):
                                # Use a neutral default if missing to prevent DB failure
                                record['data_of_birth'] = datetime(2000, 1, 1)
                            
                            if not record.get('username') and record.get('email'):
                                email_str = str(record.get('email'))
                                if '@' in email_str:
                                    record['username'] = email_str.split('@')[0]
                                else:
                                    record['username'] = email_str

                        # Special case: Password hashing for Users
                        if model == User:
                            if not record.get('password_hash'):
                                import secrets
                                record['password_hash'] = await hash_password(secrets.token_urlsafe(16))
                            else:
                                ph = str(record['password_hash'])
                                if not (ph.startswith("$2b$") or ph.startswith("$2a$")):
                                    record['password_hash'] = await hash_password(ph)

                        # Convert objects
                        for col in model.__table__.columns:
                            val = record.get(col.name)
                            if val is not None:
                                # Ensure correct data types
                                try:
                                    if isinstance(col.type, (String, Text)):
                                        if pd.isna(val) or val is None:
                                            record[col.name] = None
                                        elif isinstance(val, (float, int)):
                                            # Clean numbers for text fields (phone, ids)
                                            if isinstance(val, float) and val.is_integer():
                                                record[col.name] = str(int(val)).strip()
                                            else:
                                                record[col.name] = str(val).strip()
                                        else:
                                            record[col.name] = str(val).strip()
                                    
                                    elif isinstance(col.type, Integer):
                                        if pd.isna(val) or val is None:
                                            record[col.name] = None
                                        else:
                                            record[col.name] = int(float(val))
                                            
                                    elif isinstance(col.type, Float):
                                        if pd.isna(val) or val is None:
                                            record[col.name] = None
                                        else:
                                            record[col.name] = float(val)
                                            
                                    elif isinstance(col.type, Boolean):
                                        if pd.isna(val) or val is None:
                                            record[col.name] = getattr(col, 'default', None)
                                        else:
                                            # Convert common values to bool
                                            v_upper = str(val).upper()
                                            if v_upper in ('1', '1.0', 'TRUE', 'YES', 'Y'):
                                                record[col.name] = True
                                            elif v_upper in ('0', '0.0', 'FALSE', 'NO', 'N'):
                                                record[col.name] = False
                                            else:
                                                record[col.name] = bool(val)
                                                
                                    elif isinstance(col.type, (DateTime, Date)):
                                        if pd.isna(val) or val is None:
                                            record[col.name] = None
                                        elif isinstance(val, str):
                                            try:
                                                if len(val) > 10:
                                                    dt = datetime.strptime(val, "%Y-%m-%d %H:%M:%S")
                                                else:
                                                    dt = datetime.strptime(val, "%Y-%m-%d")
                                                
                                                record[col.name] = dt if isinstance(col.type, DateTime) else dt.date()
                                            except:
                                                record[col.name] = None # Fallback
                                        elif hasattr(val, 'date'): # Already a datetime-like (pd.Timestamp)
                                            record[col.name] = val if isinstance(col.type, DateTime) else val.date()
                                except:
                                    pass

                        try:
                            # Use nested transaction to protect individual record failures
                            async with session.begin_nested():
                                pk_name = [c.name for c in model.__table__.primary_key.columns][0]
                                unique_cols = [c.name for c in model.__table__.columns if c.unique]
                                
                                obj = None
                                
                                # 1. Try finding by email/user_code for Users (Strongest Natural Keys)
                                if model == User:
                                    if record.get('email'):
                                        r = await session.execute(select(User).where(User.email == record['email']))
                                        obj = r.scalars().first()
                                    elif record.get('user_code'):
                                        r = await session.execute(select(User).where(User.user_code == record['user_code']))
                                        obj = r.scalars().first()
                                
                                # 2. Try finding by composite unique constraints (e.g. ParentStudent)
                                if not obj and model == ParentStudent:
                                    if record.get('parent_id') and record.get('student_id'):
                                        r = await session.execute(select(ParentStudent).where(
                                            and_(ParentStudent.parent_id == record['parent_id'], 
                                                 ParentStudent.student_id == record['student_id'])
                                        ))
                                        obj = r.scalars().first()

                                # 3. Try finding by single unique columns
                                if not obj and unique_cols:
                                    for uc in unique_cols:
                                        if record.get(uc):
                                            r = await session.execute(select(model).where(getattr(model, uc) == record[uc]))
                                            obj = r.scalars().first()
                                            if obj: break

                                # 4. Try finding by Primary Key
                                if not obj and pk_name in record and record[pk_name] is not None:
                                    try:
                                        pk_val = int(record[pk_name])
                                        r = await session.execute(select(model).where(getattr(model, pk_name) == pk_val))
                                        obj = r.scalars().first()
                                    except:
                                        pass

                                if obj:
                                    # Update existing
                                    for k, v in record.items():
                                        if k != pk_name: # Don't update PK
                                            setattr(obj, k, v)
                                    count += 1
                                else:
                                    # Create new
                                    session.add(model(**record))
                                    count += 1
                                
                                await session.flush()
                        except Exception as e:
                            logger.error(f"Error importing record into {sheet_name}: {str(e)}")
                    
                    # Commit each table
                    await session.commit()
                    stats[sheet_name] = count
            
            await session.commit()
            
            # Log activity before returning
            await log_activity(request, session, "Import Backup", f"Database restore completed. Stats: {json.dumps(stats)}")
            await session.commit()

            # --- Reset Sequences in background (non-blocking) ---
            # This runs after the response is returned so the client isn't blocked.
            from app.core.background_tasks import fire_and_forget
            await fire_and_forget(_reset_sequences_bg())

            return JSONResponse({
                "status_code": 200,
                "message": "Data imported successfully. Sequence reset running in background.",
                "data": stats
            })

        except Exception as e:
            import traceback
            logger.error(f"Import failed: {str(e)}\n{traceback.format_exc()}")
            return JSONResponse({
                "status_code": 500, 
                "message": f"Import failed: {str(e)}"
            }, status_code=500)
