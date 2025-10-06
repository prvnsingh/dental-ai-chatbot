import re
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import json as _json
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import os
from dotenv import load_dotenv

# LangChain imports
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.pydantic_v1 import BaseModel as LangChainBaseModel
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

load_dotenv()  # loads python_service/.env

USE_LLM = os.getenv("USE_LLM", "false").lower() == "true"

app = FastAPI(title="Dental AI Chatbot - LangChain Service", version="0.3.0")

class ChatRequest(BaseModel):
    message: str
    user_id: Optional[str] = None
    session_id: Optional[str] = None

class AppointmentResponse(LangChainBaseModel):
    """Response structure for appointment booking"""
    reply: str = Field(description="Natural language response to the user")
    intent: str = Field(description="Detected intent: chat, propose, confirm, decline")
    appointment_candidate: Optional[str] = Field(description="ISO8601 datetime if appointment time detected")
    needs_confirmation: bool = Field(description="Whether the appointment needs user confirmation")
    confidence: float = Field(description="Confidence score for the extracted information")

# In-memory session storage (demo only - use Redis/DB in production)
CONVERSATION_HISTORY: Dict[str, ChatMessageHistory] = {}
LAST_PROPOSAL: Dict[str, str] = {}

AFFIRM = {'yes', 'yeah', 'yep', 'confirm', 'sure', 'ok', 'okay', 'please book', 'book it'}
NEGATE = {'no', 'nope', 'cancel', "don't", 'do not', 'not now', 'later'}
SHORT_YES = {'y'}
SHORT_NO  = {'n'}

def has_token(text: str, vocab: set[str]) -> bool:
    """
    True if any vocab item appears as a whole token/phrase.
    Handles multi-word phrases like 'please book'.
    """
    for phrase in vocab:
        if re.search(rf"\b{re.escape(phrase)}\b", text):
            return True
    return False

def equals_any_trimmed(text: str, vals: set[str]) -> bool:
    t = text.strip()
    return t in vals

def get_session_history(session_id: str) -> ChatMessageHistory:
    """Get or create conversation history for a session"""
    if session_id not in CONVERSATION_HISTORY:
        CONVERSATION_HISTORY[session_id] = ChatMessageHistory()
    return CONVERSATION_HISTORY[session_id]


def create_langchain_chatbot():
    """Create LangChain chatbot with memory and structured output"""
    try:
        # Initialize the LLM
        llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0.2,
            openai_api_key=os.getenv("OPENAI_API_KEY")
        )

        # Create output parser
        parser = JsonOutputParser(pydantic_object=AppointmentResponse)

        # Create the prompt template
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content="""You are a helpful dental clinic assistant specializing in appointment scheduling.

Your role:
- Help users book dental appointments
- Extract appointment times from natural language
- Provide helpful, professional responses
- Always respond in the specified JSON format

Guidelines:
- If a user requests an appointment, try to extract or suggest a specific date/time
- Convert relative times (like "next Monday at 2pm") to ISO8601 format
- If the time is unclear, ask for clarification
- Be friendly but professional
- Keep responses concise

Current date/time context: {current_datetime}

{format_instructions}"""),
            MessagesPlaceholder(variable_name="history"),
            HumanMessage(content="{input}")
        ])

        # Create the chain
        chain = prompt | llm | parser

        # Add message history
        chain_with_history = RunnableWithMessageHistory(
            chain,
            get_session_history,
            input_messages_key="input",
            history_messages_key="history",
        )

        return chain_with_history, parser

    except Exception as e:
        print(f"Failed to create LangChain chatbot: {e}")
        return None, None

def langchain_extract_and_reply(user_text: str, session_id: str) -> Dict[str, Any]:
    """
    Use LangChain for structured appointment extraction and response generation
    """
    try:
        chain, parser = create_langchain_chatbot()
        if not chain:
            return {"reply": None, "appointment_candidate": None}

        # Prepare the input
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Invoke the chain with session history
        response = chain.invoke(
            {
                "input": user_text,
                "current_datetime": current_time,
                "format_instructions": parser.get_format_instructions()
            },
            config={"configurable": {"session_id": session_id}}
        )

        print("LangChain response:", response)
        
        return {
            "reply": response.get("reply"),
            "appointment_candidate": response.get("appointment_candidate"),
            "intent": response.get("intent", "chat"),
            "needs_confirmation": response.get("needs_confirmation", False),
            "confidence": response.get("confidence", 0.8)
        }

    except Exception as e:
        print("LangChain error:", repr(e))
        import traceback
        traceback.print_exc()
        return {"reply": None, "appointment_candidate": None}

