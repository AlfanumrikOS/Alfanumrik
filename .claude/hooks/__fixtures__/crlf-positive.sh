#!/usr/bin/env bash
# FIXTURE: crlf-positive.sh -- POSITIVE control for the CR detector in
# verify-hook-patterns.sh. Every line ending in this file is CRLF ON PURPOSE.
#
# This reproduces the real defect: a shebang of "#!/usr/bin/env bash\r" makes
# the kernel exec "bash\r", which does not exist, so the hook dies before
# evaluating a single rule. Enforcement silently drops to zero.
#
# The detector MUST report a non-zero CR count for this file. If it reports 0,
# the detector is vacuous and the self-test fails loudly.
#
# PROTECTED FROM NORMALIZATION: .gitattributes pins
#   .claude/hooks/__fixtures__/** -text
# so core.autocrlf / eol=lf cannot strip these CRs on add or checkout.
# Do NOT "fix" the line endings in this file. Breaking them disarms the test.
#
# Not a hook. Never executed. Its BYTES are the whole point.
echo "crlf infected fixture"
