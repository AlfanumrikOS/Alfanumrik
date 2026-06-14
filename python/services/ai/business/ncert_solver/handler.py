import json
import re
import time

import httpx
from fastapi import HTTPException

from ...config import get_settings
from ...db.supabase import get_service_client
from .models import NcertSolverRequest, NcertSolverResponse, ParsedQuestion, RouteInfo


class CircuitBreaker:
    failures: int = 0
    lastFailureAt: float = 0
    state: str = "closed"
    FAILURE_THRESHOLD: int = 5
    RESET_TIMEOUT: float = 60.0

    @classmethod
    def canRequest(cls) -> bool:
        if cls.state == "closed":
            return True
        if cls.state == "open":
            if time.time() - cls.lastFailureAt > cls.RESET_TIMEOUT:
                cls.state = "half-open"
                return True
            return False
        return False

    @classmethod
    def recordSuccess(cls):
        cls.failures = 0
        cls.state = "closed"

    @classmethod
    def recordFailure(cls):
        cls.failures += 1
        cls.lastFailureAt = time.time()
        if cls.failures >= cls.FAILURE_THRESHOLD:
            cls.state = "open"


def detectType(text: str, options: list[str] | None = None, marks: int | None = None) -> str:
    lower = text.lower()
    if options and len(options) >= 3:
        return "mcq"
    if re.search(r"assertion.*reason", lower):
        return "assertion_reasoning"
    if re.search(r"case.?study|passage|comprehension", lower):
        return "case_based"
    if re.search(r"grammar|tense|voice|narration", lower):
        return "grammar"
    if re.search(r"poem|stanza|character|novel", lower):
        return "literature"
    if re.search(r"calculate|find.*value|solve|simplify|prove", lower):
        return "numerical"
    if marks and marks >= 5:
        return "long_answer"
    return "short_answer"


def parseQuestion(
    text: str, subject: str, grade: str, options: list[str] | None = None, marks: int | None = None
) -> ParsedQuestion:
    qtype = detectType(text, options, marks)
    hasNumerical = bool(
        re.search(
            r"\d+\s*[\+\-\×\÷\*\/\=]|\bcalculate\b|\bfind.*value\b|\bsolve\b", text, re.IGNORECASE
        )
    )
    hasFormula = bool(re.search(r"[=><≥≤±√]|x\^|sin|cos|formula", text, re.IGNORECASE))
    effectiveMarks = (
        marks if marks else (1 if qtype == "mcq" else 2 if qtype == "short_answer" else 5)
    )
    depth = "brief" if effectiveMarks <= 1 else "moderate" if effectiveMarks <= 3 else "detailed"

    return ParsedQuestion(
        originalText=text,
        type=qtype,
        subject=subject,
        grade=grade,
        concepts=[],
        marks=effectiveMarks,
        expectedDepth=depth,
        hasNumerical=hasNumerical,
        hasFormula=hasFormula,
        options=options or [],
    )


def routeToSolver(parsed: ParsedQuestion) -> RouteInfo:
    qtype = parsed.type
    subj = parsed.subject
    num = parsed.hasNumerical
    if qtype == "mcq":
        return RouteInfo(
            solver="hybrid" if num else "retrieval",
            requiresVerification=True,
            maxResponseTokens=400,
        )
    if qtype == "numerical" and subj in ["math", "physics", "chemistry"]:
        return RouteInfo(solver="deterministic", requiresVerification=True, maxResponseTokens=600)
    if qtype == "grammar":
        return RouteInfo(solver="rule_based", requiresVerification=True, maxResponseTokens=300)
    if qtype == "literature":
        return RouteInfo(solver="llm_reasoning", requiresVerification=False, maxResponseTokens=600)
    if qtype == "long_answer":
        return RouteInfo(solver="llm_reasoning", requiresVerification=False, maxResponseTokens=800)
    return RouteInfo(solver="rule_based", requiresVerification=True, maxResponseTokens=400)


def getGradeStyle(grade: str) -> str:
    try:
        g = int(grade)
    except ValueError:
        g = 9
    if g <= 7:
        return "Use simple language with real-life analogies. Be encouraging."
    if g <= 9:
        return "Use clear language with proper terms. Give one example."
    return "Use precise academic language. Focus on board-exam depth."


