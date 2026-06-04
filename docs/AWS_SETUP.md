# AWS S3 Architecture & Deployment Guide

**SaaS File Storage Platform ("GitHub for Architects")**  
**Version:** v1.0 (MVP scope)

---

## Overview

This document describes the AWS architecture and deployment model for 0studio, a SaaS product that provides organized, versioned cloud storage for large architectural 3D model files.

The product is conceptually a "GitHub for architects", but does not use Git. Instead, it focuses on:
- **Explicit version history** (iterations: v1, v2, v3...)
- **Secure cloud storage**
- **Easy retrieval**
- **Team-based sharing** (enterprise plans)

### Product Constraints

- Large files (hundreds of MB → multiple GB)
- Explicit versioning (v1, v2, v3…)
- Per-user and per-team access control
- Only one local copy; full history in cloud
- No file processing, diffing, or parsing

---

## Technology Stack

### External Services

| Service | Purpose |
|---------|---------|
| **Supabase** | Authentication (JWT) & Metadata database (Postgres) |
| **Stripe** | Subscription plans & Feature gating |

### AWS Infrastructure

| Service | Purpose |
|---------|---------|
| **Amazon S3** | Private object storage |
| **AWS Lambda** | Backend API (or Node.js server) |
| **Amazon API Gateway** | HTTP routing |
| **AWS IAM** | Access control |

---

## High-Level Architecture

```
Client (Web / Desktop)
   |
   |  HTTPS + Supabase JWT
   |
API Gateway / Express Server
   |
Backend (Lambda or Node.js)
   |
   |— JWT validation (Supabase)
   |— Permission checks (DB)
   |— Stripe plan enforcement
   |— Pre-signed S3 URLs
   |
Amazon S3 (Private)
```

### Core Security Rule

> **Clients NEVER receive AWS credentials and NEVER access S3 without pre-signed URLs.**

---

## Storage Architecture (Amazon S3)

### Bucket Configuration

| Setting | Value |
|---------|-------|
| **Bucket name** | `0studio-files` |
| **Region** | `us-east-1` |
| **Public access** | Fully blocked |
| **Bucket versioning** | **Disabled** (versioning handled manually via explicit files) |

### Object Key Naming Convention (Authoritative)

All files **must** follow this exact format:

```
users/{user_id}/projects/{project_id}/models/{model_id}/versions/{version_name}-{original_file_name}
```

**Example:**
```
users/123/projects/456/models/789/versions/v12-building.ifc
```

**Why this matters:**
- Clear per-user isolation
- Predictable access control
- Easy iteration tracking
- No client-generated paths

### Versioning Strategy

Each iteration is stored as a **new S3 object** (explicit version files).

| Version | S3 Key |
|---------|--------|
| v1 | `users/123/projects/456/models/789/versions/v1-building.ifc` |
| v2 | `users/123/projects/456/models/789/versions/v2-building.ifc` |
| v3 | `users/123/projects/456/models/789/versions/v3-building.ifc` |

> ❌ **S3 native versioning is NOT used.** Each version is a separate object.

---

## Metadata Architecture (Supabase)

S3 stores **raw files only**. Supabase Postgres stores **all structure and permissions**.

### Database Tables

```sql
-- Projects
projects
  id uuid primary key
  owner_id uuid
  org_id uuid null
  name text
  created_at timestamp

-- Models (files within projects)
models
  id uuid primary key
  project_id uuid
  name text
  created_at timestamp

-- Model Versions (explicit versioning)
model_versions
  id uuid primary key
  model_id uuid
  s3_key text
  version_name text
  file_size bigint
  uploaded_by uuid
  is_current boolean
  created_at timestamp

-- Team Access (enterprise)
project_members
  project_id uuid
  user_id uuid
  role text  -- 'owner', 'editor', 'viewer'
```

### Full SQL Schema

Run in Supabase SQL Editor (see `SUPABASE_SETUP.md` for complete schema with RLS policies).

---

## Backend API Endpoints

All endpoints require:
```
Authorization: Bearer <SUPABASE_JWT>
```

### POST /files/upload-url

**Purpose:** Generate a pre-signed S3 PUT URL for uploading a new version.

**Request:**
```json
{
  "project_id": "uuid",
  "model_id": "uuid",
  "version_name": "v12",
  "file_name": "building.ifc",
  "file_size": 482394823
}
```

**Backend Flow:**
1. Validate JWT
2. Verify project access
3. Enforce Stripe plan limits
4. Generate S3 key
5. Generate pre-signed PUT URL (≤ 15 min)

**Response:**
```json
{
  "upload_url": "https://s3-presigned-url...",
  "s3_key": "users/123/projects/456/models/789/versions/v12-building.ifc"
}
```

### POST /files/confirm-upload

**Purpose:** Persist metadata after upload completes.

**Request:**
```json
{
  "model_id": "uuid",
  "s3_key": "users/123/projects/456/models/789/versions/v12-building.ifc",
  "version_name": "v12",
  "file_size": 482394823
}
```

**Backend Flow:**
1. Validate JWT
2. Verify permission
3. Mark old versions `is_current = false`
4. Insert new `model_versions` row
5. Set `is_current = true`

**Response:**
```json
{
  "success": true,
  "version": { "id": "uuid", "version_name": "v12", ... }
}
```

### POST /files/download-url

**Purpose:** Generate a pre-signed S3 GET URL.

**Request:**
```json
{
  "s3_key": "users/123/projects/456/models/789/versions/v12-building.ifc"
}
```

