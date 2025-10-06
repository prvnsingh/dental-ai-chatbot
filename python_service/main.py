"""
Dental AI Chatbot - Python Microservice

A FastAPI-based service that provides intelligent conversational AI for dental appointment scheduling.

Key Features:
- LangChain integration for advanced natural language understanding
- Structured output parsing for appointment extraction
- Conversation memory management
- Dual-mode operation (LLM + naive fallback)
- Real-time appointment time parsing from natural language

Architecture:
- FastAPI web framework for REST API endpoints
- LangChain for LLM orchestration and conversation management
- Pydantic for data validation and structured output
- OpenAI GPT models for natural language processing

@version 1.0.0
@author Dental AI Team
@requires Python 3.8+, OpenAI API key (optional)
"""

# ================================
# Standard Library Imports
# ================================
import re
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Set

# ================================
# Third-Party Framework Imports
# ================================
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# ================================
# LangChain Framework Imports
# ================================
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.pydantic_v1 import BaseModel as LangChainBaseModel
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

# Load environment variables from .env file
load_dotenv()

# ================================
# Configuration & Settings
# ================================

# Toggle between LLM-powered and naive parsing modes
USE_LLM = os.getenv("USE_LLM", "false").lower() == "true"

# OpenAI API configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ================================
# FastAPI Application Setup
# ================================

app = FastAPI(
    title="Dental AI Chatbot - LangChain Service",
    version="1.0.0",
    description="Intelligent appointment scheduling service powered by LangChain and OpenAI",
    docs_url="/docs",
    redoc_url="/redoc"
)

# ================================
# Pydantic Data Models
# ================================

class ChatRequest(BaseModel):
    """
    Incoming chat message request model
    
    Attributes:
        message: The user's input message
        user_id: Optional user identifier for session management
        session_id: Optional session identifier for conversation continuity
    """
    message: str = Field(..., min_length=1, max_length=1000, description="User's chat message")
    user_id: Optional[str] = Field(None, description="User identifier")
    session_id: Optional[str] = Field(None, description="Session identifier for conversation continuity")

class AppointmentResponse(LangChainBaseModel):
    """
    Structured response model for LangChain output parsing
    
    This model defines the expected structure for AI responses,
    enabling consistent appointment extraction and intent classification.
    """
    reply: str = Field(
        description="Natural language response to display to the user"
    )
    intent: str = Field(
        description="Detected user intent: 'chat', 'propose', 'confirm', or 'decline'"
    )
    appointment_candidate: Optional[str] = Field(
        None,
        description="ISO8601 formatted datetime string if appointment time was extracted"
    )
    needs_confirmation: bool = Field(
        False,
        description="Whether the proposed appointment requires explicit user confirmation"
    )
    confidence: float = Field(
        0.8,
        ge=0.0,
        le=1.0,
        description="Confidence score for the extracted information (0.0 to 1.0)"
    )

# ================================
# Global State Management
# ================================

# In-memory conversation storage
# NOTE: In production, replace with Redis or database for persistence and scalability
CONVERSATION_HISTORY: Dict[str, ChatMessageHistory] = {}

# Track last appointment proposal per session for confirmation workflow
LAST_PROPOSAL: Dict[str, str] = {}

# ================================
# Natural Language Processing Constants
# ================================

# Affirmative response patterns for appointment confirmation
AFFIRMATIVE_PATTERNS: Set[str] = {
    'yes', 'yeah', 'yep', 'confirm', 'sure', 'ok', 'okay', 
    'please book', 'book it', 'sounds good', 'that works',
    'perfect', 'great', 'good'
}

# Negative response patterns for appointment rejection
NEGATIVE_PATTERNS: Set[str] = {
    'no', 'nope', 'cancel', "don't", 'do not', 'not now', 
    'later', 'different time', 'another time', 'not available'
}

# Single character shortcuts for quick responses
SHORT_AFFIRMATIVE: Set[str] = {'y'}
SHORT_NEGATIVE: Set[str] = {'n'}

# ================================
# Natural Language Processing Utilities
# ================================

def has_token(text: str, vocabulary: Set[str]) -> bool:
    """
    Check if any phrase from the vocabulary appears as complete words/phrases in the text.
    
    Uses word boundaries to ensure accurate matching and handles multi-word phrases.
    For example, 'please book' will match in 'please book me' but not in 'pleasebook'.
    
    Args:
        text: Input text to search in (case-insensitive)
        vocabulary: Set of phrases/words to search for
        
    Returns:
        True if any vocabulary item is found as a complete token/phrase
    """
    text_lower = text.lower()
    
    for phrase in vocabulary:
        # Use word boundaries for accurate matching
        pattern = rf"\b{re.escape(phrase.lower())}\b"
        if re.search(pattern, text_lower):
            return True
    
    return False

