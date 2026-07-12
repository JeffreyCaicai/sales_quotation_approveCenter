# Demo CI/CD Backup Policy Design

## Purpose

The current system is an internal demonstration environment. Its immediate operational goal is to prove the complete delivery loop: push to `main`, run all CI checks, publish the tested immutable image, deploy it to the VPS, and verify the public site. Off-VPS encrypted backups remain required before the system stores real business data, but they must not block demo iteration.

## Decision

Add one explicit server-side setting:

```dotenv
BACKUP_POLICY=optional
```

The only accepted values are `optional` and `required`.

- `optional` permits an existing installation to deploy without a pre-deployment backup. It is intended only for the internal demo stage.
- `required` preserves the existing fail-closed behavior: every deployment over an existing release must first complete and verify the encrypted off-VPS backup.
- A missing, empty, duplicated, or invalid value is treated as an error. The environment template and production transition checklist use `required`, so bypassing backup always requires an explicit `optional` assignment.

This is preferred over a GitHub-only skip flag because manual and automated deployments must follow the same server-side policy. It is preferred over inferring policy from missing S3 credentials because missing credentials must never silently weaken production protection.

## Deployment Behavior

The release installer reads and validates `BACKUP_POLICY` before any mutation.

When no prior release or stateful volumes exist, the existing bootstrap behavior remains unchanged because there is no data to back up.

When a prior release exists:

- Under `required`, the installer invokes the prior release's `backup.sh` before pulling or activating the next image. Any backup failure stops deployment.
- Under `optional`, the installer skips `backup.sh`, emits a conspicuous warning to standard error, and appends an audit record containing the UTC timestamp and target release SHA to `/opt/sales-quotation/state/unprotected-deployments.log` before continuing.

The warning must state that off-VPS backup is disabled and that the setting must be changed to `required` before real business data is imported. No backup secrets are logged.

`backup.sh` and `restore.sh` remain strict and unchanged. The disabled backup timer remains disabled during the demo stage. Rollback behavior remains unchanged because rollback switches between retained images without modifying database schema or content; it does not claim to create a recovery point.

## First Transition

The currently active release predates `BACKUP_POLICY`, so its installer cannot interpret the new setting. The first optional-aware release therefore requires one controlled bootstrap deployment:

1. Add `BACKUP_POLICY=optional` to the root-owned production environment file while preserving `root:deploy` ownership and mode `0640`.
2. Let GitHub CI build and publish the immutable image and release manifest.
3. Use the new, repository-reviewed installer once with that CI-approved release SHA and canonical image digest.
4. Verify the public health endpoint and current release pointer.

After that transition, `/opt/sales-quotation/bin/install-release` resolves the installer from the active optional-aware release, so later successful pushes to `main` complete the normal GitHub Production Delivery workflow without manual intervention.

The controlled bootstrap must not edit files inside the existing release or replace the current symlink before the new release passes its activation and health checks.

## Production Transition

Before importing real customer, quotation, user, or approval data:

1. Configure `BACKUP_AGE_RECIPIENT` and the dedicated `BACKUP_S3_*` credentials.
2. Run and verify one encrypted off-VPS backup.
3. Perform a documented restore rehearsal into new database and bucket namespaces.
4. Set `BACKUP_POLICY=required` while preserving the environment file security contract.
5. Re-enable and verify the daily backup timer.
6. Confirm the next deployment creates and verifies a backup before activation.

No code change is required for this transition.

## Failure Handling

- Invalid policy values stop before Docker, database, release, or symlink mutation.
- Failure to append the optional-mode audit record stops deployment; an unrecorded bypass is not allowed.
- Under `required`, missing backup configuration or a failed remote verification continues to stop deployment.
- If activation fails after an optional-mode bypass, the existing rollback/bootstrap-failure handling remains authoritative.
- Warning and audit output contain only policy, timestamp, and release SHA, never environment values or credentials.

## Verification

Automated tests must prove:

- `optional` skips the backup command, writes the warning, and records the target SHA before image pull.
- `required` invokes backup before image pull and stops on failure.
- Missing, empty, duplicated, and invalid policy values fail before mutation.
- The environment example and runbook document the demo-to-production transition.
- Existing backup, restore, release integrity, localization, integration, browser smoke, container, committed-secret, and ShellCheck jobs still pass.

Operational verification must prove:

- The controlled first transition installs the CI-approved digest.
- GitHub Production Delivery succeeds on a subsequent harmless commit without manual VPS commands.
- `https://quotation.38-76-162-91.sslip.io/api/health` returns HTTP 200.
- PostgreSQL and MinIO remain unexposed to public host ports.
- The original World Cup application remains reachable through its existing IP route.

## Scope Boundaries

This change does not configure S3, enable the backup timer, change database or object-storage schemas, modify the quotation UI, or weaken the eventual production backup requirement. It only makes the demo-stage exception explicit, audited, reversible, and testable.
