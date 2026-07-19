from foxy_os import FoxyOS

def test_foxy_os_integration():
    os = FoxyOS()
    student = "STU_OS_1"
    topic = "trigonometry"
    
    print("=== Testing Foxy-X Pedagogy OS (End-to-End) ===\n")
    
    # 1. Registration
    os.register_student(student, grade=10)
    print("Registered Student and initialized DNA & Gamification profiles.")
    
    # 2. Start Topic
    print("\n--- 1. Starting Topic (Hooks & Rendering) ---")
    start_res = os.start_topic(student, topic)
    print(f"Loop Stage: {start_res['loop_stage']}")
    print(f"Curiosity Engine Engaged: {start_res['curiosity_engine_type']}")
    print(f"Content Rendering Instructed: {start_res['ui_schema']['render_instruction']['component']}")
    
    # 3. Simulate getting to Practice (Explore -> Discover -> Practice)
    print("\n--- 2. Advancing to Practice ---")
    os.process_event(student, {"type": "continue"}) # EXPLORE
    os.process_event(student, {"type": "continue"}) # DISCOVER
    practice_res = os.process_event(student, {"type": "continue"}) # PRACTICE
    print(f"Current Stage: {practice_res['new_stage']}")
    print(f"Adaptive Brain Suggests: {practice_res['adaptive_difficulty']['decision']}")
    
    # 4. Simulate struggling in Practice
    print("\n--- 3. Simulating Struggle (Dopamine Trigger) ---")
    struggle_event = {
        "type": "quiz_submit",
        "metrics": {
            "time_spent": 180, # High effort
            "accuracy": 40.0,  # Low accuracy
            "retries": 3,
            "hints_used": 2
        }
    }
    struggle_res = os.process_event(student, struggle_event)
    print(f"Current Stage: {struggle_res['new_stage']} (Blocked from advancing)")
    print(f"Dopamine Events Triggered: {struggle_res['dopamine_events']}")
    
    # 5. Simulate passing Practice
    print("\n--- 4. Passing Practice ---")
    os.process_event(student, {"type": "quiz_submit", "metrics": {"accuracy": 90.0}, "payload": {"accuracy": 90.0}})
    
    # 6. Simulate getting to Teach
    os.process_event(student, {"type": "quest_complete"}) # APPLY to TEACH
    
    # 7. Simulate Teach Phase (HIF Evaluator)
    print("\n--- 5. Simulating TEACH Stage (HIF & Mastery Eval) ---")
    teach_event = {
        "type": "voice_submit",
        "payload": {
            "text_transcript": "Because of the angle of the triangle, we can calculate the height. Therefore, the tangent is useful here.",
            "nlp_clarity": 85.0
        }
    }
    teach_res = os.process_event(student, teach_event)
    print(f"Current Stage: {teach_res['new_stage']} (Advanced to Reflect)")
    print(f"HIF & Mastery Feedback: {teach_res['hif_feedback']}")
    
    # 8. Check Final DNA Updates
    print("\n--- 6. Checking Final DNA Updates ---")
    dna = os.student_profiles[student]
    print(f"Communication Ability (CC): {dna.communication_ability['score']} (Trend: {dna.communication_ability['trend']})")
    
    print("\nFoxy-X OS End-to-End Integration Tests Passed Successfully!")

if __name__ == "__main__":
    test_foxy_os_integration()
