from content_rendering_engine import ContentRenderingEngine
import json

def test_cre():
    cre = ContentRenderingEngine()
    print("=== Testing Content Rendering Engine ===\n")
    
    # 1. Test Biology / Spatial
    bio_content = {
        "topic_id": "cell_biology",
        "text": "Let's look at the anatomy of a cell and the parts of the mitochondria inside it."
    }
    bio_schema = cre.generate_ui_schema(bio_content, learning_stage="DISCOVER")
    print("--- Bio Test (Spatial) ---")
    print(f"Intent: {bio_schema['detected_intent']} -> Component: {bio_schema['render_instruction']['component']}")
    assert bio_schema['detected_intent'] == "spatial"
    assert bio_schema['render_instruction']['format'] == "diagram"
    
    # 2. Test Physics / Kinematic
    phys_content = {
        "topic_id": "projectile_motion",
        "text": "What happens when we increase the launch angle against gravity? The velocity changes."
    }
    phys_schema = cre.generate_ui_schema(phys_content, learning_stage="DISCOVER")
    print("\n--- Physics Test (Kinematic) ---")
    print(f"Intent: {phys_schema['detected_intent']} -> Component: {phys_schema['render_instruction']['component']}")
    assert phys_schema['detected_intent'] == "kinematic"
    assert phys_schema['render_instruction']['format'] == "simulation"
    
    # 3. Test Math / Procedural (with EXPLORE stage override)
    math_content = {
        "topic_id": "quadratic_equation",
        "text": "First we calculate the discriminant, next we solve for x."
    }
    math_schema_discover = cre.generate_ui_schema(math_content, learning_stage="DISCOVER")
    print("\n--- Math Test (Procedural in DISCOVER) ---")
    print(f"Intent: {math_schema_discover['detected_intent']} -> Component: {math_schema_discover['render_instruction']['component']}")
    assert math_schema_discover['detected_intent'] == "procedural"
    assert math_schema_discover['render_instruction']['format'] == "stepped_text"
    
    # Test Stage Biasing (EXPLORE)
    math_schema_explore = cre.generate_ui_schema(math_content, learning_stage="EXPLORE")
    print("\n--- Math Test (Procedural in EXPLORE) ---")
    print(f"Intent: {math_schema_explore['detected_intent']} -> Component: {math_schema_explore['render_instruction']['component']}")
    assert math_schema_explore['render_instruction']['format'] == "experiment"
    
    # Test Stage Biasing (PRACTICE)
    math_schema_practice = cre.generate_ui_schema(math_content, learning_stage="PRACTICE")
    print("\n--- Math Test (Procedural in PRACTICE) ---")
    print(f"Intent: {math_schema_practice['detected_intent']} -> Component: {math_schema_practice['render_instruction']['component']}")
    assert math_schema_practice['render_instruction']['format'] == "quiz"
    
    print("\nAll CRE tests passed successfully!")

if __name__ == "__main__":
    test_cre()
