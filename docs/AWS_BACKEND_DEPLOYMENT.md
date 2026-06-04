# AWS Backend Deployment Guide

This guide walks you through deploying the 0studio backend server to AWS so that your Homebrew-distributed app can connect to it.

## Overview

```
┌─────────────────────────────────────┐
│   Desktop App (Homebrew users)      │
│   VITE_BACKEND_URL=https://...      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   AWS Backend (this guide)          │
│   - App Runner (recommended)        │
│   - Or Elastic Beanstalk            │
│   - Or Lambda + API Gateway         │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌───────────┐   ┌───────────┐
│  Supabase │   │  Stripe   │
└───────────┘   └───────────┘
```

## Prerequisites

- AWS Account ([Sign up here](https://aws.amazon.com/))
- AWS CLI installed (`brew install awscli`)
- Docker installed (for App Runner)
- Your backend code ready in `backend/` folder
- IAM user with appropriate permissions (see below)

### Important: AWS Region

**Throughout this guide, replace `us-east-1` with your actual AWS region** (e.g., `us-east-2`, `eu-west-1`, etc.). 

To check your configured region:
```bash
aws configure get region
```

All AWS resources (ECR, App Runner, S3) should be in the **same region** for best performance.

### IAM Permissions Required

Your IAM user needs these permissions:
- **ECR Access**: `AmazonEC2ContainerRegistryFullAccess` (to create repositories and push images)
- **App Runner Access**: `AWSAppRunnerFullAccess` (to create and manage App Runner services)
- **S3 Access**: For your backend to access S3 buckets

If you get "AccessDeniedException" errors, go to IAM Console → Users → Your User → Add permissions → Attach these policies.

## Option 1: AWS App Runner (Recommended - Simplest)

AWS App Runner is the easiest way to deploy a containerized web service.

### Step 1: Create a Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
```

### Step 2: Create `.dockerignore`

Create `backend/.dockerignore`:

```
node_modules
.env
.git
*.md
```

### Step 3: Push to Amazon ECR (Elastic Container Registry)

**⚠️ IMPORTANT: Use the same region consistently throughout this guide. Replace `us-east-1` with your actual region (e.g., `us-east-2`) if different.**

```bash
# Configure AWS CLI (if not already done)
aws configure
# Enter your AWS Access Key ID, Secret Access Key, region (e.g., us-east-1 or us-east-2)

# Create ECR repository (replace us-east-1 with your region)
aws ecr create-repository --repository-name 0studio-backend --region us-east-1

# Get the repository URI (SAVE THIS!)
aws ecr describe-repositories --repository-names 0studio-backend --region us-east-1 --query 'repositories[0].repositoryUri' --output text
# Output example: 123456789.dkr.ecr.us-east-1.amazonaws.com/0studio-backend

# IMPORTANT: Note your AWS Account ID and region from the output above
# Format: {ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/0studio-backend

# Login to ECR (make sure REGION in command matches REGION in URL)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

# Build and push (from backend/ folder)
cd backend
docker build --platform linux/amd64 -t 0studio-backend .

# Tag the image (use YOUR account ID and region)
docker tag 0studio-backend:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/0studio-backend:latest

# Push to ECR
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/0studio-backend:latest
```

**Common Error**: If you get "400 Bad Request" on login, make sure the region in the `--region` flag matches the region in the ECR URL.

### Step 4: Create App Runner Service

**Via AWS Console (easiest):**

1. Go to [AWS App Runner Console](https://console.aws.amazon.com/apprunner)
2. Click **Create service**
3. **Source Configuration**:
   - Repository type: **Container registry** → **Amazon ECR**
   - Browse and select your image: `0studio-backend:latest`
   - Deployment: **Automatic** (deploys on new image push)
   - **ECR access role**: Select **"Create new service role"** (AWS will auto-create `AppRunnerECRAccessRole`)
   - Click **Next**

4. **Service settings**:
   - Service name: `0studio-backend`
   - CPU: `1 vCPU` (or `0.25 vCPU` for minimal cost)
   - Memory: `2 GB` (or `0.5 GB` for minimal cost)
   - Port: `3000`

5. **Environment variables** (click **Add environment variable** for each):
   ```
   AWS_ACCESS_KEY_ID = your_aws_access_key
   AWS_SECRET_ACCESS_KEY = your_aws_secret_key
   AWS_REGION = us-east-1
   S3_BUCKET_NAME = 0studio-files
   SUPABASE_URL = https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = your_service_role_key
   STRIPE_SECRET_KEY = sk_test_... (or sk_live_... for production)
   STRIPE_WEBHOOK_SECRET = whsec_placeholder
   FRONTEND_URL = *
   PORT = 3000
   NODE_ENV = production
   ```
   
   **Note**: Use `whsec_placeholder` for now; we'll update this after creating the Stripe webhook.

6. **Health check** (optional but recommended):
   - Path: `/health`
   - Interval: `10 seconds`
   - Timeout: `5 seconds`
   - Unhealthy threshold: `3`

7. **Auto scaling** (use defaults or customize):
   - Min instances: `1`
   - Max instances: `3`
   - Max concurrency: `100`

8. Click **Create & deploy**
9. Wait for deployment (~5 minutes)
10. Copy your service URL: `https://xxxxx.{your-region}.awsapprunner.com`

**Via AWS CLI:**

```bash
# Create App Runner service (after pushing to ECR)
aws apprunner create-service \
  --service-name 0studio-backend \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "123456789.dkr.ecr.us-east-1.amazonaws.com/0studio-backend:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "SUPABASE_URL": "https://your-project.supabase.co",
          "SUPABASE_SERVICE_ROLE_KEY": "your_key",
          "STRIPE_SECRET_KEY": "sk_live_...",
          "STRIPE_WEBHOOK_SECRET": "whsec_...",
          "FRONTEND_URL": "*",
          "PORT": "3000"
        }
      }
    },
    "AutoDeploymentsEnabled": true
  }' \
  --instance-configuration '{
    "Cpu": "0.25 vCPU",
    "Memory": "0.5 GB"
  }' \
  --region us-east-1
```

### Step 5: Test Your Deployment

```bash
# Test health endpoint
curl https://xxxxx.us-east-1.awsapprunner.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

## Option 2: AWS Elastic Beanstalk (Alternative)

Elastic Beanstalk is good if you prefer not to use Docker.

### Step 1: Install EB CLI

```bash
brew install awsebcli
```

### Step 2: Initialize Elastic Beanstalk

```bash
cd backend

# Initialize EB application
eb init -p node.js-20 0studio-backend --region us-east-1

# Create environment with environment variables
eb create 0studio-production \
  --envvars SUPABASE_URL=https://your-project.supabase.co,SUPABASE_SERVICE_ROLE_KEY=your_key,STRIPE_SECRET_KEY=sk_live_...,STRIPE_WEBHOOK_SECRET=whsec_...,FRONTEND_URL=*
```

### Step 3: Deploy

```bash
eb deploy
```

### Step 4: Get URL

```bash
eb status
# Look for CNAME: 0studio-production.xxxxx.us-east-1.elasticbeanstalk.com
```

---

## Option 3: AWS Lambda + API Gateway (Serverless)

For serverless deployment, you'd need to refactor `server.js` to use a Lambda handler. This is more complex but can be cheaper for low traffic.

See [Serverless Framework](https://www.serverless.com/) or [AWS SAM](https://aws.amazon.com/serverless/sam/) for this approach.

---

## After Deployment: Update Your App

### 1. Update Frontend Environment

Edit your `.env` file in the project root:

```env
VITE_BACKEND_URL=https://xxxxx.us-east-1.awsapprunner.com
```

Or for Elastic Beanstalk:
```env
VITE_BACKEND_URL=https://0studio-production.xxxxx.us-east-1.elasticbeanstalk.com
```

### 2. Configure Stripe Webhooks for Production

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Endpoint URL: `https://xxxxx.us-east-1.awsapprunner.com/api/stripe/webhook`
4. Select events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)
7. Update your App Runner environment variable:
   - Go to App Runner console → Your service → Configuration → Edit
   - Update `STRIPE_WEBHOOK_SECRET` with the new production webhook secret

### 3. Switch to Live Stripe Keys

In your App Runner environment variables:
- `STRIPE_SECRET_KEY` = `sk_live_...` (not `sk_test_...`)

In your app's `.env`:
- `VITE_STRIPE_PUBLISHABLE_KEY` = `pk_live_...` (not `pk_test_...`)

### 4. Rebuild and Distribute Your App

```bash
# Rebuild the app with new backend URL
npm run build:all

# Your DMG will now point to the production backend
```

---

## Verifying Everything Works

### 1. Test the Backend Health

```bash
curl https://your-backend-url.awsapprunner.com/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-01-28T..."}
```

### 2. Test Stripe Webhook (using Stripe CLI)

```bash
# Forward test events to your production endpoint
stripe trigger customer.subscription.created \
  --api-key sk_live_... \
  --webhook-endpoint https://your-backend-url.awsapprunner.com/api/stripe/webhook
```

### 3. Test Payment Status API

```bash
# Get a valid JWT token from your app (check browser dev tools)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://your-backend-url.awsapprunner.com/api/stripe/payment-status
```

### 4. Full End-to-End Test

1. Download your Homebrew-distributed app
2. Sign in with a test account
3. Try to import a model → Should show "Subscription Required"
4. Subscribe via Stripe checkout (use test card `4242 4242 4242 4242`)
5. Wait for webhook to process (~5 seconds)
6. Try to import again → Should work!

---

## Cost Estimates

| Service | Estimated Monthly Cost |
|---------|------------------------|
| **App Runner** (0.25 vCPU, 0.5GB) | ~$5-15/month |
| **Elastic Beanstalk** (t3.micro) | ~$10-20/month |
| **Lambda + API Gateway** | ~$0-5/month (pay per request) |

App Runner is recommended for simplicity and automatic scaling.

---

## Troubleshooting

### ECR AccessDeniedException

**Error**: `User is not authorized to perform: ecr:CreateRepository`

**Solution**: Your IAM user needs ECR permissions.
1. Go to IAM Console → Users → Your User
2. Click "Add permissions" → "Attach policies directly"
3. Search for and attach: `AmazonEC2ContainerRegistryFullAccess`
4. Retry the command

### Region Mismatch Error

**Error**: `400 Bad Request` when running `docker login`

**Cause**: The region in your `--region` flag doesn't match the region in your ECR URL.

**Solution**: Make sure both match. For example:
```bash
# ✅ CORRECT - both use us-east-2
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-2.amazonaws.com

# ❌ WRONG - us-east-1 vs us-east-2 mismatch
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-2.amazonaws.com
```

### App Runner Service Role Not Found

**Issue**: "No existing service role" when creating App Runner service

**Solution**: Select "Create new service role" and let AWS auto-create `AppRunnerECRAccessRole`. This role allows App Runner to pull images from ECR.

### CORS Errors

If you see CORS errors, make sure your backend has:
```javascript
app.use(cors({
  origin: '*',  // Or specific origins
  credentials: true
}));
```

### Webhook Signature Verification Failed

This means the `STRIPE_WEBHOOK_SECRET` doesn't match. Make sure you:
1. Created a **new** webhook endpoint in Stripe Dashboard for production
2. Copied the **new** signing secret to App Runner environment variables
3. Redeployed the service after updating env vars

### 502 Bad Gateway

Check App Runner logs:
1. Go to App Runner console → Your service → Logs
2. Look for startup errors
3. Common issues: missing env vars, wrong port, Node.js version mismatch

### Health Check Failing

Make sure your `/health` endpoint returns a 200 status:
```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Environment Variables Not Loading

If your app can't find environment variables:
1. Verify all env vars are set in App Runner console → Configuration → Environment variables
2. Make sure there are no extra spaces in variable names or values
3. Redeploy the service after adding/updating variables

---

## Quick Reference

| Item | Value |
|------|-------|
| Backend URL | `https://xxxxx.{your-region}.awsapprunner.com` |
| Health Check | `GET /health` |
| Payment Status | `GET /api/stripe/payment-status` |
| Stripe Webhook | `POST /api/stripe/webhook` |
| AWS Region | Use the same region throughout (e.g., `us-east-1`, `us-east-2`) |
| ECR Repository | `{account-id}.dkr.ecr.{region}.amazonaws.com/0studio-backend` |

---

## Security Checklist

- [ ] Never commit `.env` files with secrets
- [ ] Use environment variables in AWS for all secrets
- [ ] Use `sk_live_` keys in production, `sk_test_` in development
- [ ] Restrict CORS origins if possible (instead of `*`)
- [ ] Enable HTTPS only (App Runner does this automatically)
- [ ] Monitor for unusual webhook activity in Stripe Dashboard

---

## Deployment Checklist

### 1. AWS Setup
- [ ] Configure AWS CLI with `aws configure`
- [ ] Verify IAM permissions (ECR, App Runner, S3)
- [ ] Note your AWS region and account ID

### 2. ECR Setup
- [ ] Create ECR repository
- [ ] Login to ECR with correct region
- [ ] Build Docker image for linux/amd64
- [ ] Tag and push image to ECR

### 3. App Runner Setup
- [ ] Create App Runner service
- [ ] Select ECR image and create service role
- [ ] Configure CPU, memory, and port
- [ ] Add all environment variables (including AWS credentials)
- [ ] Wait for deployment (~5 minutes)
- [ ] Test `/health` endpoint

### 4. Stripe Configuration
- [ ] Create webhook endpoint in Stripe Dashboard
- [ ] Copy webhook signing secret
- [ ] Update `STRIPE_WEBHOOK_SECRET` in App Runner
- [ ] Redeploy service with new secret
- [ ] Test webhook with Stripe CLI

### 5. Frontend Update
- [ ] Update `VITE_BACKEND_URL` in root `.env`
- [ ] Rebuild app with `npm run build:all`
- [ ] Test full subscription flow
- [ ] Distribute via Homebrew

### 6. Production Checklist
- [ ] Switch to live Stripe keys (`sk_live_...`)
- [ ] Update webhook to use production endpoint
- [ ] Enable monitoring/alerts in AWS
- [ ] Document your backend URL for team
- [ ] Set up S3 bucket if not already done

---

## Success! 🎉

Your backend is now live at: `https://xxxxx.{region}.awsapprunner.com`

Next time you update your backend code:
1. Push changes to ECR: `docker push ...`
2. App Runner will auto-deploy (if automatic deployment is enabled)
3. No other steps needed!
