from fastapi.testclient import TestClient
from api_server import app

client = TestClient(app)

def test_api():
    print("=== Testing FastAPI Integration ===\n")
    
    # 1. Test Health
    resp = client.get("/health")
    print(f"Health Check: {resp.json()}")
    assert resp.status_code == 200
    
    # 2. Test Registration
    resp = client.post("/api/students/register", json={"student_id": "API_STU_1", "grade": 8})
    print(f"Register: {resp.json()}")
    assert resp.status_code == 200
    
    # 3. Test Start Topic
    resp = client.post("/api/topics/start", json={"student_id": "API_STU_1", "topic_id": "fraction"})
    print(f"Start Topic: {resp.json()['data']['loop_stage']}")
    assert resp.status_code == 200
    
    # 4. Test Event Processing
    event_payload = {
        "student_id": "API_STU_1",
        "action": {"type": "continue"}
    }
    resp = client.post("/api/events/process", json=event_payload)
    print(f"Process Event: new stage is {resp.json()['data']['new_stage']}")
    assert resp.status_code == 200

    print("\nFastAPI Integration Tests Passed Successfully!")

if __name__ == "__main__":
    test_api()
