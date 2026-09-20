# Launch-readiness round: Walker's prompt (verbatim, 2026-09-20)

Act sequentially as five executive owners responsible for preparing this CRM for its first real clients:

1. Chief Security and Privacy Officer
2. Chief Reliability and Operations Officer
3. Chief Revenue Operations Officer
4. Chief Customer Success Officer
5. Chief Launch Assurance Officer

The product and design reviews have already been completed. Inspect their findings and the current application before starting. Build on that work and reopen decisions when you find concrete problems.
Your assignment is to find and fix what would prevent me from confidently onboarding paying clients.
Be thorough, skeptical, and practical. Assess the actual application and operating processes. Distinguish working capabilities from placeholders, assumptions, and undocumented manual work.
You have authority to implement reasonable improvements. Do not stop at recommendations or routinely ask whether to proceed.
1. Establish the launch context
Inspect the repository, project instructions, previous review records, current changes, application, database, authentication, infrastructure configuration, integrations, and available tests.
Determine from evidence:

* Who the initial clients are and what they will use.
* Whether the CRM is single-tenant, multi-tenant, or deployed separately per client.
* How accounts, organizations, memberships, roles, and subscriptions work.
* Which environments exist and how changes reach production.
* What customer data is stored and which external services process it.
* Which onboarding, billing, support, and maintenance tasks are automated or manual.
* What is genuinely functional versus mocked or incomplete.

Do not invent a business model, contractual promise, infrastructure capability, or compliance requirement.
Create one launch-readiness record containing findings, priorities, decisions, task ownership, acceptance criteria, verification evidence, and remaining blockers.
Classify findings as:

* Launch blocker: exposing real clients would create an unacceptable failure, access, data, or core-workflow risk.
* Required before paid onboarding: essential to delivering and supporting the promised service.
* Follow-up improvement: useful but not necessary for the initial launch.

Explain each classification. Avoid treating every improvement as a blocker.
Complete each executive phase’s review, implementation, and verification before moving to the next. Where work depends on a later phase, record the dependency explicitly and resolve it before final acceptance.
2. Chief Security and Privacy Officer
Determine whether real customer accounts and data are adequately protected.
Review
Inspect the actual trust boundaries and enforcement points:

* Sign-up, authentication, logout, session expiry, and account recovery.
* Invitations, organization membership, role changes, and user removal.
* Backend authorization for reads, writes, exports, bulk actions, and administrative functions.
* Tenant isolation across database queries, files, search, caches, background jobs, and integrations.
* Whether changing an identifier or calling an endpoint directly exposes another customer’s records.
* Whether revoked users or downgraded roles retain access through existing sessions, links, or jobs.
* Secret handling, environment configuration, logs, and client bundles.
* Input validation, injection risks, unsafe rendering, uploads, and public endpoints.
* Rate limits and abuse controls appropriate to the application.
* Webhook authenticity, replay handling, and integration permissions.
* Sensitive information in logs, analytics, error reporting, exports, and backups.
* Data retention, deletion, export, and account closure behavior.
* Security-relevant dependencies and configuration.

Map what customer data is collected, where it goes, who can access it, and how long it remains.
Check whether existing privacy statements and customer-facing promises match actual behavior. Identify gaps without inventing certifications or claiming compliance from a code review.
Execute and verify
Fix confirmed vulnerabilities and permission gaps. Add appropriate automated checks at the real enforcement layer.
Where applicable, verify with separate users, roles, and organizations. Test denied operations as deliberately as successful ones.
For each resolved issue, record the original failure, the fix, and evidence that the unauthorized behavior is now prevented.
Use controlled environments and test data. Do not probe unrelated services or expose secrets in your reports.
3. Chief Reliability and Operations Officer
Determine whether this CRM can be operated and recovered when something goes wrong.
Review
Inspect:

* Deployment steps, environment separation, configuration, and secret management.
* Database migrations, compatibility, rollback limitations, and existing-data handling.
* Backup coverage, retention, access, and actual restoration procedures.
* Error monitoring, useful logs, health checks, and alert routing.
* Background jobs, retries, idempotency, timeouts, and failed-job recovery.
* Third-party outages, expired credentials, webhook failures, and partial completion.
* Performance with realistic record counts and simultaneous use.
* Pagination, unbounded queries, large imports, exports, and uploads.
* Dependency failures and whether users receive accurate status.
* Operational responsibilities that currently depend on the founder remembering something.

Walk through concrete incidents: a deployment fails, a migration partially completes, a provider is unavailable, a job runs twice, a client imports bad data, or a database must be restored.
Execute and verify
Implement the controls needed for the actual launch scale. Avoid adding infrastructure without a concrete need.
Create concise operating procedures for deployment, rollback or forward recovery, backup restoration, integration recovery, and incident handling.
Validate recovery in a safe environment where access permits. A configured backup is not proof that restoration works.
Make failures observable and actionable. Do not install monitoring that nobody can interpret or that sends unactionable noise.
Record which procedures were tested, which were inspected only, and what remains dependent on hosting or account access.
4. Chief Revenue Operations Officer
Determine whether the commercial lifecycle is coherent, accurate, and manageable.
First identify the actual sales and billing model. If clients are manually contracted and invoiced, evaluate that process. Do not automatically build self-service subscriptions.
Review
Where applicable, trace:
Sale or signup → account provisioning → entitlement → billing → renewal or cancellation → access changes → data disposition.
Inspect:

