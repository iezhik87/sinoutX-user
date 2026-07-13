import { Client as MinioClient } from 'minio'
import { config } from '../config/index.js'

export const minio = new MinioClient({
  endPoint: config.MINIO_ENDPOINT,
  port: config.MINIO_PORT,
  useSSL: config.MINIO_USE_SSL,
  accessKey: config.MINIO_USER,
  secretKey: config.MINIO_PASSWORD,
})

export const BUCKET = config.MINIO_BUCKET

export async function setupStorage() {
  const exists = await minio.bucketExists(BUCKET)
  if (!exists) {
    await minio.makeBucket(BUCKET, 'us-east-1')
    // Public read policy for the bucket
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKET}/*`],
        },
      ],
    })
    await minio.setBucketPolicy(BUCKET, policy)
  }
}

export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string,
  size: number,
): Promise<string> {
  await minio.putObject(BUCKET, key, buffer, size, { 'Content-Type': mimeType })
  return key
}

export async function deleteFile(key: string): Promise<void> {
  await minio.removeObject(BUCKET, key)
}

export function getPublicUrl(key: string): string {
  // /uploads/ is proxied to MinIO by nginx, so the browser can load files
  return `/uploads/${key}`
}

export async function getPresignedUrl(key: string, expirySeconds = 3600): Promise<string> {
  return minio.presignedGetObject(BUCKET, key, expirySeconds)
}