def naive_extract_datetime(text: str) -> Optional[str]:
    text = text.lower()
    weekday_map = {
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6
    }
    time_match = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', text)
    day_match = None
    for wd in weekday_map:
        if wd in text:
            day_match = wd
            break

    date_str = None
    if day_match:
        target_wd = weekday_map[day_match]
        today_wd = datetime.now().weekday()
        delta = (target_wd - today_wd) % 7
        if delta == 0:
            delta = 7
        target_date = datetime.now() + timedelta(days=delta)
        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2) or 0)
            ampm = time_match.group(3)
            if ampm == 'pm' and hour < 12:
                hour += 12
            if ampm == 'am' and hour == 12:
                hour = 0
            target_date = target_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
        date_str = target_date.isoformat()

    return date_str

@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'python_service', 'use_llm': USE_LLM}

@app.post('/simulate')
def simulate(req: ChatRequest) -> Dict[str, Any]:
    msg = (req.message or '').strip()
    low = msg.lower()
    sid = req.session_id or 'anon'

    # Confirming an existing proposal
    if sid in LAST_PROPOSAL and (
            equals_any_trimmed(low, SHORT_YES) or has_token(low, AFFIRM)
    ):
        dt = LAST_PROPOSAL[sid]
        return {
            'user_id': req.user_id or 'anonymous',
            'input': req.message,
            'reply': f'Confirming your appointment for {dt}.',
            'appointment_candidate': dt,
            'intent': 'confirm',
            'needs_confirmation': False
        }

    # Declining
    if sid in LAST_PROPOSAL and (
            equals_any_trimmed(low, SHORT_NO) or has_token(low, NEGATE)
    ):
        LAST_PROPOSAL.pop(sid, None)
        return {
            'user_id': req.user_id or 'anonymous',
            'input': req.message,
            'reply': 'Okay, I will not book that time. When works better?',
            'appointment_candidate': None,
            'intent': 'decline',
            'needs_confirmation': False
        }
    print("USE_LLM:", USE_LLM, "HAS_KEY:", bool(os.getenv("OPENAI_API_KEY")))

    # Use LangChain path (if enabled and key provided)
    if USE_LLM and os.getenv("OPENAI_API_KEY"):
        print("Using LangChain for:", msg)
        llm_out = langchain_extract_and_reply(msg, sid)
        if llm_out.get("reply") or llm_out.get("appointment_candidate"):
            cand = llm_out.get("appointment_candidate")
            intent = llm_out.get("intent", "chat")
            
            if cand and intent == "propose":
                LAST_PROPOSAL[sid] = cand
                return {
                    'user_id': req.user_id or 'anonymous',
                    'input': req.message,
                    'reply': f'{llm_out["reply"]} Shall I confirm?',
                    'appointment_candidate': cand,
                    'intent': 'propose',
                    'needs_confirmation': True,
                    'confidence': llm_out.get('confidence', 0.8)
                }
            else:
                return {
                    'user_id': req.user_id or 'anonymous',
                    'input': req.message,
                    'reply': llm_out['reply'],
                    'appointment_candidate': cand,
                    'intent': intent,
                    'needs_confirmation': llm_out.get('needs_confirmation', False),
                    'confidence': llm_out.get('confidence', 0.8)
                }

    # Propose a new time if we can parse it
    appt_time = naive_extract_datetime(msg)
    if appt_time:
        LAST_PROPOSAL[sid] = appt_time
        return {
            'user_id': req.user_id or 'anonymous',
            'input': req.message,
            'reply': f'Great! I can tentatively book you for {appt_time}. Shall I confirm?',
            'appointment_candidate': appt_time,
            'intent': 'propose',
            'needs_confirmation': True
        }

    # Fallback
    return {
        'user_id': req.user_id or 'anonymous',
        'input': req.message,
        'reply': "I can help you book an appointment. When would you like to come in?",
        'appointment_candidate': None,
        'intent': 'chat',
        'needs_confirmation': False
    }
