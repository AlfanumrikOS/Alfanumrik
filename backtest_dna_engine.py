from student_dna_engine import StudentIntelligenceEngine

def run_backtest():
    engine = StudentIntelligenceEngine()
    print("=== Running Learner DNA Backtest ===")

    # Persona 1: Anxious Overachiever
    # High Problem Solving, Low Emotional Confidence
    print("\n--- Testing Persona 1: Anxious Overachiever ---")
    stu1 = "STU_ANXIOUS_1"
    for _ in range(15):
        # Solves hard questions well
        engine.process_interaction(stu1, {
            "type": "quiz_attempt", 
            "payload": {"difficulty": "hard", "accuracy": 1.0, "hints_used": 0, "subject": "Mathematics"}
        })
        # But retries very quickly (panic guess) when they fail or hesitate
        engine.process_interaction(stu1, {
            "type": "quiz_retry",
            "payload": {"time_before_retry": 2}
        })
    
    rules1 = engine.get_adaptation_rules(stu1)
    print(f"Final Scores -> Problem Solving: {engine.profiles[stu1].problem_solving['score']}, Emotional Confidence: {engine.profiles[stu1].emotional_confidence['score']}")
    print(f"Triggered Rules: {rules1}")
    if any("Anxious Overachiever" in r for r in rules1):
        print("✅ PASS: Correctly identified Anxious Overachiever")
    else:
        print("❌ FAIL: Did not identify Anxious Overachiever")


    # Persona 2: TikTok Scroller
    # Low Attention Span, Highly Visual
    print("\n--- Testing Persona 2: TikTok Scroller ---")
    stu2 = "STU_TIKTOK_2"
    for _ in range(15):
        # Short attention
        engine.process_interaction(stu2, {
            "type": "video_watch",
            "payload": {"uninterrupted_minutes": 2, "distraction_events": 4, "completion_rate": 0.3}
        })
    rules2 = engine.get_adaptation_rules(stu2)
    print(f"Final Scores -> Attention Span: {engine.profiles[stu2].attention_span['score']}, Visual Style: {engine.profiles[stu2].learning_style['visual']}")
    print(f"Triggered Rules: {rules2}")
    if any("TikTok Scroller" in r for r in rules2):
        print("✅ PASS: Correctly identified TikTok Scroller")
    else:
        print("❌ FAIL: Did not identify TikTok Scroller")


    # Persona 3: Bored Genius
    # High Curiosity, Fast Learning
    print("\n--- Testing Persona 3: Bored Genius ---")
    stu3 = "STU_GENIUS_3"
    for _ in range(15):
        # Very fast learning
        engine.process_interaction(stu3, {
            "type": "video_watch", 
            "payload": {"time_spent_seconds": 150, "cohort_average_seconds": 450} # Very fast
        })
        # High curiosity
        engine.process_interaction(stu3, {
            "type": "unstructured_question",
            "payload": {"query": "But why does that work?"}
        })
    rules3 = engine.get_adaptation_rules(stu3)
    print(f"Final Scores -> Learning Speed: {engine.profiles[stu3].learning_speed['score']}, Curiosity: {engine.profiles[stu3].curiosity_index['score']}")
    print(f"Triggered Rules: {rules3}")
    if any("Bored Genius" in r for r in rules3):
        print("✅ PASS: Correctly identified Bored Genius")
    else:
        print("❌ FAIL: Did not identify Bored Genius")


if __name__ == "__main__":
    run_backtest()
