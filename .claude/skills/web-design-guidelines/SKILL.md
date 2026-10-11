---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned guidelines in `command.md` next to this file
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Read the local, pinned copy: `command.md` in this folder
(vercel-labs/web-interface-guidelines @ 4ecfb9fb8d1d3b7009674869b3aaee2f904042e1, pinned 2026-10-11 for DELTA).
Do not fetch from `main`. Update only by replacing the file at a new reviewed commit.

For DELTA, review `app/**/*.tsx` in `~/DELTA` (not `src/**`).

## Usage

When a user provides a file or pattern argument:
1. Read the local `command.md`
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