* Whether the offer, pricing, setup charges, recurring fees, and included services are clear and consistent.
* Whether purchased services match what the application enables.
* Trial, active, overdue, canceled, and other relevant account states.
* The authoritative source for billing state and access entitlements.
* Payment failures, duplicate events, delayed events, and out-of-order webhooks.
* Upgrades, downgrades, cancellations, refunds, and reactivation where offered.
* Whether cancellation or failed payment causes unexpected loss of customer data.
* Manual overrides, exceptional arrangements, and auditability.
* Customer and internal visibility into payment or account problems.
* Reconciliation between clients, invoices, payments, and enabled service.
* Service delivery obligations and recurring manual effort.
* Obvious cost drivers that could make early clients unprofitable.

Check realistic failure cases, including “payment succeeded but provisioning failed” and “billing changed but access did not.”
Execute and verify
Fix broken commercial flows and implement only the billing functionality the launch model requires.
Test payment behavior through sandbox facilities when available. Do not initiate real charges, refunds, or customer messages.
If billing happens outside the application, establish a clear operating procedure and reliable account-state tracking.
Identify unresolved pricing or business-policy decisions explicitly. Prepare the affected implementation where possible, but do not silently invent consequential commercial terms.
5. Chief Customer Success Officer
Determine whether a new client can become a successful, supported customer without excessive founder intervention.
Review
Walk through the complete customer lifecycle:

* Invitation or signup.
* Organization setup and initial configuration.
* Importing or entering existing records.
* Adding teammates and assigning roles.
* Completing the first meaningful CRM workflow.
* Returning later and understanding what needs attention.
* Asking for help and recovering from mistakes.
* Exporting data, leaving, and closing an account.

Define the first meaningful customer outcome based on this product. Measure the steps and friction required to reach it.
Inspect:

* Prerequisites users would not know they need.
* Confusing setup choices and missing defaults.
* Import templates, field mapping, validation, duplicate handling, and partial failures.
* Whether clients can distinguish demo data from their own records.
* Contextual help and documentation for essential workflows.
* Support entry points and the information needed to investigate an issue.
* Safe support access that respects customer permissions.
* Common failure situations and how users recover.
* Whether a customer can operate independently after onboarding.
* Manual onboarding and support workload at the first several clients.

Evaluate the experience with a fresh account and realistic, imperfect data. Do not rely on the developer’s preconfigured account.
Execute and verify
Fix onboarding obstacles, incomplete setup flows, and avoidable support burdens.
Create concise customer-facing guidance where needed and an internal onboarding checklist that reflects actual behavior.
Make errors explain what happened and what to do next. Remove unnecessary setup work and redundant data entry.
Verify that a fresh customer can reach the first meaningful outcome, resume their work later, and get help without hidden prerequisites.
Do not add elaborate tours or documentation to compensate for fixable product confusion.

Chief Product Expansion Officer
Your job is to identify the features this CRM is missing, decide which ones it actually needs, and build them.
You are authorized to introduce new capabilities. Look beyond defects and unfinished workflows. Ask: “What would a real client reasonably expect to do here that they currently cannot?”
Discover the gaps
Inspect the existing product, previous findings, and intended customer workflows. Look for:

* Important jobs users must currently complete in spreadsheets, email, or another tool.
* Missing connections between existing features.
* Repetitive work the CRM could automate.
* Information the system already holds but does not help users act on.
* Missing collaboration, follow-up, visibility, or reporting capabilities.
* Features whose absence would make a prospective client hesitate to adopt or pay for the CRM.

Consider capabilities such as reminders, activity histories, saved views, bulk actions, duplicate management, reusable templates, workflow automation, and reporting—but evaluate their relevance before deciding to build them.
Do not treat that list as a required feature set. Discover what this particular CRM needs.
Decide what deserves to exist
For each candidate, establish:

* The specific user and problem.
* Evidence of the gap in the current product.
* The workaround users would otherwise need.
* Why existing functionality cannot reasonably solve it.
* The smallest complete version that delivers meaningful value.
* Dependencies, ongoing maintenance, and implications for permissions, data, onboarding, and billing.
* Testable acceptance criteria.

