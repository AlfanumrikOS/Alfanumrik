from foxy_adaptive_brain import FoxyAdaptiveBrain
from student_dna_engine import LearnerProfile

def test_brain():
    brain = FoxyAdaptiveBrain()
    
    # Create a mock profile
    profile = LearnerProfile(student_id="STU_999", grade=10)
    
    # 1. Test Session Start (Revision check)
    # Simulate low retention and days passed
    profile.concept_retention["score"] = 40.0
    session_state = {"days_since_last_session": 8}
    action = {"type": "session_start"}
    
    res1 = brain.analyze_action(profile, session_state, action)
    print("Test 1 (Session Start):", res1["decision"], "->", res1["message"])
    assert res1["decision"] == "revise"
    
    # 2. Test Boredom -> Challenge
    # Simulate high mastery, low challenge, 3 consecutive correct
    session_state = {
        "mastery_level": 90.0,
        "current_challenge_level": 30.0,
        "consecutive_correct": 3
    }
    profile.emotional_confidence["score"] = 90.0
    action = {"type": "answer_submit"}
    
    res2 = brain.analyze_action(profile, session_state, action)
    print("Test 2 (Boredom -> Challenge):", res2["decision"], "->", res2["message"])
    assert res2["decision"] in ["challenge_level_up", "challenge_deep_dive"]
    
    # 3. Test Overwhelm -> Motivate (with Hinglish fallback for word problem)
    session_state = {
        "mastery_level": 20.0,
        "current_challenge_level": 80.0,
        "consecutive_failed": 2,
        "format": "word_problem"
    }
    profile.emotional_confidence["score"] = 30.0
    profile.communication_ability["score"] = 40.0 # Low English ability
    action = {"type": "answer_submit"}
    
    res3 = brain.analyze_action(profile, session_state, action)
    print("Test 3 (Overwhelm -> Motivate):", res3["decision"], "->", res3["message"])
    assert res3["decision"] == "motivate_simplify"
    assert "Hinglish" in res3["message"]

if __name__ == "__main__":
    test_brain()
    print("\nAll tests passed successfully!")
