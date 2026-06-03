import sys
import os
# Add the project root to sys.path so we can import our engine files
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any

from foxy_os import FoxyOS

# Initialize the global Foxy OS instance
os_engine = FoxyOS()

# Initialize FastAPI
app = FastAPI(
    title="Foxy-X Pedagogy OS API",
    description="Backend API for the Foxy AI Tutor running on Vercel Serverless",
    version="1.0.0",
    docs_url="/api/py/docs",
    openapi_url="/api/py/openapi.json"
)

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models for Input Validation ---
class RegisterRequest(BaseModel):
    student_id: str
    grade: int

class StartTopicRequest(BaseModel):
    student_id: str
    topic_id: str

class EventProcessRequest(BaseModel):
    student_id: str
    action: Dict[str, Any]

# --- API Routes ---
@app.post("/api/py/students/register")
def register_student(req: RegisterRequest):
    try:
        os_engine.register_student(req.student_id, req.grade)
        return {"status": "success", "message": f"Profiles initialized for student {req.student_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/py/topics/start")
def start_topic(req: StartTopicRequest):
    try:
        if req.student_id not in os_engine.student_profiles:
            os_engine.register_student(req.student_id, 10)
        result = os_engine.start_topic(req.student_id, req.topic_id)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/py/events/process")
def process_event(req: EventProcessRequest):
    try:
        if req.student_id not in os_engine.student_profiles:
            raise HTTPException(status_code=400, detail="Student not registered.")
        result = os_engine.process_event(req.student_id, req.action)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/py/health")
def health_check():
    return {"status": "healthy", "engines": ["DNA", "Adaptive Brain", "Dopamine", "Curiosity", "Rendering", "Mastery"]}
