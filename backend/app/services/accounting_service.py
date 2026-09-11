from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_
from sqlalchemy.orm import selectinload, joinedload
from datetime import date, datetime
from typing import Optional, List
from app.models.model import Account, JournalEntry, JournalEntryLine, Expense, User
from app.schemas.accounting import AccountCreate, JournalEntryCreate, ExpenseCreate
from app.services.rbac_portal import validating_admin_role

class AccountingService:

    @staticmethod
    async def list_accounts(session: AsyncSession) -> List[dict]:
        """Returns all accounts with their current balances using a single bulk aggregation query."""
        q = select(Account).order_by(Account.account_id.asc())
        res = await session.execute(q)
        accounts = res.scalars().all()
        
        # Single bulk query for all account sums across all journal entry lines
        lines_q = select(
            JournalEntryLine.account_id,
            func.sum(JournalEntryLine.debit_mmk).label("deb_mmk"),
            func.sum(JournalEntryLine.credit_mmk).label("cred_mmk"),
            func.sum(JournalEntryLine.debit_gbp).label("deb_gbp"),
            func.sum(JournalEntryLine.credit_gbp).label("cred_gbp")
        ).group_by(JournalEntryLine.account_id)
        
        lines_res = await session.execute(lines_q)
        sums_by_acc = {row.account_id: row for row in lines_res}
        
        data = []
        for acc in accounts:
            sums = sums_by_acc.get(acc.account_id)
            deb_mmk = (sums.deb_mmk if sums else 0.0) or 0.0
            cred_mmk = (sums.cred_mmk if sums else 0.0) or 0.0
            deb_gbp = (sums.deb_gbp if sums else 0.0) or 0.0
            cred_gbp = (sums.cred_gbp if sums else 0.0) or 0.0
            
            # Net balance calculations based on account type
            # Asset/Expense: debit - credit
            # Liability/Equity/Revenue: credit - debit
            if acc.account_type in ["Asset", "Expense"]:
                balance_mmk = deb_mmk - cred_mmk
                balance_gbp = deb_gbp - cred_gbp
            else:
                balance_mmk = cred_mmk - deb_mmk
                balance_gbp = cred_gbp - deb_gbp
                
            data.append({
                "account_id": acc.account_id,
                "account_name": acc.account_name,
                "account_type": acc.account_type,
                "currency": acc.currency,
                "is_active": acc.is_active,
                "balance_mmk": balance_mmk,
                "balance_gbp": balance_gbp,
                "debit_mmk": deb_mmk,
                "credit_mmk": cred_mmk,
                "debit_gbp": deb_gbp,
                "credit_gbp": cred_gbp
            })
        return data

    @staticmethod
    async def create_account(session: AsyncSession, payload: AccountCreate) -> Account:
        """Creates a new general ledger account."""
        # Check duplicate
        dup_q = select(Account).where(Account.account_name == payload.account_name)
        dup_res = await session.execute(dup_q)
        if dup_res.scalars().first():
            raise HTTPException(status_code=409, detail="Account name already exists")
            
        acc = Account(
            account_name=payload.account_name,
            account_type=payload.account_type,
            currency=payload.currency or "MMK",
            is_active=True
        )
        session.add(acc)
        await session.commit()
        await session.refresh(acc)
        return acc

    @staticmethod
    async def create_journal_entry(session: AsyncSession, payload: JournalEntryCreate) -> JournalEntry:
        """Records a manual journal/ledger entry, validating debit == credit."""
        total_deb_mmk = sum(line.debit_mmk or 0.0 for line in payload.lines)
        total_cred_mmk = sum(line.credit_mmk or 0.0 for line in payload.lines)
        total_deb_gbp = sum(line.debit_gbp or 0.0 for line in payload.lines)
        total_cred_gbp = sum(line.credit_gbp or 0.0 for line in payload.lines)
        
        if abs(total_deb_mmk - total_cred_mmk) > 0.01:
            raise HTTPException(status_code=400, detail=f"MMK Debits ({total_deb_mmk}) must equal Credits ({total_cred_mmk})")
        if abs(total_deb_gbp - total_cred_gbp) > 0.01:
            raise HTTPException(status_code=400, detail=f"GBP Debits ({total_deb_gbp}) must equal Credits ({total_cred_gbp})")
            
        entry = JournalEntry(
            entry_date=payload.entry_date or date.today(),
            description=payload.description,
            reference=payload.reference,
            entry_type=payload.entry_type or "journal",
            student_id=payload.student_id
        )
        session.add(entry)
        await session.flush()  # get entry_id
        
        for line_data in payload.lines:
            line = JournalEntryLine(
                entry_id=entry.entry_id,
                account_id=line_data.account_id,
                debit_mmk=line_data.debit_mmk or 0.0,
                credit_mmk=line_data.credit_mmk or 0.0,
                debit_gbp=line_data.debit_gbp or 0.0,
                credit_gbp=line_data.credit_gbp or 0.0
            )
            session.add(line)
            
        await session.commit()
        await session.refresh(entry)
        return entry

    @staticmethod
    async def list_journal_entries(session: AsyncSession, start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[dict]:
        """Lists all journal entries with lines using eager loading to prevent N+1 queries."""
        q = (
            select(JournalEntry)
            .options(
                selectinload(JournalEntry.lines).joinedload(JournalEntryLine.account),
                joinedload(JournalEntry.student)
            )
            .order_by(JournalEntry.entry_date.desc(), JournalEntry.entry_id.desc())
        )
        if start_date:
            q = q.where(JournalEntry.entry_date >= datetime.strptime(start_date, "%Y-%m-%d").date())
        if end_date:
            q = q.where(JournalEntry.entry_date <= datetime.strptime(end_date, "%Y-%m-%d").date())
            
        res = await session.execute(q)
        entries = res.scalars().all()
        
        data = []
        for entry in entries:
            lines_data = []
            for l in (entry.lines or []):
                lines_data.append({
                    "line_id": l.line_id,
                    "account_id": l.account_id,
                    "account_name": l.account.account_name if l.account else "Unknown",
                    "debit_mmk": l.debit_mmk,
                    "credit_mmk": l.credit_mmk,
                    "debit_gbp": l.debit_gbp,
                    "credit_gbp": l.credit_gbp
                })
                
            student_name = None
            if entry.student:
                student_name = f"{entry.student.username} ({entry.student.user_code})"
                    
            data.append({
                "entry_id": entry.entry_id,
                "entry_date": str(entry.entry_date),
                "description": entry.description,
                "reference": entry.reference,
                "entry_type": entry.entry_type,
                "student_id": entry.student_id,
                "student_name": student_name,
                "lines": lines_data
            })
        return data

    @staticmethod
    async def get_book_logs(session: AsyncSession, account_name_contains: str) -> List[dict]:
        """Calculates running balance book for Cash or Bank accounts."""
        # Find matching accounts
        acc_q = select(Account).where(Account.account_name.like(f"%{account_name_contains}%"))
        acc_res = await session.execute(acc_q)
        accounts = acc_res.scalars().all()
        account_ids = [acc.account_id for acc in accounts]
        
        if not account_ids:
            return []
            
        # Get all entry lines for these accounts
        q = (
            select(JournalEntryLine, JournalEntry)
            .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.entry_id)
            .where(JournalEntryLine.account_id.in_(account_ids))
            .order_by(JournalEntry.entry_date.asc(), JournalEntry.entry_id.asc())
        )
        res = await session.execute(q)
        rows = res.all()
        
        running_mmk = 0.0
        running_gbp = 0.0
        
        data = []
        for line, entry in rows:
            running_mmk += (line.debit_mmk - line.credit_mmk)
            running_gbp += (line.debit_gbp - line.credit_gbp)
            
            acc_name = "Unknown"
            for acc in accounts:
                if acc.account_id == line.account_id:
                    acc_name = acc.account_name
                    break
                    
            data.append({
                "line_id": line.line_id,
                "entry_id": entry.entry_id,
                "entry_date": str(entry.entry_date),
                "description": entry.description,
                "reference": entry.reference,
                "account_name": acc_name,
                "debit_mmk": line.debit_mmk,
                "credit_mmk": line.credit_mmk,
                "debit_gbp": line.debit_gbp,
                "credit_gbp": line.credit_gbp,
                "balance_mmk": running_mmk,
                "balance_gbp": running_gbp
            })
        return data

    @staticmethod
    async def get_student_ledger(session: AsyncSession, student_id: int) -> List[dict]:
        """Gets all ledger entries linked to a specific student."""
        q = (
            select(JournalEntryLine, JournalEntry)
            .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.entry_id)
            .where(JournalEntry.student_id == student_id)
            .order_by(JournalEntry.entry_date.desc(), JournalEntry.entry_id.desc())
        )
        res = await session.execute(q)
        rows = res.all()
        
        data = []
        for line, entry in rows:
            acc_q = select(Account).where(Account.account_id == line.account_id)
            acc_res = await session.execute(acc_q)
            acc = acc_res.scalars().first()
            
            data.append({
                "entry_id": entry.entry_id,
                "entry_date": str(entry.entry_date),
                "description": entry.description,
                "reference": entry.reference,
                "entry_type": entry.entry_type,
                "account_name": acc.account_name if acc else "Unknown",
                "debit_mmk": line.debit_mmk,
                "credit_mmk": line.credit_mmk,
                "debit_gbp": line.debit_gbp,
                "credit_gbp": line.credit_gbp
            })
        return data

    @staticmethod
    async def get_trial_balance(session: AsyncSession) -> dict:
        """Generates trial balance checking total debits and credits."""
        accounts = await AccountingService.list_accounts(session)
        
        lines = []
        total_deb_mmk = 0.0
        total_cred_mmk = 0.0
        total_deb_gbp = 0.0
        total_cred_gbp = 0.0
        
        for acc in accounts:
            # Net balance
            net_deb_mmk = 0.0
            net_cred_mmk = 0.0
            net_deb_gbp = 0.0
            net_cred_gbp = 0.0
            
            net_mmk = acc["debit_mmk"] - acc["credit_mmk"]
            net_gbp = acc["debit_gbp"] - acc["credit_gbp"]
            
            if net_mmk > 0:
                net_deb_mmk = net_mmk
            else:
                net_cred_mmk = abs(net_mmk)
                
            if net_gbp > 0:
                net_deb_gbp = net_gbp
            else:
                net_cred_gbp = abs(net_gbp)
                
            total_deb_mmk += net_deb_mmk
            total_cred_mmk += net_cred_mmk
            total_deb_gbp += net_deb_gbp
            total_cred_gbp += net_cred_gbp
            
            if net_deb_mmk > 0 or net_cred_mmk > 0 or net_deb_gbp > 0 or net_cred_gbp > 0:
                lines.append({
                    "account_id": acc["account_id"],
                    "account_name": acc["account_name"],
                    "account_type": acc["account_type"],
                    "debit_mmk": net_deb_mmk,
                    "credit_mmk": net_cred_mmk,
                    "debit_gbp": net_deb_gbp,
                    "credit_gbp": net_cred_gbp
                })
                
        return {
            "lines": lines,
            "totals": {
                "debit_mmk": total_deb_mmk,
                "credit_mmk": total_cred_mmk,
                "debit_gbp": total_deb_gbp,
                "credit_gbp": total_cred_gbp,
                "is_balanced": abs(total_deb_mmk - total_cred_mmk) < 1.0 and abs(total_deb_gbp - total_cred_gbp) < 0.01
            }
        }

    @staticmethod
    async def get_income_statement(session: AsyncSession) -> dict:
        """Generates P&L statement reporting net revenues and expenses."""
        accounts = await AccountingService.list_accounts(session)
        
        revenues = []
        expenses = []
        
        total_rev_mmk = 0.0
        total_rev_gbp = 0.0
        total_exp_mmk = 0.0
        total_exp_gbp = 0.0
        
        for acc in accounts:
            if acc["account_type"] == "Revenue":
                # Revenue net balance (credit - debit)
                val_mmk = acc["credit_mmk"] - acc["debit_mmk"]
                val_gbp = acc["credit_gbp"] - acc["debit_gbp"]
                total_rev_mmk += val_mmk
                total_rev_gbp += val_gbp
                revenues.append({
                    "account_name": acc["account_name"],
                    "amount_mmk": val_mmk,
                    "amount_gbp": val_gbp
                })
            elif acc["account_type"] == "Expense":
                # Expense net balance (debit - credit)
                val_mmk = acc["debit_mmk"] - acc["credit_mmk"]
                val_gbp = acc["debit_gbp"] - acc["credit_gbp"]
                total_exp_mmk += val_mmk
                total_exp_gbp += val_gbp
                expenses.append({
                    "account_name": acc["account_name"],
                    "amount_mmk": val_mmk,
                    "amount_gbp": val_gbp
                })
                
        net_income_mmk = total_rev_mmk - total_exp_mmk
        net_income_gbp = total_rev_gbp - total_exp_gbp
        
        return {
            "revenues": revenues,
            "expenses": expenses,
            "summary": {
                "total_revenue_mmk": total_rev_mmk,
                "total_revenue_gbp": total_rev_gbp,
                "total_expense_mmk": total_exp_mmk,
                "total_expense_gbp": total_exp_gbp,
                "net_income_mmk": net_income_mmk,
                "net_income_gbp": net_income_gbp
            }
        }

    @staticmethod
    async def get_balance_sheet(session: AsyncSession) -> dict:
        """Generates balance sheet reporting Assets, Liabilities, and Equity (with net income)."""
        accounts = await AccountingService.list_accounts(session)
        p_l = await AccountingService.get_income_statement(session)
        net_inc_mmk = p_l["summary"]["net_income_mmk"]
        net_inc_gbp = p_l["summary"]["net_income_gbp"]
        
        assets = []
        liabilities = []
        equity = []
        
        total_assets_mmk = 0.0
        total_assets_gbp = 0.0
        total_liab_mmk = 0.0
        total_liab_gbp = 0.0
        total_eq_mmk = 0.0
        total_eq_gbp = 0.0
        
        for acc in accounts:
            if acc["account_type"] == "Asset":
                val_mmk = acc["debit_mmk"] - acc["credit_mmk"]
                val_gbp = acc["debit_gbp"] - acc["credit_gbp"]
                total_assets_mmk += val_mmk
                total_assets_gbp += val_gbp
                assets.append({
                    "account_name": acc["account_name"],
                    "amount_mmk": val_mmk,
                    "amount_gbp": val_gbp
                })
            elif acc["account_type"] == "Liability":
                val_mmk = acc["credit_mmk"] - acc["debit_mmk"]
                val_gbp = acc["credit_gbp"] - acc["debit_gbp"]
                total_liab_mmk += val_mmk
                total_liab_gbp += val_gbp
                liabilities.append({
                    "account_name": acc["account_name"],
                    "amount_mmk": val_mmk,
                    "amount_gbp": val_gbp
                })
            elif acc["account_type"] == "Equity":
                val_mmk = acc["credit_mmk"] - acc["debit_mmk"]
                val_gbp = acc["credit_gbp"] - acc["debit_gbp"]
                total_eq_mmk += val_mmk
                total_eq_gbp += val_gbp
                equity.append({
                    "account_name": acc["account_name"],
                    "amount_mmk": val_mmk,
                    "amount_gbp": val_gbp
                })
                
        # Retained earnings is net income
        equity.append({
            "account_name": "Retained Earnings (Net Income)",
            "amount_mmk": net_inc_mmk,
            "amount_gbp": net_inc_gbp
        })
        total_eq_mmk += net_inc_mmk
        total_eq_gbp += net_inc_gbp
        
        return {
            "assets": assets,
            "liabilities": liabilities,
            "equity": equity,
            "summary": {
                "total_assets_mmk": total_assets_mmk,
                "total_assets_gbp": total_assets_gbp,
                "total_liabilities_mmk": total_liab_mmk,
                "total_liabilities_gbp": total_liab_gbp,
                "total_equity_mmk": total_eq_mmk,
                "total_equity_gbp": total_eq_gbp,
                "total_liabilities_equity_mmk": total_liab_mmk + total_eq_mmk,
                "total_liabilities_equity_gbp": total_liab_gbp + total_eq_gbp
            }
        }

    # ── Expenses Service ──────────────────────────────────────────────────────

    @staticmethod
    async def create_expense(session: AsyncSession, payload: ExpenseCreate) -> Expense:
        """Submits a new pending expense."""
        exp = Expense(
            title=payload.title,
            description=payload.description,
            amount_mmk=payload.amount_mmk,
            category=payload.category,
            expense_date=payload.expense_date or date.today(),
            status="Pending",
            department=payload.department,
            budget_amount=payload.budget_amount,
            payment_method=payload.payment_method or "Cash"
        )
        session.add(exp)
        await session.commit()
        await session.refresh(exp)
        return exp

    @staticmethod
    async def approve_expense(session: AsyncSession, expense_id: int, user_id: int) -> Expense:
        """Approves a pending expense and automatically posts its general ledger journal entry."""
        exp_q = select(Expense).where(Expense.expense_id == expense_id)
        exp_res = await session.execute(exp_q)
        exp = exp_res.scalars().first()
        if not exp:
            raise HTTPException(status_code=404, detail="Expense record not found")
            
        if exp.status != "Pending":
            raise HTTPException(status_code=400, detail=f"Expense is already {exp.status.lower()}")
            
        # Get corresponding expense account
        exp_acc_name = "General & Admin Expense (MMK)"
        if exp.category == "utilities":
            exp_acc_name = "Utilities Expense (MMK)"
        elif exp.category == "maintenance":
            exp_acc_name = "Maintenance Expense (MMK)"
        elif exp.category == "salaries":
            exp_acc_name = "Salary Expense (MMK)"
        elif exp.category == "petty_cash":
            exp_acc_name = "Petty Cash Expense (MMK)"
            
        exp_acc_q = select(Account).where(Account.account_name == exp_acc_name)
        exp_acc_res = await session.execute(exp_acc_q)
        exp_acc = exp_acc_res.scalars().first()
        
        # Get credit asset account based on payment method
        credit_acc_name = "Cash in Hand (MMK)"
        if exp.payment_method == "Bank":
            credit_acc_name = "CB Bank (MMK)"
        elif exp.payment_method == "Petty Cash":
            credit_acc_name = "Petty Cash (MMK)"
            
        credit_acc_q = select(Account).where(Account.account_name == credit_acc_name)
        credit_acc_res = await session.execute(credit_acc_q)
        credit_acc = credit_acc_res.scalars().first()
        
        if not exp_acc or not credit_acc:
            raise HTTPException(status_code=400, detail="Required general ledger accounts not found")
            
        # Record double-entry Journal Entry
        entry = JournalEntry(
            entry_date=exp.expense_date,
            description=f"Expense: {exp.title} ({exp.category})",
            reference=f"EXP{exp.expense_id:05d}",
            entry_type="expense"
        )
        session.add(entry)
        await session.flush()
        
        # Debit expense account
        deb_line = JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=exp_acc.account_id,
            debit_mmk=exp.amount_mmk,
            credit_mmk=0.0
        )
        # Credit asset account
        cred_line = JournalEntryLine(
            entry_id=entry.entry_id,
            account_id=credit_acc.account_id,
            debit_mmk=0.0,
            credit_mmk=exp.amount_mmk
        )
        session.add(deb_line)
        session.add(cred_line)
        
        # Update expense
        exp.status = "Approved"
        exp.approved_by = user_id
        
        await session.commit()
        await session.refresh(exp)
        return exp

    @staticmethod
    async def reject_expense(session: AsyncSession, expense_id: int, user_id: int) -> Expense:
        """Rejects a pending expense."""
        exp_q = select(Expense).where(Expense.expense_id == expense_id)
        exp_res = await session.execute(exp_q)
        exp = exp_res.scalars().first()
        if not exp:
            raise HTTPException(status_code=404, detail="Expense record not found")
            
        if exp.status != "Pending":
            raise HTTPException(status_code=400, detail=f"Expense is already {exp.status.lower()}")
            
        exp.status = "Rejected"
        exp.approved_by = user_id
        await session.commit()
        await session.refresh(exp)
        return exp

    @staticmethod
    async def list_expenses(
        session: AsyncSession,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        department: Optional[str] = None
    ) -> List[dict]:
        """Lists expenses with filters and returns serialized data."""
        q = select(Expense).order_by(Expense.expense_date.desc(), Expense.expense_id.desc())
        
        if start_date:
            q = q.where(Expense.expense_date >= datetime.strptime(start_date, "%Y-%m-%d").date())
        if end_date:
            q = q.where(Expense.expense_date <= datetime.strptime(end_date, "%Y-%m-%d").date())
        if category:
            q = q.where(Expense.category == category)
        if status:
            q = q.where(Expense.status == status)
        if department:
            q = q.where(Expense.department == department)
            
        res = await session.execute(q)
        expenses = res.scalars().all()
        
        data = []
        for exp in expenses:
            approver_name = None
            if exp.approved_by:
                app_q = select(User).where(User.user_id == exp.approved_by)
                app_res = await session.execute(app_q)
                user = app_res.scalars().first()
                if user:
                    approver_name = user.username
                    
            data.append({
                "expense_id": exp.expense_id,
                "title": exp.title,
                "description": exp.description,
                "amount_mmk": exp.amount_mmk,
                "category": exp.category,
                "expense_date": str(exp.expense_date),
                "status": exp.status,
                "approved_by": exp.approved_by,
                "approver_name": approver_name,
                "department": exp.department,
                "budget_amount": exp.budget_amount,
                "payment_method": exp.payment_method,
                "created_at": str(exp.created_at)
            })
        return data

    @staticmethod
    async def get_budget_vs_actual(session: AsyncSession) -> List[dict]:
        """Compares budget vs actual expenses for all categories."""
        # Query sum of actual and budget amounts grouped by category (for Approved expenses)
        q = (
            select(
                Expense.category,
                func.sum(Expense.amount_mmk).label("actual_mmk"),
                func.sum(Expense.budget_amount).label("budget_mmk")
            )
            .where(Expense.status == "Approved")
            .group_by(Expense.category)
        )
        res = await session.execute(q)
        rows = res.all()
        
        data = []
        categories_seen = set()
        for row in rows:
            categories_seen.add(row.category)
            data.append({
                "category": row.category,
                "actual_mmk": row.actual_mmk or 0.0,
                "budget_mmk": row.budget_mmk or 0.0,
                "variance_mmk": (row.budget_mmk or 0.0) - (row.actual_mmk or 0.0)
            })
            
        # Ensure categories that have pending or budget-only entries are represented
        all_cats = ["utilities", "maintenance", "salaries", "petty_cash", "others"]
        for cat in all_cats:
            if cat not in categories_seen:
                data.append({
                    "category": cat,
                    "actual_mmk": 0.0,
                    "budget_mmk": 0.0,
                    "variance_mmk": 0.0
                })
        return data
