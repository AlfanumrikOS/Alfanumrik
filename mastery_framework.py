from typing import Dict, Any

class TopicMasteryProfile:
    def __init__(self, topic_id: str):
        self.topic_id = topic_id
        self.level = 1
        self.metrics = {
            "knowledge": 0.0,
            "application": 0.0,
            "retention_7d": 0.0,
            "retention_30d": 0.0,
            "retention_60d": 0.0,
            "teaching_ability": 0.0,
            "problem_solving": 0.0,
            "creativity": 0.0
        }

class MasteryEvaluator:
    """
    Evaluates a student's mastery level (1-5) for a specific topic based on 
    multidimensional metrics. Implements progression locks and decay rules.
    """
    def __init__(self):
        self.profiles: Dict[str, Dict[str, TopicMasteryProfile]] = {}

    def get_profile(self, student_id: str, topic_id: str) -> TopicMasteryProfile:
        if student_id not in self.profiles:
            self.profiles[student_id] = {}
        if topic_id not in self.profiles[student_id]:
            self.profiles[student_id][topic_id] = TopicMasteryProfile(topic_id)
        return self.profiles[student_id][topic_id]

    def update_metrics(self, student_id: str, topic_id: str, new_metrics: Dict[str, float]) -> int:
        """
        Updates the metrics and returns the new evaluated Mastery Level (1-5).
        """
        profile = self.get_profile(student_id, topic_id)
        
        # Update metrics (simple overwrite for this simulation)
        for key, value in new_metrics.items():
            if key in profile.metrics:
                profile.metrics[key] = value
                
        # Evaluate Decay First (The Decay Rule)
        # If a Level 5 student fails a 60-day check (retention < 80) -> demote to Level 3
        if profile.level == 5 and profile.metrics["retention_60d"] > 0 and profile.metrics["retention_60d"] < 80.0:
            profile.level = 3
            return profile.level
            
        m = profile.metrics
        
        # Evaluate Progression (Bottom-up)
        new_level = 1 # Default to Beginner
        
        # Check Level 2: Explorer
        if m["knowledge"] >= 60.0 and m["problem_solving"] >= 50.0:
            new_level = 2
            
        # Check Level 3: Practitioner
        if new_level == 2 and m["knowledge"] >= 85.0 and m["application"] >= 80.0 and m["problem_solving"] >= 80.0:
            new_level = 3
            
        # Check Level 4: Expert (The Progression Rule Hard Lock)
        # Cannot pass Level 3 without a >80% teaching ability score and 7-day retention
        if new_level == 3 and m["teaching_ability"] >= 80.0 and m["retention_7d"] >= 80.0 and m["creativity"] >= 60.0:
            new_level = 4
            
        # Check Level 5: Mentor
        # Must have >90% 30-day retention and elite teaching ability
        if new_level == 4 and m["retention_30d"] >= 90.0 and m["teaching_ability"] >= 90.0:
            new_level = 5
            
        # A student can only go up or be explicitly decayed. 
        # (We don't demote them just because they haven't taken a 7-day test yet).
        # We only update if the new calculated level is higher than their current (unless caught by decay rule above).
        if new_level > profile.level:
            profile.level = new_level
            
        return profile.level

    def get_action_recommendation(self, level: int) -> str:
        """
        Returns the AI action based on the current mastery level.
        """
        actions = {
            1: "Keep in EXPLORE/DISCOVER stages. Use high-motivation UI.",
            2: "Push to PRACTICE stage. Vary question types to build resilience.",
            3: "Push to TEACH stage. Introduce minor spaced repetition.",
            4: "Push to MASTER stage. Schedule 30-day checks.",
            5: "Award 3D Mastery Badge. Unlock Secret Boss Challenges for this topic."
        }
        return actions.get(level, "Unknown level.")
