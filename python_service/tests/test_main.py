import pytest
import os
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient
from main import app, get_session_history, langchain_extract_and_reply


@pytest.fixture
def client():
    """Create test client"""
    return TestClient(app)


@pytest.fixture
def mock_openai_key():
    """Mock OpenAI API key"""
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "USE_LLM": "true"}):
        yield


class TestHealthEndpoints:
    def test_health_endpoint(self, client):
        """Test health endpoint"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "python_service"


class TestChatSimulation:
    def test_simulate_basic_message(self, client):
        """Test basic message simulation"""
        payload = {
            "message": "Hello",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        response = client.post("/simulate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "reply" in data
        assert "intent" in data

    def test_simulate_appointment_request_fallback(self, client):
        """Test appointment request with fallback parser"""
        payload = {
            "message": "I want an appointment next Monday at 10am",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        response = client.post("/simulate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "reply" in data
        assert "appointment_candidate" in data

    def test_confirm_appointment(self, client):
        """Test appointment confirmation"""
        # First make a proposal
        payload = {
            "message": "I want an appointment next Monday at 10am",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        client.post("/simulate", json=payload)
        
        # Then confirm
        confirm_payload = {
            "message": "yes",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        response = client.post("/simulate", json=confirm_payload)
        assert response.status_code == 200
        data = response.json()
        assert data["intent"] == "confirm"

    def test_decline_appointment(self, client):
        """Test appointment decline"""
        # First make a proposal
        payload = {
            "message": "I want an appointment next Monday at 10am",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        client.post("/simulate", json=payload)
        
        # Then decline
        decline_payload = {
            "message": "no",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        response = client.post("/simulate", json=decline_payload)
        assert response.status_code == 200
        data = response.json()
        assert data["intent"] == "decline"


class TestLangChainIntegration:
    @patch('main.ChatOpenAI')
    def test_langchain_chatbot_creation(self, mock_llm, mock_openai_key):
        """Test LangChain chatbot creation"""
        from main import create_langchain_chatbot
        
        # Mock the LLM
        mock_llm_instance = Mock()
        mock_llm.return_value = mock_llm_instance
        
        chain, parser = create_langchain_chatbot()
        assert chain is not None
        assert parser is not None

    @patch('main.create_langchain_chatbot')
    def test_langchain_extract_and_reply(self, mock_create_chatbot, mock_openai_key):
        """Test LangChain extraction function"""
        # Mock the chain
        mock_chain = Mock()
        mock_parser = Mock()
        mock_create_chatbot.return_value = (mock_chain, mock_parser)
        
        # Mock the response
        mock_chain.invoke.return_value = {
            "reply": "I can book you for Monday at 10am",
            "appointment_candidate": "2025-10-07T10:00:00",
            "intent": "propose",
            "needs_confirmation": True,
            "confidence": 0.9
        }
        
        result = langchain_extract_and_reply("book appointment Monday 10am", "test_session")
        
        assert result["reply"] == "I can book you for Monday at 10am"
        assert result["appointment_candidate"] == "2025-10-07T10:00:00"
        assert result["intent"] == "propose"


class TestSessionHistory:
    def test_get_session_history(self):
        """Test session history management"""
        session_id = "test_session"
        history = get_session_history(session_id)
        assert history is not None
        
        # Get same session again
        history2 = get_session_history(session_id)
        assert history is history2  # Should be same instance


class TestUtilityFunctions:
    def test_has_token(self):
        """Test token matching function"""
        from main import has_token
        
        vocab = {"book", "appointment", "schedule"}
        assert has_token("I want to book", vocab)
        assert has_token("schedule meeting", vocab)
        assert not has_token("I want to look", vocab)

    def test_equals_any_trimmed(self):
        """Test trimmed equality function"""
        from main import equals_any_trimmed
        
        vals = {"yes", "no", "maybe"}
        assert equals_any_trimmed(" yes ", vals)
        assert equals_any_trimmed("no", vals)
        assert not equals_any_trimmed("okay", vals)


if __name__ == "__main__":
    pytest.main([__file__])