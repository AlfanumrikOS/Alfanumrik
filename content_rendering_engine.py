from typing import Dict, Any, List
import json

class ContentRenderingEngine:
    """
    Analyzes educational text/payloads and dynamically selects the best 
    UI rendering format (Simulation, Animation, Diagram, Story, Text).
    """
    
    def __init__(self):
        # Heuristic keyword mapping to Intent
        self.heuristics = {
            "spatial": ["inside", "parts of", "anatomy", "layout", "layers", "structure", "where is"],
            "dynamic": ["over time", "becomes", "cycles", "speed", "flow", "life cycle", "reaction"],
            "kinematic": ["if we increase", "what happens when", "forces", "velocity", "gravity", "angle"],
            "abstract": ["definition", "therefore", "proof", "rule", "equation", "formula", "theorem"],
            "contextual": ["in 1850", "struggled to", "imagine you are", "history", "diary", "perspective"],
            "procedural": ["first", "next", "finally", "calculate", "solve for", "step"]
        }
        
        # Mapping Intent to preferred Media Format and UI component
        self.intent_to_media = {
            "kinematic": {"format": "simulation", "ui_component": "interactive_canvas"},
            "dynamic": {"format": "animation", "ui_component": "looping_video_player"},
            "spatial": {"format": "diagram", "ui_component": "interactive_svg_map"},
            "contextual": {"format": "story", "ui_component": "narrative_card"},
            "procedural": {"format": "stepped_text", "ui_component": "accordion_steps"},
            "abstract": {"format": "text", "ui_component": "markdown_latex_block"}
        }

    def _detect_primary_intent(self, content_text: str) -> str:
        """
        Runs a heuristic keyword check to determine the primary intent of the text.
        Returns 'abstract' (text) as a fallback.
        """
        content_lower = content_text.lower()
        intent_scores = {intent: 0 for intent in self.heuristics}
        
        for intent, keywords in self.heuristics.items():
            for keyword in keywords:
                if keyword in content_lower:
                    intent_scores[intent] += 1
                    
        # Find the intent with the highest score
        best_intent = max(intent_scores, key=intent_scores.get)
        
        # If no keywords matched, fallback to abstract/text
        if intent_scores[best_intent] == 0:
            return "abstract"
            
        return best_intent

    def generate_ui_schema(self, content_payload: Dict[str, Any], learning_stage: str = "DISCOVER") -> Dict[str, Any]:
        """
        Takes raw content and the current Learning Loop stage, and returns
        a structured JSON schema for the frontend to render.
        """
        raw_text = content_payload.get("text", "")
        intent = self._detect_primary_intent(raw_text)
        
        # Determine base media recommendation
        media_rec = self.intent_to_media[intent]
        
        # Stage Biasing (Integration with Learning Loop)
        # If we are in EXPLORE, we heavily bias towards Simulation/Interactive.
        # If we only got a 'spatial' diagram, we might try to make it an interactive diagram.
        if learning_stage == "EXPLORE" and intent in ["abstract", "procedural"]:
            # Force interactive if possible, or fallback to an experiment prompt
            media_rec = {"format": "experiment", "ui_component": "sandbox_prompt"}
            
        elif learning_stage == "PRACTICE":
            # Practice should usually be stepped text or quiz
            media_rec = {"format": "quiz", "ui_component": "adaptive_mcq"}

        # Construct the final schema for the frontend
        schema = {
            "topic_id": content_payload.get("topic_id", "unknown"),
            "detected_intent": intent,
            "render_instruction": {
                "format": media_rec["format"],
                "component": media_rec["ui_component"],
                "data_payload": raw_text
            },
            # Provide a fallback hierarchy in case the specific simulation/asset doesn't exist on frontend
            "fallback_hierarchy": ["simulation", "animation", "diagram", "text"]
        }
        
        return schema