def equals_any_trimmed(text: str, values: Set[str]) -> bool:
    """
    Check if the trimmed text exactly matches any value in the set.
    
    Useful for single-character responses like 'y' or 'n'.
    
    Args:
        text: Input text to check
        values: Set of exact values to match against
        
    Returns:
        True if trimmed text matches any value (case-insensitive)
    """
    normalized_text = text.strip().lower()
    normalized_values = {val.lower() for val in values}
    return normalized_text in normalized_values

# ================================
# Session Management Functions
# ================================

def get_session_history(session_id: str) -> ChatMessageHistory:
    """
    Get or create conversation history for a specific session.
    
    Maintains conversation context across multiple requests within the same session.
    In production, this should be backed by a persistent store like Redis or database.
    
    Args:
        session_id: Unique session identifier
        
    Returns:
        ChatMessageHistory object for the session
    """
    if not session_id:
        session_id = "default"
    
    if session_id not in CONVERSATION_HISTORY:
        CONVERSATION_HISTORY[session_id] = ChatMessageHistory()
        print(f"Created new conversation history for session: {session_id}")
    
    return CONVERSATION_HISTORY[session_id]


# ================================
# LangChain Integration Functions
# ================================

def create_langchain_chatbot():
    """
    Initialize LangChain chatbot with OpenAI LLM, structured output parsing, and conversation memory.
    
    Creates a complete conversational AI pipeline that:
    - Maintains conversation context across messages
    - Extracts appointment information in structured format
    - Handles natural language date/time parsing
    - Provides consistent, professional responses
    
    Returns:
        tuple: (chain_with_history, parser) or (None, None) if initialization fails
    """
    try:
        # Validate OpenAI API key
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("Warning: OpenAI API key not found. LLM features will be disabled.")
            return None, None

        # Initialize the Language Model with optimal settings for conversation
        llm = ChatOpenAI(
            model=OPENAI_MODEL,
            temperature=0.2,  # Low temperature for consistent, focused responses
            openai_api_key=api_key,
            max_tokens=500,   # Limit response length for efficiency
            request_timeout=30  # 30 second timeout for API calls
        )

        # Create structured output parser using our Pydantic model
        parser = JsonOutputParser(pydantic_object=AppointmentResponse)

        # Define the system prompt with clear instructions and context
        system_prompt = """You are DentBot, a professional AI assistant for a modern dental clinic specializing in appointment scheduling and patient care.

PERSONALITY & TONE:
- Friendly, professional, and empathetic
- Clear and concise communication
- Patient-focused and helpful

CORE RESPONSIBILITIES:
- Schedule dental appointments efficiently
- Extract specific dates/times from natural language
- Provide appointment availability and suggestions
- Answer basic dental care questions
- Maintain conversation context and continuity

APPOINTMENT SCHEDULING RULES:
- Convert relative dates (e.g., "next Monday", "tomorrow") to ISO8601 format
- Business hours: Monday-Friday 8 AM - 6 PM, Saturday 9 AM - 3 PM
- If time is ambiguous, suggest options and ask for confirmation
- Always propose specific times rather than vague responses
- Set needs_confirmation=true for appointment proposals

RESPONSE FORMAT:
- Always respond using the exact JSON structure specified
- Keep replies under 100 words for better user experience
- Use appropriate intent classification: chat, propose, confirm, decline

Current date/time for reference: {current_datetime}

{format_instructions}"""

        # Create the conversation prompt template
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content=system_prompt),
            MessagesPlaceholder(variable_name="history"),
            HumanMessage(content="{input}")
        ])

        # Build the processing chain: Prompt → LLM → Parser
        chain = prompt | llm | parser

        # Add conversation memory for session continuity
        chain_with_history = RunnableWithMessageHistory(
            chain,
            get_session_history,
            input_messages_key="input",
            history_messages_key="history",
        )

        print(f"✅ LangChain chatbot initialized successfully with model: {OPENAI_MODEL}")
        return chain_with_history, parser

    except Exception as error:
        print(f"❌ Failed to create LangChain chatbot: {error}")
        import traceback
        traceback.print_exc()
        return None, None

