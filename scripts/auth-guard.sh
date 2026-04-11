#!/bin/bash
set -e
echo "🔒 Auth Flow Guard — Pre-deploy Check"

# 1. middleware.ts must NOT exist
if [ -f "src/middleware.ts" ]; then
  echo "❌ FATAL: src/middleware.ts exists! Next.js 16 only allows proxy.ts"
  exit 1
fi

# 2. proxy.ts MUST exist
if [ ! -f "src/proxy.ts" ]; then
  echo "❌ FATAL: src/proxy.ts missing!"
  exit 1
fi

# 3. proxy.ts must export 'proxy' function
if ! grep -q "export async function proxy" src/proxy.ts; then
  echo "❌ FATAL: proxy.ts doesn't export proxy function"
  exit 1
fi

# 4. Login page must exist
if [ ! -f "src/app/login/page.tsx" ]; then
  echo "❌ FATAL: src/app/login/page.tsx missing!"
  exit 1
fi

# 5. Auth callback must exist
if [ ! -f "src/app/auth/callback/route.ts" ]; then
  echo "❌ FATAL: auth callback route missing!"
  exit 1
fi

# 6. Auth confirm must exist
if [ ! -f "src/app/auth/confirm/route.ts" ]; then
  echo "❌ FATAL: auth confirm route missing!"
  exit 1
fi

# 7. No client-side profile inserts in AuthScreen
if grep -q "\.from('students')\.insert\|\.from('teachers')\.insert\|\.from('guardians')\.insert" src/components/auth/AuthScreen.tsx 2>/dev/null; then
  echo "❌ FATAL: AuthScreen.tsx has client-side profile inserts — violates server-only auth"
  exit 1
fi

# 8. No client-side profile inserts in AuthContext
if grep -q "\.from('students')\.insert\|\.from('teachers')\.insert\|\.from('guardians')\.insert" src/lib/AuthContext.tsx 2>/dev/null; then
  echo "❌ FATAL: AuthContext.tsx has client-side profile inserts — violates server-only auth"
  exit 1
fi

# 9. Session API must exist
if [ ! -f "src/app/api/auth/session/route.ts" ]; then
  echo "❌ FATAL: Session management API missing!"
  exit 1
fi

# 10. All 4 role tabs in AuthScreen
for role in "Student" "Teacher" "Parent" "School"; do
  if ! grep -q "$role" src/components/auth/AuthScreen.tsx 2>/dev/null; then
    echo "❌ FATAL: AuthScreen.tsx missing $role tab"
    exit 1
  fi
done

echo "✅ Auth Flow Guard — All checks passed"
