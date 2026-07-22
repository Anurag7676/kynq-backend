# API Error Response Structures - Quick Reference

This document provides a quick reference for all error response structures from the user authentication endpoints.

---

## Error Response Standard Format

All error responses follow this structure:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "code": "ERROR_CODE", // Optional: for programmatic handling
  "canResendOTP": true, // Optional: for OTP-related errors
  "error": "Detailed error message" // Optional: usually only in development
}
```

---

## Registration Endpoint Errors

### 1. User Already Exists (Verified)
```json
{
  "success": false,
  "message": "User with this email already exists. Please login instead.",
  "code": "USER_EXISTS_VERIFIED"
}
```

### 2. Missing Required Fields
```json
{
  "success": false,
  "message": "Please provide all required fields"
}
```

### 3. Server Error
```json
{
  "success": false,
  "message": "Server error",
  "error": "Detailed error message here"
}
```

---

## OTP Verification Endpoint Errors

### 1. Invalid or Expired OTP
```json
{
  "success": false,
  "message": "Invalid or expired OTP"
}
```

### 2. Already Verified
```json
{
  "success": false,
  "message": "Email is already verified"
}
```

### 3. User Not Found
```json
{
  "success": false,
  "message": "User not found"
}
```

### 4. Missing Fields
```json
{
  "success": false,
  "message": "Please provide email and OTP"
}
```

---

## Resend OTP Endpoint Errors

### 1. User Not Found
```json
{
  "success": false,
  "message": "User not found"
}
```

### 2. Already Verified
```json
{
  "success": false,
  "message": "Email is already verified"
}
```

### 3. Missing Email
```json
{
  "success": false,
  "message": "Please provide email"
}
```

---

## Login Endpoint Errors

### 1. Email Not Verified
```json
{
  "success": false,
  "message": "Email not verified. Please verify your email first. You can request a new OTP by calling the resend-otp endpoint.",
  "code": "EMAIL_NOT_VERIFIED",
  "canResendOTP": true
}
```

### 2. Invalid Credentials
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

### 3. Account Deactivated
```json
{
  "success": false,
  "message": "Account is deactivated. Please contact support."
}
```

### 4. Missing Fields
```json
{
  "success": false,
  "message": "Please provide email and password"
}
```

---

## Check Verification Status Errors

### 1. User Not Found
```json
{
  "success": false,
  "message": "User not found"
}
```

### 2. Missing Email
```json
{
  "success": false,
  "message": "Please provide email"
}
```

---

## Success Response with Codes

### Registration - OTP Resent
```json
{
  "success": true,
  "message": "Account found but email not verified. A new verification OTP has been sent to your email address.",
  "code": "RESENT_OTP",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "isVerified": false
  }
}
```

---

## Error Code Reference Table

| Code | Endpoint | Meaning | Frontend Action |
|------|----------|---------|----------------|
| `USER_EXISTS_VERIFIED` | POST /register | User already registered and verified | Redirect to login page |
| `EMAIL_NOT_VERIFIED` | POST /login | Email not verified | Show verification prompt with resend option |
| `RESENT_OTP` | POST /register | OTP automatically resent | Show success message, proceed to OTP page |
| (none) | All | Generic error | Show error message to user |

---

## TypeScript Error Interface

```typescript
interface ApiErrorResponse {
  success: false;
  message: string;
  code?: 'USER_EXISTS_VERIFIED' | 'EMAIL_NOT_VERIFIED' | 'RESENT_OTP';
  canResendOTP?: boolean;
  error?: string; // Development only
}

interface ApiSuccessResponse {
  success: true;
  message: string;
  code?: 'RESENT_OTP';
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    isVerified: boolean;
  };
  token?: string;
  isVerified?: boolean;
  isActive?: boolean;
}
```

---

## Frontend Error Handling Example

```typescript
const handleApiError = (error: ApiErrorResponse) => {
  switch (error.code) {
    case 'USER_EXISTS_VERIFIED':
      // Show info message and redirect to login
      showToast('info', error.message);
      setTimeout(() => navigate('/login'), 2000);
      break;
    
    case 'EMAIL_NOT_VERIFIED':
      // Show verification prompt with resend option
      if (error.canResendOTP) {
        showVerificationModal(error.message);
      } else {
        showToast('error', error.message);
      }
      break;
    
    default:
      // Generic error handling
      showToast('error', error.message);
      break;
  }
};
```

---

## HTTP Status Codes

| Status Code | Meaning | When Used |
|-------------|---------|-----------|
| 200 | Success | Successful operations |
| 201 | Created | New user registered |
| 400 | Bad Request | Validation errors, user exists, etc. |
| 401 | Unauthorized | Login failed, email not verified |
| 404 | Not Found | User not found |
| 500 | Server Error | Internal server errors |

---

## Quick Copy-Paste Error Messages

### For Toast/Notification Components

```javascript
const ERROR_MESSAGES = {
  USER_EXISTS_VERIFIED: {
    type: 'info',
    message: 'User with this email already exists. Please login instead.',
    action: 'redirect_to_login'
  },
  EMAIL_NOT_VERIFIED: {
    type: 'warning',
    message: 'Email not verified. Please verify your email first.',
    action: 'show_verification_prompt'
  },
  INVALID_OTP: {
    type: 'error',
    message: 'Invalid or expired OTP. Please request a new one.',
    action: 'show_resend_button'
  },
  INVALID_CREDENTIALS: {
    type: 'error',
    message: 'Invalid credentials. Please check your email and password.',
    action: null
  },
  ACCOUNT_DEACTIVATED: {
    type: 'error',
    message: 'Account is deactivated. Please contact support.',
    action: 'contact_support'
  }
};
```

---

**Last Updated:** January 2024



