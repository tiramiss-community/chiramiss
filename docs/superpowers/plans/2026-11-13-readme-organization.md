# README Organization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this documentation plan.

**Goal:** Make the root README a concise entry point while preserving existing documentation.

**Architecture:** Move detailed sections to five use-case documents. Keep quick starts and
bot contact information in the root README, and basic installation in the npm README.

**Tech Stack:** Markdown and relative GitHub links.

**Spec:** `docs/superpowers/specs/2026-11-13-readme-design.md`

## Global Constraints

- English prose; no runtime or dependency changes.
- Preserve PR #16 descriptions, configuration defaults, warnings, and full benchmark report.
- Keep ChiramissBot information at the existing README URL.

## Review Focus

- Moved fragments must resolve in their new files.
- Docker Compose links must resolve relative to `docs/`.
- npm readers need absolute GitHub documentation URLs.
- Benchmark conclusions must identify the measured revision and cache conditions.
- Benchmark update instructions must point to the new report destination.

### Task 1: Reorganize documentation

**Files:** `README.md`, five new `docs/*.md` files from the spec,
`packages/chiramiss/README.md`, `packages/bench/README.md`.

- [x] Move complete sections, retaining configuration tables and benchmark report verbatim.
- [x] Write the concise root README and npm documentation links.
- [x] Update links between documents and benchmark release instructions.
- [x] Verify local paths and fragments, report preservation, and `git diff --check`.
  Expected: no broken links, unchanged report and configuration tables, no whitespace errors.
- [x] Inspect the final diff for lost material and scope changes.

Documentation-only work: use direct content/link verification; no new application tests.

## Verification results

- Local links/fragments and same-repository npm documentation links: 49 checked, all resolve.
- All 76 original table rows and 11 code examples retained.
- Full generated benchmark report preserved verbatim, including Notes and Environment.
- Root README: 595 → 120 lines.
- `git diff --check`: clean.
- Independent documentation review: no important issues.
- Application tests not run: Markdown-only changes.

Execution: completed in the current checkout on `docs/reorganize-readme`, based on
PR #16 head `57727eb`. No runtime files or dependencies changed.