def buildSolverSystemPrompt(parsed: ParsedQuestion, ragContext: str | None) -> str:
    grade = parsed.grade
    subjectLower = parsed.subject.lower()
    subjectSafetyRule = ""
    if subjectLower in ["math", "mathematics"]:
        subjectSafetyRule = f"\nSUBJECT-SPECIFIC RULE (Math): Do NOT use formulas, theorems, or methods not taught in NCERT for Class {grade}. For example, do not use L'Hopital's rule in Class 11, or integration by parts in Class 11 if it is a Class 12 topic. If you are unsure whether a method is in the NCERT syllabus for this grade, explicitly say so."
    elif subjectLower in ["physics", "chemistry", "science", "biology"]:
        subjectSafetyRule = f'\nSUBJECT-SPECIFIC RULE (Science): Do NOT state specific numerical values, constants, or experimental results unless you are CERTAIN they match NCERT for Class {grade}. Use only the formulas and derivations presented in NCERT. If unsure about a specific value or constant, say "Please verify the exact value from your NCERT textbook."'
    elif subjectLower in [
        "history",
        "geography",
        "civics",
        "economics",
        "social science",
        "political science",
    ]:
        subjectSafetyRule = f'\nSUBJECT-SPECIFIC RULE (Social Studies): Do NOT state specific dates, events, names, or historical claims unless you are CERTAIN they match NCERT for Class {grade}. If unsure about a specific date or fact, say "Please verify from your NCERT textbook."'

    prompt = f"""You are a CBSE Class {grade} {parsed.subject} problem-solving engine that strictly follows NCERT.

CORE RULES — FOLLOW WITHOUT EXCEPTION:
- You MUST solve this problem using ONLY methods, formulas, and concepts taught in the NCERT textbook for Class {grade} {parsed.subject}.
- Do NOT use advanced methods, shortcuts, or concepts not covered in NCERT for this grade.
- Do NOT invent facts, formulas, dates, or definitions not in NCERT.
- NEVER contradict NCERT. If your knowledge differs from NCERT, follow NCERT.
- If you are not confident in your answer, you MUST say so explicitly rather than guessing.
- If unsure about any fact, say "This should be verified against the NCERT textbook" rather than presenting uncertain information as fact.
- Always output valid JSON.{subjectSafetyRule}"""

    if ragContext:
        prompt += f"""

=== NCERT REFERENCE MATERIAL (Grade {grade}, {parsed.subject}) ===
{ragContext}
=== END REFERENCE ===

You MUST answer ONLY based on the NCERT content provided above. If the context doesn't contain relevant information, say so explicitly and set your confidence lower. NEVER make up information not present in the reference material. Your solution MUST be consistent with the above NCERT content. Do not contradict it. If the answer can be directly derived from this material, use it as the authoritative source."""
    else:
        prompt += f"""

WARNING: No NCERT reference material was found for this question.
You may still solve using your general knowledge of the CBSE Class {grade} {parsed.subject} curriculum, but you MUST:
1. Use ONLY standard methods taught at this grade level
2. NOT fabricate specific NCERT page numbers, exercise numbers, or textbook quotes
3. Add a note in your explanation: "This solution should be verified against the NCERT textbook"
4. If you are uncertain about the correct method or answer, say so explicitly
5. Set your confidence appropriately — do not express high confidence without NCERT backing"""
    return prompt


def buildSolverPrompt(
    parsed: ParsedQuestion, route: RouteInfo, ragContext: str | None, gradeStyle: str
) -> str:
    formatRules = ""
    if parsed.type == "mcq":
        opts = " | ".join([f"{chr(65+i)}) {o}" for i, o in enumerate(parsed.options)])
        formatRules = f"Select correct option. Options: {opts}"
    elif parsed.type == "numerical":
        formatRules = "Show complete step-by-step working with Given, Formula, Substitution, Calculation, Answer with units."

    marksGuide = (
        "1-2 sentences."
        if parsed.marks <= 1
        else "3-5 sentences with concept."
        if parsed.marks <= 3
        else "Detailed with definition, explanation, example."
    )
    noRagWarning = (
        ""
        if ragContext
        else "\nIMPORTANT: No NCERT reference material was retrieved. Include a note in your explanation that the student should verify this answer from their NCERT textbook."
    )

    return f"""Solve this CBSE Class {parsed.grade} {parsed.subject} question.
QUESTION: {parsed.originalText}
MARKS: {parsed.marks} | TYPE: {parsed.type}
{formatRules}
{noRagWarning}

RULES: {marksGuide} {gradeStyle} Use ONLY NCERT-prescribed methods for this grade.

Output JSON: {{"answer":"...","steps":["..."],"concept":"...","explanation":"...","common_mistake":"...","formula_used":"..."}}"""


