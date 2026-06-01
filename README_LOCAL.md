# Local Development Guide

## Prerequisites
- **Node.js** >= 18 (recommended LTS)
- **npm** (comes with Node) or **pnpm** if you prefer
- **Docker Desktop** (optional, for Supabase local emulator)
- **Git**

## Clone the repository
```powershell
git clone https://github.com/your-org/alfanumrik.git
cd alfanumrik
```

## Install dependencies
```powershell
npm ci
```

## Environment configuration
Create a `.env.local` file at the project root (same level as `package.json`). Example:
```dotenv
# Supabase connection (replace with your own dev project values)
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Feature‑flag control (default OFF for safety)
FF_AGENT_MESH_V1=true
```
You can also generate the type definitions for Supabase tables:
```powershell
npm run supabase:gen-types
```

## Running the UI (Next.js)
```powershell
npm run dev
```
Open your browser at **http://localhost:3000** – the UI will hot‑reload on code changes.

## Running a mesh tick locally
The mesh runtime is a plain TypeScript entry‑point (`agents/runtime/tick.ts`). You can run it directly with the provided script:
```powershell
npm run mesh:tick            # dry‑run (no DB writes)
npm run mesh:tick -- --commit   # commit results to Supabase (use with caution)
```
Add `--real-l7` if you want the optional deploy step.

## Optional: Supabase local emulator (Docker)
If you prefer not to use a remote Supabase project, you can spin up the official Supabase image:
```yaml
# docker-compose.yml (place in project root)
version: "3.8"
services:
  supabase:
    image: supabase/postgres:latest
    environment:
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
```
Then start it:
```powershell
docker compose up -d
```
Update `.env.local` to point to the local instance:
```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://localhost:5432
NEXT_PUBLIC_SUPABASE_ANON_KEY=postgres://postgres:password@localhost:5432/postgres
```

## Convenience script
A PowerShell helper (`run-local.ps1`) is provided to automate the steps above:
```powershell
# run-local.ps1 – place at repository root
.
# Ensure dependencies are installed
npm ci

# Generate Supabase types (if needed)
npm run supabase:gen-types

# Start Next.js dev server in the background
Start-Process -FilePath "npm" -ArgumentList "run dev" -NoNewWindow

# Wait a few seconds for the dev server to be ready
Start-Sleep -Seconds 5

# Run a mesh tick (dry‑run)
npm run mesh:tick
```
Run it with:
```powershell
.un-local.ps1
```
The script will install dependencies, generate types, launch the UI, and execute a single mesh tick.

---
### Next steps
- Implement the feature‑flag cache and Redis lock as described in the roadmap.
- Extend the `l2-orchestrator` to return a DAG of tasks.
- Add OpenTelemetry instrumentation across layers.

Happy hacking!
