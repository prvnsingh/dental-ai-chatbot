/**
 * Dental AI Chatbot - Frontend Application
 * 
 * A React-based chat interface for dental appointment scheduling using AI.
 * Features:
 * - Real-time chat with AI assistant
 * - Persistent session management
 * - Appointment confirmation workflow
 * - Message history preservation
 * - Responsive design
 * 
 * @version 1.0.0
 * @author Dental AI Team
 */

import { useEffect, useMemo, useRef, useState } from "react"

// ================================
// Configuration & Constants
// ================================

// API endpoint configuration from environment variables
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"

// ================================
// Custom Hooks
// ================================

/**
 * Custom hook for persistent session ID management
 * Generates a unique session ID and stores it in localStorage
 * @returns {[string, Function]} Session ID and setter function
 */
function useSessionId() {
  const [sessionId, setSessionId] = useState(() => {
    // Try to load existing session from localStorage
    const existingSession = localStorage.getItem("session_id")
    if (existingSession) {
      return existingSession
    }

    // Generate new session ID using crypto.randomUUID()
    const newSessionId = crypto.randomUUID()
    localStorage.setItem("session_id", newSessionId)
    return newSessionId
  })

  return [sessionId, setSessionId]
}

// ================================
// Main App Component
// ================================

export default function App() {
  // ================================
  // State Management
  // ================================

  // Session and authentication state
  const [sessionId] = useSessionId()
  const [token, setToken] = useState("")

  // Chat state
  const [messages, setMessages] = useState([]) // Array of {role, content, meta?, created_at?}
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)

  // UI preferences
  const [useLLM, setUseLLM] = useState(true) // Toggle between LLM and naive parsing

  // Refs for DOM manipulation
  const scrollerRef = useRef(null) // Reference to chat container for auto-scrolling

  // ================================
  // Side Effects (useEffect hooks)
  // ================================

  /**
   * Auto-scroll chat container to bottom when new messages arrive
   * Ensures users always see the latest message without manual scrolling
   */
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: "smooth"
      })
    }
  }, [messages])

  /**
   * Initialize authentication token on app startup
   * Uses legacy demo token endpoint for quick testing
   * TODO: Replace with proper user authentication in production
   */
  useEffect(() => {
    async function initializeToken() {
      try {
        const response = await fetch(`${API_BASE}/api/chatbot/token`, {
          method: "POST"
        })

        if (!response.ok) {
          throw new Error(`Failed to get token: ${response.status}`)
        }

        const data = await response.json()
        setToken(data.token)

        if (data.warning) {
          console.warn("Authentication:", data.warning)
        }
      } catch (error) {
        console.error("Token initialization failed:", error)
        // Could add user notification here
      }
    }

    initializeToken()
  }, [])

  /**
   * Load conversation history when token and session are available
   * Restores previous conversation state for better user experience
   */
  useEffect(() => {
    if (!token || !sessionId) return

    async function loadConversationHistory() {
      try {
        const response = await fetch(
          `${API_BASE}/api/chat_sessions/${sessionId}/messages`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        )

        if (!response.ok) {
          console.warn(`History fetch failed with status: ${response.status}`)
          return
        }

        const data = await response.json()

        if (data.ok && data.messages) {
          // Transform server messages to client format
          const formattedMessages = data.messages.map((message) => ({
            role: message.role,
            content: message.content,
            meta: message.meta || null,
            created_at: message.created_at
          }))

          setMessages(formattedMessages)
          console.log(`Loaded ${formattedMessages.length} previous messages`)
        }
      } catch (error) {
        console.error("Failed to load conversation history:", error)
        // Gracefully continue without history rather than breaking the app
      }
    }

    loadConversationHistory()
  }, [token, sessionId])

  // ================================
  // Message Handling Functions
  // ================================

  /**
   * Send a message to the AI chatbot
   * Handles optimistic UI updates, API communication, and error scenarios
   */
  async function sendMessage() {
    const messageText = input.trim()

    // Validate input and prerequisites
    if (!messageText) {
      console.warn("Cannot send empty message")
      return
    }

    if (!token) {
      console.warn("Cannot send message without authentication token")
      // TODO: Add user notification for authentication issues
      return
    }

    // Clear input immediately for better UX
    setInput("")

    // Optimistic update: Add user message immediately to UI
    const userMessage = {
      role: "user",
      content: messageText,
      created_at: new Date().toISOString()
    }
    setMessages((previousMessages) => [...previousMessages, userMessage])

    setLoading(true)

    try {
      // Send message to backend API
      const response = await fetch(
        `${API_BASE}/api/chatbot/message?use_llm=${useLLM ? "1" : "0"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            message: messageText,
            session_id: sessionId
          })
        }
      )

      const responseData = await response.json()

      if (!response.ok) {
        console.error("API error:", response.status, responseData)
        throw new Error(responseData.message || "API request failed")
      }

      // Extract assistant response data
      const assistantData = responseData.data || {}
      const assistantReply = assistantData.reply || "I'm sorry, I couldn't process that request."

      // Add assistant response to messages
      const assistantMessage = {
        role: "assistant",
        content: assistantReply,
        meta: assistantData,
        created_at: new Date().toISOString()
      }

      setMessages((previousMessages) => [...previousMessages, assistantMessage])

    } catch (error) {
      console.error("Message sending failed:", error)

      // Add error message to chat for user feedback
      const errorMessage = {
        role: "assistant",
        content: "I'm experiencing technical difficulties. Please try again in a moment.",
        created_at: new Date().toISOString(),
        meta: { error: true }
      }

      setMessages((previousMessages) => [...previousMessages, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  // ================================
  // Appointment Management Functions
  // ================================

  /**
   * Confirm a proposed appointment time
   * Finds the most recent appointment proposal and submits confirmation
   */
  async function confirmAppointment() {
    if (!token) {
      console.warn("Cannot confirm appointment without authentication token")
      return
    }

    // Find the most recent assistant message with an appointment proposal
    const latestProposal = [...messages]
      .reverse()
      .find((message) =>
        message.role === "assistant" &&
        message.meta?.appointment_candidate
      )

    if (!latestProposal) {
      alert("No appointment proposal found to confirm.")
      return
    }

    const scheduledTime = latestProposal.meta.appointment_candidate

    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/api/chatbot/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          scheduled_at: scheduledTime,
          confirm: true
        })
      })

      const responseData = await response.json()

      let confirmationMessage

      if (response.status === 409) {
        // Time slot conflict - already booked
        confirmationMessage = {
          role: "assistant",
          content: responseData.message || "That time slot is already booked. Please select a different time.",
          created_at: new Date().toISOString(),
          meta: { error: true, type: 'conflict' }
        }
      } else if (!response.ok) {
        // Other API errors
        console.error("Appointment confirmation failed:", response.status, responseData)
        confirmationMessage = {
          role: "assistant",
          content: "Sorry, I couldn't confirm your appointment. Please try again.",
          created_at: new Date().toISOString(),
          meta: { error: true }
        }
      } else {
        // Success
        const appointmentInfo = responseData.appointment
        confirmationMessage = {
          role: "assistant",
          content: `✅ Your appointment has been confirmed for ${new Date(scheduledTime).toLocaleString()}.`,
          created_at: new Date().toISOString(),
          meta: {
            confirmed: true,
            appointment: appointmentInfo
          }
        }
      }

      setMessages((previousMessages) => [...previousMessages, confirmationMessage])

    } catch (error) {
      console.error("Network error during appointment confirmation:", error)

      const errorMessage = {
        role: "assistant",
        content: "Network error occurred while confirming your appointment. Please try again.",
        created_at: new Date().toISOString(),
        meta: { error: true, type: 'network' }
      }

      setMessages((previousMessages) => [...previousMessages, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  /**
   * Decline a proposed appointment time
   * Allows user to reject the current proposal and ask for alternatives
   */
  async function declineAppointment() {
    if (!token) {
      console.warn("Cannot decline appointment without authentication token")
      return
    }

    // Find the most recent appointment proposal
    const latestProposal = [...messages]
      .reverse()
      .find((message) =>
        message.role === "assistant" &&
        message.meta?.appointment_candidate
      )

    if (!latestProposal) {
      alert("No appointment proposal found to decline.")
      return
    }

    const scheduledTime = latestProposal.meta.appointment_candidate

    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/api/chatbot/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          scheduled_at: scheduledTime,
          confirm: false
        })
      })

      const responseData = await response.json()

      let declineMessage

      if (!response.ok) {
        console.error("Appointment decline failed:", response.status, responseData)
        declineMessage = {
          role: "assistant",
          content: "Sorry, I couldn't process your response. Please try again.",
          created_at: new Date().toISOString(),
          meta: { error: true }
        }
      } else {
        declineMessage = {
          role: "assistant",
          content: "No problem! When would be a better time for your appointment?",
          created_at: new Date().toISOString(),
          meta: { declined: true }
        }
      }

      setMessages((previousMessages) => [...previousMessages, declineMessage])

    } catch (error) {
      console.error("Network error during appointment decline:", error)

      const errorMessage = {
        role: "assistant",
        content: "Network error occurred. Please try again.",
        created_at: new Date().toISOString(),
        meta: { error: true, type: 'network' }
      }

      setMessages((previousMessages) => [...previousMessages, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  // ================================
  // Computed Values
  // ================================

  /**
   * Determine if appointment confirmation buttons should be displayed
   * Shows confirm/decline buttons when the last message requires user confirmation
   */
  const showConfirmationBar = useMemo(() => {
    const lastMessage = messages[messages.length - 1]
    return (
      lastMessage?.role === "assistant" &&
      lastMessage?.meta?.needs_confirmation &&
      lastMessage?.meta?.appointment_candidate
    )
  }, [messages])

  // ================================
  // Render UI
  // ================================

  return (
    <div
      className="min-h-screen flex flex-col items-center p-4"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <div className="w-full max-w-2xl">

        {/* Application Header */}
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-gray-800">
            🦷 Dental AI Assistant
          </h1>
          <div className="text-xs text-gray-500 font-mono">
            Session: <code className="bg-gray-100 px-1 py-0.5 rounded">
              {sessionId.slice(0, 8)}…
            </code>
            <span className="mx-2">|</span>
            API: <code className="bg-gray-100 px-1 py-0.5 rounded">
              {API_BASE.replace('http://', '').replace('https://', '')}
            </code>
          </div>
        </header>

        {/* AI Processing Toggle */}
        <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useLLM}
                onChange={(e) => setUseLLM(e.target.checked)}
                className="rounded border-gray-300"
              />
              🤖 Use Advanced AI (LLM)
            </label>
          </div>
          <div className="text-xs text-gray-500">
            {useLLM ? "Enhanced natural language understanding" : "Simple keyword matching"}
          </div>
        </div>

        {/* Chat Messages Container */}
        <div
          ref={scrollerRef}
          className="border border-gray-200 rounded-lg p-4 h-[60vh] overflow-auto bg-white shadow-sm"
        >
          {/* Empty State */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-4">💬</div>
              <div className="text-gray-600 mb-2 font-medium">Welcome to Dental AI Assistant</div>
              <div className="text-sm text-gray-500">
                I can help you schedule appointments, answer questions, and provide dental care information.
                <br />
                Try saying: "I need an appointment next Monday at 2pm"
              </div>
            </div>
          )}

          {/* Message List */}
          {messages.map((message, index) => (
            <div key={`${message.created_at || index}`} className="mb-4 last:mb-0">

              {/* Message Header */}
              <div className="flex items-center gap-2 mb-1">
                <div className="text-xs font-medium text-gray-600">
                  {message.role === "user" ? (
                    <span className="flex items-center gap-1">
                      👤 You
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      🤖 AI Assistant
                    </span>
                  )}
                </div>
                {message.created_at && (
                  <div className="text-xs text-gray-400">
                    {new Date(message.created_at).toLocaleTimeString()}
                  </div>
                )}
              </div>

              {/* Message Content */}
              <div
                className={`rounded-lg px-4 py-3 text-sm max-w-[85%] ${message.role === "user"
                    ? "bg-blue-500 text-white ml-auto"
                    : message.meta?.error
                      ? "bg-red-50 border border-red-200 text-red-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
              >
                {message.content}

                {/* Appointment Candidate Display */}
                {message.meta?.appointment_candidate && (
                  <div className="text-xs opacity-75 mt-2 p-2 bg-white/20 rounded border">
                    📅 Proposed: <code className="font-mono">
                      {new Date(message.meta.appointment_candidate).toLocaleString()}
                    </code>
                  </div>
                )}

                {/* Error Indicator */}
                {message.meta?.error && (
                  <div className="text-xs mt-1 opacity-75">
                    ⚠️ {message.meta.type === 'network' ? 'Network issue' : 'Processing error'}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full"></div>
              AI is thinking...
            </div>
          )}
        </div>

        {/* Appointment Confirmation Bar */}
        {showConfirmationBar && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📅</span>
                <div>
                  <div className="font-medium text-blue-900">
                    Confirm your appointment?
                  </div>
                  <div className="text-sm text-blue-700">
                    Please confirm or select a different time
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  onClick={confirmAppointment}
                  disabled={loading}
                >
                  ✓ Confirm
                </button>
                <button
                  className="px-4 py-2 rounded-md bg-gray-300 hover:bg-gray-400 text-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
                  onClick={declineAppointment}
                  disabled={loading}
                >
                  ✕ Pick another time
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Message Input Section */}
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <input
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="Ask me anything about dental appointments... (e.g., 'I need a cleaning next Tuesday at 2pm')"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              disabled={loading}
              maxLength={500}
            />
            <div className="text-xs text-gray-500 mt-1 flex justify-between">
              <span>Press Enter to send, Shift+Enter for new line</span>
              <span>{input.length}/500</span>
            </div>
          </div>
          <button
            className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px]"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></div>
              </div>
            ) : (
              "Send 📤"
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center text-xs text-gray-400">
          Dental AI Assistant v1.0.0 | Powered by LangChain & OpenAI
        </div>
      </div>
    </div>
  )
}
