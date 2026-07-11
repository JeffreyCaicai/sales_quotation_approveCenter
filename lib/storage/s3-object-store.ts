import {
  DeleteObjectCommand,
  GetObjectTaggingCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { ImportError } from "@/lib/imports/contracts";
import type { ObjectStore, PendingObject } from "@/lib/storage/object-store";

export interface S3ObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

type Presign = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly config: S3ObjectStoreConfig,
    private readonly client: S3Client = new S3Client(S3ObjectStore.clientConfig(config)),
    private readonly presign: Presign = getSignedUrl,
  ) {}

  static fromEnv(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): S3ObjectStore {
    const values = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    };
    if (Object.values(values).some((value) => !value?.trim())) {
      throw new ImportError(500, "STORAGE_CONFIGURATION_ERROR");
    }
    try {
      new URL(values.endpoint!);
    } catch {
      throw new ImportError(500, "STORAGE_CONFIGURATION_ERROR");
    }
    return new S3ObjectStore(values as S3ObjectStoreConfig);
  }

  private static clientConfig(config: S3ObjectStoreConfig): S3ClientConfig {
    return {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
  }

  async putImmutable(
    key: string,
    body: Uint8Array,
    contentType: string,
    sha256: string,
    attemptId: string,
  ): Promise<PendingObject> {
    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        Metadata: { sha256, state: "pending", attemptid: attemptId },
        Tagging: new URLSearchParams({ state: "pending", attemptId }).toString(),
        IfNoneMatch: "*",
      }));
      return { key, attemptId, versionId: result.VersionId };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 412 || (error as { name?: string }).name === "PreconditionFailed") {
        throw new ImportError(409, "STORAGE_OBJECT_COLLISION");
      }
      const owned = await this.probePending(key, attemptId);
      if (owned) return owned;
      throw new ImportError(500, "STORAGE_WRITE_FAILED");
    }
  }

  private async probePending(
    key: string,
    attemptId?: string,
    versionId?: string,
  ): Promise<PendingObject | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket, Key: key, VersionId: versionId,
      }));
      const tags = await this.client.send(new GetObjectTaggingCommand({
        Bucket: this.config.bucket, Key: key, VersionId: versionId ?? head.VersionId,
      }));
      const tagMap = Object.fromEntries((tags.TagSet ?? []).map((tag) => [tag.Key, tag.Value]));
      const owner = tagMap.attemptId ?? head.Metadata?.attemptid;
      const state = tagMap.state ?? head.Metadata?.state;
      if (state !== "pending" || !owner || (attemptId && owner !== attemptId)) return null;
      if (versionId && head.VersionId && head.VersionId !== versionId) return null;
      return { key, attemptId: owner, versionId: head.VersionId ?? versionId };
    } catch {
      return null;
    }
  }

  async cleanupPending(object: PendingObject): Promise<"deleted" | "not_owned"> {
    const owned = await this.probePending(object.key, object.attemptId, object.versionId);
    if (!owned) return "not_owned";
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: object.key,
      VersionId: owned.versionId,
    }));
    return "deleted";
  }

  async commitPending(object: PendingObject): Promise<void> {
    const owned = await this.probePending(object.key, object.attemptId, object.versionId);
    if (!owned) return;
    await this.client.send(new PutObjectTaggingCommand({
      Bucket: this.config.bucket,
      Key: object.key,
      VersionId: owned.versionId,
      Tagging: { TagSet: [
        { Key: "state", Value: "committed" },
        { Key: "attemptId", Value: object.attemptId },
      ] },
    }));
  }

  async listPendingObjects(): Promise<PendingObject[]> {
    const pending: PendingObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: "imports/",
        ContinuationToken: token,
      }));
      for (const item of page.Contents ?? []) {
        if (!item.Key) continue;
        const owned = await this.probePending(item.Key);
        if (owned) pending.push(owned);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return pending;
  }

  async getSignedDownloadUrl(key: string, expiresSeconds: number): Promise<string> {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 3600) {
      throw new ImportError(400, "STORAGE_EXPIRY_INVALID");
    }
    return this.presign(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }
}
