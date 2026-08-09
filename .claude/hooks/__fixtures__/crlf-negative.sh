#!/usr/bin/env bash
# FIXTURE: crlf-negative.sh -- NEGATIVE control for the CR detector in
# verify-hook-patterns.sh. This file is LF-terminated and must always report
# ZERO CR bytes. If it ever reports CR, the detector would be producing a
# false positive and the self-test fails.
#
# Not a hook. Never executed. Its BYTES are the whole point.
echo "clean LF fixture"