def langchain_extract_and_reply(user_text: str, session_id: str) -> Dict[str, Any]:
    """
    Process user input through LangChain for intelligent appointment extraction and response generation.
    
    This function orchestrates the complete AI processing pipeline:
    1. Initialize or retrieve the LangChain chatbot
    2. Prepare context with current datetime
    3. Process user input through the LLM with conversation history
    4. Extract structured appointment information
    5. Return standardized response format
    
    Args:
        user_text: User's natural language input
        session_id: Session identifier for conversation continuity
        
    Returns:
        Dict containing reply, appointment_candidate, intent, needs_confirmation, and confidence
    """
    try:
        # Initialize LangChain chatbot (cached after first creation)
        chain, parser = create_langchain_chatbot()
        if not chain or not parser:
            print("⚠️ LangChain chatbot not available, falling back to naive parsing")
            return {"reply": None, "appointment_candidate": None}

        # Prepare context information for the LLM
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        print(f"🧠 Processing with LangChain: '{user_text[:50]}...' (Session: {session_id[:8]})")
        
        # Invoke the LangChain pipeline with conversation history
        response = chain.invoke(
            {
                "input": user_text.strip(),
                "current_datetime": current_time,
                "format_instructions": parser.get_format_instructions()
            },
            config={"configurable": {"session_id": session_id or "default"}}
        )

        # Validate response structure
        if not isinstance(response, dict):
            print(f"⚠️ Unexpected response type: {type(response)}")
            return {"reply": None, "appointment_candidate": None}

        print(f"✅ LangChain response: {response}")
        
        # Return standardized response format
        return {
            "reply": response.get("reply", "I'm here to help with your appointment needs."),
            "appointment_candidate": response.get("appointment_candidate"),
            "intent": response.get("intent", "chat"),
            "needs_confirmation": response.get("needs_confirmation", False),
            "confidence": max(0.0, min(1.0, response.get("confidence", 0.8)))  # Clamp to 0-1 range
        }

    except Exception as error:
        print(f"❌ LangChain processing error: {repr(error)}")
        
        # Log detailed error information for debugging
        import traceback
        print("Full error traceback:")
        traceback.print_exc()
        
        # Return fallback response structure
        return {
            "reply": None, 
            "appointment_candidate": None,
            "intent": "chat",
            "needs_confirmation": False,
            "confidence": 0.0
        }

# ================================
# Fallback Datetime Parsing Functions
# ================================

def naive_extract_datetime(text: str) -> Optional[str]:
    """
    Fallback datetime extraction using regex patterns and basic NLP.
    
    This function provides appointment time parsing when LLM is unavailable.
    It handles common patterns like:
    - "Monday at 2pm"
    - "next Tuesday 10:30am"
    - "Friday at 3"
    
    Args:
        text: Natural language text containing potential appointment time
        
    Returns:
        ISO8601 datetime string if time is extracted, None otherwise
    """
    try:
        text_lower = text.lower().strip()
        
        # Map weekday names to numbers (Monday=0, Sunday=6)
        weekday_mapping = {
            'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6,
            'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3,
            'fri': 4, 'sat': 5, 'sun': 6
        }
        
        # Enhanced time pattern matching
        time_pattern = r'(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)?'
        time_match = re.search(time_pattern, text_lower)
        
        # Find weekday mentions
        detected_weekday = None
        for weekday, weekday_number in weekday_mapping.items():
            if weekday in text_lower:
                detected_weekday = weekday_number
                break

        # Process the extracted information
        if detected_weekday is not None:
            # Calculate target date (next occurrence of the weekday)
            current_date = datetime.now()
            current_weekday = current_date.weekday()
            
            # Calculate days until target weekday
            days_ahead = (detected_weekday - current_weekday) % 7
            if days_ahead == 0:  # If it's today, schedule for next week
                days_ahead = 7
                
            target_date = current_date + timedelta(days=days_ahead)
            
            # Process time if available
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2) or 0)
                am_pm = (time_match.group(3) or '').replace('.', '').lower()
                
                # Convert 12-hour to 24-hour format
                if am_pm in ['pm', 'pm']:
                    if hour != 12:
                        hour += 12
                elif am_pm in ['am', 'am']:
                    if hour == 12:
                        hour = 0
                elif hour < 8:  # Assume afternoon if no AM/PM and hour < 8
                    hour += 12
                
                # Validate hour and minute ranges
                if 0 <= hour <= 23 and 0 <= minute <= 59:
                    target_date = target_date.replace(
                        hour=hour, 
                        minute=minute, 
                        second=0, 
                        microsecond=0
                    )
                else:
                    # Invalid time, use default business hour
                    target_date = target_date.replace(hour=10, minute=0, second=0, microsecond=0)
            else:
                # No specific time mentioned, default to 10:00 AM
                target_date = target_date.replace(hour=10, minute=0, second=0, microsecond=0)
            
            # Validate the appointment is in business hours (rough check)
            if target_date.weekday() < 5:  # Monday-Friday
                if target_date.hour < 8 or target_date.hour > 18:
                    target_date = target_date.replace(hour=10)
            elif target_date.weekday() == 5:  # Saturday
                if target_date.hour < 9 or target_date.hour > 15:
                    target_date = target_date.replace(hour=10)
            
            return target_date.isoformat()
        
        # If no weekday found, check for relative terms
        relative_terms = {
            'tomorrow': 1,
            'today': 0,
            'next week': 7
        }
        
        for term, days in relative_terms.items():
            if term in text_lower:
                target_date = datetime.now() + timedelta(days=days)
                if time_match:
                    # Apply time parsing as above
                    hour = int(time_match.group(1))
                    minute = int(time_match.group(2) or 0)
                    am_pm = (time_match.group(3) or '').replace('.', '').lower()
                    
                    if am_pm in ['pm', 'pm'] and hour != 12:
                        hour += 12
                    elif am_pm in ['am', 'am'] and hour == 12:
                        hour = 0
                    elif hour < 8:
                        hour += 12
                    
                    if 0 <= hour <= 23 and 0 <= minute <= 59:
                        target_date = target_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    
                return target_date.isoformat()
        
        return None
        
    except Exception as error:
        print(f"Error in naive datetime extraction: {error}")
        return None

