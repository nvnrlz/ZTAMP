"""
retrieval_router.py — Real-Time Policy-Driven Web Retrieval Engine

Replaces the local RAG pipeline (embedding_engine + rag_engine) with a
live web retrieval system governed by Access Restriction policies.

Architecture:
  ┌─────────────────────────────────────────────────────────────────┐
  │                     RetrievalRouter                             │
  │                                                                 │
  │  Phase 1: Intent & Domain Resolution  (~0.5s)                   │
  │    User query → keyword extraction → PolicyEngine lookup        │
  │    → list of allowed domains + access modes                     │
  │                                                                 │
  │  Phase 2: Parallel Web Retrieval  (~2-4s)                       │
  │    For each domain:                                             │
  │      scrape  → DuckDuckGo site-search → Crawl top 2-3 pages    │
  │      api     → Direct API call (GitHub, etc.)                   │
  │      mcp     → MCP server call (future)                         │
  │      auth    → OAuth/API-key flow (future)                      │
  │                                                                 │
  │  Phase 3: Context Compilation  (~0.5s)                          │
  │    Raw markdown → token-budget trimming → clean context         │
  └─────────────────────────────────────────────────────────────────┘

Key Design Decisions:
  - Uses DuckDuckGo's HTML search (no API key required) with site: prefix
    to find the exact 2-3 pages relevant to the user's query.
  - Fetches pages via httpx + simple HTML→markdown conversion (no heavy
    browser overhead like Crawl4AI). If Crawl4AI is available, uses it
    for JavaScript-rendered pages.
  - All retrievals are policy-gated: if a domain is not whitelisted,
    the request is blocked immediately.
  - Context is token-budgeted to avoid blowing up the LLM's context window.
"""

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse, quote_plus

import httpx

from policy_engine import PolicyEngine, AccessRule

logger = logging.getLogger("retrieval_router")


# ─── Retrieved Document ─────────────────────────────────

@dataclass
class RetrievedDocument:
    """A single document retrieved from a whitelisted website."""

    url: str
    domain: str
    title: str
    content: str          # Clean markdown/text content
    access_mode: str      # scrape, api, mcp, authenticated
    char_count: int = 0
    retrieval_time_ms: float = 0.0

    def __post_init__(self):
        self.char_count = len(self.content)

    @property
    def citation(self) -> str:
        return f"[{self.title}]({self.url})"

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "domain": self.domain,
            "title": self.title,
            "content_preview": self.content[:200] + "…" if len(self.content) > 200 else self.content,
            "char_count": self.char_count,
            "access_mode": self.access_mode,
            "retrieval_time_ms": round(self.retrieval_time_ms, 1),
        }


@dataclass
class RetrievalResult:
    """Complete result from a retrieval operation."""

    query: str
    documents: list[RetrievedDocument] = field(default_factory=list)
    context_text: str = ""         # compiled context for LLM prompt
    citations: list[str] = field(default_factory=list)
    domains_searched: list[str] = field(default_factory=list)
    domains_blocked: list[str] = field(default_factory=list)
    total_retrieval_ms: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "document_count": len(self.documents),
            "domains_searched": self.domains_searched,
            "domains_blocked": self.domains_blocked,
            "citations": self.citations,
            "total_retrieval_ms": round(self.total_retrieval_ms, 1),
            "error": self.error,
        }


# ─── HTML → Markdown Converter ──────────────────────────

