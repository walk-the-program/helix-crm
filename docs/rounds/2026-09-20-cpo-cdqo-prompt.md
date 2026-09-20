# CPO / CDQO review prompt (Walker, 2026-09-20)

Run by a Fable agent ONLY after round 3 (docs/rounds/2026-09-20-round-3.md) is integrated
and verified. After it finishes: one push to GitHub, no app launch. Nothing may incur cost.

---

Act as my Chief Product Officer first, then my Chief Design and Quality Officer. Your assignment is to inspect the existing CRM, identify what is incomplete or poorly conceived, and execute the improvements needed to make it coherent, useful, reliable, and polished.
These are two distinct responsibilities. Complete the product review and its implementation before starting the full design review. Then evaluate the finished product again after the design changes.
Be rigorous and candid. Do not protect existing decisions because they are already implemented. Do not confuse a large feature list with a good product, or an attractive screenshot with a good experience.
You have authority to make reasonable product, engineering, and design decisions and implement them. Do not stop after presenting recommendations or routinely ask whether to proceed.

1. Understand the actual product
Before proposing changes, inspect the repository, project instructions, current uncommitted work, application routes, data models, APIs, integrations, tests, and running application where available.
Establish:
* Who this CRM serves and what those users need to accomplish.
* Its core workflows, terminology, and intended scope.
* What is implemented, partially implemented, mocked, or disconnected.
* How the frontend, backend, storage, permissions, and integrations interact.
* Existing technical and design conventions worth preserving.
* Constraints that should influence your decisions.
Infer intent from evidence. Separate observed behavior from assumptions. Do not invent a target customer or business model to justify a redesign.
Run the existing checks to establish a baseline. Preserve unrelated work. If something cannot be inspected or run, identify the limitation and continue with work that can be verified.
Create a durable working record containing the product map, findings, decisions, implementation tasks, ownership, and verification status. Keep it updated throughout execution.

2. Phase one: Chief Product Officer
Evaluate the CRM as a complete operating system for its intended users. Inspect the connections between features as carefully as the features themselves.
Product purpose and scope
Ask:
* Does the product make its primary jobs obvious and easy?
* Can users complete those jobs end to end?
* Which features create real value, and which create complexity without enough benefit?
* What essential behavior is missing?
* What should be simplified, consolidated, or removed?
* Are defaults and terminology appropriate for the intended customer?
Be thorough within the product's purpose. Do not turn this into an attempt to build every feature of an enterprise CRM.
Entities and associations
Map the entities actually present, such as companies, contacts, leads, opportunities, pipelines, activities, tasks, notes, communications, proposals, and users.
For every meaningful relationship, examine:
* Cardinality, ownership, required fields, and source of truth.
* How users create, discover, change, and remove the association.
* Whether both sides display consistent information.
* Duplicate records, conflicting ownership, and orphaned records.
* Reassignment, merging, archiving, deletion, and restoration where supported.
* Historical records when related information changes.
* Whether related records inherit permissions appropriately.
Walk through difficult cases. What happens when a contact changes companies? A deal has multiple stakeholders? A company has several open deals? An owner leaves? A referenced record is archived? A lead converts into an existing company?
Use scenarios appropriate to this CRM. Do not add entities merely because they appear in this list.
Data flow and integrity
Trace important actions through the complete path:
User action → validation → application logic → persistence → related records → interface updates → reporting or integrations.
Check:
* Whether saves actually persist and remain correct after refresh.
* Whether edits propagate to all relevant views.
* Whether calculations, counts, filters, and summaries agree.
* Whether optimistic updates recover properly from failures.
* Whether retries or double submissions create duplicate actions.
* Whether concurrent edits overwrite data unexpectedly.
* Whether dates, time zones, currencies, and statuses behave consistently.
* Whether imports, exports, search, sorting, and pagination preserve expected behavior.
* Whether integration failures are visible and recoverable.
* Whether permissions are enforced by the backend, including tenant isolation if applicable.
Treat silent data loss, incorrect reporting, unauthorized access, and misleading success states as serious product failures.
Customer journeys
Walk through the actual application as a new user and a returning user.
Evaluate onboarding, initial setup, record creation, relationship management, follow-up, pipeline movement, search, reporting, and recovery from mistakes.
For each core journey, ask:
* Can the user understand where to start?
* Is the next action obvious?
* Is the necessary context available at the point of action?
* Are users repeatedly entering information the system already knows?
* Does the application preserve useful context between screens?
* Can users tell what happened and what remains?
* Can they correct mistakes without rebuilding their work?
* Are there dead ends, hidden prerequisites, or features that stop halfway?
Inspect empty, loading, error, permission-restricted, and partially completed states—not just populated happy paths.
Findings and decisions
Record each substantive finding with:
* Concrete evidence: route, component, code reference, or reproduction steps.
* The affected user and workflow.
* The consequence and severity.
* The recommended behavior and why it is appropriate.
* Dependencies and testable acceptance criteria.
Separate confirmed defects, usability problems, strategic improvements, and unresolved hypotheses.
Prioritize by user impact, integrity risk, frequency, dependencies, and implementation cost. Do not manufacture findings to appear thorough.
Execute the product improvements
After the audit, write a prioritized implementation plan and proceed directly into execution.
Implement confirmed defects, incomplete core workflows, and justified improvements within the existing product's purpose. Resolve foundational data and behavior problems before polishing dependent features.
For each finding, record whether it is implemented, deferred with a concrete reason, or blocked by a specific missing dependency. Avoid an unexplained backlog of recommendations.
Use proportionate solutions. Preserve working behavior unless changing it serves a clear purpose. Avoid broad rewrites when focused changes will solve the problem.
Before moving to phase two, verify the implemented product behavior and reconcile the findings against the actual result. A blocked item must remain visibly unresolved.

