# 0studio Backend API

Backend API server for handling AWS S3 operations securely.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
S3_BUCKET_NAME=0studio-files

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server Configuration
PORT=3000
FRONTEND_URL=http://localhost:5173
```

### 3. Get AWS Credentials

1. Go to AWS Console → IAM → Users
2. Create a new user named `0studio-backend`
3. Attach policy: `AmazonS3FullAccess` (or create custom policy)
4. Save the Access Key ID and Secret Access Key
5. Add them to your `.env` file

### 4. Get Supabase Service Role Key

1. Go to Supabase Dashboard → Settings → API
2. Copy the `service_role` key (NOT the anon key)
3. Add it to your `.env` file

### 5. Create S3 Bucket

```bash
# Using AWS CLI
aws s3api create-bucket \
  --bucket 0studio-files \
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket 0studio-files \
  --versioning-configuration Status=Enabled
```

Or use AWS Console:
1. Go to S3 → Create bucket
2. Name: `0studio-files`
3. Region: Choose closest to your users
4. Block Public Access: Keep enabled
5. Properties → Bucket Versioning → Enable

### 6. Start the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

All endpoints require authentication via Supabase JWT token in the `Authorization` header.

### GET `/health`
Health check endpoint (no auth required)

### GET `/api/aws/presigned-upload`
Get presigned URL for uploading a file.

**Query Parameters:**
- `key` (required): S3 key/path for the file
- `expiresIn` (optional): Expiration time in seconds (default: 3600)

**Example:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/aws/presigned-upload?key=org-123/project-456/models/file.3dm"
```

### GET `/api/aws/presigned-download`
Get presigned URL for downloading a specific version.

**Query Parameters:**
- `key` (required): S3 key/path for the file
- `versionId` (required): S3 version ID
- `expiresIn` (optional): Expiration time in seconds (default: 3600)

### GET `/api/aws/list-versions`
List all versions of a file.

**Query Parameters:**
- `key` (required): S3 key/path for the file

### DELETE `/api/aws/delete-version`
Delete a specific version of a file.

**Body:**
```json
{
  "key": "org-123/project-456/models/file.3dm",
  "versionId": "version-id-here"
}
```

## Security Features

- ✅ JWT token verification via Supabase
- ✅ User isolation (users can only access files in `org-{userId}/` paths)
- ✅ Rate limiting (100 requests per 15 minutes per IP)
- ✅ CORS protection
- ✅ Input validation

## Testing

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Test authenticated endpoint (replace YOUR_TOKEN with actual Supabase JWT):
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/aws/presigned-upload?key=org-test123/project-test456/models/test.3dm"
```

## Deployment

### Option 1: AWS Elastic Beanstalk
- Managed Node.js hosting
- Auto-scaling
- Uses your AWS credits

### Option 2: AWS Lambda + API Gateway
- Serverless
- Pay per request
- Good for low traffic

### Option 3: VPS (DigitalOcean, Linode, etc.)
- Simple Node.js hosting
- ~$5-10/month

## Troubleshooting

**Error: "AWS credentials not configured"**
- Check that `.env` file exists and has correct AWS credentials

**Error: "S3 bucket not found"**
- Verify bucket name in `.env` matches your actual bucket
- Check AWS region is correct

**Error: "Invalid or expired token"**
- Make sure you're using Supabase JWT token from authenticated user
- Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are correct

**Error: "S3 key does not belong to user"**
- S3 keys must start with `org-{userId}/`
- Verify the user ID matches the authenticated user
