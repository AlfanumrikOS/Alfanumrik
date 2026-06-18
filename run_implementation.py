import os
import sys
import anthropic

client = anthropic.Anthropic()

ENVIRONMENT_ID = "env_01TTzARQWSJdzRJbviqSrt3Z"
MEMORY_STORE_ID = "memstore_0146UCtct7cEob1HFHEJxDHz"
REPO_URL = "https://github.com/AlfanumrikOS/Alfanumrik.git"
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

if not GITHUB_TOKEN:
    print("ERROR: Set GITHUB_TOKEN first:")
    print('  $env:GITHUB_TOKEN = "ghp_your_token_here"')
    sys.exit(1)


def create_agent():
    agent = client.beta.agents.create(
        name="Alfanumrik Pedagogy Implementer",
        model="claude-opus-4-0-20250514",
        system="""You are a senior full-stack engineer implementing pedagogy improvements for Alfanumrik.

STACK: Next.js 14 (App Router) + TypeScript + TailwindCSS frontend, Supabase (PostgreSQL + Edge Functions in Deno), Python AI services.

KEY DIRECTORIES:
- src/lib/foxy/ — Foxy AI tutor logic
- src/lib/quiz/ — Quiz engine
- src/lib/rag/ — RAG retrieval
- src/lib/irt/ — Item Response Theory / adaptive difficulty
- src/components/foxy/ — Foxy UI components
- src/components/quiz/ — Quiz UI
- src/components/review/ — Review/revision UI
- src/app/api/ — Next.js API routes
- supabase/functions/ — Edge functions
- supabase/migrations/ — Database schema
- python/services/ai/ — Python AI services

PEDAGOGY SPECS: Read from the memory store under /pedagogy/ (27 documents).

RULES:
1. READ existing code BEFORE writing. Understand current patterns first.
2. READ the relevant pedagogy spec from memory store BEFORE making changes.
3. Match existing code style.
4. Write tests matching project patterns (vitest, src/__tests__/).
5. Create a feature branch and commit with clear messages.
6. Prefer surgical changes over rewrites.""",
        tools=[{"type": "agent_toolset_20260401"}],
    )
    print(f"Agent created: {agent.id}")
    print("NEXT: Paste this ID into the AGENT_ID variable in this script, then save.")
    return agent.id


def run_session(agent_id, task, rubric, title):
    session = client.beta.sessions.create(
        agent=agent_id,
        environment_id=ENVIRONMENT_ID,
        title=title,
        resources=[
            {
                "type": "memory_store",
                "memory_store_id": MEMORY_STORE_ID,
                "access": "read_only",
            },
            {
                "type": "github_repository",
                "url": REPO_URL,
                "authorization_token": GITHUB_TOKEN,
                "checkout": {"type": "branch", "name": "main"},
            },
        ],
    )
    print(f"Session: {title}")
    print(f"Watch: https://platform.claude.com/workspaces/default/sessions/{session.id}")

    client.beta.sessions.events.send(
        session_id=session.id,
        events=[{
            "type": "user.define_outcome",
            "description": task,
            "rubric": {"type": "text", "content": rubric},
            "max_iterations": 5,
        }],
    )
    return session.id


TASKS = {
    "1_srs": {
        "title": "Implement SRS Algorithm (Doc 22)",
        "task": "Read /pedagogy/22-srs-algorithm-specification.md from the memory store. Then audit existing SRS/review/revision code in the repo — check src/lib/quiz/, src/app/review/, src/app/revision/, supabase/migrations/ for review-related tables, and src/lib/irt/. Compare what exists against the spec. Implement what's missing: ReviewCard data model, compute_quality(), process_learning_card(), process_review_card() with SM-2, generate_daily_queue(), misconception-aware intervals, exam-calendar overrides. Create branch feat/srs-pedagogy.",
        "rubric": "1. Existing SRS code audited with gap analysis\n2. ReviewCard model matches doc 22 schema\n3. compute_quality() maps correctly\n4. process_learning_card() implements learning steps and graduation\n5. process_review_card() implements SM-2 ease factor (1.3-3.0)\n6. Lapse handling resets state and reduces ease by 0.20\n7. generate_daily_queue() correct priority order\n8. Misconception cards capped at 30-day max\n9. Exam calendar override at 14/7/2 day thresholds\n10. Tests written\n11. Committed to feat/srs-pedagogy branch",
    },
    "2_foxy": {
        "title": "Implement Foxy Prompt System (Doc 18)",
        "task": "Read /pedagogy/18-foxy-prompt-engineering.md from the memory store. Audit src/lib/foxy/, src/components/foxy/, src/app/foxy/, python/services/ai/. Compare against 5-layer prompt architecture. Implement all 5 layers, prompt assembly function, 4 conversation patterns, 5 guardrails. Create branch feat/foxy-prompt-layers.",
        "rubric": "1. Current Foxy code audited with gap analysis\n2. All 5 prompt layers as composable modules\n3. Layer 1 has all 10 hard rules\n4. Layer 2 has all 5 grade tiers\n5. Layer 3 has Math/Physics/Chemistry/Biology inserts\n6. Layer 4 has RAG injection slots\n7. Layer 5 has student state fields\n8. Prompt assembly function works\n9. All 5 guardrails implemented\n10. Tests written\n11. Committed to feat/foxy-prompt-layers branch",
    },
    "3_misconceptions": {
        "title": "Implement Misconception Database (Doc 20)",
        "task": "Read /pedagogy/20-misconception-database-architecture.md from the memory store. Audit supabase/migrations/ and src/lib/quiz/ for existing misconception handling. Implement: misconception table (Supabase migration), seed 80+ misconceptions, 4-stage detection pipeline, integration with quiz and Foxy. Create branch feat/misconception-db.",
        "rubric": "1. Existing misconception handling audited\n2. Supabase migration creates table matching schema\n3. 80+ misconceptions seeded\n4. Proactive detection before topic teaching\n5. Reactive detection via wrong-answer matching\n6. Verification with different question after correction\n7. Integration with quiz system\n8. Integration with Foxy prompts\n9. Tests written\n10. Committed to feat/misconception-db branch",
    },
}

# ──────────────────────────────────────
# PASTE YOUR AGENT ID HERE after running create_agent:
AGENT_ID = ""
# ──────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python run_implementation.py create_agent")
        print("  python run_implementation.py run 1_srs")
        print("  python run_implementation.py run 2_foxy")
        print("  python run_implementation.py run 3_misconceptions")
        sys.exit(1)

    if sys.argv[1] == "create_agent":
        create_agent()
    elif sys.argv[1] == "run":
        if not AGENT_ID:
            print("ERROR: Run 'python run_implementation.py create_agent' first,")
            print("then paste the agent ID into AGENT_ID in this script.")
            sys.exit(1)
        task = TASKS[sys.argv[2]]
        run_session(AGENT_ID, task["task"], task["rubric"], task["title"])