3. Phase two: Chief Design and Quality Officer
Now review the updated product independently through the lens of interaction quality and visual design. Do not assume phase-one work is good enough because you helped implement it.
Use the running application and actual screenshots where possible. Source-code inspection alone does not establish visual quality.
First establish a coherent design direction appropriate to the CRM's users. Build on strong existing patterns. Make deliberate decisions about typography, density, color, spacing, navigation, components, and interaction behavior.
Information architecture and interaction
Evaluate:
* Navigation, page organization, labels, and discoverability.
* Whether list, detail, edit, and create experiences fit together.
* Whether related information is grouped meaningfully.
* Primary and secondary action hierarchy.
* Forms, validation timing, field grouping, and sensible defaults.
* Tables, filters, sorting, selection, pagination, and bulk actions.
* Modals, drawers, menus, tooltips, and confirmation patterns.
* Keyboard navigation, focus management, and escape behavior.
* Feedback during saves, background work, errors, and recovery.
* Whether users can understand and act without excessive explanation.
Remove unnecessary steps and ambiguity. Preserve useful information density without creating clutter.
Visual quality
Inspect every important route and reusable component for:
* Typography hierarchy, line length, readability, and wrapping.
* Spacing, alignment, proportions, and consistent layout.
* Table density, column sizing, truncation, and numeric alignment.
* Color meaning, contrast, and status differentiation.
* Icon consistency and clarity.
* Button, input, badge, tab, and card consistency.
* Loading, empty, error, disabled, selected, hover, and focus states.
* Responsive behavior across the product's supported screen sizes.
* Overflow, clipped content, awkward whitespace, and broken layouts.
* Long names, large values, missing fields, and realistic volumes of data.
Inspect representative screens with both sparse and dense data. A dashboard with three perfect sample records is insufficient evidence.
Accessibility and copy
Check semantic controls, accessible names, keyboard access, visible focus, contrast, and information communicated without relying only on color.
Rewrite confusing copy. Use concise, natural language appropriate to CRM users. Labels should describe actual actions. Errors should explain the problem and the available next step.
Remove jargon, filler, vague success messages, and unnecessary instructional paragraphs.
Execute the design improvements
Produce an evidence-backed design findings list and implement it.
Fix shared patterns at the component or token level where appropriate, then inspect every affected context. Avoid accumulating page-specific patches that make the system less consistent.
Verify the rendered result after changes. Iterate until the identified issues are resolved or specifically documented as blocked.
If design work exposes a deeper product problem, address it through the product decision record and reverify the affected workflow.

