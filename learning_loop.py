from enum import Enum
from typing import Dict, Any, Tuple
import time

# Enum for the 8 stages of the Foxy Learning Loop
class LearningStage(Enum):
    HOOK = 1
    EXPLORE = 2
    DISCOVER = 3
    PRACTICE = 4
    APPLY = 5
    TEACH = 6
    REFLECT = 7
    MASTER = 8

class LearningLoopController:
    """
    State machine that orchestrates a student's journey through a concept.
    Connects to the Curiosity, Adaptive Brain, and Dopamine systems.
    """
    
    def __init__(self):
        # Maps student_id to their current active loop state
        self.active_sessions: Dict[str, Dict[str, Any]] = {}
        
    def start_loop(self, student_id: str, topic_id: str) -> Dict[str, Any]:
        """
        Initializes a new learning loop for a topic. Always starts at HOOK.
        """
        self.active_sessions[student_id] = {
            "topic_id": topic_id,
            "current_stage": LearningStage.HOOK,
            "start_time": time.time(),
            "metrics": {
                "practice_accuracy": 0.0,
                "teach_clarity_score": 0.0
            }
        }
        return self._get_stage_ui_instruction(LearningStage.HOOK, topic_id)

    def process_student_action(self, student_id: str, action: Dict[str, Any]) -> Tuple[LearningStage, Dict[str, Any]]:
        """
        Takes student input, evaluates if they met the exit criteria for the current stage,
        and transitions them to the next stage if successful.
        """
        session = self.active_sessions.get(student_id)
        if not session:
            raise ValueError("No active learning loop found for this student.")
            
        current_stage = session["current_stage"]
        topic_id = session["topic_id"]
        
        # State Machine Transitions
        if current_stage == LearningStage.HOOK:
            # Move to EXPLORE immediately after they interact with the hook
            next_stage = LearningStage.EXPLORE
            
        elif current_stage == LearningStage.EXPLORE:
            # Move to DISCOVER after they finish tinkering in the sandbox
            next_stage = LearningStage.DISCOVER
            
        elif current_stage == LearningStage.DISCOVER:
            # Move to PRACTICE after they view the formal reveal
            next_stage = LearningStage.PRACTICE
            
        elif current_stage == LearningStage.PRACTICE:
            # Exit criteria: Need at least 80% accuracy in practice to move to APPLY
            accuracy = action.get("payload", {}).get("accuracy", 0.0)
            session["metrics"]["practice_accuracy"] = accuracy
            if accuracy >= 80.0:
                next_stage = LearningStage.APPLY
            else:
                next_stage = LearningStage.PRACTICE # Must stay in practice
                
        elif current_stage == LearningStage.APPLY:
            # After solving the real-world quest
            next_stage = LearningStage.TEACH
            
        elif current_stage == LearningStage.TEACH:
            # Exit criteria: NLP score of their explanation must be decent
            clarity = action.get("payload", {}).get("nlp_clarity", 0.0)
            session["metrics"]["teach_clarity_score"] = clarity
            if clarity > 60.0:
                next_stage = LearningStage.REFLECT
            else:
                next_stage = LearningStage.TEACH # Try explaining again
                
        elif current_stage == LearningStage.REFLECT:
            # After writing reflection
            next_stage = LearningStage.MASTER
            
        elif current_stage == LearningStage.MASTER:
            # Loop is complete, triggers 30-day spaced repetition
            return current_stage, {"status": "complete", "message": "Topic queued for 30-day mastery check."}
            
        # Update state if transition occurred
        session["current_stage"] = next_stage
        
        # Return the new state and the UI instructions for rendering it
        ui_instruction = self._get_stage_ui_instruction(next_stage, topic_id)
        return next_stage, ui_instruction

    def _get_stage_ui_instruction(self, stage: LearningStage, topic_id: str) -> Dict[str, Any]:
        """
        Returns the data payload needed by the frontend to render the current stage.
        In a full system, this would call CuriosityEngine, AdaptiveBrain, etc.
        """
        instructions = {
            LearningStage.HOOK: {
                "action": "call_curiosity_engine",
                "ui": "render_hook_video",
                "description": "Trigger Information Gap."
            },
            LearningStage.EXPLORE: {
                "action": "render_sandbox",
                "ui": "render_interactive_slider",
                "description": "Allow risk-free tinkering."
            },
            LearningStage.DISCOVER: {
                "action": "call_curiosity_engine",
                "ui": "render_knowledge_reveal",
                "description": "Formal academic introduction."
            },
            LearningStage.PRACTICE: {
                "action": "call_adaptive_brain",
                "ui": "render_adaptive_quiz",
                "description": "Dynamic difficulty scaling to maintain Flow Zone."
            },
            LearningStage.APPLY: {
                "action": "load_quest",
                "ui": "render_narrative_problem",
                "description": "Real-world context application."
            },
            LearningStage.TEACH: {
                "action": "enable_microphone",
                "ui": "render_chatbot_confused",
                "description": "Feynman technique explanation."
            },
            LearningStage.REFLECT: {
                "action": "load_journal",
                "ui": "render_text_input",
                "description": "Metacognitive closure."
            },
            LearningStage.MASTER: {
                "action": "queue_spaced_repetition",
                "ui": "render_mastery_badge_locked",
                "description": "Initiate 30-day retention tracking."
            }
        }
        return instructions[stage]
