# Internal Demo CI/CD Validation

Validation date: 2026-07-12 (Asia/Jakarta)

Public URL: https://quotation.38-76-162-91.sslip.io

## Controlled transition

The first release containing the explicit demo backup policy was activated through the reviewed one-time transition procedure:

- Release SHA: `8ee3003f0cbb7a9d6beb4245982cdcd6bd62040a`
- CI run: `29194861689`
- The public and loopback health checks returned HTTP 200 after activation.
- The deployment bypass was recorded in `state/unprotected-deployments.log` before the image pull.
- The off-VPS backup timer remains disabled while this environment contains internal demo data only.

## Demo operating boundary

`BACKUP_POLICY=optional` is permitted only for this internal demo phase. It must not be used after real customer, quotation, rate-card, user, approval, or production business data is imported.

Before promotion beyond the internal demo phase:

1. Configure separate off-VPS backup storage and least-privilege backup credentials.
2. Verify an encrypted backup completes successfully.
3. Perform and document a restore rehearsal.
4. Change the policy to `BACKUP_POLICY=required`.
5. Re-enable and verify the scheduled backup timer.

The next ordinary trusted `main` push is the proof run for fully automatic CI and Production Delivery. No manual VPS mutation is permitted during that proof run.
