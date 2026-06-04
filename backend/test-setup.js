#!/usr/bin/env node
/**
 * Quick test script to verify AWS S3 backend setup
 * Run: node test-setup.js
 */

import dotenv from 'dotenv';
import { S3Client, ListBucketsCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function testSetup() {
  console.log('🧪 Testing AWS S3 Backend Setup...\n');

  // Test 1: Check environment variables
  console.log('1️⃣ Checking environment variables...');
  const required = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'S3_BUCKET_NAME',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing.join(', '));
    console.error('   Please check your .env file\n');
    return;
  }
  console.log('✅ All environment variables are set\n');

  // Test 2: Test AWS S3 connection
  console.log('2️⃣ Testing AWS S3 connection...');
  try {
    const s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    // List buckets to verify credentials
    const buckets = await s3Client.send(new ListBucketsCommand({}));
    console.log(`✅ AWS connection successful (found ${buckets.Buckets?.length || 0} buckets)`);

    // Check if target bucket exists
    const bucketExists = buckets.Buckets?.some(
      b => b.Name === process.env.S3_BUCKET_NAME
    );

    if (!bucketExists) {
      console.warn(`⚠️  Bucket "${process.env.S3_BUCKET_NAME}" not found`);
      console.warn('   Please create the bucket or check the name in .env\n');
    } else {
      console.log(`✅ Bucket "${process.env.S3_BUCKET_NAME}" found`);

      // Check versioning
      try {
        const versioning = await s3Client.send(
          new GetBucketVersioningCommand({ Bucket: process.env.S3_BUCKET_NAME })
        );
        if (versioning.Status === 'Enabled') {
          console.log('✅ Bucket versioning is enabled\n');
        } else {
          console.warn('⚠️  Bucket versioning is NOT enabled');
          console.warn('   Please enable versioning in S3 bucket settings\n');
        }
      } catch (error) {
        console.warn('⚠️  Could not check versioning:', error.message);
      }
    }
  } catch (error) {
    console.error('❌ AWS connection failed:', error.message);
    console.error('   Check your AWS credentials\n');
    return;
  }

  // Test 3: Test Supabase connection
  console.log('3️⃣ Testing Supabase connection...');
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Try to get a user (this will fail if credentials are wrong)
    const { error } = await supabase.auth.admin.listUsers({ limit: 1 });
    if (error) {
      throw error;
    }
    console.log('✅ Supabase connection successful\n');
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    console.error('   Check your Supabase URL and service role key\n');
    return;
  }

  console.log('🎉 All tests passed! Your backend is ready to use.');
  console.log('\nNext steps:');
  console.log('1. Start the backend: cd backend && npm run dev');
  console.log('2. Test the health endpoint: curl http://localhost:3000/health');
  console.log('3. Start your frontend and try uploading a file');
}

testSetup().catch(console.error);