# ================================
# FastAPI Endpoints
# ================================

@app.get('/health')
def health_check():
    """
    Health check endpoint for service monitoring and load balancer probes.
    
    Returns service status, configuration, and availability of key features.
    """
    return {
        'status': 'ok',
        'service': 'python_service',
        'version': '1.0.0',
        'use_llm': USE_LLM,
        'llm_available': bool(OPENAI_API_KEY),
        'model': OPENAI_MODEL if USE_LLM else 'naive_parsing',
        'timestamp': datetime.now().isoformat(),
        'active_sessions': len(CONVERSATION_HISTORY)
    }

@app.post('/simulate')
def simulate_chat_interaction(req: ChatRequest) -> Dict[str, Any]:
    """
    Main chat endpoint for processing user messages and generating AI responses.
    
    This endpoint handles:
    - Natural language understanding for appointment scheduling
    - Intent classification (chat, propose, confirm, decline)
    - Appointment time extraction and validation
    - Conversation state management
    - Fallback to naive parsing when LLM is unavailable
    
    Args:
        req: ChatRequest containing user message and session information
        
    Returns:
        Dictionary with reply, appointment info, intent, and confidence scores
    """
    # ================================
    # Input Processing & Validation
    # ================================
    
    # Sanitize and prepare input
    user_message = (req.message or '').strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    message_lower = user_message.lower()
    session_id = req.session_id or 'anonymous'
    user_id = req.user_id or 'anonymous'
    
    print(f"📥 Processing message from {user_id} (Session: {session_id[:8]}): '{user_message[:100]}'")

    # ================================
    # Appointment Confirmation Workflow
    # ================================
    
    # Handle confirmation of previously proposed appointment
    if session_id in LAST_PROPOSAL:
        has_affirmative = (
            equals_any_trimmed(message_lower, SHORT_AFFIRMATIVE) or 
            has_token(message_lower, AFFIRMATIVE_PATTERNS)
        )
        
        if has_affirmative:
            appointment_time = LAST_PROPOSAL[session_id]
            # Remove proposal from memory since it's being confirmed
            del LAST_PROPOSAL[session_id]
            
            print(f"✅ User confirmed appointment: {appointment_time}")
            
            return {
                'user_id': user_id,
                'input': user_message,
                'reply': f'✅ Perfect! Your appointment is confirmed for {datetime.fromisoformat(appointment_time).strftime("%B %d at %I:%M %p")}. I look forward to seeing you then!',
                'appointment_candidate': appointment_time,
                'intent': 'confirm',
                'needs_confirmation': False,
                'confidence': 1.0
            }

        # Handle rejection of previously proposed appointment
        has_negative = (
            equals_any_trimmed(message_lower, SHORT_NEGATIVE) or 
            has_token(message_lower, NEGATIVE_PATTERNS)
        )
        
        if has_negative:
            # Remove the declined proposal
            declined_time = LAST_PROPOSAL.pop(session_id, None)
            print(f"❌ User declined appointment: {declined_time}")
            
            return {
                'user_id': user_id,
                'input': user_message,
                'reply': 'No problem at all! What day and time would work better for you? I have availability throughout the week.',
                'appointment_candidate': None,
                'intent': 'decline',
                'needs_confirmation': False,
                'confidence': 1.0
            }

    # ================================
    # Intelligent Processing Pipeline
    # ================================
    
    # Log processing mode for debugging
    llm_available = bool(OPENAI_API_KEY)
    print(f"🔧 Processing mode - USE_LLM: {USE_LLM}, API Key Available: {llm_available}")

    # Primary path: Use LangChain with OpenAI LLM
    if USE_LLM and llm_available:
        print(f"🤖 Using advanced AI processing for: '{user_message[:50]}'")
        
        llm_response = langchain_extract_and_reply(user_message, session_id)
        
        if llm_response.get("reply") or llm_response.get("appointment_candidate"):
            appointment_candidate = llm_response.get("appointment_candidate")
            detected_intent = llm_response.get("intent", "chat")
            
            # Handle appointment proposal from LLM
            if appointment_candidate and detected_intent == "propose":
                # Store proposal for confirmation workflow
                LAST_PROPOSAL[session_id] = appointment_candidate
                
                formatted_time = datetime.fromisoformat(appointment_candidate).strftime("%B %d at %I:%M %p")
                confirmation_reply = f'{llm_response["reply"]} Would you like me to confirm this appointment for {formatted_time}?'
                
                print(f"📅 LLM proposed appointment: {appointment_candidate}")
                
                return {
                    'user_id': user_id,
                    'input': user_message,
                    'reply': confirmation_reply,
                    'appointment_candidate': appointment_candidate,
                    'intent': 'propose',
                    'needs_confirmation': True,
                    'confidence': llm_response.get('confidence', 0.8)
                }
            else:
                # Regular chat or other intents
                return {
                    'user_id': user_id,
                    'input': user_message,
                    'reply': llm_response['reply'],
                    'appointment_candidate': appointment_candidate,
                    'intent': detected_intent,
                    'needs_confirmation': llm_response.get('needs_confirmation', False),
                    'confidence': llm_response.get('confidence', 0.8)
                }

    # ================================
    # Fallback Processing (Naive Parsing)
    # ================================
    
    print(f"🔍 Using naive datetime extraction for: '{user_message}'")
    
    # Try to extract appointment time using regex patterns
    extracted_time = naive_extract_datetime(user_message)
    
    if extracted_time:
        # Store proposal for confirmation workflow
        LAST_PROPOSAL[session_id] = extracted_time
        
        formatted_time = datetime.fromisoformat(extracted_time).strftime("%B %d at %I:%M %p")
        
        print(f"📅 Naive parser extracted time: {extracted_time}")
        
        return {
            'user_id': user_id,
            'input': user_message,
            'reply': f'Great! I can schedule you for {formatted_time}. Would you like me to confirm this appointment?',
            'appointment_candidate': extracted_time,
            'intent': 'propose',
            'needs_confirmation': True,
            'confidence': 0.6  # Lower confidence for regex-based extraction
        }

    # ================================
    # Default Fallback Response
    # ================================
    
    print("💬 No appointment time detected, providing general assistance")
    
    # Provide helpful fallback based on message content
    if any(word in message_lower for word in ['appointment', 'schedule', 'book', 'available']):
        fallback_reply = "I'd be happy to help you schedule an appointment! Please let me know what day and time works best for you. For example, you could say 'next Monday at 2pm' or 'Friday morning'."
    elif any(word in message_lower for word in ['hours', 'open', 'closed']):
        fallback_reply = "Our office hours are Monday through Friday 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We're closed on Sundays. When would you like to schedule your appointment?"
    else:
        fallback_reply = "Hello! I'm here to help you schedule dental appointments. What day and time would work best for you?"

    return {
        'user_id': user_id,
        'input': user_message,
        'reply': fallback_reply,
        'appointment_candidate': None,
        'intent': 'chat',
        'needs_confirmation': False,
        'confidence': 0.9  # High confidence in fallback responses
    }
