from typing import Dict, List, Optional
from datetime import datetime, timezone
import json
import math

class LearnerProfile:
    def __init__(self, student_id: str, grade: int):
        self.student_id = student_id
        self.grade = grade
        self.last_updated = datetime.now(timezone.utc).isoformat()
        self.total_interactions_logged = 0
        
        # Core DNA Attributes [Score 0-100, Confidence 0.0-1.0, Trend string]
        self.learning_speed = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.attention_span = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.concept_retention = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.curiosity_index = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.problem_solving = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.creativity_index = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.communication_ability = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        self.emotional_confidence = {"score": 50.0, "confidence": 0.0, "trend": "0"}
        
        # Subject Affinity (Subject -> {score, confidence})
        self.subject_affinity = {
            "Mathematics": {"score": 50.0, "confidence": 0.0},
            "Science": {"score": 50.0, "confidence": 0.0},
            "Social_Studies": {"score": 50.0, "confidence": 0.0},
            "Languages": {"score": 50.0, "confidence": 0.0}
        }
        
        # Learning Style (sums to 100)
        self.learning_style = {
            "visual": 33.3,
            "textual": 33.3,
            "kinesthetic": 33.4,
            "confidence": 0.0
        }

    def to_dict(self):
        return {
            "student_id": self.student_id,
            "grade": self.grade,
            "last_updated": self.last_updated,
            "total_interactions_logged": self.total_interactions_logged,
            "dna": {
                "learning_speed": self.learning_speed,
                "attention_span": self.attention_span,
                "concept_retention": self.concept_retention,
                "curiosity_index": self.curiosity_index,
                "problem_solving": self.problem_solving,
                "creativity_index": self.creativity_index,
                "communication_ability": self.communication_ability,
                "emotional_confidence": self.emotional_confidence,
                "subject_affinity": self.subject_affinity,
                "learning_style": self.learning_style
            }
        }
        
    def to_json(self):
        return json.dumps(self.to_dict(), indent=2)