def _html_to_text(html: str) -> str:
    """
    Simple HTML → clean text conversion.
    Strips tags, keeps structure via newlines.
    """
    text = html

    # Remove scripts and styles entirely
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<nav[^>]*>.*?</nav>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<footer[^>]*>.*?</footer>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<header[^>]*>.*?</header>", "", text, flags=re.DOTALL | re.IGNORECASE)

    # Convert headings to markdown
    for i in range(1, 7):
        hashes = "#" * i
        text = re.sub(rf"<h{i}[^>]*>(.*?)</h{i}>", rf"\n{hashes} \1\n", text, flags=re.DOTALL | re.IGNORECASE)

    # Convert <p>, <br>, <li> to newlines
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "\n• ", text, flags=re.IGNORECASE)

    # Convert <code> and <pre> blocks
    text = re.sub(r"<pre[^>]*><code[^>]*>(.*?)</code></pre>", r"\n```\n\1\n```\n", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<code[^>]*>(.*?)</code>", r"`\1`", text, flags=re.DOTALL | re.IGNORECASE)

    # Convert bold/italic
    text = re.sub(r"<(?:strong|b)[^>]*>(.*?)</(?:strong|b)>", r"**\1**", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<(?:em|i)[^>]*>(.*?)</(?:em|i)>", r"*\1*", text, flags=re.DOTALL | re.IGNORECASE)

    # Convert <a> links — keep text, discard href
    text = re.sub(r"<a[^>]*>(.*?)</a>", r"\1", text, flags=re.DOTALL | re.IGNORECASE)

    # Convert <table> rows
    text = re.sub(r"<tr[^>]*>", "\n| ", text, flags=re.IGNORECASE)
    text = re.sub(r"<t[dh][^>]*>(.*?)</t[dh]>", r"\1 | ", text, flags=re.DOTALL | re.IGNORECASE)

    # Strip all remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Decode HTML entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")

    # Clean up whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)

    return text.strip()


def _extract_title(html: str) -> str:
    """Extract the <title> tag content from HTML."""
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
    if match:
        title = match.group(1).strip()
        # Remove common suffixes
        for suffix in [" - AWS", " | AWS", " — AWS Documentation",
                       " - Amazon Web Services", " | Amazon Web Services"]:
            if title.endswith(suffix):
                title = title[:-len(suffix)]
        return title
    return "Untitled"


# ─── Search Link Extractor ──────────────────────────────

def _extract_duckduckgo_links(html: str, max_links: int = 5) -> list[dict]:
    """
    Extract search result links from DuckDuckGo HTML.
    Returns list of {url, title} dicts.
    """
    results = []

    # DuckDuckGo HTML result pattern
    # Each result is in a <a class="result__a" href="...">
    patterns = [
        # Pattern 1: result__a links
        re.compile(r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE),
        # Pattern 2: result-title links
        re.compile(r'<a[^>]*class="[^"]*result-title[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE),
        # Pattern 3: generic result links that point to the target domain
        re.compile(r'<a[^>]*href="(https?://(?:docs\.aws|repost\.aws)[^"]+)"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE),
    ]

    seen_urls: set[str] = set()
    for pattern in patterns:
        for match in pattern.finditer(html):
            url = match.group(1).strip()
            title = re.sub(r"<[^>]+>", "", match.group(2)).strip()

            # Follow DuckDuckGo redirects
            if "duckduckgo.com/l/" in url:
                uddg_match = re.search(r"uddg=([^&]+)", url)
                if uddg_match:
                    from urllib.parse import unquote
                    url = unquote(uddg_match.group(1))

            # Validate URL
            if not url.startswith("http"):
                continue
            if url in seen_urls:
                continue
            # Skip DuckDuckGo's own pages
            if "duckduckgo.com" in url:
                continue

            seen_urls.add(url)
            results.append({"url": url, "title": title or url})

            if len(results) >= max_links:
                break
        if len(results) >= max_links:
            break

    return results


# ─── Retrieval Router ───────────────────────────────────

class RetrievalRouter:
    """
    Real-time, policy-driven web retrieval engine.

    Replaces the local RAG pipeline with live web fetching:
    1. Resolves relevant domains from the user query
    2. Policy-gates every domain access
    3. Searches and crawls approved sites in parallel
    4. Compiles context within token budget
    """

    def __init__(
        self,
        policy_engine: PolicyEngine,
        max_context_chars: int = 24000,  # ~6000 tokens
        request_timeout: float = 15.0,
    ):
        self.policy = policy_engine
        self.max_context_chars = max_context_chars
        self.request_timeout = request_timeout
        self._http_config = {
            "timeout": request_timeout,
            "follow_redirects": True,
            "headers": {
                "User-Agent": "Mozilla/5.0 (compatible; ZTAMP-PlannerAgent/2.0; policy-driven-retrieval)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
        }
        logger.info(
            "RetrievalRouter initialized (max_context=%d chars, timeout=%.1fs)",
            max_context_chars, request_timeout,
        )

    async def retrieve(self, query: str) -> RetrievalResult:
        """
        Main entry point: given a user query, retrieve relevant context
        from whitelisted websites.

        Pipeline:
        1. Resolve which domains to search (via PolicyEngine)
        2. For each domain, search for relevant pages
        3. Fetch and extract content from top pages
        4. Compile context within token budget
        """
        start_time = time.time()
        result = RetrievalResult(query=query)

        # ── Phase 1: Domain Resolution ──
        rules = self.policy.resolve_search_domains(query)
        if not rules:
            result.error = "No whitelisted domains match this query. Check your Access Restriction policy."
            logger.warning("No domains resolved for query: '%s…'", query[:60])
            return result

        logger.info(
            "Phase 1 complete: %d domains resolved for '%s…'",
            len(rules), query[:60],
        )

        # ── Phase 2: Parallel Retrieval ──
        tasks = []
        for rule in rules:
            if rule.access_mode == "scrape":
                tasks.append(self._scrape_retrieve(query, rule))
            elif rule.access_mode == "api":
                tasks.append(self._api_retrieve(query, rule))
            else:
                logger.info("Skipping %s (mode=%s not yet implemented)", rule.domain, rule.access_mode)

        if not tasks:
            result.error = "No retrieval tasks could be created. Check access mode configuration."
            return result

        # Run all retrievals in parallel
        all_docs_nested = await asyncio.gather(*tasks, return_exceptions=True)

        for docs_or_error in all_docs_nested:
            if isinstance(docs_or_error, Exception):
                logger.error("Retrieval task failed: %s", docs_or_error)
                continue
            if isinstance(docs_or_error, list):
                result.documents.extend(docs_or_error)

        result.domains_searched = [r.domain for r in rules]
        logger.info(
            "Phase 2 complete: %d documents retrieved from %d domains",
            len(result.documents), len(rules),
        )

        # ── Phase 3: Context Compilation ──
        if result.documents:
            result.context_text = self._compile_context(result.documents)
            result.citations = [doc.citation for doc in result.documents]

        result.total_retrieval_ms = (time.time() - start_time) * 1000
        logger.info(
            "Retrieval complete: %d docs, %d chars context, %.1fms total",
            len(result.documents), len(result.context_text), result.total_retrieval_ms,
        )

        return result

    # ── Scrape-Based Retrieval ────────────────────────

    async def _scrape_retrieve(
        self, query: str, rule: AccessRule
    ) -> list[RetrievedDocument]:
        """
        Retrieve content by scraping web pages.

        Steps:
        1. Use DuckDuckGo to find relevant pages on the target domain
        2. Fetch top N pages
        3. Extract clean text content
        """
        docs: list[RetrievedDocument] = []

        try:
            # Step 1: Search for relevant URLs using DuckDuckGo with site: restriction
            search_query = f"{rule.search_prefix} {query}"
            urls = await self._search_duckduckgo(search_query, max_results=rule.max_pages_per_query)

            if not urls:
                # Fallback: try constructing a direct AWS docs URL
                urls = self._construct_direct_urls(query, rule)

            if not urls:
                logger.warning("No URLs found for '%s' on %s", query[:40], rule.domain)
                return docs

            logger.info(
                "Found %d URLs for '%s…' on %s: %s",
                len(urls), query[:40], rule.domain,
                [u["url"][:80] for u in urls],
            )

            # Step 2: Fetch pages in parallel
            fetch_tasks = [self._fetch_page(u["url"], u.get("title", ""), rule) for u in urls]
            results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

            for doc_or_error in results:
                if isinstance(doc_or_error, RetrievedDocument):
                    docs.append(doc_or_error)
                elif isinstance(doc_or_error, Exception):
                    logger.warning("Page fetch failed: %s", doc_or_error)

        except Exception as e:
            logger.error("Scrape retrieval failed for %s: %s", rule.domain, e)

        return docs

    async def _search_duckduckgo(
        self, query: str, max_results: int = 3
    ) -> list[dict]:
        """
        Search DuckDuckGo HTML for relevant URLs.
        No API key required.
        """
        encoded_query = quote_plus(query)
        search_url = f"https://html.duckduckgo.com/html/?q={encoded_query}"

        try:
            async with httpx.AsyncClient(**self._http_config) as client:
                resp = await client.get(search_url)
                resp.raise_for_status()

            results = _extract_duckduckgo_links(resp.text, max_links=max_results)
            logger.info(
                "DuckDuckGo search for '%s…': %d results",
                query[:50], len(results),
            )
            return results

        except Exception as e:
            logger.error("DuckDuckGo search failed: %s", e)
            return []

    def _construct_direct_urls(
        self, query: str, rule: AccessRule
    ) -> list[dict]:
        """
        Construct direct URLs for known AWS documentation structures.
        Fallback when DuckDuckGo search returns nothing.
        """
        if rule.domain != "docs.aws.amazon.com":
            return []

        # Extract AWS service name from query
        service_patterns = {
            "s3": "AmazonS3/latest/userguide",
            "ec2": "AWSEC2/latest/UserGuide",
            "lambda": "lambda/latest/dg",
            "vpc": "vpc/latest/userguide",
            "iam": "IAM/latest/UserGuide",
            "rds": "AmazonRDS/latest/UserGuide",
            "dynamodb": "amazondynamodb/latest/developerguide",
            "cloudformation": "AWSCloudFormation/latest/UserGuide",
            "ecs": "AmazonECS/latest/developerguide",
            "eks": "eks/latest/userguide",
            "sqs": "AWSSimpleQueueService/latest/SQSDeveloperGuide",
            "sns": "sns/latest/dg",
            "cloudwatch": "AmazonCloudWatch/latest/monitoring",
        }

        query_lower = query.lower()
        for service, path in service_patterns.items():
            if service in query_lower:
                url = f"https://docs.aws.amazon.com/{path}/"
                return [{"url": url, "title": f"AWS {service.upper()} User Guide"}]

        return []

    async def _fetch_page(
        self, url: str, hint_title: str, rule: AccessRule
    ) -> RetrievedDocument:
        """Fetch a single page and extract clean text content."""
        start = time.time()

        # Policy check: ensure the URL domain is allowed
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        access = self.policy.check_access(domain)
        if not access.allowed:
            raise PermissionError(f"Domain '{domain}' is not whitelisted in the access policy")

        async with httpx.AsyncClient(**self._http_config) as client:
            resp = await client.get(url)
            resp.raise_for_status()

        html = resp.text
        title = _extract_title(html) or hint_title or url
        content = _html_to_text(html)

        # Quality filter: skip pages with very little content
        if len(content) < 100:
            raise ValueError(f"Page at {url} has insufficient content ({len(content)} chars)")

        elapsed_ms = (time.time() - start) * 1000
        logger.info("Fetched '%s' (%d chars, %.0fms)", title[:50], len(content), elapsed_ms)

        return RetrievedDocument(
            url=url,
            domain=domain,
            title=title,
            content=content,
            access_mode=rule.access_mode,
            retrieval_time_ms=elapsed_ms,
        )

    # ── API-Based Retrieval (Future) ─────────────────

    async def _api_retrieve(
        self, query: str, rule: AccessRule
    ) -> list[RetrievedDocument]:
        """
        Retrieve content via a direct API call.
        Placeholder for future implementation (GitHub API, etc.)
        """
        logger.info("API retrieval for %s not yet implemented", rule.domain)
        return []

    # ── Context Compilation ──────────────────────────

    def _compile_context(self, documents: list[RetrievedDocument]) -> str:
        """
        Compile retrieved documents into a single context string
        within the token budget.

        Strategy:
        - Sort by retrieval time (faster = likely more relevant)
        - Allocate budget proportionally
        - Include source citations
        """
        if not documents:
            return ""

        budget_per_doc = self.max_context_chars // len(documents)
        parts: list[str] = []
        total_chars = 0

        for doc in documents:
            # Trim content to budget
            content = doc.content
            if len(content) > budget_per_doc:
                content = content[:budget_per_doc] + "\n\n[… content truncated to stay within context budget …]"

            part = (
                f"────────────────────────────────────────\n"
                f"Source: {doc.title}\n"
                f"URL: {doc.url}\n"
                f"Access: {doc.access_mode}\n"
                f"────────────────────────────────────────\n\n"
                f"{content}"
            )

            total_chars += len(part)
            if total_chars > self.max_context_chars:
                # Hard cutoff
                remaining = self.max_context_chars - (total_chars - len(part))
                if remaining > 200:
                    parts.append(part[:remaining] + "\n\n[… context budget reached …]")
                break

            parts.append(part)

        context = "\n\n".join(parts)

        logger.info(
            "Context compiled: %d docs → %d chars (budget: %d)",
            len(documents), len(context), self.max_context_chars,
        )

        return context

    def format_context_for_prompt(self, result: RetrievalResult) -> str:
        """
        Format the retrieval result into the context block that gets
        injected into the LLM prompt.

        This returns the same format as the old RAG engine's
        format_context_for_prompt() method for backward compatibility.
        """
        if not result.documents:
            return ""

        header = (
            f"\n\n<WebContext>\n"
            f"The following documentation was retrieved in real-time from approved websites.\n"
            f"Domains searched: {', '.join(result.domains_searched)}\n"
            f"Documents retrieved: {len(result.documents)}\n"
            f"Total retrieval time: {result.total_retrieval_ms:.0f}ms\n\n"
        )

        footer = "\n</WebContext>\n"

        return header + result.context_text + footer

    # ── Health check ─────────────────────────────────

    def get_status(self) -> dict:
        """Get retrieval router status."""
        return {
            "mode": "policy_driven_web_retrieval",
            "policy": self.policy.get_policy_summary(),
            "max_context_chars": self.max_context_chars,
            "timeout": self.request_timeout,
        }
