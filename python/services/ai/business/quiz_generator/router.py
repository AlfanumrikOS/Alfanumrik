from fastapi import APIRouter, Depends, HTTPException

from ...api.auth import enforce_student_grade_scope, require_active_student
from ...db.supabase import get_service_client
from .handler import generate_quiz, handle_next_question
from .models import QuizGeneratorRequest, QuizGeneratorResponse

router = APIRouter()


@router.post("/v1/quiz-generator", response_model=QuizGeneratorResponse)
async def create_quiz(
    request: QuizGeneratorRequest,
    student: dict[str, object] = Depends(require_active_student),
    supabase=Depends(get_service_client),
):
    try:
        if request.student_id != student["id"]:
            raise HTTPException(
                status_code=403,
                detail={"error": "STUDENT_SCOPE_MISMATCH"},
            )
        request.grade = enforce_student_grade_scope(request.grade, student)
        if request.action == "next_question":
            if not request.session_id:
                raise HTTPException(
                    status_code=400, detail="session_id is required for next_question"
                )
            return await handle_next_question(supabase, request)
        else:
            return await generate_quiz(supabase, request)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
