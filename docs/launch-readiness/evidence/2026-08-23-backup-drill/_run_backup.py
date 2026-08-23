import json
import os
import urllib.request

ENV_PATH = "C:/Users/User/OneDrive/Documents/GitHub/Alfanumrik/Alfanumrik/apps/host/.env.local"
OUT_DIR = "C:/Users/User/OneDrive/Documents/GitHub/Alfanumrik/Alfanumrik/docs/launch-readiness/evidence/2026-08-23-backup-drill"
SCHOOL_ID = "7f355f26-2c4d-4303-8f0e-6889789b1df0"

env = {}
with open(ENV_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == chr(34) and v[-1] == chr(34):
            v = v[1:-1]
        env[k] = v

base = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1"
key = env["SUPABASE_SERVICE_ROLE_KEY"]

tables = [
    ("schools", "id=eq." + SCHOOL_ID),
    ("school_admins", "school_id=eq." + SCHOOL_ID),
    ("students", "school_id=eq." + SCHOOL_ID),
    ("teachers", "school_id=eq." + SCHOOL_ID),
    ("classes", "school_id=eq." + SCHOOL_ID),
]

summary = []
for name, query in tables:
    url = base + "/" + name + "?" + query
    req = urllib.request.Request(url, headers={
        "apikey": key,
        "Authorization": "Bearer " + key,
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read()
        data = json.loads(body)
        out_path = os.path.join(OUT_DIR, name + ".json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        summary.append((name, len(data), None))
    except Exception as e:
        summary.append((name, None, str(e)[:150]))

print("Backup drill export summary (Test Pilot Academy, school_id=" + SCHOOL_ID + "):")
for name, count, err in summary:
    if err:
        print("  " + name + ": ERROR - " + err)
    else:
        print("  " + name + ": " + str(count) + " rows exported")
