# Agent usage

How AI coding agents were used to build this project, and how their output was checked.

## Tools

- **Claude Code** (VS Code extension, model Claude Opus 5.5) for design, implementation, tests and docs. Commits it co-wrote carry a `Co-Authored-By: Claude` trailer.
- **Claude API** inside the product: the planning agent in `apps/api/src/services/agent` (see README, "AI workflow and responsible use").

## Representative prompts

The build followed a plan-first, step-by-step workflow that I guided at each stage:

1. **Spec:** I gave Claude Code the full problem statement for "Agentic Data Migration Planner and Reconciliation Workbench" (provided inputs, agent responsibilities, application requirements, scope limits).
2. **Architecture:** I asked it to lay out the complete architecture as a sequence of steps, with what each step would deliver.
3. **Per-step plans:** for each step, I had it write a detailed plan before any code, and reviewed that plan.
4. **Step-by-step implementation:** I had it implement one step at a time (core engine → API → UI and end-to-end test → Docker, CI and README), guiding and checking each step before moving to the next.

During deployment and submission, prompts were short and practical, for example (originally in Hinglish, translated):

- "It's complete now, I need to deploy it. Tell me the steps."
- "I don't have an ANTHROPIC_API_KEY, where do I get it?"
- "Is my work done? This is an assignment I have to submit." (followed by pasting the requirement and submission checklists, to check the project against them)

## Delegated work

Work was delegated in layers, each committed and tested before the next:

1. Core engine (`packages/core`): schemas, transformation rule catalogue, plan validation, deterministic runner, quarantine evidence.
2. API (`apps/api`): plan versioning, approval gate, planning agent with read-only tools, dry run, idempotent execution, reconciliation, rollback, audit history.
3. UI (`apps/web`) and the end-to-end test.
4. Docker image, CI workflow, Render blueprint, README.
5. Deployment steps to Render.

Decisions kept with me: problem choice, scope limits (one source, one target, max 500 records), what the agent may and may not do, and final review of every change.

## Agent mistakes and rejected suggestions

- **Script name clashed with pnpm.** The setup script was first named `setup`, but `pnpm setup` is a built-in pnpm command and shadows it. Renamed to `bootstrap` (commit `1abebcb`).
- **Reviewer answers were lost on revision.** Revising a plan with the offline heuristic planner dropped the reviewer's answers to clarification questions. Fixed so revisions keep them, with a test (commit `1abebcb`).
- **Wrong step order in deployment guidance.** The agent first told me to approve before the dry run. The app's approval gate requires a dry run first; the agent corrected it.

- **Rejected: switching to a free LLM provider for the live demo.** Without a paid Anthropic API key, swapping the agent to another provider would have meant a new client, new tests and a redeploy close to the deadline. I kept the deterministic offline planner for the live demo instead and documented it in the README.
- **Rejected: letting the agent push through the GitHub CLI.** I created the GitHub repository and pushed the code myself.
- **Caught by the checklist review:** `AGENT_USAGE.md` was missing and a stray heading had been appended to the README by GitHub's quick-start commands. Both were fixed before submission.

## How the output was verified

- **Automated tests**: 45 core unit tests, 30 API integration tests against real Postgres, 6 UI component tests, and 1 Playwright end-to-end test of the full journey. Counts and coverage are in the README.
- **CI**: GitHub Actions runs typecheck, all tests, the build and the e2e test on every push. The deployed commit passed.
- **Manual run on the deployed app**: generated a plan, saw the blocking `marketing_opt_in` question stop approval, and checked `/api/health`.
- **Safety by design rather than trust**: the in-product agent only has read-only tools, its plan is schema-validated, it is saved as a draft, and only a named human can approve. A prompt-injection row in the sample data checks this.
