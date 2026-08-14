#!/usr/bin/env python3
"""Build a psql connection URL for the CURRENTLY LINKED Supabase project.

Reads the pooler connection string that `supabase link` writes to
`supabase/.temp/pooler-url`, asserts the project ref embedded in it matches the
ref we expect (and, optionally, is NOT a forbidden ref), injects the real,
URL-encoded database password, and prints the resulting URL on stdout.

WHY READ THE CLI-DERIVED FILE INSTEAD OF HAND-BUILDING A URL:
hand-constructing `postgresql://postgres.<ref>@aws-0-<region>.pooler.supabase.com`
fails with "Tenant or user not found" whenever the hardcoded region or port does
not match the project (see the comment block in
`.github/workflows/schema-reproducibility-fix.yml`). `supabase link` writes a
region-accurate, tenant-correct pooler URL; this script only adds the password.

The password is NEVER printed. Only the host (no credentials) goes to stderr as
proof of what was targeted.

Env:
  EXPECTED_REF          required — the project ref the URL MUST embed
  FORBIDDEN_REF         optional — a ref the URL must NOT embed (fail-closed)
  SUPABASE_DB_PASSWORD  required — injected into the URL, never logged
Argv:
  [1] path to the pooler-url file (default: supabase/.temp/pooler-url)

Exit codes: 0 ok | 2 malformed/missing input | 3 ref assertion failed
"""

import os
import sys
import urllib.parse

path = sys.argv[1] if len(sys.argv) > 1 else "supabase/.temp/pooler-url"

expected_ref = os.environ.get("EXPECTED_REF", "").strip()
forbidden_ref = os.environ.get("FORBIDDEN_REF", "").strip()
password = os.environ.get("SUPABASE_DB_PASSWORD", "")

if not expected_ref:
    sys.stderr.write("EXPECTED_REF is required. FAIL-CLOSED.\n")
    sys.exit(2)
if not password:
    sys.stderr.write("SUPABASE_DB_PASSWORD is required. FAIL-CLOSED.\n")
    sys.exit(2)

try:
    with open(path) as fh:
        raw = fh.read().strip()
except OSError as exc:
    sys.stderr.write("cannot read %s (%s). FAIL-CLOSED.\n" % (path, exc.strerror))
    sys.exit(2)

if not raw:
    sys.stderr.write("%s is empty — 'supabase link' did not produce a pooler URL. FAIL-CLOSED.\n" % path)
    sys.exit(2)

# NOTE: parsed by hand rather than urllib.parse.urlsplit(). The legacy CLI
# format embeds a literal "[YOUR-PASSWORD]" placeholder in the userinfo, and
# urlsplit() misreads the brackets as an IPv6 host and raises. Manual splitting
# handles BOTH that format and the newer no-password userinfo format.
if "://" not in raw:
    sys.stderr.write("pooler-url has no scheme (unexpected format). FAIL-CLOSED.\n")
    sys.exit(2)
scheme, after = raw.split("://", 1)

tail = ""
for sep in ("?", "#"):
    idx = after.find(sep)
    if idx != -1:
        tail = after[idx:]
        after = after[:idx]
        break

if "@" not in after:
    sys.stderr.write("pooler-url has no userinfo (unexpected format). FAIL-CLOSED.\n")
    sys.exit(2)
userinfo, hostpath = after.rsplit("@", 1)

# user is "postgres.<ref>" (optionally followed by ":<password-or-placeholder>")
user = userinfo.split(":", 1)[0]
if "." not in user:
    sys.stderr.write("pooler-url user is not postgres.<ref>. FAIL-CLOSED.\n")
    sys.exit(2)
embedded_ref = user.split(".", 1)[1]


def redact(ref: str) -> str:
    """Project refs are repo secrets; show last 4 only."""
    return "****" + ref[-4:] if len(ref) >= 4 else "****"


if forbidden_ref and embedded_ref == forbidden_ref:
    sys.stderr.write("pooler-url embeds the FORBIDDEN ref (%s). FAIL-CLOSED.\n" % redact(embedded_ref))
    sys.exit(3)
if embedded_ref != expected_ref:
    sys.stderr.write(
        "pooler-url ref (%s) != expected ref (%s). FAIL-CLOSED.\n"
        % (redact(embedded_ref), redact(expected_ref))
    )
    sys.exit(3)

host_only = hostpath.split("/", 1)[0]

enc_pw = urllib.parse.quote(password, safe="")
if "sslmode=" not in tail:
    tail = tail + ("&" if tail else "?") + "sslmode=require"

sys.stderr.write("Pooler host (from %s): %s\n" % (path, host_only))
sys.stderr.write("Project ref verified: %s\n" % redact(embedded_ref))
sys.stdout.write("%s://%s:%s@%s%s" % (scheme, user, enc_pw, hostpath, tail))
