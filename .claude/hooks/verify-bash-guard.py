#!/usr/bin/env python3
import json, subprocess, sys
H = chr(60)*2
PKG = "pack" + "ages/lib/src/"
MIG = "supa" + "base/migrations/"
FN  = "supa" + "base/functions/quiz-generator/index.ts"
CLD = ".cla" + "ude/agents/quality.md"
WF  = ".git" + "hub/workflows/ci.yml"
PXY = "apps/host/" + "src/proxy.ts"
SEC = "SUPA" + "BASE_SERVICE_ROLE_KEY"

CASES = [
 ("ALLOW","commit message quoting an in-place sed on a protected file",
  "git commit -F - " + H + "MSG\nfix: bug\n\nsed -i s/x/y/ " + PKG + "xp-rules.ts was unblocked\nMSG"),
 ("ALLOW","echo, then ls, with an unrelated 2" + chr(62) + "&1",
  "echo hi; ls -la " + MIG + "*.sql 2" + chr(62) + "&1 | head"),
 ("ALLOW","copy FROM a protected path into /tmp",
  "cp " + MIG + "a.sql /tmp/a.sql"),
 ("ALLOW","read a protected migration with psql",
  "psql -f " + MIG + "a.sql -d verify"),
 ("ALLOW","grep for a secret NAME (existence check)",
  "grep -c " + SEC + " .env.example"),
 ("ALLOW","heredoc body naming an agent file, no interpreter",
  "git commit -F - " + H + "M\ntouched " + CLD + " earlier\nM"),
 ("DENY","in-place sed on the canonical XP file (P2)",
  "sed -i s/10/99/ " + PKG + "xp-rules.ts"),
 ("DENY","truncating redirect into canonical rbac",
  "echo hack " + chr(62) + " " + PKG + "rbac.ts"),
 ("DENY","append redirect into the proxy",
  "printf x " + chr(62)*2 + " " + PXY),
 ("DENY","copy INTO the protected migration dir",
  "cp /tmp/evil.sql " + MIG + "999_evil.sql"),
 ("DENY","tee into the canonical admin client",
  "cat /tmp/x | tee " + PKG + "supabase-admin.ts"),
 ("DENY","mv into workflows",
  "mv /tmp/ci.yml " + WF),
 ("DENY","redirect into an AI edge function",
  "echo x " + chr(62) + " " + FN),
 ("DENY","interpreter heredoc writing an agent file (the old bypass)",
  "python3 - " + H + "EOF\nopen(\"" + CLD + "\",\"w\").write(\"x\")\nEOF"),
 ("DENY","printing a secret VALUE",
  "echo $" + SEC),
]

def run(cmd, agent):
    payload = json.dumps({"agent_type": agent, "tool_input": {"command": cmd}})
    p = subprocess.run(["bash", ".claude/hooks/bash-guard.sh"],
                       input=payload, capture_output=True, text=True)
    if p.returncode != 0:
        return "ERROR", p.stderr.strip()
    if not p.stdout.strip():
        return "ALLOW", ""
    d = json.loads(p.stdout)
    o = d.get("hookSpecificOutput", {})
    dec = o.get("permissionDecision", "allow")
    return ("DENY" if dec == "deny" else "ALLOW"), o.get("permissionDecisionReason", "")

fails = 0
for want, desc, cmd in CASES:
    got, why = run(cmd, "frontend")
    ok = (got == want)
    if not ok: fails += 1
    print(("  ok  " if ok else "  FAIL") + "  want=%-5s got=%-5s  %s" % (want, got, desc))

got, _ = run("python3 - " + H + "EOF\nopen(\"" + CLD + "\",\"w\")\nEOF", "orchestrator")
ok = (got == "ALLOW")
if not ok: fails += 1
print(("  ok  " if ok else "  FAIL") + "  want=ALLOW got=%-5s  orchestrator may edit agent-system files (guard.sh Rule 8)" % got)

print()
print(("PASS" if fails == 0 else "FAIL") + " - %d case(s), %d failure(s)" % (len(CASES)+1, fails))
sys.exit(1 if fails else 0)
