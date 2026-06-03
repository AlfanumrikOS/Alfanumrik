from dopamine_framework import DopamineEngine
import random

def test_dopamine_engine():
    engine = DopamineEngine()
    student = "STU_DOPA_1"
    
    print("=== Testing Dopamine Framework ===\n")

    # 1. Test Micro Win (Grit)
    print("--- Test: Micro Win (Grit) ---")
    engine.process_event(student, {"type": "question_answered", "payload": {"correct": False, "time_taken": 30}})
    engine.process_event(student, {"type": "question_answered", "payload": {"correct": False, "time_taken": 40}})
    triggers1 = engine.process_event(student, {"type": "question_answered", "payload": {"correct": True, "time_taken": 10}})
    print("Triggers:", triggers1)
    assert any(t["type"] == "micro_win" for t in triggers1)

    # 2. Test Flame of Focus (Consistency)
    print("\n--- Test: Flame of Focus ---")
    engine.process_event(student, {"type": "deep_work_session", "payload": {"minutes": 30}})
    engine.process_event(student, {"type": "deep_work_session", "payload": {"minutes": 45}})
    triggers2 = engine.process_event(student, {"type": "deep_work_session", "payload": {"minutes": 25}})
    print("Triggers:", triggers2)
    assert any(t["type"] == "streak_update" for t in triggers2)

    # 3. Test Discovery Reward
    print("\n--- Test: Discovery Reward ---")
    engine.process_event(student, {"type": "lateral_exploration"})
    engine.process_event(student, {"type": "unstructured_question"})
    triggers3 = engine.process_event(student, {"type": "lateral_exploration"})
    print("Triggers:", triggers3)
    assert any(t["type"] == "discovery_reward" for t in triggers3)

    # 4. Test Secret Boss Challenge
    print("\n--- Test: Secret Boss Challenge ---")
    # Force random to trigger
    random.seed(42) # Should make random predictable, let's just loop until we get it for the test
    boss_triggered = False
    for i in range(20):
        triggers4 = engine.process_event(student, {"type": "flow_zone_check"}, dna_profile={"mastery": 95, "confidence": 95})
        if any(t["type"] == "secret_challenge" for t in triggers4):
            boss_triggered = True
            print(f"Secret boss triggered on attempt {i+1}!")
            print("Triggers:", triggers4)
            break
    assert boss_triggered

    print("\nAll dopamine logic tests passed!")

if __name__ == "__main__":
    test_dopamine_engine()
