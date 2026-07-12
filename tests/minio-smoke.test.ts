import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, test } from "vitest";

import { runMinioSmoke } from "@/scripts/smoke-test-minio";

const payload = "quotation-minio-smoke";

function fakeClient(returnedPayload = payload) {
  const calls: string[] = [];
  const client = {
    async send(command: unknown) {
      calls.push(command?.constructor.name ?? "unknown");
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToString: async () => returnedPayload } };
      }
      return {};
    },
  } as unknown as S3Client;
  return { calls, client };
}

describe("MinIO S3 smoke", () => {
  test("creates a unique bucket, round-trips an object, and removes both", async () => {
    const { calls, client } = fakeClient();
    await runMinioSmoke(client, "quotation-ci-unique", "probe.txt", payload);
    expect(calls).toEqual([
      CreateBucketCommand.name,
      PutObjectCommand.name,
      GetObjectCommand.name,
      DeleteObjectCommand.name,
      DeleteBucketCommand.name,
    ]);
  });

  test("fails a corrupt read and still cleans up the object and bucket", async () => {
    const { calls, client } = fakeClient("wrong");
    await expect(runMinioSmoke(client, "quotation-ci-corrupt", "probe.txt", payload)).rejects.toThrow("round-trip mismatch");
    expect(calls.slice(-2)).toEqual([DeleteObjectCommand.name, DeleteBucketCommand.name]);
  });
});
