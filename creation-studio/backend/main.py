"""
main.py — FastAPI application for the Planner Agent + Canvas Agent backend.

Endpoints:
  POST /api/planner/chat       → Process a user message, return structured response
  GET  /api/planner/health     → Health check (Ollama, DB, RAG status)
  GET  /api/planner/context    → Knowledge base stats & indexed files
  POST /api/canvas/generate    → Generate workflow on canvas from plan (A2UI protocol)
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from rag_engine import RAGProvider
from planner_agent import PlannerAgent, ConversationMessage
from canvas_agent import CanvasAgent

# ─── Logging ────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-14s │ %(levelname)-5s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("api")

# ─── Globals ────────────────────────────────────────────

rag_provider: Optional[RAGProvider] = None
planner_agent: Optional[PlannerAgent] = None
canvas_agent: Optional[CanvasAgent] = None

# ─── Lifespan (startup/shutdown) ────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize RAG, Planner and Canvas agents on startup, clean up on shutdown."""
    global rag_provider, planner_agent, canvas_agent

    logger.info("=" * 60)
    logger.info("  Planner Agent Backend starting up")
    logger.info("=" * 60)

    # Initialize RAG provider
    rag_provider = RAGProvider(
        dbname=os.environ.get("PGDATABASE", "vectordb"),
        host=os.environ.get("PGHOST", "localhost"),
        port=os.environ.get("PGPORT", "5432"),
        user=os.environ.get("PGUSER"),
        password=os.environ.get("PGPASSWORD"),
    )

    # Initialize Planner Agent
    planner_agent = PlannerAgent(rag_provider=rag_provider)

    # Initialize Canvas Agent
    canvas_agent = CanvasAgent()
    logger.info("Canvas Agent initialized ✓")

    # Log startup info
    try:
        summary = rag_provider.get_context_summary()
        logger.info("Knowledge base: %d files, %d chunks", summary["total_files"], summary["total_chunks"])
    except Exception as e:
        logger.warning("Could not connect to vector DB at startup: %s", e)

    health = await planner_agent.check_ollama_health()
    if health["ollama_running"]:
        logger.info("Ollama: Running ✓ | Model %s: %s",
                     health["model_name"],
                     "Available ✓" if health["model_available"] else "NOT FOUND ✗")
    else:
        logger.warning("Ollama: Not reachable ✗ — start it with `ollama serve`")

    logger.info("=" * 60)
    logger.info("  Planner Agent Backend ready on port %s",
                os.environ.get("PLANNER_PORT", "8000"))
    logger.info("=" * 60)

    yield  # App is running

    # Shutdown
    logger.info("Shutting down Planner Agent Backend…")
    if planner_agent:
        planner_agent.close()


# ─── FastAPI App ────────────────────────────────────────

