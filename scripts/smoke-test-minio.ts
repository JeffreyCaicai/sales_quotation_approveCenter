import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function runMinioSmoke(
  client: S3Client,
  bucket: string,
  key: string,
  payload: string,
): Promise<void> {
  let bucketCreated = false;
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload }));
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as GetObjectCommandOutput;
    const actual = await result.Body?.transformToString();
    if (actual !== payload) throw new Error("MinIO object round-trip mismatch");
  } finally {
    if (bucketCreated) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } finally {
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const client = new S3Client({
    endpoint: required("MINIO_SMOKE_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("MINIO_SMOKE_ACCESS_KEY_ID"),
      secretAccessKey: required("MINIO_SMOKE_SECRET_ACCESS_KEY"),
    },
  });
  const bucket = `quotation-ci-${randomUUID()}`;
  try {
    await runMinioSmoke(client, bucket, "health/probe.txt", "quotation-minio-smoke");
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
