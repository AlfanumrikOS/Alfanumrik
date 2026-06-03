from learning_loop import LearningLoopController, LearningStage

def test_learning_loop():
    controller = LearningLoopController()
    student_id = "STU_LOOP_1"
    topic_id = "trigonometry"
    
    print("=== Testing Foxy Learning Loop State Machine ===\n")
    
    # 1. Start Loop
    print("--- Starting Loop ---")
    initial_ui = controller.start_loop(student_id, topic_id)
    assert controller.active_sessions[student_id]["current_stage"] == LearningStage.HOOK
    print("Initial Stage:", LearningStage.HOOK.name)
    print("UI Instruction:", initial_ui["ui"])
    
    # 2. Advance through simple stages
    print("\n--- Advancing through simple stages ---")
    for _ in range(2): # Advance through HOOK and EXPLORE
        new_stage, ui = controller.process_student_action(student_id, {"type": "continue"})
        print(f"Advanced to: {new_stage.name} -> UI: {ui['ui']}")
        
    assert controller.active_sessions[student_id]["current_stage"] == LearningStage.DISCOVER
    
    # Advance DISCOVER to PRACTICE
    new_stage, ui = controller.process_student_action(student_id, {"type": "continue"})
    assert new_stage == LearningStage.PRACTICE
    
    # 3. Test PRACTICE gating (Must score >= 80)
    print("\n--- Testing PRACTICE Gate ---")
    new_stage, ui = controller.process_student_action(student_id, {"type": "quiz_submit", "payload": {"accuracy": 60.0}})
    print(f"Scored 60.0. Stage is now: {new_stage.name}")
    assert new_stage == LearningStage.PRACTICE # Should remain in practice
    
    new_stage, ui = controller.process_student_action(student_id, {"type": "quiz_submit", "payload": {"accuracy": 85.0}})
    print(f"Scored 85.0. Stage is now: {new_stage.name}")
    assert new_stage == LearningStage.APPLY # Should advance
    
    # 4. Advance APPLY to TEACH
    new_stage, ui = controller.process_student_action(student_id, {"type": "quest_complete"})
    assert new_stage == LearningStage.TEACH
    
    # 5. Test TEACH gating (Must have NLP clarity > 60)
    print("\n--- Testing TEACH Gate ---")
    new_stage, ui = controller.process_student_action(student_id, {"type": "voice_submit", "payload": {"nlp_clarity": 40.0}})
    print(f"Clarity 40.0. Stage is now: {new_stage.name}")
    assert new_stage == LearningStage.TEACH # Should remain in teach
    
    new_stage, ui = controller.process_student_action(student_id, {"type": "voice_submit", "payload": {"nlp_clarity": 75.0}})
    print(f"Clarity 75.0. Stage is now: {new_stage.name}")
    assert new_stage == LearningStage.REFLECT # Should advance
    
    # 6. Finish Loop
    new_stage, ui = controller.process_student_action(student_id, {"type": "journal_submit"})
    assert new_stage == LearningStage.MASTER
    print("\n--- Final Stage Reached ---")
    print(f"Stage: {new_stage.name}, UI: {ui['description']}")
    
    print("\nAll learning loop state machine tests passed successfully!")

if __name__ == "__main__":
    test_learning_loop()
