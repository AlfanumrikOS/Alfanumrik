from human_intelligence_framework import HumanIntelligenceActivityDB, HIFEvaluator
from student_dna_engine import LearnerProfile

def test_hif():
    db = HumanIntelligenceActivityDB()
    evaluator = HIFEvaluator()
    profile = LearnerProfile(student_id="STU_HIF_1", grade=9)
    
    print("=== Testing Human Intelligence Framework ===\n")
    
    # 1. Test DB Retrieval
    print("--- Test: Fetching Activities ---")
    activities = db.get_activities_for_topic("electricity")
    assert activities["level"] == "senior"
    assert "IQ" in activities["activities"]
    assert "EQ" in activities["activities"]
    print("Successfully retrieved 4-pillar activities for Electricity.")
    
    # 2. Test Evaluator (Mock LLM)
    print("\n--- Test: Evaluation & Scoring ---")
    
    # EQ Test (Should score high due to keywords)
    eq_input = "I feel that it is very difficult for the families who lose their main jobs. We must try to deeply understand their perspective and support them emotionally during this tough time."
    eq_result = evaluator.evaluate_submission("EQ", eq_input)
    print("EQ Result:", eq_result)
    assert eq_result["score"] > 70
    
    # CQ Test (Should score low due to short/generic answer)
    cq_input = "I don't know, maybe use a big battery."
    cq_result = evaluator.evaluate_submission("CQ", cq_input)
    print("CQ Result:", cq_result)
    assert cq_result["score"] < 70
    
    # 3. Test DNA Engine Integration
    print("\n--- Test: Updating Learner DNA ---")
    print(f"Initial Creativity Index: {profile.creativity_index['score']}")
    print(f"Initial Emotional Confidence: {profile.emotional_confidence['score']}")
    
    # Update DNA with the scores
    evaluator.update_learner_dna(profile, "EQ", eq_result["score"])
    evaluator.update_learner_dna(profile, "CQ", cq_result["score"])
    
    print(f"Updated Creativity Index: {profile.creativity_index['score']} (Trend: {profile.creativity_index['trend']})")
    print(f"Updated Emotional Confidence: {profile.emotional_confidence['score']} (Trend: {profile.emotional_confidence['trend']})")
    
    # Verify update (Since initial was 50, and EQ score is high, EQ confidence should go up)
    assert profile.emotional_confidence["score"] > 50.0
    
    print("\nAll HIF tests passed successfully!")

if __name__ == "__main__":
    test_hif()
