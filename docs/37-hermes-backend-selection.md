# Selected Hermes backend patterns

Reference checkout: `C:/catooon/references/hermes-agent`, upstream https://github.com/NousResearch/hermes-agent, commit `e8b799f4f86bc9bad0d1493ad9e7242aeed91e6d`, reviewed 2026-10-05. Upstream is MIT, copyright Nous Research 2025. SettlePilot remains a TypeScript backend; the implementations below are original adaptations of documented patterns, not copied Python modules.

Relevant sources: `agent/system_prompt.py`, `agent/prompt_builder.py`, `tools/memory_tool.py`, `tools/skills_tool.py`, and `website/docs/developer-guide/prompt-assembly.md` at that revision.

Selected scope:
1. Frozen instructions, policy constitution, skill catalog/content and memory per evaluation. Hash manifests identify what each run used. Mid-run file/memory edits take effect in the next evaluation.
2. Lazy skill delivery with a short repeat-read response after a skill has been returned successfully. The full skill stays in the tool conversation; backend prerequisite checks still require it.
3. Bounded memory with duplicate suppression. Notes never become spending authority or verified chain observations.
4. Preserve existing durable jobs, leases, request ledger, exact action approvals and receipt reconciliation; use owner readiness/budget UI to make those mechanisms understandable.

Financial evidence, receipts, policy and candidates are never replaced by an LLM-generated compression summary. Shell execution, remote messaging controls, arbitrary plugins, subagents and model-authored financial policy are outside the selected scope.

Acceptance: edits during a run cannot change its loaded skill content; repeat reads avoid duplicate payloads; next runs observe edits; escaped paths and oversized context files are rejected; manifest logs contain hashes/lengths only; memory duplicates do not consume capacity; all existing policy and onchain adapter regressions continue to pass.
