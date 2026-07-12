# Production container notes

Compose reads application and service credentials from
`/opt/sales-quotation/shared/.env.production`. Create it from
`env.production.example`, set ownership to `root:deploy` and mode `0640` so the
rootless deploy user can read it through the `deploy` group, and pass it to
the mandatory startup wrapper:

```sh
sudo chown root:deploy /opt/sales-quotation/shared/.env.production
sudo chmod 0640 /opt/sales-quotation/shared/.env.production
/opt/sales-quotation/current/deploy/production-up.sh \
  /opt/sales-quotation/shared/.env.production
```

`APP_IMAGE` must be an immutable image digest (`registry/name@sha256:...`), not a
mutable tag. The wrapper resolves the `web` image through Compose, rejects
anything except `repo@sha256:<64 lowercase hex>`, validates the complete Compose
configuration, and only then starts the services. It derives the Compose file and
validator paths from its own release directory, so it can be run from any working
directory. Do not bypass it for production startup. PostgreSQL and MinIO are
reachable only on the internal Compose network. The web service is reachable only
through `127.0.0.1:3000` for the host Nginx reverse proxy.

The release installer also requires this canonical digest as its second
argument. It pulls the full-Git-SHA tag and rejects it unless the pulled digest
matches the value recorded by the GitHub publication job:

```sh
/opt/sales-quotation/current/deploy/install-release.sh "$GIT_SHA" "$APP_IMAGE"
```

Before accepting uploads, create `S3_BUCKET` and a bucket-scoped application user
in MinIO. Put that user's credentials in `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY`; do not expose MinIO root credentials to the web service.

## Worker deferred

This repository does not contain a queue consumer or worker entrypoint. Import
processing currently runs only when the authenticated
`app/api/imports/[jobId]/process/route.ts` endpoint is called. A worker service is
therefore deliberately absent: pointing a container at a nonexistent artifact
would create a restart loop and falsely imply asynchronous processing. Add the
worker to Compose only after a tested worker entrypoint and build artifact exist;
at that point it must use the exact same `APP_IMAGE` digest as `web`.