4. Delegation and parallel execution
You are the coordinator and remain accountable for the complete result.
You may run up to three Opus agents concurrently. Each Opus agent may supervise up to three Sonnet agents concurrently for bounded legwork.
This permits a maximum of three Opus leads and nine Sonnet workers, subject to the runtime's actual limits. Use fewer when appropriate. These are ceilings, not staffing targets.
Use Opus for coherent workstreams, difficult decisions, implementation, and review. Use Sonnet for bounded investigation, implementation, tests, or visual checks. Sonnet agents must not delegate further.
Check available model aliases, nesting support, and concurrency limits before dispatch. Do not silently substitute models or claim unavailable agents were used. If nesting is unsupported, route child assignments through the coordinator while retaining Opus accountability. Queue work when capacity is unavailable.
Every assignment needs an explicit handoff
Give each Opus lead and Sonnet worker:
* Task ID, parent, and intended outcome.
* Relevant context, evidence, and files to read.
* Exact writable scope and excluded areas.
* Shared schemas, interfaces, behavior, or design decisions.
* Dependencies and conditions required before starting.
* Concrete acceptance criteria, including relevant edge cases.
* Verification steps and expected results.
* Delegation allowance and allocated capacity.
* Conditions requiring escalation to the parent.
* Required return format.
"Improve the UI" or "handle the backend" is not an adequate assignment.
Protect ownership and integration
Maintain one active writer per file or shared mutable resource. Assign explicit ownership of shared types, migrations, lockfiles, design tokens, and common components.
A parent must not edit files currently assigned to a child. Resolve overlapping needs through ownership transfer or sequential work.
Settle shared contracts before parallel implementation. Route contract changes through the coordinator and notify affected agents.
Use isolated worktrees when useful and supported. Track their base revisions and integration order. Preserve existing user changes.
Each worker must return its changes, acceptance results, checks actually run, and unresolved issues. Opus must inspect its Sonnet workers' actual output and verify the combined workstream. The coordinator must inspect and verify the integrated application.
An agent's completion message is not proof that the task is complete.

5. Execution boundaries
Make routine, reversible decisions autonomously. Do not repeatedly ask permission for normal implementation work.
Stay within the CRM's purpose. Record speculative expansions as proposals instead of building them automatically.
Do not delete production data, send real customer communications, incur new spending, or publish/deploy without applicable authorization. Use safe development data for testing. Prepare and verify migrations with explicit handling of existing records.
If blocked, state the exact missing access, decision, or dependency and continue independent work. Never present simulated behavior as working integration.

6. Final acceptance and delivery
After both phases, perform an integrated review of the finished application.
Verify the core journeys, persistence, relationships, permissions, reporting consistency, responsive layouts, accessibility, and affected regression paths. Use verification appropriate to the changes; do not weaken checks to obtain a pass.
Distinguish checks actually run from checks that remain unavailable. Recheck behavior affected by later design changes.
Before finishing, ensure all agents are finished or stopped, changes are integrated, and the findings record reflects reality.
Give me a concise final report covering:
1. The most consequential product problems found and fixed.
2. The most consequential design problems found and fixed.
3. What was verified and the evidence supporting it.
4. Anything still incomplete, blocked, or deliberately deferred.
Keep detailed findings and implementation records in the project.
Your job is to deliver a materially better CRM—not merely a critique, a plan, or a cosmetic refresh. Start by inspecting the product.
