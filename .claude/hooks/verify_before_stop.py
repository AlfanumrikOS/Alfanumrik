#!/usr/bin/env python3
"""
verify_before_stop.py — Claude Code Stop hook for Alfanumrik.

Purpose: `.claude/CLAUDE.md` requires every task to end with the Compact
Report Format ("## Done:", "Agents:", "Files: ... | Tests: ... | Build: ...",
"Catalog:", "Chains:", "Approval:", "Commit: ... | ready to merge: ...").
This hook doesn't trust that the claimed checks happened just because the
report says so — it re-reads this turn's actual tool-call history from the
transcript and cross-checks the report's claims against real evidence.
If a claim has no matching tool call behind it (e.g. "Tests: 42/42" with no
vitest run this turn, or "Build: PASS" with no build/type-check command),
the turn is blocked and Claude is told exactly what's missing.

This is a heuristic net, not a proof engine — see the companion command
`.claude/commands/audit-change.md` for a stronger, model-based independent
review. Treat a pass here as "no obvious fabrication," not "verified correct."

Install: registered as a Stop hook in `.claude/settings.json`.
Runbook: `docs/runbooks/verify-before-stop-hook.md`.
Requires no third-party packages. Windows-safe (explicit utf-8 I/O).
"""
import io
import json
import sys
import os
import re
import time

# Anchor the log under the project root — the hook's cwd is not guaranteed
# to be the repo root, so a bare relative path could scatter logs anywhere.
LOG_PATH = os.path.join(
    os.environ.get("CLAUDE_PROJECT_DIR", "."), ".claude", "verification-log.jsonl"
)

# Distinctive Compact Report Format markers (see .claude/CLAUDE.md,
# "Compact Report Format"). Chosen to be unlikely in ordinary prose.
REPORT_MARKERS = [
    "## Done:",
    "Agents:",
    "Catalog:",
    "Chains:",
    "ready to merge",
]

def read_stdin_json():
    try:
        # Read stdin as utf-8 explicitly (Windows consoles default to cp1252);
        # fall back to the default stream if .buffer is unavailable in some
        # exotic harness — fail open either way.
        try:
            stream = io.TextIOWrapper(
                sys.stdin.buffer, encoding="utf-8", errors="replace"
            )
        except Exception:
            stream = sys.stdin
        return json.loads(stream.read())
    except Exception:
        return {}

def walk_tool_uses(obj, out):
    """Recursively collect every dict that looks like a tool_use block,
    regardless of exact transcript schema/nesting."""
    if isinstance(obj, dict):
        if obj.get("type") == "tool_use" and "name" in obj:
            out.append(obj)
        for v in obj.values():
            walk_tool_uses(v, out)
    elif isinstance(obj, list):
        for v in obj:
            walk_tool_uses(v, out)