**Backend Flow:**
1. Validate JWT
2. Look up metadata
3. Verify access
4. Generate pre-signed GET URL (≤ 15 min)

**Response:**
```json
{
  "download_url": "https://s3-presigned-url..."
}
```

### GET /files/versions?model_id=uuid

**Purpose:** List all versions of a model.

**Response:**
```json
{
  "versions": [
    { "id": "uuid", "version_name": "v12", "file_size": 482394823, ... },
    { "id": "uuid", "version_name": "v11", "file_size": 480000000, ... }
  ]
}
```

### POST /files/models

**Purpose:** Create a new model within a project.

**Request:**
```json
{
  "project_id": "uuid",
  "name": "Main Building"
}
```

---

## IAM Configuration

### Lambda/Backend IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::0studio-files/*"
    }
  ]
}
```

### Security Guarantees

- ✅ No public S3 access
- ✅ No per-user IAM roles
- ✅ All authorization enforced by backend

---

## Setup Instructions

### Step 1: Create S3 Bucket

**Using AWS Console:**

1. Go to https://console.aws.amazon.com/s3/
2. Click "Create bucket"
3. Configure:
   - **Bucket name**: `0studio-files` (must be globally unique)
   - **Region**: `us-east-1`
   - **Block Public Access**: ✅ Keep ALL boxes checked
   - **Bucket Versioning**: ❌ Keep **Disabled** (we use explicit versioning)
4. Click "Create bucket"

**Using AWS CLI:**

```bash
# Create bucket
aws s3api create-bucket \
  --bucket 0studio-files \
  --region us-east-1

# Verify public access is blocked
aws s3api put-public-access-block \
  --bucket 0studio-files \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### Step 2: Create IAM User

1. Go to https://console.aws.amazon.com/iam/
2. Click "Users" → "Create user"
3. **User name**: `0studio-backend`
4. Attach the custom policy above (or `AmazonS3FullAccess` for development)
5. Create access key and save credentials

### Step 3: Configure Backend Environment

Create `backend/.env`:

```env
# AWS Configuration
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
S3_BUCKET_NAME=0studio-files

# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Server Configuration
PORT=3000
FRONTEND_URL=http://localhost:5173
```

### Step 4: Run Database Migration

Run the SQL schema in Supabase SQL Editor (see `SUPABASE_SETUP.md`).

### Step 5: Start Backend

```bash
cd backend
npm install
npm run dev
```

### Step 6: Test Endpoints

```bash
# Health check
curl http://localhost:3000/health

# Get upload URL (requires auth)
curl -X POST http://localhost:3000/files/upload-url \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "uuid",
    "model_id": "uuid",
    "version_name": "v1",
    "file_name": "building.ifc",
    "file_size": 1000000
  }'
```

---

## Security Model

| Rule | Implementation |
|------|----------------|
| JWT validation | Every request validates Supabase JWT |
| Short-lived URLs | Pre-signed URLs expire in 15 minutes |
| Server-side keys | S3 keys generated only by backend |
| No metadata in S3 | All metadata stored in Supabase |

---

## Stripe Plan Limits

| Plan | Max File Size |
|------|---------------|
| Free | 500 MB |
| Student | 500 MB |
| Enterprise | 5 GB |

Limits are enforced in `POST /files/upload-url` before generating pre-signed URLs.

---

## Explicit Non-Goals

- ❌ Git-style diffs
- ❌ File parsing or previews
- ❌ Real-time collaboration
- ❌ CAD-specific processing
- ❌ Local sync daemon

---

## Future Enhancements (Not Implemented)

- CloudFront CDN
- Glacier archival rules
- Audit logs (enterprise)
- File locking
- Retention policies

---

## Rules for Coding LLMs & Contributors

1. **Never bypass backend** for S3 access
2. **Never trust client-provided** user IDs
3. **Never store metadata** in S3
4. **Always enforce Stripe limits** server-side
5. **Always generate S3 keys** server-side

---

## One-Line System Summary

> A server-mediated, versioned S3 storage system where Supabase manages identity and metadata, Stripe controls entitlements, and the backend issues temporary access to private files.

---

## Frontend API Usage

```typescript
import { filesAPI } from '@/lib/aws-api';

// Upload a new version
const version = await filesAPI.uploadVersion(
  projectId,
  modelId,
  'v12',
  'building.ifc',
  fileBuffer,
  'application/octet-stream'
);

// Download a version
const fileData = await filesAPI.downloadVersion(s3Key);

// List all versions
const versions = await filesAPI.listVersions(modelId);

// Create a new model
const model = await filesAPI.createModel({
  project_id: projectId,
  name: 'Main Building'
});
```

---

## Troubleshooting

### "Access Denied" errors
- Check IAM user has correct permissions
- Verify bucket name matches `.env` file

### "Project not found" errors
- Ensure project exists in Supabase
- Check user has access to project

### "Plan limit exceeded" errors
- User needs to upgrade Stripe subscription
- Check file size is within plan limits

### "S3 key does not belong to user" errors
- S3 keys must start with `users/{userId}/`
- Verify user ID matches authenticated user

---

## Cost Estimation

With standard S3 pricing in `us-east-1`:

| Usage | Cost |
|-------|------|
| Storage | ~$0.023/GB/month |
| PUT requests | ~$0.005 per 1,000 |
| GET requests | ~$0.0004 per 1,000 |
| Data transfer | First 100GB free, then ~$0.09/GB |

**Example:** 100 users, 50GB storage, 10,000 requests/month ≈ **$1-2/month**
