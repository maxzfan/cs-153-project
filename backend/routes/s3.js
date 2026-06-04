import { Router } from 'express';
import { PutObjectCommand, GetObjectCommand, ListObjectVersionsCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3 presigned URL routes (legacy per-user paths under /api/aws).
 * Returns an Express Router.
 */
export function createS3Routes({ s3Client, BUCKET_NAME, verifyAuth, validateS3Key }) {
  const router = Router();

  // Get presigned URL for upload
  router.get('/presigned-upload', verifyAuth, async (req, res) => {
    try {
      const { key, expiresIn: rawExpiresIn = '3600' } = req.query;
      const expiresIn = Math.min(Math.max(parseInt(rawExpiresIn) || 3600, 60), 3600);

      if (!key) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      validateS3Key(key, req.user.id);

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });

      res.json({
        url,
        expiresIn
      });
    } catch (error) {
      if (error.message.includes('does not belong to user')) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  // Get presigned URL for download (with version)
  router.get('/presigned-download', verifyAuth, async (req, res) => {
    try {
      const { key, versionId, expiresIn: rawExpiresIn = '3600' } = req.query;
      const expiresIn = Math.min(Math.max(parseInt(rawExpiresIn) || 3600, 60), 3600);

      if (!key || !versionId) {
        return res.status(400).json({ error: 'Missing key or versionId parameter' });
      }

      validateS3Key(key, req.user.id);

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        VersionId: versionId,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });

      res.json({
        url,
        expiresIn: parseInt(expiresIn)
      });
    } catch (error) {
      if (error.message.includes('does not belong to user')) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to generate download URL' });
    }
  });

  // List file versions
  router.get('/list-versions', verifyAuth, async (req, res) => {
    try {
      const { key } = req.query;

      if (!key) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      validateS3Key(key, req.user.id);

      const command = new ListObjectVersionsCommand({
        Bucket: BUCKET_NAME,
        Prefix: key,
      });

      const response = await s3Client.send(command);

      const versions = (response.Versions || []).map(version => ({
        key: version.Key,
        versionId: version.VersionId,
        size: version.Size,
        lastModified: version.LastModified?.toISOString(),
        isLatest: version.IsLatest,
      }));

      res.json({ versions });
    } catch (error) {
      if (error.message.includes('does not belong to user')) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to list versions' });
    }
  });

  // Delete a specific version
  router.delete('/delete-version', verifyAuth, async (req, res) => {
    try {
      const { key, versionId } = req.body;

      if (!key || !versionId) {
        return res.status(400).json({ error: 'Missing key or versionId parameter' });
      }

      validateS3Key(key, req.user.id);

      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        VersionId: versionId,
      });

      await s3Client.send(command);

      res.json({ success: true });
    } catch (error) {
      if (error.message.includes('does not belong to user')) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to delete version' });
    }
  });

  return router;
}