class StudentIntelligenceEngine:
    """
    Engine to continually update the Learner DNA based on raw interaction events.
    """
    def __init__(self):
        # In a real app, this would be a database connection
        self.profiles: Dict[str, LearnerProfile] = {}

    def get_or_create_profile(self, student_id: str, grade: int = 9) -> LearnerProfile:
        if student_id not in self.profiles:
            self.profiles[student_id] = LearnerProfile(student_id, grade)
        return self.profiles[student_id]

    def _update_metric(self, metric_dict: dict, new_score: float, weight: float = 0.1):
        """Exponential moving average for smooth updates"""
        old_score = metric_dict["score"]
        updated_score = (old_score * (1 - weight)) + (new_score * weight)
        
        # Calculate trend
        diff = updated_score - old_score
        trend_str = f"+{diff:.1f}" if diff >= 0 else f"{diff:.1f}"
        
        metric_dict["score"] = min(100.0, max(0.0, round(updated_score, 1)))
        metric_dict["trend"] = trend_str
        # Confidence increases asymptotically as more data points come in
        metric_dict["confidence"] = min(1.0, metric_dict["confidence"] + 0.05)

    def process_interaction(self, student_id: str, event: dict):
        """
        Process a single learning event and update the DNA.
        Event schema expects keys like:
        - type: 'video_watch', 'quiz_attempt', 'chat_message', 'simulation_use'
        - payload: dict containing specific metrics (time_spent, accuracy, etc.)
        """
        profile = self.get_or_create_profile(student_id)
        profile.total_interactions_logged += 1
        profile.last_updated = datetime.now(timezone.utc).isoformat()
        
        event_type = event.get("type")
        payload = event.get("payload", {})
        
        # 1. Learning Speed Inference
        if "time_spent_seconds" in payload and "cohort_average_seconds" in payload:
            speed_ratio = payload["cohort_average_seconds"] / max(1, payload["time_spent_seconds"])
            new_speed_score = min(100.0, speed_ratio * 50) # Assuming 1.0 ratio = 50 score
            self._update_metric(profile.learning_speed, new_speed_score)

        # 2. Attention Span Inference
        if "uninterrupted_minutes" in payload and "distraction_events" in payload:
            # Expected age norm approx 20 mins for class 6-12
            attention_score = (payload["uninterrupted_minutes"] / 20.0) * 100 - (payload["distraction_events"] * 5)
            self._update_metric(profile.attention_span, attention_score)
            
        # 4. Curiosity Index Inference
        if event_type == "exploration_click" or event_type == "unstructured_question":
            # Boost curiosity for non-mandatory actions
            self._update_metric(profile.curiosity_index, 100.0, weight=0.05)
            
        # 5. Problem Solving Inference
        if event_type == "quiz_attempt" and payload.get("difficulty") == "hard":
            accuracy = payload.get("accuracy", 0.0) * 100
            hints_used = payload.get("hints_used", 0)
            ps_score = (accuracy * 0.7) + (100 if hints_used == 0 else 0 * 0.3) - (hints_used * 10)
            self._update_metric(profile.problem_solving, ps_score)

        # 8. Emotional Confidence
        if event_type == "quiz_retry":
            retry_speed_seconds = payload.get("time_before_retry", 0)
            # If they retry instantly (guess), score low. If they wait and think (20-60s), score high.
            if retry_speed_seconds < 3:
                conf_score = 20
            elif 10 < retry_speed_seconds < 60:
                conf_score = 90
            else:
                conf_score = 50
            self._update_metric(profile.emotional_confidence, conf_score)

        # 9. Subject Affinity
        subject = payload.get("subject")
        if subject and subject in profile.subject_affinity:
            if event_type == "voluntary_study":
                current = profile.subject_affinity[subject]
                current["score"] = min(100.0, current["score"] + 2)
                current["confidence"] = min(1.0, current["confidence"] + 0.02)
                
        # 10. Learning Style Modality
        if event_type in ["video_watch", "article_read", "simulation_use"]:
            completion = payload.get("completion_rate", 0.0)
            if event_type == "video_watch":
                profile.learning_style["visual"] += completion * 2
            elif event_type == "article_read":
                profile.learning_style["textual"] += completion * 2
            elif event_type == "simulation_use":
                profile.learning_style["kinesthetic"] += completion * 2
                
            # Normalize learning styles to sum to 100
            total = profile.learning_style["visual"] + profile.learning_style["textual"] + profile.learning_style["kinesthetic"]
            profile.learning_style["visual"] = round((profile.learning_style["visual"] / total) * 100, 1)
            profile.learning_style["textual"] = round((profile.learning_style["textual"] / total) * 100, 1)
            profile.learning_style["kinesthetic"] = round((profile.learning_style["kinesthetic"] / total) * 100, 1)
            profile.learning_style["confidence"] = min(1.0, profile.learning_style["confidence"] + 0.05)

        return profile

    def get_adaptation_rules(self, student_id: str) -> List[str]:
        """
        Returns actionable adaptations based on the current DNA.
        """
        profile = self.profiles.get(student_id)
        if not profile:
            return []
            
        rules = []
        
        # Scenario A: Low Emotional Confidence + High Problem Solving
        if profile.emotional_confidence["score"] < 40 and profile.problem_solving["score"] > 70:
            rules.append("ADAPTATION: Anxious Overachiever detected. Break down complex problems, provide highly encouraging feedback, disable visible timers.")
            
        # Scenario B: Low Attention Span + High Visual
        if profile.attention_span["score"] < 40 and profile.learning_style["visual"] > 50:
            rules.append("ADAPTATION: TikTok Scroller detected. Switch to 'Shorts' mode. Use 2-minute video segments with frequent interactive checkpoints.")
            
        # Scenario C: High Curiosity + Fast Speed
        if profile.curiosity_index["score"] > 80 and profile.learning_speed["score"] > 80:
            rules.append("ADAPTATION: Bored Genius detected. Accelerate standard syllabus, offer Olympiad-level deep dives.")
            
        return rules

# Example usage/Test script
if __name__ == "__main__":
    engine = StudentIntelligenceEngine()
    student_id = "STU_83729"
    
    # Simulate a learning session
    events = [
        {
            "type": "video_watch", 
            "payload": {"time_spent_seconds": 300, "cohort_average_seconds": 450, "completion_rate": 0.95, "uninterrupted_minutes": 5, "distraction_events": 0}
        },
        {
            "type": "quiz_attempt", 
            "payload": {"difficulty": "hard", "accuracy": 1.0, "hints_used": 0, "subject": "Mathematics"}
        },
        {
            "type": "voluntary_study",
            "payload": {"subject": "Mathematics"}
        },
        {
            "type": "unstructured_question",
            "payload": {"query": "Why does this formula work?"}
        },
        {
            "type": "quiz_retry",
            "payload": {"time_before_retry": 25} # Thoughtful retry
        }
    ]
    
    print("Processing events...")
    for event in events:
        profile = engine.process_interaction(student_id, event)
        
    print("\nFinal Learner DNA:")
    print(profile.to_json())
    
    print("\nTriggered Adaptations:")
    for rule in engine.get_adaptation_rules(student_id):
        print("-", rule)
