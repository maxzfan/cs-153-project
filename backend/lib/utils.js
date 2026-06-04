import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { SendEmailCommand } from '@aws-sdk/client-ses';

/**
 * Utility function factory.
 * Returns { escapeHtml, resolvePendingInvites, sendProjectInviteEmail, ensureS3Cors }.
 */
export function createUtils({ supabase, sesClient, s3Client, BUCKET_NAME, INVITE_FROM_EMAIL }) {

  function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Resolve any pending project invites for a newly-authenticated user.
   * When someone is invited by email before they have an account, the
   * project_members row has user_id=null and status='pending'.  Once they
   * sign in we can link their account and activate the membership.
   */
  async function resolvePendingInvites(user) {
    if (!user?.email) return;
    try {
      const { data: pending } = await supabase
        .from('project_members')
        .select('id')
        .eq('email', user.email.toLowerCase())
        .is('user_id', null);

      if (pending && pending.length > 0) {
        const ids = pending.map(r => r.id);
        await supabase
          .from('project_members')
          .update({ user_id: user.id, status: 'active', updated_at: new Date().toISOString() })
          .in('id', ids);
      }
    } catch (_err) {
      // Swallow — invite resolution is best-effort
    }
  }

  /**
   * Send project invite email via Amazon SES (no-op if INVITE_FROM_EMAIL not set).
   */
  async function sendProjectInviteEmail({ toEmail, projectName, inviterEmail, role, appUrl }) {
    if (!INVITE_FROM_EMAIL) {
      return;
    }
    const appLink = appUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
    const subject = `You're invited to the project "${projectName}" on 0studio`;
    const text = `${inviterEmail} invited you to the project "${projectName}" as ${role}.\n\nOpen 0studio and sign in to see the project: ${appLink}`;
    const html = `
    <p>${escapeHtml(inviterEmail)} invited you to the project <strong>${escapeHtml(projectName)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
    <p><a href="${escapeHtml(appLink)}">Open 0studio</a> and sign in to see the project.</p>
  `.trim();
    try {
      const command = new SendEmailCommand({
        Source: INVITE_FROM_EMAIL,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' },
          },
        },
      });
      await sesClient.send(command);
    } catch (_err) {
      // Best-effort — don't fail the request if email fails
    }
  }

  /**
   * Ensure S3 bucket has CORS configured for presigned URL access from the browser.
   */
  async function ensureS3Cors() {
    if (!BUCKET_NAME) return;
    try {
      const command = new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ['*'],
              AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
              AllowedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
              ExposeHeaders: ['ETag', 'x-amz-version-id'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      });
      await s3Client.send(command);
    } catch (_err) {
      // Best-effort — log handled at caller level if needed
    }
  }

  return { escapeHtml, resolvePendingInvites, sendProjectInviteEmail, ensureS3Cors };
}
