import { Router } from 'express';
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Cloud sync routes — project-scoped S3 operations with member permission checks.
 * Mounted at /api/projects/:projectId/sync.
 *
 * NOTE: Express mergeParams is required so req.params.projectId is visible
 * from the parent mount path.
 */
const VALID_FILE_KEY = /^(tree\.json|commits\/[a-zA-Z0-9_-]+\.(3dm|delta|glb|rvt|ifc))$/;

// Original-format and derivative-status allowlists for tree.json push validation
const VALID_ORIGINAL_FORMATS = new Set(['.3dm', '.rvt', '.ifc']);
const VALID_DERIVATIVE_STATUSES = new Set(['present', 'missing']);

function validateFileKey(fileKey) {
  if (!fileKey || !VALID_FILE_KEY.test(fileKey)) {
    const err = new Error('Invalid file_key');
    err.status = 400;
    throw err;
  }
}

function validateTreeCommitMetadata(treeData) {
  if (!treeData || !Array.isArray(treeData.commits)) return;
  for (const c of treeData.commits) {
    if (c?.originalFormat !== undefined && !VALID_ORIGINAL_FORMATS.has(c.originalFormat)) {
      const err = new Error(`Invalid originalFormat for commit ${c.id}`);
      err.status = 400;
      throw err;
    }
    if (c?.derivativeStatus !== undefined && !VALID_DERIVATIVE_STATUSES.has(c.derivativeStatus)) {
      const err = new Error(`Invalid derivativeStatus for commit ${c.id}`);
      err.status = 400;
      throw err;
    }
    if (c?.derivativeSize !== undefined && (typeof c.derivativeSize !== 'number' || c.derivativeSize < 0 || !Number.isFinite(c.derivativeSize))) {
      const err = new Error(`Invalid derivativeSize for commit ${c.id}`);
      err.status = 400;
      throw err;
    }
  }
}

