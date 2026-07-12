# Production Release Checklist

Use this checklist for every GitHub-to-VPS production release. Record the CI
run, image digest, backup evidence, deployment run, and health evidence in the
operations log; never copy secret values into that record.

## One-time GitHub and registry controls

- [ ] Protect `main` and require the complete `CI` workflow before merge.
- [ ] Create the GitHub `production` environment, restrict it to `main`, and
      configure required reviewers when the repository plan supports them.
- [ ] Store exactly `VPS_HOST`, `VPS_PORT`, `VPS_USER`,
      `VPS_SSH_PRIVATE_KEY`, and `VPS_HOST_KEY` as `production` environment
      secrets. Keep database, application, MinIO, backup, and age secrets only
      in `/opt/sales-quotation/shared/.env.production` or the recovery kit.
- [ ] Set `VPS_USER` to `deploy`. Record `VPS_HOST_KEY` from an independently
      verified host-key ceremony; do not obtain it with `ssh-keyscan` during a
      deployment.
- [ ] Ensure the VPS rootless Docker daemon can pull
      `ghcr.io/jeffreycaicai/sales_quotation_approvecenter`. The package must be
      public or authenticated on the VPS outside the workflow; do not add a
      long-lived registry credential to GitHub deployment secrets.

## CI and native Docker/PostgreSQL gate

- [ ] Confirm `CI` ran for the exact full Git SHA on a trusted `main` push, not
      a pull-request ref or fork.
- [ ] Confirm Node 22 `npm ci`, logic, localization, unit, ESLint, and the
      production Next.js build succeeded.
- [ ] Confirm ShellCheck and the committed-secret/private-key scan succeeded.
- [ ] Confirm `docker-compose.test.yml` started healthy PostgreSQL and MinIO,
      every migration in `drizzle/` applied, and all native PostgreSQL
      integration/concurrency/publication/import/lifecycle tests succeeded.
- [ ] Confirm the production Dockerfile built and the focused production
      Playwright smoke passed `/api/health`, the login page, and one dashboard
      transition.

Local Docker CLI absence is not a release waiver. The mandatory GitHub CI
Docker, PostgreSQL, MinIO, image-build, and browser jobs remain the release
gate.

## VPS, backup, restore, Nginx, and domain gate

- [ ] Confirm the deploy user's daemon is rootless, PostgreSQL and MinIO expose
      no public ports, and only Nginx reaches `127.0.0.1:3000`.
- [ ] Confirm the existing `worldcup-lottery` default Nginx workload remains
      enabled. Validate the separate quotation vhost with `nginx -t`.
- [ ] Confirm DNS resolves the quotation domain to the VPS, its certificate is
      valid, HTTP redirects as intended, and the public `/api/health` succeeds
      over the canonical HTTPS `SITE_ORIGIN`.
- [ ] Confirm the daily backup timer is healthy and the latest encrypted
      PostgreSQL/MinIO backup has a verified off-VPS checksum marker.
- [ ] Confirm the most recent scheduled restore rehearsal created a new
      database and bucket, matched row/object checksums, and did not promote
      either namespace. A stale or failed rehearsal blocks irreversible schema
      work.
- [ ] Confirm migrations follow expand/migrate/contract and remain compatible
      with current plus two retained rollback releases.

## Release and rollback evidence

- [ ] Confirm the publication job pushed only the full Git SHA tag and recorded
      `ghcr.io/jeffreycaicai/sales_quotation_approvecenter@sha256:<64 hex>`.
- [ ] Confirm the production job passed both the full SHA and that exact digest
      to `install-release.sh`; the host's `image.digest` and effective
      `APP_IMAGE` must match the recorded value.
- [ ] Confirm loopback and public health passed after migration and traffic
      switch, and verify the login and quotation demo manually at the canonical
      domain without disturbing `worldcup-lottery`.
- [ ] For rollback, dispatch `Production Delivery` with one full lowercase SHA
      from the host's retained current-plus-two release lineage. Do not use a
      branch, tag, prefix, shell expression, or arbitrary historical SHA.
- [ ] After rollback, record the selected SHA/digest and repeat loopback,
      public-domain, Nginx, database, and quotation-demo health checks. Rollback
      changes application code only; it does not reverse contract migrations.