def load_transcript_entries(transcript_path):
    entries = []
    try:
        with open(os.path.expanduser(transcript_path), "r",
                  encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except Exception:
                    continue
                # Valid JSON that isn't an object (string/number/null/array)
                # would crash dict-consumers downstream — skip it here so
                # every consumer sees dicts only.
                if isinstance(parsed, dict):
                    entries.append(parsed)
    except Exception:
        pass
    return entries

def entries_since_last_user_turn(entries):
    last_user_idx = None
    for i, e in enumerate(entries):
        if e.get("type") == "user" or e.get("role") == "user":
            last_user_idx = i
    if last_user_idx is None:
        return entries
    return entries[last_user_idx:]

def collect_evidence(tool_uses):
    ev = {
        "search": False,        # Grep/Glob, or Bash grep/rg
        "git_diff": False,      # Bash git diff / git status
        "supabase_query": False,  # mcp__supabase__* / execute_sql (logged only, never blocks)
        "file_edit": False,     # Edit/Write/NotebookEdit
        "file_read": False,     # Read
        "test_run": False,      # Bash vitest / npm test / npm run test*
        "build_run": False,     # Bash npm run build / next build / npm run type-check / tsc
    }
    for t in tool_uses:
        name = (t.get("name") or "")
        inp = t.get("input") or {}
        cmd = ""
        if isinstance(inp, dict):
            cmd = str(inp.get("command", "")) + " " + str(inp.get("query", ""))

        if name in ("Grep", "Glob"):
            ev["search"] = True
        if name == "Bash" and re.search(r"\b(grep|rg)\b", cmd):
            ev["search"] = True
        if name == "Bash" and re.search(r"git\s+(diff|status)", cmd):
            ev["git_diff"] = True
        if "supabase" in name.lower() or "execute_sql" in name.lower() or "list_tables" in name.lower():
            ev["supabase_query"] = True
        if name in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
            ev["file_edit"] = True
        if name == "Read":
            ev["file_read"] = True
        if name == "Bash" and re.search(r"\bvitest\b|npm\s+test\b|npm\s+run\s+test", cmd):
            ev["test_run"] = True
        if name == "Bash" and re.search(r"npm\s+run\s+build|next\s+build|npm\s+run\s+type-check|\btsc\b", cmd):
            ev["build_run"] = True
    return ev

def has_report(text):
    """A Compact Report is considered present when >= 2 markers appear."""
    if not text:
        return False
    return sum(1 for m in REPORT_MARKERS if m in text) >= 2

def _segment_after(text, marker):
    """Return the segment of the line following `marker`, up to the next
    `|` separator, for every line containing the marker."""
    segments = []
    for line in (text or "").splitlines():
        if marker in line:
            after = line.split(marker, 1)[1]
            segments.append(after.split("|", 1)[0].strip())
    return segments

def tests_line_claims_pass(text):
    """True when a 'Tests:' segment claims a real pass count — i.e. it is
    not N/A and not 0/0. Placeholder text like '[pass]/[total]' is not a
    numeric claim and does not trigger."""
    for seg in _segment_after(text, "Tests:"):
        if "N/A" in seg or "N-A" in seg:
            continue
        m = re.search(r"(\d+)\s*/\s*(\d+)", seg)
        if m and not (m.group(1) == "0" and m.group(2) == "0"):
            return True
    return False

def build_line_claims_pass(text):
    """True when a 'Build:' segment claims PASS. The template placeholder
    'PASS/FAIL' is not a claim."""
    for seg in _segment_after(text, "Build:"):
        if re.search(r"\bPASS\b(?!\s*/)", seg):
            return True
    return False

def main():
    data = read_stdin_json()

    if data.get("stop_hook_active"):
        # Already nagged once this turn — don't loop.
        sys.exit(0)

    last_msg = data.get("last_assistant_message", "") or ""
    transcript_path = data.get("transcript_path", "")

    entries = load_transcript_entries(transcript_path) if transcript_path else []
    turn_entries = entries_since_last_user_turn(entries)
    tool_uses = []
    walk_tool_uses(turn_entries, tool_uses)
    ev = collect_evidence(tool_uses)

    report_present = has_report(last_msg)
    made_code_changes = ev["file_edit"]

    problems = []

    if made_code_changes and not report_present:
        problems.append(
            "Files were edited this turn but no Compact Report Format was "
            "emitted. Emit the Compact Report Format per .claude/CLAUDE.md "
            "(## Done / Agents / Files|Tests|Build / Catalog / Chains / "
            "Approval / Commit lines) before finishing."
        )

    if report_present:
        if tests_line_claims_pass(last_msg) and not ev["test_run"]:
            problems.append(
                "The report's 'Tests:' line claims a pass count, but no test "
                "command (vitest / npm test / npm run test) appears in this "
                "turn's tool history. Run the tests for real and paste the "
                "actual result, or mark the line N/A — don't assert a count "
                "you didn't produce (.claude/CLAUDE.md Compact Report Format)."
            )
        if build_line_claims_pass(last_msg) and not ev["build_run"]:
            problems.append(
                "The report claims 'Build: PASS', but no build or type-check "
                "command (npm run build / next build / npm run type-check / "
                "tsc) appears in this turn's tool history. Run it for real "
                "before claiming PASS (.claude/CLAUDE.md Compact Report Format)."
            )

    if made_code_changes and not ev["git_diff"]:
        problems.append(
            "Files were edited but no `git diff`/`git status` call appears "
            "this turn. Run it and confirm the actual diff matches the "
            "'Files: [n] changed' scope before reporting."
        )

    verdict = "blocked" if problems else "passed"
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.time(),
                "session_id": data.get("session_id"),
                "verdict": verdict,
                "problems": problems,
                "evidence": ev,
                "report_present": report_present,
            }) + "\n")
    except Exception:
        pass  # logging is best-effort, never block on log failure

    if problems:
        reason = (
            "Stop blocked by verify_before_stop.py — the Compact Report makes "
            "claims this turn's actual tool calls don't back up:\n- "
            + "\n- ".join(problems)
            + "\n\nGo run the missing checks for real, then re-emit the "
            "Compact Report Format (.claude/CLAUDE.md) with genuine evidence "
            "(paste the actual command output)."
        )
        print(json.dumps({"decision": "block", "reason": reason}))
        sys.exit(0)

    sys.exit(0)

if __name__ == "__main__":
    main()
