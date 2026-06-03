import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional

from foxy_os import FoxyOS

# Initialize the global Foxy OS instance
os = FoxyOS()

# Initialize FastAPI
app = FastAPI(
    title="Foxy-X Pedagogy OS API",
    description="Backend API for the Foxy AI Tutor",
    version="1.0.0"
)

# Allow CORS for the frontend (Next.js typically runs on port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "*"],
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

@app.post("/api/students/register")
def register_student(req: RegisterRequest):
    """
    Initializes a new student's DNA and Gamification profiles.
    """
    try:
        os.register_student(req.student_id, req.grade)
        return {"status": "success", "message": f"Profiles initialized for student {req.student_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/topics/start")
def start_topic(req: StartTopicRequest):
    """
    Triggers the Curiosity Engine and the Content Rendering Engine to start a topic.
    Returns the JSON UI schema dictating what the frontend must render.
    """
    try:
        # Ensure student exists
        if req.student_id not in os.student_profiles:
            os.register_student(req.student_id, 10) # Auto-register for robustness
            
        result = os.start_topic(req.student_id, req.topic_id)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/events/process")
def process_event(req: EventProcessRequest):
    """
    The master event router. Receives all interactions and returns UI updates,
    dopamine triggers, and adaptive difficulty changes.
    """
    try:
        # Ensure student exists
        if req.student_id not in os.student_profiles:
            raise HTTPException(status_code=400, detail="Student not registered.")
            
        result = os.process_event(req.student_id, req.action)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health_check():
    """Simple health check endpoint"""
    return {"status": "healthy", "engines": ["DNA", "Adaptive Brain", "Dopamine", "Curiosity", "Rendering", "Mastery"]}


if __name__ == "__main__":
    print("Starting Foxy-X OS API Server on http://0.0.0.0:8000")
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=True)
