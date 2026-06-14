from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from .handler import handle_ncert_solver
from .models import NcertSolverRequest, NcertSolverResponse

router = APIRouter(prefix="/ncert-solver", tags=["ncert-solver"])


@router.post("/", response_model=NcertSolverResponse)
async def ncert_solver_endpoint(req: NcertSolverRequest, authorization: str = Header(None)):
    try:
        return await handle_ncert_solver(req, authorization)
    except HTTPException as he:
        if isinstance(he.detail, dict):
            return JSONResponse(status_code=he.status_code, content=he.detail)
        return JSONResponse(status_code=he.status_code, content={"error": he.detail})
