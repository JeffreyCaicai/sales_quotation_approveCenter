# Building Identity and ERP Mapping Design

**Date:** 2026-07-11

**Status:** Approved
**Scope:** Building identity, manual building-master imports, Rate Card references, and future ERP synchronization

## 1. Context

The Building Team's manually maintained building workbook is currently more complete than ERP. It includes every building operated by the company and assigns each one a unique `IRIS Building ID`, including buildings that do not yet exist in ERP. ERP will eventually become an upstream source, but an absent ERP record must not prevent an operational building from appearing in Rate Cards, sales packages, quotations, or the sales building selector.

## 2. Confirmed Identity Rules

- `IRIS Building ID` is the permanent business identifier for a building.
- It is mandatory, globally unique, immutable, and never reused.
- Every new building must receive an IRIS Building ID before it can enter a published Rate Card.
- Building names, addresses, classifications, and operational status may change without changing the IRIS Building ID.
- A building that leaves operation is marked `Inactive`; its identity and history are retained.
- The database also uses an internal immutable UUID for foreign keys. The UUID is an implementation detail and is not the identifier used in business files.
- `ERP Building ID` is an optional external mapping. It never replaces either the internal UUID or IRIS Building ID.

## 3. Data Model

The `buildings` entity contains:

| Field | Rule |
|---|---|
| `id` | Internal PostgreSQL UUID; immutable primary key. |
| `iris_building_id` | Required, unique, immutable business identifier, for example `B003004`. |
| `erp_building_id` | Nullable external identifier; unique when present. |
| `building_name` | Required mutable display name. |
| `building_type` | Controlled business value. |
| `grade_resource` | Controlled business value. |
| `area` | Business geography attribute. |
| `city` | Business geography attribute. |
| `cbd_area` | Business geography attribute. |
| `sub_district` | Business geography attribute. |
| `address` | Full building address. |
| `erp_link_status` | `Manual Only` or `ERP Linked`. Derived from whether a verified ERP mapping exists. |
| `operational_status` | `Active` or `Inactive`. Independent from ERP link status. |
| `data_source` | Source provenance, initially `Building Team`, later optionally enriched by `ERP`. |
| audit fields | Import batch, timestamps, uploader/publisher, and before/after history. |

ERP mappings may be represented in a separate external-identifier table when the ERP adapter is implemented. The public contract remains the same: one verified external mapping is attached to the existing building record and never creates a second business identity for the same building.

## 4. Reference Rules

- Building master files use `IRIS Building ID` as the update key.
- Rate Card building prices reference `IRIS Building ID`.
- Rate Card package membership references `IRIS Building ID`.
- Sales selection, quotation line items, building appendices, and exports display or retain the IRIS Building ID.
- Database relationships resolve the IRIS Building ID to the internal UUID before publication.
- ERP Building ID is never required by Rate Card validation.

Published Rate Cards and historical quotations continue to reference the same internal building UUID even after an ERP Building ID is added. Adding or correcting an ERP mapping therefore cannot change historical commercial records.

## 5. Import and Validation Rules

A building batch is rejected atomically when:

- IRIS Building ID is blank;
- the same IRIS Building ID appears more than once in the file;
- an IRIS Building ID attempts to identify a different existing building;
- a nonblank ERP Building ID is already linked to another building;
- a published IRIS Building ID is changed or reused;
- a required business field or controlled value is invalid.

A blank ERP Building ID is valid. Such a record is imported with `erp_link_status = Manual Only` and remains eligible for Rate Cards when operational status is `Active`.

An inactive building cannot be added to a new Rate Card or package configuration. Existing historical Rate Cards and quotations retain it.

## 6. ERP Reconciliation Flow

When ERP later supplies a building that has no verified mapping:

1. The adapter searches for candidates using IRIS Building ID when available, then normalized name, address, city, and sub-district as supporting evidence.
2. An exact verified identifier match may update approved ERP-owned attributes automatically.
3. A name/address-only match is a suggestion and requires administrator confirmation.
4. Confirmation attaches the ERP Building ID to the existing building record and changes its link status to `ERP Linked`.
5. If the ERP record is confirmed to represent a different building, it does not overwrite the candidate. The Building Team must assign a new IRIS Building ID before that building becomes commercially available.
6. Every link, unlink, or conflict resolution creates an audit event.

The system must never create or merge buildings solely from fuzzy name matching.

## 7. Template Contract Changes

The building template uses these leading columns:

1. `IRIS Building ID` — required
2. `ERP Building ID` — optional
3. `Building Name` — required
4. `Building Type`
5. `Grade Resource`
6. `Area`
7. `City`
8. `CBD Area`
9. `Sub-District`
10. `Address`
11. `Operational Status` — required
12. `Data Source`

`ERP Link Status` is system-derived and included in exports, but importers do not set it manually. Rate Card sheets replace the generic `Building Code` label with `IRIS Building ID`.

This contract requires a new template version. Previously published import records retain their original template version and parser contract.

## 8. Operational Ownership

- The Building Team owns allocation and governance of IRIS Building IDs.
- Sales Operations uploads and publishes approved building data according to its permissions.
- ERP synchronization may enrich or propose mappings, but cannot silently replace IRIS identity.
- Identifier corrections or building merges require a controlled administrative workflow with reason, actor, before/after state, and dependency checks.

## 9. Acceptance Criteria

- A valid active building with an IRIS Building ID and no ERP Building ID can be imported and included in a Rate Card.
- Adding an ERP Building ID later updates the same building record.
- Historical Rate Cards, packages, and quotations remain connected after ERP mapping.
- Duplicate or reused IRIS IDs are rejected before publication.
- Duplicate ERP mappings are rejected before publication.
- Inactive buildings remain visible in history but cannot enter a new Rate Card.
- All identity and mapping changes are auditable.
