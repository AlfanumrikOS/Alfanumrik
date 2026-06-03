from mastery_framework import MasteryEvaluator

def test_mastery():
    evaluator = MasteryEvaluator()
    student = "STU_MASTER_1"
    topic = "algebra"
    
    print("=== Testing Mastery Framework ===\n")
    
    # 1. Test Initial Level 1 -> Level 2
    print("--- Test: Progression to Level 2 (Explorer) ---")
    metrics1 = {"knowledge": 70.0, "problem_solving": 60.0}
    level = evaluator.update_metrics(student, topic, metrics1)
    print(f"Current Level: {level}")
    assert level == 2
    
    # 2. Test Level 2 -> Level 3 (Practitioner)
    print("\n--- Test: Progression to Level 3 (Practitioner) ---")
    metrics2 = {"knowledge": 90.0, "application": 85.0, "problem_solving": 85.0}
    level = evaluator.update_metrics(student, topic, metrics2)
    print(f"Current Level: {level}")
    assert level == 3
    
    # 3. Test The Progression Rule Hard Lock (Trying to reach L4 without teaching ability)
    print("\n--- Test: Progression Hard Lock (L3 -> L4) ---")
    # Even with 100 knowledge and 100 retention, if teaching ability is low, they stay L3
    metrics3_blocked = {"knowledge": 100.0, "retention_7d": 100.0, "teaching_ability": 50.0, "creativity": 90.0}
    level = evaluator.update_metrics(student, topic, metrics3_blocked)
    print(f"Metrics: 100% Knowledge, but low teaching ability.")
    print(f"Current Level: {level}")
    assert level == 3
    
    # Now unlock Level 4
    metrics3_unlocked = {"teaching_ability": 85.0}
    level = evaluator.update_metrics(student, topic, metrics3_unlocked)
    print(f"Metrics: Teaching ability improved.")
    print(f"Current Level: {level}")
    assert level == 4
    
    # 4. Test Level 4 -> Level 5 (Mentor)
    print("\n--- Test: Progression to Level 5 (Mentor) ---")
    metrics4 = {"retention_30d": 95.0, "teaching_ability": 95.0}
    level = evaluator.update_metrics(student, topic, metrics4)
    print(f"Current Level: {level}")
    assert level == 5
    print(f"AI Action: {evaluator.get_action_recommendation(level)}")
    
    # 5. Test The Decay Rule (Failing 60d retention)
    print("\n--- Test: The Decay Rule (Demotion to L3) ---")
    metrics5 = {"retention_60d": 60.0} # They failed the 60d check
    level = evaluator.update_metrics(student, topic, metrics5)
    print(f"Metrics: Failed 60-day retention check (60.0%).")
    print(f"Current Level: {level}")
    assert level == 3

    print("\nAll Mastery Framework tests passed successfully!")

if __name__ == "__main__":
    test_mastery()
