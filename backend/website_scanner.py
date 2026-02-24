"""
website_scanner.py — Website Capability Scanner for Access Restriction Policies

Performs real-time capability scanning of domains to determine the best
method of data retrieval for the Planner Agent's URL whitelist.

Detects three access modes:
1. Open Access / Scrape — Public data, no credentials needed (e.g., docs.aws.com)
2. API Access          — Direct REST/GraphQL API available (e.g., github.com)
3. MCP Access          — Model Context Protocol server exists (e.g., notion.so)
4. Authenticated       — Requires OAuth/API key/SAML credentials (e.g., linkedin.com)

Backend Logic for Capability Detection:
  1. HTTP HEAD request to check public accessibility (status 200 vs 401/403)
  2. Check for common API endpoints (/api, /rest, /graphql, /v1, /v2)
  3. Check for MCP server registry matches 
  4. Inspect response headers for auth requirements (WWW-Authenticate, etc.)
  5. Check for robots.txt scrape permissions
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("website_scanner")

# ─── Known MCP Server Registry ─────────────────────────
# In production, this would be fetched from a central MCP registry
MCP_REGISTRY: dict[str, str] = {
    "github.com": "github-mcp-server",
    "notion.so": "notion-mcp-server",
    "slack.com": "slack-mcp-server",
    "linear.app": "linear-mcp-server",
    "figma.com": "figma-mcp-server",
    "asana.com": "asana-mcp-server",
    "trello.com": "trello-mcp-server",
    "airtable.com": "airtable-mcp-server",
    "confluence.atlassian.com": "confluence-mcp-server",
    "sentry.io": "sentry-mcp-server",
}

# ─── Known API Patterns ────────────────────────────────
API_DISCOVERY_PATHS = [
    "/api",
    "/api/v1",
    "/api/v2",
    "/api/v3",
    "/rest/api",
    "/graphql",
    "/.well-known/openapi",
    "/openapi.json",
    "/swagger.json",
]


@dataclass
class ScanResult:
    """Result of scanning a website for access capabilities."""

    domain: str
    is_reachable: bool = False
    is_public: bool = False
    has_api: bool = False
    has_mcp: bool = False
    requires_auth: bool = False
    detected_methods: list[str] = field(default_factory=list)
    api_endpoint: Optional[str] = None
    mcp_server: Optional[str] = None
    auth_type: Optional[str] = None  # oauth, api_key, basic, saml
    robots_allows_scraping: bool = True
    response_time_ms: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "domain": self.domain,
            "isReachable": self.is_reachable,
            "isPublic": self.is_public,
            "hasApi": self.has_api,
            "hasMcp": self.has_mcp,
            "requiresAuth": self.requires_auth,
            "detectedMethods": self.detected_methods,
            "apiEndpoint": self.api_endpoint,
            "mcpServer": self.mcp_server,
            "authType": self.auth_type,
            "robotsAllowsScraping": self.robots_allows_scraping,
            "responseTimeMs": self.response_time_ms,
            "error": self.error,
        }


class WebsiteScanner:
    """
    Scans websites to determine the best access method for the Planner Agent.

    Detection Strategy:
    1. HTTP HEAD → reachability + public access check
    2. Check robots.txt → scraping permissions
    3. Probe common API endpoints → API discovery
    4. Check MCP registry → MCP server availability
    5. Inspect auth headers → authentication requirements
    """

    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout
        self._http_config = {
            "timeout": timeout,
            "follow_redirects": True,
            "headers": {
                "User-Agent": "CreationStudio-PolicyScanner/1.0",
                "Accept": "text/html,application/json",
            },
        }

    async def scan(self, domain: str) -> ScanResult:
        """
        Perform a comprehensive capability scan of a domain.

        Returns a ScanResult with detected access methods.
        """
        result = ScanResult(domain=domain)

        # Normalize domain
        if not domain.startswith("http"):
            url = f"https://{domain}"
        else:
            url = domain
            domain = urlparse(url).netloc

        result.domain = domain

        try:
            async with httpx.AsyncClient(**self._http_config) as client:
                # Step 1: Reachability + public access check
                await self._check_reachability(client, url, result)

                if not result.is_reachable:
                    result.error = f"Cannot reach {domain}"
                    return result

                # Step 2: Check robots.txt for scrape permissions
                await self._check_robots(client, url, result)

                # Step 3: Probe for API endpoints
                await self._check_api(client, url, result)

                # Step 4: Check MCP registry
                self._check_mcp(domain, result)

                # Step 5: Determine auth requirements from headers
                await self._check_auth(client, url, result)

                # Build detected methods list
                self._build_methods(result)

        except Exception as e:
            logger.error("Scan failed for %s: %s", domain, e)
            result.error = str(e)

        logger.info(
            "Scan complete for %s: methods=%s, api=%s, mcp=%s, auth=%s",
            domain,
            result.detected_methods,
            result.has_api,
            result.has_mcp,
            result.requires_auth,
        )

        return result

    async def _check_reachability(
        self, client: httpx.AsyncClient, url: str, result: ScanResult
    ) -> None:
        """Check if the site is reachable and publicly accessible."""
        try:
            import time

            start = time.time()
            resp = await client.head(url)
            result.response_time_ms = (time.time() - start) * 1000

            result.is_reachable = True
            result.is_public = resp.status_code in (200, 301, 302, 304)

            if resp.status_code in (401, 403):
                result.requires_auth = True
                result.is_public = False

        except httpx.ConnectError:
            result.is_reachable = False
        except httpx.TimeoutException:
            result.is_reachable = False
            result.error = "Connection timed out"

    async def _check_robots(
        self, client: httpx.AsyncClient, url: str, result: ScanResult
    ) -> None:
        """Check robots.txt for scraping permissions."""
        try:
            parsed = urlparse(url)
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
            resp = await client.get(robots_url)

            if resp.status_code == 200:
                content = resp.text.lower()
                # Check if our user-agent or * is disallowed from /
                if "disallow: /" in content and "user-agent: *" in content:
                    result.robots_allows_scraping = False
                else:
                    result.robots_allows_scraping = True
            else:
                # No robots.txt = scraping allowed
                result.robots_allows_scraping = True

        except Exception:
            result.robots_allows_scraping = True  # Default: allow

    async def _check_api(
        self, client: httpx.AsyncClient, url: str, result: ScanResult
    ) -> None:
        """Probe common API endpoint patterns."""
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        for path in API_DISCOVERY_PATHS:
            try:
                api_url = f"{base}{path}"
                resp = await client.head(api_url)

                if resp.status_code in (200, 204, 301, 302):
                    result.has_api = True
                    result.api_endpoint = api_url

                    # Check content type for JSON API
                    ct = resp.headers.get("content-type", "")
                    if "json" in ct or "openapi" in ct:
                        logger.info("Detected JSON API at %s", api_url)

                    break  # Found an API endpoint

                elif resp.status_code == 401:
                    # API exists but requires auth
                    result.has_api = True
                    result.api_endpoint = api_url
                    result.requires_auth = True
                    break

            except (httpx.ConnectError, httpx.TimeoutException):
                continue

    def _check_mcp(self, domain: str, result: ScanResult) -> None:
        """Check if the domain has a known MCP server."""
        # Check exact match
        if domain in MCP_REGISTRY:
            result.has_mcp = True
            result.mcp_server = MCP_REGISTRY[domain]
            return

        # Check parent domain match (e.g., api.github.com → github.com)
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            parent = ".".join(parts[i:])
            if parent in MCP_REGISTRY:
                result.has_mcp = True
                result.mcp_server = MCP_REGISTRY[parent]
                return

    async def _check_auth(
        self, client: httpx.AsyncClient, url: str, result: ScanResult
    ) -> None:
        """Determine authentication type from response headers."""
        try:
            resp = await client.head(url)

            # Check WWW-Authenticate header
            www_auth = resp.headers.get("www-authenticate", "").lower()
            if www_auth:
                result.requires_auth = True
                if "bearer" in www_auth:
                    result.auth_type = "oauth"
                elif "basic" in www_auth:
                    result.auth_type = "basic"
                elif "negotiate" in www_auth:
                    result.auth_type = "saml"

            # Check for OAuth meta headers
            link_header = resp.headers.get("link", "")
            if "oauth" in link_header.lower():
                result.requires_auth = True
                result.auth_type = "oauth"

            # Check for API key patterns in docs
            if not result.auth_type and result.requires_auth:
                result.auth_type = "api_key"  # Default assumption

        except Exception:
            pass

    def _build_methods(self, result: ScanResult) -> None:
        """Build the final list of detected access methods."""
        methods = []

        if result.is_public and result.robots_allows_scraping:
            methods.append("scrape")

        if result.has_api:
            methods.append("api")

        if result.has_mcp:
            methods.append("mcp")

        if result.requires_auth:
            methods.append("authenticated")

        # If nothing detected but reachable, default to scrape
        if not methods and result.is_reachable:
            methods.append("scrape")

        result.detected_methods = methods


# ─── FastAPI Integration ────────────────────────────────
# This function is intended to be mounted as a route in the existing server.

async def scan_website_handler(domain: str) -> dict:
    """
    API handler for POST /api/scan-website

    Request body: { "domain": "github.com" }
    Response: ScanResult as JSON

    Usage:
        @app.post("/api/scan-website")
        async def scan(body: dict):
            return await scan_website_handler(body["domain"])
    """
    scanner = WebsiteScanner()
    result = await scanner.scan(domain)
    return result.to_dict()


# ─── CLI Usage ──────────────────────────────────────────
if __name__ == "__main__":
    import sys

    async def main():
        domains = sys.argv[1:] or ["github.com", "docs.aws.com", "linkedin.com"]
        scanner = WebsiteScanner()

        for domain in domains:
            print(f"\n{'='*60}")
            print(f"Scanning: {domain}")
            print(f"{'='*60}")

            result = await scanner.scan(domain)
            import json
            print(json.dumps(result.to_dict(), indent=2))

    asyncio.run(main())
