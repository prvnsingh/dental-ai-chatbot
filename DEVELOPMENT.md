# Dental AI Chatbot - Project Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Setup & Installation](#setup--installation)
4. [Configuration](#configuration)
5. [Development Guide](#development-guide)
6. [API Documentation](#api-documentation)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)

---

## Project Overview

The Dental AI Chatbot is a comprehensive healthcare communication system that leverages artificial intelligence to provide intelligent conversation capabilities for dental practices. The system enables patients to interact with an AI assistant for appointment scheduling, general inquiries, and preliminary dental health guidance.

### Key Features

- **Intelligent Conversations**: AI-powered chat using OpenAI's GPT-4o-mini model
- **Appointment Management**: Smart extraction of appointment preferences and scheduling
- **User Authentication**: Secure JWT-based authentication system
- **Real-time Communication**: WebSocket support for live chat experiences
- **Responsive Design**: Modern React-based frontend with mobile-first approach
- **Scalable Architecture**: Microservices design with containerized deployment

### Technology Stack

- **Frontend**: React 18, Vite, CSS3
- **Backend**: Node.js, Express.js
- **AI Service**: Python, FastAPI, LangChain
- **Database**: PostgreSQL 15
- **Containerization**: Docker, Docker Compose
- **Authentication**: JWT, bcrypt
- **AI Integration**: OpenAI API (GPT-4o-mini)

---

## Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Python AI      │
│   (React)       │◄──►│   (Node.js)     │◄──►│   Service       │
│   Port: 5173    │    │   Port: 3000    │    │   Port: 8001    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         │              ┌─────────────────┐                │
         └──────────────►│   PostgreSQL    │◄───────────────┘
                        │   Database      │
                        │   Port: 5432    │
                        └─────────────────┘
```

### Data Flow

1. **User Interaction**: User sends message through React frontend
2. **Authentication**: Backend validates JWT token and user session
3. **Message Processing**: Backend forwards message to Python AI service
4. **AI Processing**: LangChain processes message with OpenAI GPT model
5. **Response Generation**: AI service returns structured response
6. **Data Persistence**: Chat history and extracted data saved to PostgreSQL
7. **Client Update**: Frontend receives response and updates UI

### Security Architecture

- **JWT Authentication**: Stateless token-based authentication
- **Password Hashing**: bcrypt with salt rounds for secure password storage
- **Rate Limiting**: Express rate limiter to prevent abuse
- **CORS Configuration**: Controlled cross-origin resource sharing
- **Security Headers**: Helmet.js for additional security headers

---

## Setup & Installation

### Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **Python**: Version 3.11 or higher
- **PostgreSQL**: Version 15 or higher
- **Docker & Docker Compose**: Latest stable versions
- **Git**: For version control

### Quick Start with Docker

1. **Clone the repository**:
   ```powershell
   git clone <repository-url>
   cd dental-ai-chatbot
   ```

2. **Create environment file**:
   ```powershell
   Copy-Item .env.example .env
   # Edit .env with your configuration values
   ```

3. **Start all services**:
   ```powershell
   docker-compose up -d
   ```

4. **Access the application**:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000
   - Python AI Service: http://localhost:8001

### Manual Installation

#### Backend Setup

```powershell
cd backend
npm install
npm run dev
```

#### Frontend Setup

```powershell
cd frontend
npm install
npm run dev
```

#### Python Service Setup

```powershell
cd python_service
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

#### Database Setup

```powershell
# Create PostgreSQL database
createdb dental_chatbot

# Run database migrations
psql -d dental_chatbot -f database/schema.sql
```

---

## Configuration

### Environment Variables

The application uses environment variables for configuration. Create a `.env` file based on `.env.example`:

#### Database Configuration
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dental_chatbot
DB_USER=postgres
DB_PASSWORD=your_password
```

#### Authentication
```env
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRY=7d
```

#### AI Service Configuration
```env
OPENAI_API_KEY=your-openai-api-key
PYTHON_SERVICE_URL=http://localhost:8001
```

#### Application Settings
```env
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173
```

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 5173 | React development server |
| Backend | 3000 | Express.js API server |
| Python AI | 8001 | FastAPI AI service |
| PostgreSQL | 5432 | Database server |

---

## Development Guide

### Project Structure

```
dental-ai-chatbot/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── App.jsx          # Main application component
│   │   ├── main.jsx         # Application entry point
│   │   └── styles.css       # Global styles
│   ├── package.json         # Frontend dependencies
│   └── vite.config.js       # Vite build configuration
├── backend/                 # Node.js backend API
│   ├── server.js            # Main Express server
│   ├── auth.js              # Authentication middleware
│   ├── db.js                # Database connection
│   ├── appointments.ts      # Appointment management
│   └── package.json         # Backend dependencies
├── python_service/          # Python AI microservice
│   ├── main.py              # FastAPI application
│   ├── requirements.txt     # Python dependencies
│   └── tests/               # Python tests
├── database/                # Database schema and scripts
│   ├── schema.sql           # Database schema definition
│   └── chat_logs.sql        # Chat logging tables
├── .vscode/                 # VS Code configuration
│   ├── settings.json        # Workspace settings
│   └── launch.json          # Debug configurations
└── docker-compose.yml       # Container orchestration
```

### Code Style Guidelines

#### JavaScript/React
- Use ES6+ features (arrow functions, destructuring, async/await)
- Prefer functional components with hooks
- Use 2 spaces for indentation
- Include JSDoc comments for complex functions

#### Python
- Follow PEP 8 style guidelines
- Use type hints for function parameters and returns
- Use 4 spaces for indentation
- Include docstrings for all functions and classes

#### General
- Write descriptive commit messages
- Keep functions small and focused
- Use meaningful variable and function names
- Add comments for complex business logic

### Development Workflow

1. **Create Feature Branch**:
   ```powershell
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**: Implement your feature with tests

3. **Run Tests**:
   ```powershell
   # Backend tests
   cd backend && npm test
   
   # Python tests
   cd python_service && python -m pytest
   
   # Frontend tests
   cd frontend && npm test
   ```

4. **Commit Changes**:
   ```powershell
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push and Create PR**:
   ```powershell
   git push origin feature/your-feature-name
   ```

---

## API Documentation

### Authentication Endpoints

#### POST /api/auth/register
Register a new user account.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response**:
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

#### POST /api/auth/login
Authenticate user and receive JWT token.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

### Chat Endpoints

#### POST /api/chat
Send message to AI chatbot.

**Headers**:
```
Authorization: Bearer <jwt_token>
```

**Request Body**:
```json
{
  "message": "I need to schedule a dental appointment",
  "sessionId": "unique-session-id"
}
```

**Response**:
```json
{
  "success": true,
  "response": "I'd be happy to help you schedule an appointment. What day works best for you?",
  "appointmentData": null,
  "needsConfirmation": false
}
```

#### POST /api/appointments/confirm
Confirm appointment booking.

**Headers**:
```
Authorization: Bearer <jwt_token>
```

**Request Body**:
```json
{
  "appointmentData": {
    "preferredDate": "2024-02-15",
    "preferredTime": "10:00 AM",
    "appointmentType": "cleaning",
    "notes": "Regular checkup"
  }
}
```

**Response**:
```json
{
  "success": true,
  "message": "Appointment confirmed successfully",
  "appointment": {
    "id": 123,
    "date": "2024-02-15T10:00:00Z",
    "type": "cleaning",
    "status": "confirmed"
  }
}
```

### Python AI Service Endpoints

#### POST /chat
Process chat message with AI.

**Request Body**:
```json
{
  "message": "I want to book an appointment for next Tuesday at 2 PM",
  "context": []
}
```

**Response**:
```json
{
  "response": "I can help you schedule that appointment. Let me confirm the details.",
  "appointment_data": {
    "preferred_date": "2024-02-13",
    "preferred_time": "14:00",
    "appointment_type": "general"
  },
  "needs_confirmation": true
}
```

---

## Testing

### Backend Testing

Run backend tests with Jest:

```powershell
cd backend
npm test                    # Run all tests
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Run tests with coverage report
```

### Python Service Testing

Run Python tests with pytest:

```powershell
cd python_service
python -m pytest                           # Run all tests
python -m pytest -v                        # Verbose output
python -m pytest --coverage               # Coverage report
python -m pytest tests/test_main.py       # Specific test file
```

### Frontend Testing

Run frontend tests with Vitest:

```powershell
cd frontend
npm test                    # Run all tests
npm run test:ui            # Run tests with UI
npm run test:coverage      # Coverage report
```

### Integration Testing

Test the full stack integration:

```powershell
# Start all services
docker-compose up -d

# Run integration tests
npm run test:integration
```

---

## Deployment

### Production Deployment with Docker

1. **Build production images**:
   ```powershell
   docker-compose -f docker-compose.prod.yml build
   ```

2. **Deploy to production**:
   ```powershell
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Monitor services**:
   ```powershell
   docker-compose logs -f
   ```

### Environment-Specific Configuration

#### Production Environment Variables
```env
NODE_ENV=production
DB_SSL=true
CORS_ORIGINS=https://yourdomain.com
RATE_LIMIT_REQUESTS=100
```

#### Staging Environment
```env
NODE_ENV=staging
DB_NAME=dental_chatbot_staging
CORS_ORIGINS=https://staging.yourdomain.com
```

### Health Checks

The application includes health check endpoints:

- **Backend**: GET `/api/health`
- **Python Service**: GET `/health`
- **Database**: Automated connection testing

---

## Troubleshooting

### Common Issues

#### Database Connection Issues

**Problem**: Cannot connect to PostgreSQL database

**Solutions**:
1. Verify database is running: `docker-compose ps`
2. Check connection settings in `.env` file
3. Ensure database exists: `psql -l`
4. Check firewall settings for port 5432

#### OpenAI API Issues

**Problem**: AI responses failing or slow

**Solutions**:
1. Verify `OPENAI_API_KEY` is set correctly
2. Check API quota and billing status
3. Monitor rate limits in OpenAI dashboard
4. Implement retry logic for transient failures

#### Authentication Problems

**Problem**: JWT token validation failing

**Solutions**:
1. Verify `JWT_SECRET` is consistent across services
2. Check token expiration settings
3. Clear browser localStorage and re-login
4. Validate token format and structure

#### Development Server Issues

**Problem**: Frontend not connecting to backend

**Solutions**:
1. Verify all services are running on correct ports
2. Check CORS configuration in backend
3. Update `FRONTEND_URL` in environment variables
4. Clear browser cache and cookies

### Performance Optimization

#### Database Performance
- Add indexes for frequently queried columns
- Use connection pooling for database connections
- Implement query optimization for chat history
- Regular database maintenance and vacuuming

#### API Response Times
- Implement response caching where appropriate
- Use compression middleware for API responses
- Optimize AI service response times
- Monitor and log slow queries

### Monitoring and Logging

#### Log Files
- Backend logs: Check console output or log files
- Python service logs: FastAPI automatic logging
- Database logs: PostgreSQL log directory
- Frontend logs: Browser developer console

#### Metrics to Monitor
- API response times
- Database query performance
- AI service response times
- Error rates and patterns
- User authentication success rates

### Support and Contributing

For bug reports and feature requests, please create an issue in the project repository with:
1. Detailed description of the problem
2. Steps to reproduce the issue
3. Expected vs actual behavior
4. Environment details (OS, versions, etc.)
5. Relevant log messages or error traces

---

*This documentation is maintained alongside the codebase. Please update it when making significant changes to the system architecture or functionality.*