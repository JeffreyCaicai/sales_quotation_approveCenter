# Subagent-Driven Development Progress

Plan: docs/superpowers/plans/2026-07-11-stage-2-data-import-vps.md
Branch: codex/stage-2-data-import-design
Preserved deployment: https://sales-quotation-approval.jeffrey202510.chatgpt.site/ (HTTP 200 verified 2026-07-11)
Source anchor: sites-demo-v1 at d76497e

Task 1: complete (commits d76497e..0441b20, review clean; hosted URL HTTP 200 verified by controller; dependency audit and cold font download noted for final review)
Task 2: complete (commits 0441b20..d71d69c, review clean; native PostgreSQL 17 migration and two-connection Rate Card lock timing explicitly deferred to Tasks 10–12)
Task 3: complete (commits d71d69c..6d1d55f, review clean; native PostgreSQL bootstrap smoke test deferred to Tasks 10–12)
Task 4: complete (commits 6d1d55f..17165ac, review clean after storage/streaming/OOXML/lease/reconciliation hardening; real versioned MinIO and native PostgreSQL concurrency deferred to Tasks 10–12)
IRIS Task 1: complete (commits 2150ce5..1196449; immutable IRIS identity, nullable normalized ERP mapping, UUID-preserving migration, and deletion/reuse protection covered in PGlite)
IRIS Task 2: complete (commits 30becb7..0083454; TMN-IMPORT-2 building/Rate Card parsing with physical source-row preservation)
IRIS Task 3: complete (commits 54562c4..d225c83; deterministic identity validation and complete IRIS-keyed differences)
IRIS Task 4: complete (commits 96779f2..67556ed; transactional audited mapping publication and stale-snapshot rejection; native PostgreSQL test retained but unavailable locally)
IRIS Task 5: complete (commits ede8fb1..1e53829; formal templates generated and kept behind authorization; hosted prototype unchanged)
IRIS Task 6: complete in this commit with executable PGlite lifecycle and deterministic 5,000-row parse/validate/diff coverage. Native PostgreSQL integration remains unverified locally: `localhost:55432` rejected the required run with `EPERM`, and no Docker/container runtime is available. This gap includes native advisory-lock and transactional publication behavior; it is not represented as passing PGlite coverage.
