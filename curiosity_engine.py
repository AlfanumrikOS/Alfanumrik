from typing import Dict, Any, Optional
import json
import random

class CuriosityEngine:
    """
    Ensures every lesson begins with a hook based on Information Gap Theory.
    Generates a 5-step pipeline for the frontend to render.
    """
    
    ENGINES = [
        "mystery",
        "surprise",
        "contradiction",
        "real_world",
        "future_prediction",
        "what_if"
    ]
    
    def __init__(self):
        # Fallback database of pre-written curiosity pipelines for the Indian curriculum
        self.knowledge_base = {
            "trigonometry": {
                "engine": "real_world",
                "pipeline": {
                    "hook": "In 1852, Radhanath Sikdar calculated the exact height of Mount Everest without ever climbing it.",
                    "curiosity_gap": "How do you measure a mountain you can't climb?",
                    "discovery_journey": {
                        "type": "interactive_slider",
                        "prompt": "Try guessing the height based on the angle of this shadow."
                    },
                    "knowledge_reveal": "Enter Sine, Cosine, and Tangent: the universal cheat codes for triangles.",
                    "reflection": "Now, use Tangent to find the height of this building based on the shadow you just measured."
                }
            },
            "newtons_third_law": {
                "engine": "contradiction",
                "pipeline": {
                    "hook": "A speeding truck crushes a mosquito on its windshield.",
                    "curiosity_gap": "The truck crushed the mosquito. But did you know the mosquito hit the truck with the EXACT SAME amount of force?",
                    "discovery_journey": {
                        "type": "simulation_sandbox",
                        "prompt": "If the forces are equal, why didn't the truck explode? Try changing the masses."
                    },
                    "knowledge_reveal": "Because F=ma. Equal force affects different masses completely differently. This is Newton's Third Law.",
                    "reflection": "If you are floating in space and throw a heavy wrench forward, what happens to you?"
                }
            },
            "french_revolution": {
                "engine": "mystery",
                "pipeline": {
                    "hook": "In 1793, the King of France was executed by his own people. Yet, just a few years earlier, they loved him.",
                    "curiosity_gap": "What could possibly make an entire country decide to execute their king in public?",
                    "discovery_journey": {
                        "type": "decision_tree",
                        "prompt": "You are a peasant. Bread costs a month's wages. Do you pay taxes, steal, or revolt?"
                    },
                    "knowledge_reveal": "The Estate System, the bread crisis, and Enlightenment ideas created a powder keg. Let's look at the spark.",
                    "reflection": "Look at this modern news headline about a protest. Which of the 3 estates does this remind you of?"
                }
            },
            "active_passive_voice": {
                "engine": "surprise",
                "pipeline": {
                    "hook": "\"I broke the vase.\" vs \"The vase was broken.\"",
                    "curiosity_gap": "Politicians and criminals love the second sentence. Why?",
                    "discovery_journey": {
                        "type": "highlight_text",
                        "prompt": "Identify who takes the blame in these 3 news headlines."
                    },
                    "knowledge_reveal": "Passive voice allows you to hide the subject (the person responsible). Active voice forces accountability.",
                    "reflection": "Rewrite this politician's apology to make them take actual responsibility."
                }
            },
            "inflation": {
                "engine": "future_prediction",
                "pipeline": {
                    "hook": "In 1990, a movie ticket cost ₹15. Today it costs ₹250.",
                    "curiosity_gap": "Are movies getting 15x better, or is our money getting weaker?",
                    "discovery_journey": {
                        "type": "economy_simulator",
                        "prompt": "You have ₹100. Try buying groceries in 2000, 2010, and 2020."
                    },
                    "knowledge_reveal": "Welcome to Inflation: how the supply of money controls its power.",
                    "reflection": "If the government prints a trillion rupees tomorrow and gives everyone a million, will you be rich? Why or why not?"
                }
            }
        }

    def generate_lesson_opener(self, topic_id: str) -> Dict[str, Any]:
        """
        Generates the 5-step Curiosity Pipeline for a given topic.
        In a production environment, this could call an LLM if the topic isn't in the DB.
        """
        topic = topic_id.lower().replace(" ", "_")
        
        if topic in self.knowledge_base:
            return self.knowledge_base[topic]
        else:
            # Fallback for unknown topics (Simulation of LLM response)
            engine = random.choice(self.ENGINES)
            return {
                "engine": engine,
                "pipeline": {
                    "hook": f"Did you know there's a secret behind {topic}?",
                    "curiosity_gap": "What happens when we look closer?",
                    "discovery_journey": {
                        "type": "quiz_mcq",
                        "prompt": "Can you guess the core principle?"
                    },
                    "knowledge_reveal": f"Here is the formal definition of {topic}.",
                    "reflection": "How does this change your view of the world?"
                }
            }

    def get_ui_json(self, topic_id: str) -> str:
        """
        Returns the pipeline as a JSON string for the frontend to render.
        """
        opener = self.generate_lesson_opener(topic_id)
        return json.dumps(opener, indent=2)
