"""
main.py — FastAPI application for the Planner Agent + Canvas Agent backend.

v2: Uses PolicyEngine + RetrievalRouter for real-time web retrieval
    instead of local RAG (embedding_engine + rag_engine + query_analyzer).

Endpoints:
  POST /api/planner/chat       → Process a user message, return structured response
  GET  /api/planner/health     → Health check (Ollama, retrieval, policy status)
  GET  /api/planner/policy     → Current access policy summary
  POST /api/canvas/generate    → Generate workflow on canvas from plan (A2UI protocol)
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from policy_engine import PolicyEngine
from retrieval_router import RetrievalRouter
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

policy_engine: Optional[PolicyEngine] = None
retrieval_router: Optional[RetrievalRouter] = None
planner_agent: Optional[PlannerAgent] = None
canvas_agent: Optional[CanvasAgent] = None

# ─── Lifespan (startup/shutdown) ────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize PolicyEngine, RetrievalRouter, Planner and Canvas agents on startup."""
    global policy_engine, retrieval_router, planner_agent, canvas_agent

    logger.info("=" * 60)
    logger.info("  Planner Agent Backend v2 starting up")
    logger.info("  Mode: Policy-Driven Real-Time Web Retrieval")
    logger.info("=" * 60)

    # ── Initialize Policy Engine ──
    policy_engine = PolicyEngine()
    allowed = policy_engine.get_allowed_domains()
    logger.info("PolicyEngine initialized:")
    for rule in allowed:
        logger.info("  ✓ %s (%s) — %s", rule.domain, rule.access_mode, rule.display_name)

    # ── Initialize Retrieval Router ──
    retrieval_router = RetrievalRouter(
        policy_engine=policy_engine,
        max_context_chars=24000,   # ~6000 tokens
        request_timeout=15.0,
    )
    logger.info("RetrievalRouter initialized (max_context=24000 chars)")

    # ── Initialize Planner Agent ──
    from planner_agent import LLMConfig
    planner_agent = PlannerAgent(
        policy_engine=policy_engine,
        retrieval_router=retrieval_router,
        llm_config=LLMConfig.development(),
    )
    logger.info("PlannerAgent v2 initialized ✓")

    # ── Initialize Canvas Agent ──
    canvas_agent = CanvasAgent()
    logger.info("Canvas Agent initialized ✓")

    # ── LLM Health Check ──
    health = await planner_agent.check_ollama_health()
    if health["ollama_running"]:
        logger.info("Ollama: Running ✓ | Model %s: %s",
                     health["model_name"],
                     "Available ✓" if health["model_available"] else "NOT FOUND ✗")
    else:
        logger.warning("Ollama: Not reachable ✗ — start it with `ollama serve`")

    logger.info("=" * 60)
    logger.info("  Planner Agent Backend v2 ready on port %s",
                os.environ.get("PLANNER_PORT", "8000"))
    logger.info("  No local vector DB required.")
    logger.info("  Web retrieval governed by Access Restriction Policy.")
    logger.info("=" * 60)

    yield  # App is running

    # Shutdown
    logger.info("Shutting down Planner Agent Backend…")
    if planner_agent:
        planner_agent.close()


# ─── FastAPI App ────────────────────────────────────────