export function createSyncRoutes({ s3Client, BUCKET_NAME, verifyAuth, checkProjectPermission, verifySubscription }) {
  const router = Router({ mergeParams: true });

  // Get a presigned upload URL for a project file
  router.post('/push-url', verifyAuth, verifySubscription(), async (req, res) => {
    try {
      const { projectId } = req.params;
      const { file_key } = req.body;
      console.log(`[sync] push-url: projectId=${projectId}, file_key=${file_key}`);

      if (!file_key) {
        return res.status(400).json({ error: 'Missing file_key parameter' });
      }
      validateFileKey(file_key);

      const permission = await checkProjectPermission(projectId, req.user.id, 'editor', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'You need editor or owner access to push files' });
      }

      const s3Key = `projects/${projectId}/${file_key}`;
      console.log(`[sync] push-url: generating presigned URL for s3Key=${s3Key}, bucket=${BUCKET_NAME}`);

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      res.json({ upload_url: url, s3_key: s3Key });
    } catch (error) {
      console.error(`[sync] push-url error:`, error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  // Get a presigned download URL for a project file
  router.post('/pull-url', verifyAuth, async (req, res) => {
    try {
      const { projectId } = req.params;
      const { file_key } = req.body;

      if (!file_key) {
        return res.status(400).json({ error: 'Missing file_key parameter' });
      }
      validateFileKey(file_key);

      const permission = await checkProjectPermission(projectId, req.user.id, 'viewer', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const s3Key = `projects/${projectId}/${file_key}`;

      // Force binary download semantics on every GET. Prevents any artifact (.glb, .3dm,
      // .rvt, .ifc) from being interpreted as HTML/JS if a teammate is tricked into
      // opening a presigned URL directly — stored-XSS defense in depth.
      // tree.json is served as JSON so downloadText()/pull-content still work unchanged.
      const isJson = file_key === 'tree.json';
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ResponseContentType: isJson ? 'application/json' : 'application/octet-stream',
        ...(isJson ? {} : { ResponseContentDisposition: 'attachment' }),
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      res.json({ download_url: url, s3_key: s3Key });
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
        return res.status(404).json({ error: 'File not found in cloud storage' });
      }
      res.status(500).json({ error: 'Failed to generate download URL' });
    }
  });

  // Download file content directly (for browser clients that can't fetch S3 presigned URLs due to CORS)
  router.post('/pull-content', verifyAuth, async (req, res) => {
    try {
      const { projectId } = req.params;
      const { file_key } = req.body;
      console.log(`[sync] pull-content: projectId=${projectId}, file_key=${file_key}`);

      if (!file_key) {
        return res.status(400).json({ error: 'Missing file_key parameter' });
      }
      validateFileKey(file_key);

      const permission = await checkProjectPermission(projectId, req.user.id, 'viewer', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const s3Key = `projects/${projectId}/${file_key}`;
      console.log(`[sync] pull-content: fetching s3Key=${s3Key}, bucket=${BUCKET_NAME}`);

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });

      const response = await s3Client.send(command);
      const body = await response.Body.transformToString();
      console.log(`[sync] pull-content: success, body length=${body.length}`);
      res.setHeader('Content-Type', 'application/json');
      res.send(body);
    } catch (error) {
      console.error(`[sync] pull-content error:`, error.name, error.Code, error.message);
      if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
        return res.status(404).json({ error: 'File not found in cloud storage' });
      }
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  // List all synced files for a project
  router.get('/list', verifyAuth, async (req, res) => {
    try {
      const { projectId } = req.params;

      const permission = await checkProjectPermission(projectId, req.user.id, 'viewer', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const prefix = `projects/${projectId}/`;

      const command = new ListObjectVersionsCommand({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
      });

      const response = await s3Client.send(command);

      const files = (response.Versions || [])
        .filter(v => v.IsLatest)
        .map(v => ({
          key: v.Key,
          file_key: v.Key.replace(prefix, ''),
          size: v.Size,
          lastModified: v.LastModified?.toISOString(),
        }));

      res.json({ files });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list project files' });
    }
  });

  // Push tree.json directly with optimistic locking (ETag-based)
  router.post('/push-tree', verifyAuth, verifySubscription(), async (req, res) => {
    try {
      const { projectId } = req.params;
      const { treeData, expectedETag } = req.body;

      if (!treeData) {
        return res.status(400).json({ error: 'Missing treeData parameter' });
      }

      // Reject malformed commit metadata before it lands in S3. Blocks a compromised
      // client from injecting path-traversal values through originalFormat that the
      // renderer later uses to build local file paths.
      try {
        validateTreeCommitMetadata(treeData);
      } catch (validationErr) {
        return res.status(400).json({ error: validationErr.message });
      }

      const permission = await checkProjectPermission(projectId, req.user.id, 'editor', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'You need editor or owner access to push files' });
      }

      const s3Key = `projects/${projectId}/tree.json`;

      // If expectedETag is provided, check current ETag for conflict detection
      if (expectedETag) {
        try {
          const headCommand = new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          });
          const headResponse = await s3Client.send(headCommand);
          const currentETag = headResponse.ETag;

          if (currentETag && currentETag !== expectedETag) {
            console.log(`[sync] push-tree: ETag mismatch for projectId=${projectId}. expected=${expectedETag}, current=${currentETag}`);
            return res.status(409).json({ error: 'conflict', currentETag });
          }
        } catch (error) {
          // If the file doesn't exist yet, that's fine — no conflict
          if (error.name !== 'NotFound' && error.name !== 'NoSuchKey' && error.Code !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
            throw error;
          }
        }
      }

      // Write tree.json
      const putCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: JSON.stringify(treeData, null, 2),
        ContentType: 'application/json',
      });

      const putResponse = await s3Client.send(putCommand);
      const newETag = putResponse.ETag;

      console.log(`[sync] push-tree: success for projectId=${projectId}, newETag=${newETag}`);
      res.json({ etag: newETag });
    } catch (error) {
      console.error(`[sync] push-tree error:`, error);
      res.status(500).json({ error: 'Failed to push tree.json' });
    }
  });

  // Get the current ETag for tree.json (lightweight check)
  router.get('/tree-etag', verifyAuth, async (req, res) => {
    try {
      const { projectId } = req.params;

      const permission = await checkProjectPermission(projectId, req.user.id, 'viewer', req.user.email);
      if (!permission.allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const s3Key = `projects/${projectId}/tree.json`;

      try {
        const headCommand = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
        });
        const headResponse = await s3Client.send(headCommand);
        res.json({ etag: headResponse.ETag || null });
      } catch (error) {
        if (error.name === 'NotFound' || error.name === 'NoSuchKey' || error.Code === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
          return res.json({ etag: null });
        }
        throw error;
      }
    } catch (error) {
      console.error(`[sync] tree-etag error:`, error);
      res.status(500).json({ error: 'Failed to get tree ETag' });
    }
  });

  return router;
}
