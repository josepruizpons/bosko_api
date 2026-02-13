import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { api_error500 } from './errors';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-3',
  credentials: {
    accessKeyId: process.env.AWS_ID!,
    secretAccessKey: process.env.AWS_SECRET_KEY!,
  },
});

const BUCKET = process.env.AWS_BUCKET!;

if (!BUCKET) {
  throw new Error('AWS_BUCKET environment variable is required');
}

if (!process.env.AWS_ID || !process.env.AWS_SECRET_KEY) {
  throw new Error('AWS_ID and AWS_SECRET_KEY environment variables are required');
}

/**
 * Upload a file to S3
 * @param buffer - File buffer
 * @param key - S3 key (path/filename)
 * @param contentType - MIME type
 * @returns The S3 URL of the uploaded file
 */
export async function uploadFileToS3(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Return the public URL
  return await getSignedFileUrl(key)
}

/**
 * Download a file from S3
 * @param key - S3 key (path/filename)
 * @returns File buffer
 */
export async function downloadFileFromS3(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`File not found: ${key}`);
  }

  // Convert stream to buffer
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/**
 * Delete a file from S3
 * @param key - S3 key (path/filename)
 */
export async function deleteFileFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Stream a file from S3
 * @param key - S3 key (path/filename)
 * @returns Object with stream and metadata
 */
export async function streamFileFromS3(key: string): Promise<{
  stream: ReadableStream;
  contentType: string | undefined;
  contentLength: number | undefined;
}> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`File not found: ${key}`);
  }

  return {
    stream: response.Body as ReadableStream,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/**
 * Generate a signed URL for temporary access to a file
 * @param key - S3 key (path/filename)
 * @param expirationSeconds - URL expiration time in seconds (default: 3600)
 * @returns Signed URL
 */
export async function getSignedFileUrl(
  key: string,
  expirationSeconds: number = 1800
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  try {
    return await getSignedUrl(s3Client, command, {
      expiresIn: expirationSeconds,
    });

  } catch (error) {
    console.log(error)
    api_error500()
    return ''
  }
}

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'eu-west-3',
  credentials: {
    accessKeyId: process.env.AWS_ID!,
    secretAccessKey: process.env.AWS_SECRET_KEY!,
  },
});

export async function invokeVideoLambda(audioS3Key: string, imageS3Key: string, fileName: string): Promise<string> {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || 'bosko-video';

  const command = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({
      audioS3Key,
      imageS3Key,
      fileName,
    }),
  });

  const response = await lambdaClient.send(command);

  if (response.StatusCode !== 200) {
    throw new Error(`Lambda invocation failed with status ${response.StatusCode}`);
  }

  const payload: {
    statusCode: number;
    body: { key: string }
  } = JSON.parse(
    new TextDecoder().decode(response.Payload)
  );
  console.log({ payload })

  if (payload.statusCode !== 200) {
    throw new Error(`Lambda error`);
  }

  // Lambda returns the S3 key
  return payload.body.key
}

export { s3Client, BUCKET };




