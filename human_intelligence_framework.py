from typing import Dict, Any, List
import random
from student_dna_engine import LearnerProfile

class HumanIntelligenceActivityDB:
    """
    Database of IQ, EQ, CQ, and CC activities mapped to curriculum topics.
    """
    def __init__(self):
        self.db = {
            "electricity": {
                "level": "senior",
                "activities": {
                    "IQ": {
                        "prompt": "Power Grid Optimization. Calculate and minimize power loss across a simulated regional grid using Kirchhoff's laws.",
                        "type": "logic_simulation"
                    },
                    "EQ": {
                        "prompt": "Energy Ethics. Debate the socio-economic impact of shutting down a coal plant that employs 10,000 people to shift to renewables.",
                        "type": "ethical_debate"
                    },
                    "CQ": {
                        "prompt": "Future Battery. Propose a theoretical energy storage mechanism that doesn't rely on Lithium.",
                        "type": "divergent_design"
                    },
                    "CC": {
                        "prompt": "Investor Pitch. Deliver a 2-minute pitch explaining why your AC circuit design is more efficient.",
                        "type": "persuasive_speech"
                    }
                }
            },
            "industrial_revolution": {
                "level": "junior",
                "activities": {
                    "IQ": {
                        "prompt": "Cause & Effect. Map how the steam engine led to urbanization using a logic tree.",
                        "type": "logic_mapping"
                    },
                    "EQ": {
                        "prompt": "Diary of a Child Worker. Write a journal entry from the perspective of a 10-year-old factory worker in 1850.",
                        "type": "empathy_writing"
                    },
                    "CQ": {
                        "prompt": "Alternative History. If coal didn't exist, describe the primary power source for early factories.",
                        "type": "world_building"
                    },
                    "CC": {
                        "prompt": "Town Hall. Record a speech trying to convince your village to build a textile mill.",
                        "type": "persuasive_speech"
                    }
                }
            }
        }

    def get_activities_for_topic(self, topic: str) -> Dict[str, Any]:
        return self.db.get(topic, {})


class HIFEvaluator:
    """
    Simulates an LLM evaluator that scores unstructured student inputs for IQ, EQ, CQ, CC.
    """
    
    def evaluate_submission(self, pillar: str, student_input: str) -> Dict[str, Any]:
        """
        Simulates parsing text/voice input to generate a 0-100 score and feedback.
        """
        length = len(student_input.split())
        
        # Mock logic based on keywords and length to simulate an LLM response
        score = min(100, max(20, length * 2)) # Longer responses generally score higher in this mock
        
        if pillar == "EQ":
            keywords = ["feel", "difficult", "understand", "perspective", "family", "sad"]
            if any(k in student_input.lower() for k in keywords):
                score = min(100, score + 30)
            feedback = "Great empathy and perspective taking." if score > 70 else "Try to understand how the other side feels."
                
        elif pillar == "CQ":
            keywords = ["what if", "imagine", "instead of", "gravity", "solar"]
            if any(k in student_input.lower() for k in keywords):
                score = min(100, score + 40)
            feedback = "Highly divergent and creative thinking!" if score > 70 else "A bit too standard. Try thinking outside the box."
                
        elif pillar == "CC":
            keywords = ["because", "therefore", "firstly", "in conclusion"]
            if any(k in student_input.lower() for k in keywords):
                score = min(100, score + 35)
            feedback = "Clear, structured, and persuasive communication." if score > 70 else "Lacked structure. Break your points down."
                
        elif pillar == "IQ":
            keywords = ["calculate", "step", "reduce", "logical", "if"]
            if any(k in student_input.lower() for k in keywords):
                score = min(100, score + 30)
            feedback = "Excellent systematic reduction of the problem." if score > 70 else "There were leaps in logic. Try a step-by-step approach."
            
        else:
            feedback = "Evaluation complete."

        return {
            "score": float(score),
            "feedback": feedback
        }

    def update_learner_dna(self, profile: LearnerProfile, pillar: str, score: float):
        """
        Maps the HIF scores directly to the foundational Learner DNA Engine.
        """
        # We use an exponential moving average (weight 0.2 for new HIF events)
        weight = 0.2
        
        def update_metric(metric: dict, val: float):
            old = metric["score"]
            metric["score"] = round((old * (1 - weight)) + (val * weight), 1)
            metric["confidence"] = min(1.0, metric["confidence"] + 0.05)
            metric["trend"] = f"{metric['score'] - old:+.1f}"

        if pillar == "IQ":
            update_metric(profile.problem_solving, score)
            update_metric(profile.learning_speed, score)
        elif pillar == "EQ":
            update_metric(profile.emotional_confidence, score)
        elif pillar == "CQ":
            update_metric(profile.creativity_index, score)
        elif pillar == "CC":
            update_metric(profile.communication_ability, score)