app = FastAPI(
    title="ZTAMP Planner Agent API v2",
    description="Backend for the Planner Agent — Policy-driven real-time web retrieval with Llama 3.1",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — allow the Vite dev server and Node.js server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
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
    session_id: Optional[str] = Field(
        default=None,
        description="Conversation session ID for stateful context tracking"
    )
    use_rag: bool = Field(
        default=True,
        description="Whether to activate web retrieval for this message"
    )
    model: Optional[str] = Field(
        default=None,
        description="Override the default LLM model for this request"
    )
    template_content: Optional[str] = Field(
        default=None,
        description="Optional YAML workflow template content to guide the planner"
    )


class ChatResponse(BaseModel):
    message_to_user: str = Field(..., description="Agent's response message with source citations")
    intent: str = Field(default="question", description="'question', 'clarification', or 'action'")
    steps: list[dict] = Field(default_factory=list, description="Workflow steps when intent is 'action'")
    workflow_parameters: dict = Field(default_factory=lambda: {"floating": [], "fixed": []}, description="Parameters grouped by type: floating (user-decided) and fixed (standard values)")
    missing_parameters_audit: list[dict] = Field(default_factory=list, description="Missing params with source quotes for clarification")
    rag_citations: list[str] = Field(default_factory=list, description="Sources used from web retrieval")
    session_id: str = Field(default="", description="Session ID for conversation continuity")


class HealthResponse(BaseModel):
    status: str
    ollama: dict
    retrieval: dict


class CanvasGenerateRequest(BaseModel):
    workflow_plan: dict = Field(..., description="The workflow plan from the Planner Agent")
    current_parameters: Optional[dict] = Field(
        default=None,
        description="The extracted parameters (input, task, output)"
    )
    attached_files: Optional[list[str]] = Field(
        default=None,
        description="File names attached during the planner conversation"
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
    1. Resolve relevant domains via the Access Restriction Policy
    2. Fetch live documentation from approved websites
    3. Generate a structured response (question, clarification, or workflow)
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
            session_id=request.session_id,
            use_rag=request.use_rag,
            model_override=request.model,
            template_content=request.template_content,
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


@app.get("/api/planner/models")
async def list_models():
    """Return available LLM models from Ollama."""
    if not planner_agent:
        raise HTTPException(status_code=503, detail="Planner Agent not initialized")

    health = await planner_agent.check_ollama_health()
    models = health.get("available_models", [])
    active = health.get("model_name", "")

    return {
        "models": models,
        "active_model": active,
    }

@app.get("/api/planner/health", response_model=HealthResponse)
async def health_check():
    """Check the health of all backend dependencies."""
    if not planner_agent:
        return HealthResponse(
            status="unhealthy",
            ollama={"running": False},
            retrieval={"mode": "not_initialized"},
        )

    # Check Ollama
    ollama_health = await planner_agent.check_ollama_health()

    # Check Retrieval Router
    retrieval_status = retrieval_router.get_status() if retrieval_router else {"mode": "unavailable"}

    overall = "healthy" if ollama_health["ollama_running"] else "degraded"

    return HealthResponse(
        status=overall,
        ollama=ollama_health,
        retrieval=retrieval_status,
    )


@app.get("/api/planner/policy")
async def get_policy():
    """Get the active access restriction policy."""
    if not policy_engine:
        raise HTTPException(status_code=503, detail="PolicyEngine not initialized")

    return policy_engine.get_policy_summary()


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
            attached_files=request.attached_files,
        )
        return CanvasGenerateResponse(**response.to_dict())

    except Exception as e:
        logger.exception("Unexpected error in /api/canvas/generate")
        raise HTTPException(
            status_code=500,
            detail=f"Canvas generation failed: {str(e)}",
        )



@app.get("/api/planner/sessions")
async def get_sessions():
    """
    Get active conversation session stats.
    Useful for monitoring concurrency and debugging context issues.
    """
    if not planner_agent:
        raise HTTPException(status_code=503, detail="Planner Agent not initialized")
    return planner_agent.get_session_stats()


@app.get("/api/planner/rag-status")
async def get_rag_status():
    """
    Get the status of the retrieval pipeline.
    Backward-compatible endpoint — now returns web retrieval info.
    """
    result = {
        "agentic_available": False,  # No longer uses agentic RAG
        "agentic_enabled": False,
        "mode": "policy_driven_web_retrieval",
        "retrieval": retrieval_router.get_status() if retrieval_router else {},
    }

    return result


# ─── Admin: Prompt Management ──────────────────────────

class PromptUpdateRequest(BaseModel):
    content: str = Field(..., description="New content for the prompt file")


@app.get("/api/admin/prompts")
async def list_prompts():
    """List all available prompt .md files."""
    try:
        from prompt_loader import list_prompt_files
        files = list_prompt_files()
        return {"prompts": files}
    except Exception as e:
        logger.error("Failed to list prompt files: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/admin/prompts/{filename}")
async def read_prompt(filename: str):
    """Read the raw content of a prompt file."""
    try:
        from prompt_loader import read_prompt_file
        content = read_prompt_file(filename)
        return {"filename": filename, "content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Prompt file not found: {filename}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to read prompt file '%s': %s", filename, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/prompts/{filename}")
async def update_prompt(filename: str, body: PromptUpdateRequest):
    """Update the content of a prompt file and invalidate cached prompts."""
    try:
        from prompt_loader import write_prompt_file
        result = write_prompt_file(filename, body.content)

        # Invalidate cached system prompts so changes take effect immediately
        try:
            from planner_agent import reload_system_prompt
            reload_system_prompt()
            logger.info("Planner agent system prompt cache invalidated")
        except Exception as reload_err:
            logger.warning("Could not reload system prompt cache: %s", reload_err)

        return {"message": "Prompt updated successfully", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to update prompt file '%s': %s", filename, e)
        raise HTTPException(status_code=500, detail=str(e))


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
