# Final approval routing and proxy entry design

## Confirmed business rules

- Effective discount up to and including 65% routes directly to Ayu, Head of Sales.
- Effective discount above 65% and up to and including 75% routes directly to April, Head of Business Control.
- Effective discount above 75% routes directly to Thomas, CEO.
- Approval is single-step. A quotation is not passed through lower approval levels first.
- Ayu must never approve her own quotation. A quotation commercially owned by Ayu that would normally route to Ayu is escalated to April.
- Amal and Desti may enter quotations on behalf of explicitly assigned Freelancer sales owners.
- The quotation keeps two separate identities:
  - `salesId`: the actual commercial owner whose customer/brand assignment and sales group apply.
  - `createdById`: the user who entered the quotation.
- Customer and brand permissions, approval routing, reporting, and quotation ownership use `salesId`, not `createdById`.
- Every proxy action remains visible in the approval audit history.

## Domain model

Users may receive quotation-entry capabilities independently of their approval role:

- `canCreateQuotations` permits a user such as Ayu to own and enter a quotation.
- `canCreateOnBehalfOfSalesIds` is an explicit allow-list for proxy entry.
- `salesGroup` records whether a commercial owner belongs to Sales Team, Everyone Can Be Sales, or Freelancer.

`QuoteInput.salesOwnerId` is optional. It defaults to the actor for ordinary sales users. A proxy entry user must select an allowed owner.

`Quote.createdById` is immutable for the life of a quotation. Each submit/resubmit event additionally records the actor at that action.

## Routing

The routing resolver receives the effective discount, commercial owner, and approval directory. It first calculates the normal discount band, then applies the no-self-approval rule. It returns the pending status, approver role, and exact required approver identity as one atomic result.

## Compatibility

Existing local demo quotations without `createdById` are migrated during loading by deriving the creator from the first submission event, or from `salesId` for a draft. This keeps the current browser demo usable while new records always contain the explicit field.

## UI behavior

Ordinary sales users see the existing quotation flow unchanged. Amal and Desti see an “Enter quotation for” selector before customer selection. Changing the commercial owner clears customer and brand selections so stale assignments cannot be submitted.

