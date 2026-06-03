from typing import Dict, Any, List
import time
from student_dna_engine import LearnerProfile

class FoxyAdaptiveBrain:
    """
    The decision engine that balances Challenge, Confidence, and Mastery
    to keep the student in the Flow Zone.
    """
    
    def __init__(self):
        # We store some session state to prevent jarring rapid format switching
        self.session_state = {}

    def _get_flow_zone_status(self, mastery: float, confidence: float, challenge: float) -> str:
        """
        Calculates if the student is in Flow, Boredom, or Overwhelm.
        Formula: | (M*0.5 + C*0.5) - Ch | < 15 is Flow.
        """
        combined_ability = (mastery * 0.5) + (confidence * 0.5)
        diff = combined_ability - challenge
        
        if abs(diff) < 15:
            return "FLOW"
        elif diff >= 15:
            return "BOREDOM"
        else:
            return "OVERWHELM"

    def analyze_action(self, profile: LearnerProfile, current_session: Dict[str, Any], action: Dict[str, Any]) -> Dict[str, Any]:
        """
        Ingests a student action, analyzes the Brain State, and outputs an Adaptation.
        
        current_session expects:
        - mastery_level: float (0-100)
        - current_challenge_level: float (0-100)
        - consecutive_correct: int
        - consecutive_failed: int
        - format: string (video, quiz, etc.)
        - time_in_format: seconds
        - days_since_last_session: float
        """
        student_id = profile.student_id
        if student_id not in self.session_state:
            self.session_state[student_id] = {"last_format_switch": time.time()}

        # 1. Base Variables
        m = current_session.get("mastery_level", 50.0)
        c = profile.emotional_confidence.get("score", 50.0)
        ch = current_session.get("current_challenge_level", 50.0)
        zone = self._get_flow_zone_status(m, c, ch)
        
        action_type = action.get("type")
        payload = action.get("payload", {})
        
        adaptation = {
            "decision": "continue",
            "message": "",
            "format": current_session.get("format", "quiz"),
            "new_challenge_level": ch
        }
        
        # 2. Decision Tree Evaluations

        # B. When to Revise (Start of session check)
        if action_type == "session_start":
            retention = profile.concept_retention.get("score", 50.0)
            if retention < 60.0 or current_session.get("days_since_last_session", 0) > 7:
                adaptation["decision"] = "revise"
                adaptation["format"] = "warm_up_quiz"
                adaptation["message"] = "Welcome back! Let's do a quick 3-question warm-up."
                return adaptation

        # C. When to Challenge
        if current_session.get("consecutive_correct", 0) >= 3 and zone == "BOREDOM":
            if profile.curiosity_index.get("score", 50.0) > 75:
                adaptation["decision"] = "challenge_deep_dive"
                adaptation["message"] = "You're crushing this! Let's try an Olympiad-level challenge."
            else:
                adaptation["decision"] = "challenge_level_up"
                adaptation["message"] = "Level up! Here is a Boss Level question."
            adaptation["new_challenge_level"] = min(100.0, ch + 20)
            return adaptation

        # A. What to Teach Next
        if action_type == "topic_complete":
            if m > 85 and c > 80:
                adaptation["decision"] = "progress"
                adaptation["message"] = "Mastered! Moving on to the next chapter."
            elif m < 50:
                adaptation["decision"] = "lateral_prerequisite"
                adaptation["message"] = "Let's review some building blocks before moving forward."
            return adaptation

        # D. When to Motivate (Overwhelm)
        if current_session.get("consecutive_failed", 0) >= 2 or payload.get("hesitation_seconds", 0) > 45:
            if zone == "OVERWHELM":
                adaptation["decision"] = "motivate_simplify"
                adaptation["format"] = "visual_diagram" # Simplified format
                adaptation["new_challenge_level"] = max(0.0, ch - 15)
                # Indian context logic: if language scores are low or they failed a word problem, offer Hinglish/regional help
                if profile.communication_ability.get("score", 50.0) < 60 and current_session.get("format") == "word_problem":
                    adaptation["message"] = "This is a tough one for everyone! Let's break it down visually. Would you like a Hinglish hint?"
                else:
                    adaptation["message"] = "Take a breath, you've solved harder than this before. Let's look at it differently."
                return adaptation

        # E. When to Switch Formats (Disengagement)
        attention = profile.attention_span.get("score", 50.0)
        time_since_switch = time.time() - self.session_state[student_id]["last_format_switch"]
        
        # Only switch if they've been in current format for at least 2 minutes (120s) to avoid jarring UI
        if time_since_switch > 120 and attention < 40 and current_session.get("format") == "video":
            adaptation["decision"] = "switch_format"
            adaptation["format"] = "interactive_quiz"
            adaptation["message"] = "Let's pause and do a quick knowledge check!"
            self.session_state[student_id]["last_format_switch"] = time.time()
            return adaptation

        # Default Flow State
        adaptation["decision"] = "continue"
        return adaptation
