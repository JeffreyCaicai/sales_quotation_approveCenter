# Production container notes

Compose reads application and service credentials from
`/opt/sales-quotation/shared/.env.production`. Create it from
`env.production.example`, set ownership to `root:deploy` and mode `0640` so the
rootless deploy user can read it through the `deploy` group, and pass it to
Compose for variable interpolation:

```sh
sudo chown root:deploy /opt/sales-quotation/shared/.env.production
sudo chmod 0640 /opt/sales-quotation/shared/.env.production
IMAGE="$(docker compose --env-file /opt/sales-quotation/shared/.env.production config --images web)"
deploy/validate-app-image.sh "$IMAGE"
docker compose --env-file /opt/sales-quotation/shared/.env.production config --quiet
docker compose --env-file /opt/sales-quotation/shared/.env.production up -d
```

`APP_IMAGE` must be an immutable image digest (`registry/name@sha256:...`), not a
mutable tag. The preflight resolves the `web` image through Compose and rejects
anything except `repo@sha256:<64 lowercase hex>`. Run it before every production
`up`. PostgreSQL and MinIO are reachable only on the internal Compose network.
The web service is reachable only through `127.0.0.1:3000` for the host Nginx
reverse proxy.

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
