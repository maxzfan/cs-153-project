// AWS S3 API service
// Connects to backend API that handles AWS operations securely

export interface PresignedUrlResponse {
  url: string;
  expiresIn: number; // seconds
}

export interface UploadResponse {
  versionId: string;
  etag: string;
}

export interface S3FileMetadata {
  key: string;
  versionId: string;
  size: number;
  lastModified: string;
}


export class AWSS3API {
  private baseUrl: string;

  constructor() {
    // Use VITE_BACKEND_URL for consistency, fallback to VITE_AWS_API_URL for backward compatibility
    const backendUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_AWS_API_URL || 'http://localhost:3000';
    this.baseUrl = `${backendUrl}/api/aws`;
  }

  /**
   * Get a presigned URL for uploading a file to S3
   * @param s3Key - The S3 key (path) where the file should be uploaded
   * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
   */
  async getPresignedUploadUrl(s3Key: string, expiresIn: number = 3600): Promise<PresignedUrlResponse> {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('User must be authenticated to upload files');
    }

    const response = await fetch(
      `${this.baseUrl}/presigned-upload?key=${encodeURIComponent(s3Key)}&expires=${expiresIn}`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to get presigned upload URL: ${response.statusText}`);
    }
    
    return await response.json();
  }

  /**
   * Get a presigned URL for downloading a specific version of a file from S3
   * @param s3Key - The S3 key (path) of the file
   * @param versionId - The S3 version ID to download
   * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
   */
  async getPresignedDownloadUrl(
    s3Key: string,
    versionId: string,
    expiresIn: number = 3600
  ): Promise<PresignedUrlResponse> {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('User must be authenticated to download files');
    }

    const response = await fetch(
      `${this.baseUrl}/presigned-download?key=${encodeURIComponent(s3Key)}&versionId=${versionId}&expires=${expiresIn}`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to get presigned download URL: ${response.statusText}`);
    }
    
    return await response.json();
  }

  /**
   * Upload a file directly to S3 using a presigned URL
   * Returns the S3 version ID from the response header
   * @param presignedUrl - The presigned URL from getPresignedUploadUrl
   * @param fileData - The file data (ArrayBuffer, Blob, or File)
   * @param contentType - Optional content type
   */
  async uploadFile(
    presignedUrl: string,
    fileData: ArrayBuffer | Blob | File,
    contentType?: string
  ): Promise<UploadResponse> {
    try {
      const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: fileData,
        headers: contentType ? { 'Content-Type': contentType } : {},
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      // Extract version ID from response header (S3 returns this when versioning is enabled)
      const versionId = response.headers.get('x-amz-version-id');
      const etag = response.headers.get('etag') || '';

      if (!versionId) {
        throw new Error('S3 version ID not found in response. Make sure versioning is enabled on your S3 bucket.');
      }

      return {
        versionId,
        etag,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Download a file from S3 using a presigned URL
   * @param presignedUrl - The presigned URL from getPresignedDownloadUrl
   */
  async downloadFile(presignedUrl: string): Promise<ArrayBuffer> {
    try {
      const response = await fetch(presignedUrl);
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      throw error;
    }
  }

  /**
   * List all versions of a file in S3
   * @param s3Key - The S3 key (path) of the file
   */
  async listFileVersions(s3Key: string): Promise<S3FileMetadata[]> {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('User must be authenticated to list file versions');
    }

    const response = await fetch(
      `${this.baseUrl}/list-versions?key=${encodeURIComponent(s3Key)}`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to list versions: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.versions;
  }

  /**
   * Delete a specific version of a file from S3
   * @param s3Key - The S3 key (path) of the file
   * @param versionId - The S3 version ID to delete
   */
  async deleteFileVersion(s3Key: string, versionId: string): Promise<void> {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('User must be authenticated to delete file versions');
    }

    const response = await fetch(`${this.baseUrl}/delete-version`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ key: s3Key, versionId }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to delete version: ${response.statusText}`);
    }
  }

  /**
   * Generate S3 key from project and file path
   * Format: org-{userId}/project-{projectId}/models/{filename}
   * @deprecated Use FilesAPI.generateS3Key() for new architecture
   */
  generateS3Key(userId: string, projectId: string, filename: string, folder: string = 'models'): string {
    return `org-${userId}/project-${projectId}/${folder}/${filename}`;
  }
}

// Export singleton instance
export const awsS3API = new AWSS3API();



