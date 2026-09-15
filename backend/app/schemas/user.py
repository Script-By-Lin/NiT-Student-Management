from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date

class UserBase(BaseModel):
    user_id: int
    user_code: str
    username: str
    email: str
    password: str
    phone: str
    nrc: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    profile_picture: Optional[str] = None
    date_of_birth: Optional[date] = None
    role: str
    is_active: Optional[bool] = True
    how_did_you_hear: Optional[str] = None
    student_type: Optional[str] = None
    
    @field_validator('password')
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v

class LoginUser(BaseModel):
    email: str
    password: str
    remember_me: Optional[bool] = False

class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    nrc: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    date_of_birth: Optional[date] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    profile_picture: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    how_did_you_hear: Optional[str] = None
    student_type: Optional[str] = None
    intended_course_code: Optional[str] = None
    signature: Optional[str] = None
    user_code: Optional[str] = None


class AdminStudentCreate(BaseModel):
    username: str
    email: str
    password: Optional[str] = None
    date_of_birth: date
    is_active: Optional[bool] = True
    
    # Optional manual code
    user_code: Optional[str] = None
    
    # Contact info
    nrc: Optional[str] = None
    phone: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    address: Optional[str] = None
    
    # Optional enrollment
    course_code: Optional[str] = None
    batch_no: Optional[str] = None
    batch_id: Optional[int] = None
    payment_plan: Optional[str] = None
    downpayment: Optional[float] = None
    installment_amount: Optional[float] = None
    total_fee: Optional[float] = None
    exam_fee_gbp: Optional[float] = None

    
    # Division
    department: Optional[str] = "College"

    # Profile integration
    profile_picture: Optional[str] = None
    
    # Tracking
    how_did_you_hear: Optional[str] = None
    student_type: Optional[str] = None

    @field_validator('password')
    @classmethod
    def password_length(cls, v):
        if v is not None and len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v


class AdminParentCreate(BaseModel):
    username: str
    email: str
    password: str
    date_of_birth: date
    is_active: Optional[bool] = True

    @field_validator('password')
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v

class AdminStaffCreate(BaseModel):
    username: str
    email: str
    password: str
    date_of_birth: date
    role: str
    is_active: Optional[bool] = True

    @field_validator('password')
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v
        
    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ['sales', 'hr', 'manager', 'teacher', 'accountant', 'student_affairs']:
            raise ValueError('Role must be sales, hr, manager, teacher, accountant, or student_affairs')
        return v


class AdminParentLinkChild(BaseModel):
    student_code: str
    relationship_label: Optional[str] = "parent"

class StudentRegister(BaseModel):
    username: str
    email: str
    date_of_birth: date
    
    # Contact info
    phone: str
    nrc: str
    gender: str
    parent_name: str
    parent_phone: str
    address: str
    profile_picture: str
    
    # Division & Enrollment
    department: str = "College"
    course_code: str
    
    # Tracking
    how_did_you_hear: str
    student_type: str = "New Student"
    
    # E-Signature
    signature: str

class AdminStudentApprove(BaseModel):
    user_code: Optional[str] = None
    auto_prefix: Optional[str] = None # "CO" or "IN"

class UserPasswordChange(BaseModel):
    old_password: str
    new_password: str

    @field_validator('new_password')
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v

class AdminUserPasswordChange(BaseModel):
    new_password: str

    @field_validator('new_password')
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v