app = FastAPI(
    title="ZTAMP Planner Agent API",
    description="Backend for the Planner Agent — RAG-powered workflow planning with Llama 3.1",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Vite dev server and Node.js server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:4000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Models ──────────────────────────

class ChatMessageInput(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    message: str = Field(..., description="The user's current message")
    conversation_history: list[ChatMessageInput] = Field(
        default_factory=list,
        description="Previous messages in the conversation"
    )
    attached_files: Optional[list[str]] = Field(
        default=None,
        description="Filenames explicitly attached by the user"
    )


class ChatResponse(BaseModel):
    status: str = Field(..., description="'GATHERING_INFO' or 'READY_TO_CREATE'")
    message_to_user: str = Field(..., description="Agent's response message")
    rag_citations: list[str] = Field(default_factory=list, description="Sources used from knowledge base")
    current_parameters: dict = Field(default_factory=dict, description="Parameters gathered so far")
    workflow_plan: Optional[dict] = Field(default=None, description="Complete workflow plan when status is READY_TO_CREATE")


class HealthResponse(BaseModel):
    status: str
    ollama: dict
    rag: dict


class ContextResponse(BaseModel):
    summary: dict
    indexed_files: list[dict]


class CanvasGenerateRequest(BaseModel):
    workflow_plan: dict = Field(..., description="The workflow plan from the Planner Agent")
    current_parameters: Optional[dict] = Field(
        default=None,
        description="The extracted parameters (input, task, output)"
    )


class CanvasGenerateResponse(BaseModel):
    success: bool = Field(..., description="Whether generation was successful")
    message: str = Field(..., description="Status message")
    a2ui_messages: list[dict] = Field(default_factory=list, description="A2UI protocol messages")
    nodes: list[dict] = Field(default_factory=list, description="React Flow nodes")
    edges: list[dict] = Field(default_factory=list, description="React Flow edges")
    node_configs: dict = Field(default_factory=dict, description="Node configurations")
    workflow_name: str = Field(default="", description="Generated workflow name")
    workflow_description: str = Field(default="", description="Generated workflow description")


# ─── Endpoints ──────────────────────────────────────────

@app.post("/api/planner/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Process a user message through the Planner Agent.

    The agent will:
    1. Search the RAG knowledge base for relevant context
    2. Analyze completeness of workflow requirements
    3. Return either a follow-up question or a complete workflow plan
    """
    if not planner_agent:
        raise HTTPException(status_code=503, detail="Planner Agent not initialized")

    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Convert input history to internal types
    history = [
        ConversationMessage(
            role="user" if msg.role == "user" else "assistant",
            content=msg.content,
        )
        for msg in request.conversation_history
    ]

    try:
        response = await planner_agent.process_message(
            user_message=request.message,
            conversation_history=history,
            attached_files=request.attached_files,
        )
        return ChatResponse(**response.to_dict())

    except ConnectionError as e:
        logger.error("Ollama connection error: %s", e)
        raise HTTPException(
            status_code=503,
            detail=str(e),
        )
    except Exception as e:
        logger.exception("Unexpected error in /api/planner/chat")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {str(e)}",
        )


@app.get("/api/planner/health", response_model=HealthResponse)
async def health_check():
    """Check the health of all backend dependencies."""
    if not planner_agent or not rag_provider:
        return HealthResponse(
            status="unhealthy",
            ollama={"running": False},
            rag={"connected": False},
        )

    # Check Ollama
    ollama_health = await planner_agent.check_ollama_health()

    # Check RAG/DB
    try:
        rag_summary = rag_provider.get_context_summary()
        rag_status = {
            "connected": True,
            "total_files": rag_summary["total_files"],
            "total_chunks": rag_summary["total_chunks"],
        }
    except Exception as e:
        rag_status = {"connected": False, "error": str(e)}

    overall = "healthy" if ollama_health["ollama_running"] and rag_status.get("connected") else "degraded"

    return HealthResponse(
        status=overall,
        ollama=ollama_health,
        rag=rag_status,
    )


@app.get("/api/planner/context", response_model=ContextResponse)
async def get_context_info():
    """Get information about the knowledge base."""
    if not rag_provider:
        raise HTTPException(status_code=503, detail="RAG provider not initialized")

    try:
        summary = rag_provider.get_context_summary()
        indexed_files = rag_provider.list_indexed_files()
        return ContextResponse(summary=summary, indexed_files=indexed_files)
    except Exception as e:
        logger.error("Failed to get context info: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/canvas/generate", response_model=CanvasGenerateResponse)
async def generate_canvas_workflow(request: CanvasGenerateRequest):
    """
    Generate a visual workflow on the canvas from a Planner Agent's workflow plan.

    Uses the A2UI protocol to describe the UI structure, and also returns
    native React Flow nodes/edges/configs for direct rendering.
    """
    if not canvas_agent:
        raise HTTPException(status_code=503, detail="Canvas Agent not initialized")

    try:
        response = canvas_agent.generate_workflow(
            workflow_plan=request.workflow_plan,
            current_parameters=request.current_parameters,
        )
        return CanvasGenerateResponse(**response.to_dict())

    except Exception as e:
        logger.exception("Unexpected error in /api/canvas/generate")
        raise HTTPException(
            status_code=500,
            detail=f"Canvas generation failed: {str(e)}",
        )


# ─── Run ────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PLANNER_PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=["./"],
        log_level="info",
    )
