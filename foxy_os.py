from typing import Dict, Any

# Importing all previous AI engines
from student_dna_engine import LearnerProfile
from foxy_adaptive_brain import FoxyAdaptiveBrain as AdaptiveBrain
from dopamine_framework import GamificationProfile, DopamineEngine as GamificationEngine
from curiosity_engine import CuriosityEngine
from content_rendering_engine import ContentRenderingEngine
from learning_loop import LearningLoopController, LearningStage
from human_intelligence_framework import HumanIntelligenceActivityDB, HIFEvaluator
from mastery_framework import MasteryEvaluator

class FoxyOS:
    """
    The centralized Pedagogy Operating System.
    Acts as the global event router connecting all 6 proprietary AI Engines.
    """
    def __init__(self):
        # Initialize Core Engines
        self.adaptive_brain = AdaptiveBrain()
        self.dopamine_engine = GamificationEngine()
        self.curiosity_engine = CuriosityEngine()
        self.content_engine = ContentRenderingEngine()
        self.learning_loop = LearningLoopController()
        self.hif_db = HumanIntelligenceActivityDB()
        self.hif_eval = HIFEvaluator()
        self.mastery_eval = MasteryEvaluator()
        
        # In-memory mock database
        self.student_profiles: Dict[str, LearnerProfile] = {}
        self.gamification_profiles: Dict[str, GamificationProfile] = {}

    def register_student(self, student_id: str, grade: int):
        self.student_profiles[student_id] = LearnerProfile(student_id, grade)
        self.gamification_profiles[student_id] = GamificationProfile(student_id)
        
    def start_topic(self, student_id: str, topic_id: str) -> Dict[str, Any]:
        """
        Initiates the learning journey. Calls Curiosity and Content engines.
        """
        # 1. Start Learning Loop (HOOK Stage)
        ui_instruction = self.learning_loop.start_loop(student_id, topic_id)
        
        # 2. Get Curiosity content
        pipeline = self.curiosity_engine.generate_lesson_opener(topic_id)
        
        # 3. Route content to Rendering Engine
        content_payload = {"topic_id": topic_id, "text": pipeline["pipeline"]["hook"]}
        render_schema = self.content_engine.generate_ui_schema(content_payload, learning_stage="HOOK")
        
        return {
            "status": "Topic Started",
            "loop_stage": "HOOK",
            "curiosity_engine_type": pipeline["engine"],
            "ui_schema": render_schema
        }

    def process_event(self, student_id: str, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        The Master Event Router. All clicks, answers, and interactions flow through here.
        """
        dna = self.student_profiles[student_id]
        gami = self.gamification_profiles[student_id]
        
        # 1. Update DNA based on raw event (e.g., time spent, accuracy)
        # Note: In a real system, the DNA Engine would have its own event processor here.
            
        # 2. Update Intrinsic Motivation / Dopamine
        dopamine_triggers = []
        if "metrics" in action:
            dopamine_triggers = self.dopamine_engine.process_event(student_id, action)
            
        # 3. Process Learning Loop progression
        next_stage, ui_instruction = self.learning_loop.process_student_action(student_id, action)
        
        # 4. If in PRACTICE stage, fetch adaptive content
        adaptive_difficulty = None
        if next_stage == LearningStage.PRACTICE:
            current_session = {"format": "quiz", "current_challenge_level": 50.0}
            adaptive_difficulty = self.adaptive_brain.analyze_action(dna, current_session, action)
            
        # 5. If in TEACH stage (HIF Evaluator triggered)
        hif_feedback = None
        if next_stage == LearningStage.TEACH and action.get("type") == "voice_submit":
            # Grade their verbal teaching using the Human Intelligence Framework
            student_input = action.get("payload", {}).get("text_transcript", "")
            hif_result = self.hif_eval.evaluate_submission("CC", student_input)
            
            # Update their global DNA metrics with this communication score
            self.hif_eval.update_learner_dna(dna, "CC", hif_result["score"])
            
            # Update Mastery with teaching ability
            topic_id = self.learning_loop.active_sessions[student_id]["topic_id"]
            new_level = self.mastery_eval.update_metrics(
                student_id, topic_id, {"teaching_ability": hif_result["score"]}
            )
            hif_feedback = f"HIF CC Score: {hif_result['score']}. Mastery Level: {new_level}"
            
        return {
            "new_stage": next_stage.name,
            "ui_instruction": ui_instruction,
            "adaptive_difficulty": adaptive_difficulty,
            "dopamine_events": dopamine_triggers,
            "hif_feedback": hif_feedback
        }