Classify candidates as build now, later, or reject, with a brief reason.
Build now when the feature completes an important customer job, removes substantial recurring effort, or addresses a clear adoption barrier. Reserve later for ideas that depend on unvalidated demand or disproportionate complexity.
Do not reject valuable features merely because they require backend work, new data structures, or multiple screens. Equally, do not add features merely to make the product look larger.
Build the selected features
Write the prioritized plan and proceed directly into implementation. Do not stop to ask which features I want unless a consequential decision cannot be inferred from the product context.
Deliver complete vertical slices:
Data model → backend behavior → permissions → interface → feedback and failure handling → verification.
A button, mocked screen, disconnected integration, or hard-coded result does not count as a completed feature.
Integrate each capability into the existing navigation, relationships, search, reporting, and design system wherever relevant. Handle existing records and sensible defaults.
Use the same Opus/Sonnet delegation method and shared concurrency budget as the other roles. Do not create a separate agent allowance.
Verify the value
Exercise each feature as the intended user with realistic data. Confirm that it solves the original problem and works with the rest of the CRM.
Check empty states, failure states, unauthorized access, persistence, and relevant edge cases. Update onboarding and operating guidance where behavior changes.
Have the relevant security, reliability, revenue, or customer-success owner recheck affected areas before launch assurance begins.
Return a concise record of what you considered, what you built, what you deferred or rejected, and how the completed features were verified.
Your standard is: “This capability belongs in this CRM, solves a concrete problem, and now works end to end.”

6. Chief Launch Assurance Officer
Now independently challenge the combined result.
Your responsibility is to decide whether the current version is ready for a controlled first-client launch. Do not simply summarize the preceding agents’ completion reports.
Review and test
Build a launch acceptance matrix covering the relevant combinations of:

* User role and organization.
* New and existing accounts.
* Empty and populated datasets.
* Normal and failure conditions.
* Supported browsers and screen sizes.
* Integration and commercial states.

Prioritize meaningful scenarios rather than exhaustively testing combinations that add little evidence.
Exercise complete journeys against the integrated application:

* Provision a client and establish correct access.
* Create or import real-shaped data.
* Associate records and complete core CRM workflows.
* Invite and remove a teammate.
* Confirm permissions and tenant boundaries.
* Verify persistence, reporting, and exports.
* Exercise applicable billing-state changes.
* Recover from representative failures.
* Complete offboarding without unexpected data handling.

Check for regressions introduced during these five phases.
Assess whether performance and usability remain acceptable with realistic data. Ensure customer-facing claims correspond to capabilities that actually work.
Execute and conclude
Fix newly discovered issues and rerun affected checks.
For significant workstreams, use a reviewer who did not implement the change when capacity allows. Give them original requirements and actual artifacts.
Assign one evidence-backed outcome:

* Ready for controlled onboarding: required checks passed, with any limitations clearly bounded.
* Ready with specific operating conditions: name the necessary conditions, manual steps, and their owner.
* Not ready: identify the exact unresolved blockers and next actions.

Do not claim launch readiness when essential checks could not be performed.
7. Agent hierarchy and execution method
You are the coordinator and accountable integration owner.
You may run up to three Opus agents concurrently, each supervising up to three Sonnet agents concurrently.
The ceiling is three Opus leads plus nine Sonnet workers, subject to actual runtime limits. Use fewer when the work does not justify more.
Opus owns coherent workstreams, implementation decisions, difficult changes, and review. Sonnet handles bounded investigation, implementation, tests, or verification. Sonnet must not delegate further.
Check model availability, nested delegation support, and capacity before dispatch. Do not silently substitute models. If nesting is unavailable, route Sonnet assignments through the coordinator while retaining Opus responsibility. Queue work when capacity is unavailable.
For every assignment, provide:

* Task ID, parent, intended outcome, and relevant findings.
* Verified context and files to inspect.
* Writable paths and excluded areas.
* Shared schemas, interfaces, and behavior requirements.
* Dependencies and readiness conditions.
* Concrete acceptance criteria and verification steps.
* Child-agent allowance and allocated slots.
* Escalation conditions and required return evidence.

Maintain one active writer per file or shared resource. Explicitly assign shared types, migrations, lockfiles, configuration, and test environments.
Resolve shared contracts before parallel implementation. Communicate contract changes and pause incompatible work.
Workers submit results; parents inspect and accept them. Opus must inspect Sonnet changes and verify the whole workstream. The coordinator must verify the assembled result.
Record checks actually performed, their outcomes, and the revision or snapshot tested. A completion message is not verification.
Keep a durable checkpoint of decisions, active agents, ownership, dependencies, changes, and the next action so work can continue across context limits.
8. Authority and boundaries
Proceed autonomously with ordinary, reversible implementation and safe testing.
Preserve unrelated changes and existing customer data. Do not weaken tests, permissions, or requirements to obtain a pass.
Do not deploy publicly, change production infrastructure, delete production data, initiate real financial transactions, send customer communications, or incur spending without applicable authorization.
If a required action needs access or a consequential business decision, complete the preparation, identify the exact blocker, and continue independent work.
Keep reports factual. Mark assumptions and untested claims explicitly.
9. Final delivery
Maintain detailed evidence in the project. Give me a concise final report containing:

1. The launch-readiness verdict.
2. The most consequential findings and fixes from each role.
3. The customer journeys and operational procedures actually verified.
4. Remaining blockers, operating conditions, and deferred improvements.
5. The practical steps required to onboard the first client.

Do not finish with an unprioritized recommendations list. Finish with an improved application, verified operating procedures, and an honest decision about whether real clients can begin using it.
Start by inspecting the current product and previous review results.
