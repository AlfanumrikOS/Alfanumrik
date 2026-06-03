from typing import Dict, Any, List
from datetime import datetime, timedelta
import random

class GamificationProfile:
    def __init__(self, student_id: str):
        self.student_id = student_id
        
        # Micro Wins tracking
        self.current_struggle = {"consecutive_failures": 0, "time_spent_thinking": 0}
        
        # Learning Streaks (Flame of Focus)
        # Tracking deep work minutes rather than just days logged in
        self.flame_intensity = 0 # 0 to 100
        self.weekly_deep_work_minutes = 0
        
        # Mastery and Discovery
        self.earned_badges: List[str] = []
        self.discovery_points = 0
        self.unlocked_nodes: List[str] = ["basic_module_1"]

class DopamineEngine:
    """
    Evaluates learning events to trigger dopamine-positive UI feedback
    based on effort, consistency, and curiosity, NEVER completion.
    """
    def __init__(self):
        self.profiles: Dict[str, GamificationProfile] = {}

    def get_profile(self, student_id: str) -> GamificationProfile:
        if student_id not in self.profiles:
            self.profiles[student_id] = GamificationProfile(student_id)
        return self.profiles[student_id]

    def process_event(self, student_id: str, event: Dict[str, Any], dna_profile: Any = None) -> List[Dict[str, Any]]:
        """
        Process an event and return a list of UI triggers (rewards).
        """
        profile = self.get_profile(student_id)
        triggers = []
        
        event_type = event.get("type")
        payload = event.get("payload", {})
        
        # 1. Micro Wins (Effort)
        if event_type == "question_answered":
            if payload.get("correct") is False:
                profile.current_struggle["consecutive_failures"] += 1
                profile.current_struggle["time_spent_thinking"] += payload.get("time_taken", 0)
            else:
                # Correct answer! Let's check if it was a struggle
                failures = profile.current_struggle["consecutive_failures"]
                time_spent = profile.current_struggle["time_spent_thinking"] + payload.get("time_taken", 0)
                
                if failures >= 2 and time_spent > 60:
                    # Rewarding the GRIT, not just the correct answer
                    triggers.append({
                        "type": "micro_win",
                        "ui_pattern": "glowing_pulse",
                        "message": "Incredible grit! You struggled but didn't give up."
                    })
                
                # Reset struggle tracker
                profile.current_struggle = {"consecutive_failures": 0, "time_spent_thinking": 0}

        # 3. Learning Streaks (Consistency / Flame of Focus)
        if event_type == "deep_work_session":
            minutes = payload.get("minutes", 0)
            if minutes >= 20: # Must be deep work, not just logging in
                profile.weekly_deep_work_minutes += minutes
                profile.flame_intensity = min(100, profile.flame_intensity + (minutes // 5))
                
                if profile.flame_intensity > 80:
                    color = "Purple (Elite)"
                elif profile.flame_intensity > 50:
                    color = "Blue (Hot)"
                else:
                    color = "Orange (Warm)"
                    
                triggers.append({
                    "type": "streak_update",
                    "ui_pattern": "flame_of_focus",
                    "color": color,
                    "intensity": profile.flame_intensity,
                    "message": f"Your Flame of Focus is growing! ({minutes} mins deep work)"
                })

        # 4. Discovery Rewards (Curiosity)
        if event_type == "unstructured_question" or event_type == "lateral_exploration":
            profile.discovery_points += 1
            if profile.discovery_points % 3 == 0:
                triggers.append({
                    "type": "discovery_reward",
                    "ui_pattern": "eureka_moment",
                    "message": "Eureka! Your curiosity unlocked a hidden lore card.",
                    "payload": {"unlocked_item": "lore_card_newton_apple"}
                })

        # 6. Mastery Badges (Deep Learning)
        # Usually triggered by a cron job checking 30-day retention, 
        # but here we simulate a retention check event
        if event_type == "retention_check_passed":
            topic = payload.get("topic")
            badge_id = f"{topic}_mastery_30d"
            if badge_id not in profile.earned_badges:
                profile.earned_badges.append(badge_id)
                triggers.append({
                    "type": "mastery_badge",
                    "ui_pattern": "3d_interactive_badge",
                    "message": f"You've truly mastered {topic}. This knowledge is yours forever.",
                    "payload": {"badge_id": badge_id}
                })
                
        # 5. Secret Challenges (Variable Rewards)
        # If the student is getting highly confident/flow zone, maybe drop a secret boss
        if event_type == "flow_zone_check" and dna_profile:
            mastery = dna_profile.get("mastery", 50)
            confidence = dna_profile.get("confidence", 50)
            if mastery > 90 and confidence > 90:
                # 10% chance to drop a secret challenge
                if random.random() < 0.10:
                    triggers.append({
                        "type": "secret_challenge",
                        "ui_pattern": "mysterious_envelope",
                        "message": "A Secret Boss Challenge has appeared! Are you ready?"
                    })

        return triggers
