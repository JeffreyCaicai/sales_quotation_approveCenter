# Final approval routing and proxy entry implementation plan

1. Add failing unit tests for the 65%/75% boundaries, Ayu self-approval escalation, authorized proxy entry, and unauthorized proxy rejection.
2. Extend the user and quotation domain types with sales groups, quotation-entry permissions, commercial owner input, and creator identity.
3. Centralize approval routing in one resolver and use it for submission, approval authorization, snapshots, persistence validation, and seeded demo data.
4. Add Ayu, Amal, Desti, and a Freelancer demo owner to the directory with explicit permissions and customer assignments.
5. Update the quotation wizard to show the owner selector only to authorized proxy users and filter customers using the selected commercial owner.
6. Update localization and visible threshold text from 70% to 75%.
7. Run logic, unit, type, localization, lint, integration, browser smoke, and build checks.
8. Review the branch diff and hand it off without merging or deploying until explicitly requested.
