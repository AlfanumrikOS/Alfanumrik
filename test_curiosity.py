import json
from curiosity_engine import CuriosityEngine

def test_curiosity_engine():
    engine = CuriosityEngine()
    print("=== Testing Curiosity Engine ===\n")
    
    # 1. Test Known Topic (Trigonometry)
    print("--- Test: Trigonometry (Known Topic) ---")
    json_output_trig = engine.get_ui_json("trigonometry")
    data_trig = json.loads(json_output_trig)
    
    assert "engine" in data_trig
    assert data_trig["engine"] == "real_world"
    
    pipeline = data_trig["pipeline"]
    assert "hook" in pipeline
    assert "curiosity_gap" in pipeline
    assert "discovery_journey" in pipeline
    assert "knowledge_reveal" in pipeline
    assert "reflection" in pipeline
    
    print("Output verified. Hook:", pipeline["hook"])
    
    # 2. Test Known Topic (Inflation)
    print("\n--- Test: Inflation (Known Topic) ---")
    json_output_inf = engine.get_ui_json("inflation")
    data_inf = json.loads(json_output_inf)
    
    assert data_inf["engine"] == "future_prediction"
    assert "Are movies getting" in data_inf["pipeline"]["curiosity_gap"]
    print("Output verified. Engine:", data_inf["engine"])

    # 3. Test Unknown Topic (Fallback/LLM simulation)
    print("\n--- Test: Unknown Topic (Fallback) ---")
    json_output_unknown = engine.get_ui_json("Quantum Computing")
    data_unknown = json.loads(json_output_unknown)
    
    assert data_unknown["engine"] in engine.ENGINES
    assert "quantum_computing" in data_unknown["pipeline"]["hook"]
    print("Output verified for unknown topic. Engine:", data_unknown["engine"])

    print("\nAll curiosity engine tests passed successfully!")

if __name__ == "__main__":
    test_curiosity_engine()