def buildVerificationSystemPrompt(parsed: ParsedQuestion) -> str:
    return f"""You are a CBSE Class {parsed.grade} {parsed.subject} answer verification engine.

Your job is to rigorously verify a proposed solution against NCERT standards.

VERIFICATION CHECKLIST — check ALL of the following:
1. Does this solution use ONLY methods taught in NCERT for Class {parsed.grade} {parsed.subject}? Flag any advanced methods not in the syllabus.
2. Are all formulas and values consistent with NCERT for this grade? Check for incorrect constants, wrong formula application.
3. Is the answer format appropriate for a CBSE board exam? (proper units, significant figures, marks-appropriate depth)
4. Are the steps logically correct and complete? Check for arithmetic errors, sign errors, unit conversion errors.
5. Does the explanation match what NCERT teaches, or does it introduce concepts from a different grade level?

If ANY check fails, set "passed" to false and list the specific issues.
If the solution uses a method not in NCERT for this grade, flag it even if the final answer is numerically correct.
Always output valid JSON."""


def buildVerificationPrompt(parsed: ParsedQuestion, proposedAnswer: str) -> str:
    opts_str = (
        f"OPTIONS: {' | '.join([f'{chr(65+i)}) {o}' for i, o in enumerate(parsed.options)])}"
        if parsed.options
        else ""
    )
    task1 = (
        "RECOMPUTE all calculations independently from scratch. Check units, significant figures, and sign."
        if parsed.hasNumerical
        else f"Check all key concepts, facts, and definitions against NCERT for Class {parsed.grade}."
    )

    return f"""VERIFY this CBSE Class {parsed.grade} {parsed.subject} answer.

QUESTION: {parsed.originalText}
{opts_str}

PROPOSED SOLUTION: {proposedAnswer}

VERIFICATION TASKS:
1. {task1}
2. Does this solution use ONLY methods taught in NCERT for Class {parsed.grade}? If it uses advanced methods, flag this.
3. Are all formulas and values consistent with NCERT for this grade?
4. Is the answer format appropriate for a CBSE board exam worth {parsed.marks} mark(s)?
5. If any step is uncertain or potentially incorrect, flag it.

Output JSON: {{"passed":boolean,"confidence":0-1,"correct_answer":"...","errors_found":["..."],"recomputed_result":"..."}}"""


def estimateConfidence(solver: str, verified: bool, hasRAG: bool) -> float:
    c = (
        0.9
        if solver == "deterministic"
        else 0.8
        if solver == "rule_based"
        else 0.75
        if solver == "hybrid"
        else 0.65
    )
    if hasRAG:
        c += 0.1
    else:
        c -= 0.15
    if verified:
        c += 0.05
    else:
        c -= 0.15
    return max(0.0, min(1.0, c))


async def callClaude(prompt: str, maxTokens: int, systemPrompt: str) -> str:
    s = get_settings()
    if not s.anthropic_api_key:
        raise Exception("Claude API key not configured")

    async with httpx.AsyncClient(timeout=25.0) as client:
        try:
            res = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": s.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": maxTokens,
                    "system": systemPrompt,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if res.status_code < 200 or res.status_code >= 300:
                CircuitBreaker.recordFailure()
                raise Exception(f"Claude API error: {res.status_code}")

            data = res.json()
            CircuitBreaker.recordSuccess()
            return data.get("content", [{}])[0].get("text", "")
        except Exception as e:
            if not (isinstance(e, Exception) and str(e).startswith("Claude API error:")):
                CircuitBreaker.recordFailure()
            raise


async def fetchRAGContext(*args, **kwargs) -> str | None:
    # Placeholder for actual RAG retrieval matching the signature
    return None


async def handle_ncert_solver(req: NcertSolverRequest, auth_header: str) -> NcertSolverResponse:
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = auth_header.replace("Bearer ", "")
    s = get_settings()

    # ── Auth ──
    async with httpx.AsyncClient() as hc:
        auth_url = f"{s.supabase_url.rstrip('/')}/auth/v1/user"
        res = await hc.get(
            auth_url,
            headers={"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {token}"},
        )
        if res.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_data = res.json()
        user_id = user_data.get("id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

    client = get_service_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database client unavailable")

    # ── Subject governance + daily-quota enforcement ──
    try:
        student_res = (
            await client.table("students")
            .select("id")
            .eq("auth_user_id", user_id)
            .eq("is_active", True)
            .is_("deleted_at", "null")
            .execute()
        )
        student_data = student_res.data
        if not student_data:
            raise HTTPException(
                status_code=422,
                detail={"error": "subject_not_allowed", "reason": "grade", "subject": req.subject},
            )
        resolved_student_id = student_data[0]["id"]

        subj_check = await client.rpc(
            "get_available_subjects", {"p_student_id": resolved_student_id}
        ).execute()
        subj_rows = subj_check.data or []
        row = next((r for r in subj_rows if r.get("code") == req.subject), None)
        if not row:
            raise HTTPException(
                status_code=422,
                detail={"error": "subject_not_allowed", "reason": "grade", "subject": req.subject},
            )
        if row.get("is_locked"):
            raise HTTPException(
                status_code=422,
                detail={"error": "subject_not_allowed", "reason": "plan", "subject": req.subject},
            )

        usage_date = time.strftime("%Y-%m-%d")
        usage_res = await client.rpc(
            "check_and_record_usage",
            {
                "p_student_id": resolved_student_id,
                "p_feature": "ncert_solver",
                "p_usage_date": usage_date,
            },
        ).execute()
        usage_rows = usage_res.data
        if not usage_rows or not usage_rows[0].get("allowed"):
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "Daily NCERT-solver limit reached",
                    "code": "NCERT_LIMIT",
                    "used": usage_rows[0].get("used_count") if usage_rows else None,
                    "message": "You've used all your NCERT-solver requests for today. Come back tomorrow! 🦊",
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"ncert-solver subject validation/usage failed: {e}")
        raise HTTPException(
            status_code=422,
            detail={"error": "subject_not_allowed", "reason": "grade", "subject": req.subject},
        )

    if not CircuitBreaker.canRequest():
        raise HTTPException(
            status_code=503, detail="Service temporarily unavailable, please try again shortly"
        )

    # ── Phase 3 feature flag (grounded logic omitted per instructions to use Claude directly or fallback) ──

    # ── Step 1: Parse question ──
    parsed = parseQuestion(req.question, req.subject, req.grade, req.options, req.marks)

    # ── Step 2: Retrieve NCERT context ──
    ragContext = await fetchRAGContext()

    # ── Step 3: Route to solver ──
    route = routeToSolver(parsed)

    # ── Step 4: Generate solution ──
    gradeStyle = getGradeStyle(req.grade)
    solverSystemPrompt = buildSolverSystemPrompt(parsed, ragContext)
    solverPrompt = buildSolverPrompt(parsed, route, ragContext, gradeStyle)

    try:
        solutionRaw = await callClaude(solverPrompt, route.maxResponseTokens, solverSystemPrompt)
    except Exception as e:
        print(f"Solver error: {e}")
        raise HTTPException(status_code=500, detail="Solver failed")

    solution = {
        "answer": solutionRaw,
        "steps": [],
        "concept": "",
        "explanation": solutionRaw,
        "common_mistake": "",
        "formula_used": "",
    }
    try:
        jsonMatch = re.search(r"\{[\s\S]*\}", solutionRaw)
        if jsonMatch:
            parsed_sol = json.loads(jsonMatch.group(0))
            solution.update(parsed_sol)
    except Exception:
        pass

    # ── Step 5: Verify answer ──
    verification = {"passed": True, "confidence": 0.7, "issues": []}
    if route.requiresVerification and solution.get("answer"):
        verifySystemPrompt = buildVerificationSystemPrompt(parsed)
        verifyPrompt = buildVerificationPrompt(parsed, json.dumps(solution))
        try:
            verifyRaw = await callClaude(verifyPrompt, 300, verifySystemPrompt)
            verifyMatch = re.search(r"\{[\s\S]*\}", verifyRaw)
            if verifyMatch:
                verifyResult = json.loads(verifyMatch.group(0))
                verification["passed"] = verifyResult.get("passed", False)
                verification["confidence"] = verifyResult.get("confidence", 0.7)
                verification["issues"] = verifyResult.get("errors_found", [])

                if not verification["passed"] and verifyResult.get("correct_answer"):
                    solution["answer"] = verifyResult["correct_answer"]
                    if verifyResult.get("recomputed_result"):
                        solution["steps"].append(f"Verified: {verifyResult['recomputed_result']}")
        except Exception:
            verification["confidence"] = 0.5

    # ── Step 6: Compute final confidence ──
    confidence = estimateConfidence(route.solver, verification["passed"], bool(ragContext))

    return NcertSolverResponse(
        answer=solution.get("answer", ""),
        steps=solution.get("steps", []),
        concept=solution.get("concept", ""),
        explanation=solution.get("explanation", ""),
        common_mistake=solution.get("common_mistake", ""),
        formula_used=solution.get("formula_used", ""),
        confidence=confidence,
        verified=verification["passed"],
        verification_issues=verification.get("issues", []),
        solver_type=route.solver,
        question_type=parsed.type,
        marks=parsed.marks,
    )
