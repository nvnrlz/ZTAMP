"""
policy_engine.py — Temporary Policy-as-Code Engine for Access Restriction

This module defines the access restriction policies that govern which websites
the Planner Agent is allowed to access and HOW it may access them.

This is the TEMPORARY implementation used for development and testing.
Once the Policy Creator UI (PolicyCreatorPage.tsx) generates production
policies, this module will be replaced by a policy loader that reads
the generated JSON/Rego policies.

Architecture:
  ┌───────────────────────────────────────┐
  │         PolicyEngine                  │
  │                                       │
  │  check_access(domain) → AccessRule    │
  │  get_allowed_domains() → list         │
  │  resolve_search_domains(query) → list │
  └───────────────────────────────────────┘

Current test policy:
  - docs.aws.amazon.com  → scrape (Crawl4AI)
  - repost.aws           → scrape (Crawl4AI, for AWS re:Post Q&A)
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("policy_engine")


# ─── Access Rule ────────────────────────────────────────

@dataclass
class AccessRule:
    """Defines how the Planner Agent is allowed to access a specific domain."""

    domain: str
    allowed: bool = False
    access_mode: str = "denied"  # scrape, api, mcp, authenticated, denied
    display_name: str = ""
    search_prefix: str = ""     # e.g. "site:docs.aws.amazon.com" for focused search
    api_endpoint: Optional[str] = None
    mcp_server: Optional[str] = None
    auth_type: Optional[str] = None
    max_pages_per_query: int = 3
    priority: int = 1           # lower = higher priority for domain resolution
    tags: list[str] = field(default_factory=list)  # e.g. ["aws", "cloud", "documentation"]

    def to_dict(self) -> dict:
        return {
            "domain": self.domain,
            "allowed": self.allowed,
            "access_mode": self.access_mode,
            "display_name": self.display_name,
            "search_prefix": self.search_prefix,
            "api_endpoint": self.api_endpoint,
            "mcp_server": self.mcp_server,
            "auth_type": self.auth_type,
            "max_pages_per_query": self.max_pages_per_query,
            "priority": self.priority,
            "tags": self.tags,
        }


# ─── Domain Keyword Mapping ────────────────────────────
# Maps user-intent keywords → relevant domain(s)
# Used in Phase 1 (Intent & Domain Resolution) to determine
# which sites to crawl based on what the user is asking about.

DOMAIN_KEYWORD_MAP: dict[str, list[str]] = {
    # AWS services → docs.aws.amazon.com
    "aws": ["docs.aws.amazon.com"],
    "s3": ["docs.aws.amazon.com"],
    "ec2": ["docs.aws.amazon.com"],
    "lambda": ["docs.aws.amazon.com"],
    "vpc": ["docs.aws.amazon.com"],
    "iam": ["docs.aws.amazon.com"],
    "rds": ["docs.aws.amazon.com"],
    "dynamodb": ["docs.aws.amazon.com"],
    "cloudformation": ["docs.aws.amazon.com"],
    "cloudfront": ["docs.aws.amazon.com"],
    "sqs": ["docs.aws.amazon.com"],
    "sns": ["docs.aws.amazon.com"],
    "ecs": ["docs.aws.amazon.com"],
    "eks": ["docs.aws.amazon.com"],
    "route53": ["docs.aws.amazon.com"],
    "cloudwatch": ["docs.aws.amazon.com"],
    "kinesis": ["docs.aws.amazon.com"],
    "redshift": ["docs.aws.amazon.com"],
    "elasticache": ["docs.aws.amazon.com"],
    "api gateway": ["docs.aws.amazon.com"],
    "step functions": ["docs.aws.amazon.com"],
    "sagemaker": ["docs.aws.amazon.com"],
    "aurora": ["docs.aws.amazon.com"],
    "fargate": ["docs.aws.amazon.com"],
    "nat gateway": ["docs.aws.amazon.com"],
    "security group": ["docs.aws.amazon.com"],
    "subnet": ["docs.aws.amazon.com"],
    "elastic ip": ["docs.aws.amazon.com"],
    "load balancer": ["docs.aws.amazon.com"],
    "auto scaling": ["docs.aws.amazon.com"],
    "elb": ["docs.aws.amazon.com"],
    "alb": ["docs.aws.amazon.com"],
    "nlb": ["docs.aws.amazon.com"],
    "waf": ["docs.aws.amazon.com"],
    "secrets manager": ["docs.aws.amazon.com"],
    "parameter store": ["docs.aws.amazon.com"],
    "ssm": ["docs.aws.amazon.com"],
    "codebuild": ["docs.aws.amazon.com"],
    "codepipeline": ["docs.aws.amazon.com"],
    "codecommit": ["docs.aws.amazon.com"],
    "codedeploy": ["docs.aws.amazon.com"],
    "eventbridge": ["docs.aws.amazon.com"],
    "glue": ["docs.aws.amazon.com"],
    "athena": ["docs.aws.amazon.com"],
    "emr": ["docs.aws.amazon.com"],
    "elasticbeanstalk": ["docs.aws.amazon.com"],
    "lightsail": ["docs.aws.amazon.com"],
    "amplify": ["docs.aws.amazon.com"],
    "appsync": ["docs.aws.amazon.com"],
    "cognito": ["docs.aws.amazon.com"],

    # AWS community → repost.aws
    "re:post": ["repost.aws"],
    "repost": ["repost.aws"],

    # Catch-all: any "cloud" or "infrastructure" query defaults to AWS
    "cloud": ["docs.aws.amazon.com"],
    "infrastructure": ["docs.aws.amazon.com"],
    "terraform": ["docs.aws.amazon.com"],  # often used with AWS
    "bucket": ["docs.aws.amazon.com"],
    "instance": ["docs.aws.amazon.com"],
}


class PolicyEngine:
    """
    Evaluates access policies for the Planner Agent.

    In production, this will load policies generated by the Policy Creator UI.
    For now, it uses a hard-coded policy that only allows access to AWS docs.
    """

    def __init__(self):
        self._rules: dict[str, AccessRule] = {}
        self._load_test_policy()
        logger.info(
            "PolicyEngine initialized with %d domain rules: %s",
            len(self._rules),
            list(self._rules.keys()),
        )

    def _load_test_policy(self) -> None:
        """Load the temporary testing policy (AWS docs only)."""

        # ── Rule 1: AWS Documentation (Primary) ──
        self._rules["docs.aws.amazon.com"] = AccessRule(
            domain="docs.aws.amazon.com",
            allowed=True,
            access_mode="scrape",
            display_name="AWS Documentation",
            search_prefix="site:docs.aws.amazon.com",
            max_pages_per_query=3,
            priority=1,
            tags=["aws", "cloud", "documentation", "official"],
        )

        # ── Rule 2: AWS re:Post (Community Q&A) ──
        self._rules["repost.aws"] = AccessRule(
            domain="repost.aws",
            allowed=True,
            access_mode="scrape",
            display_name="AWS re:Post",
            search_prefix="site:repost.aws",
            max_pages_per_query=2,
            priority=2,
            tags=["aws", "community", "qa"],
        )

    # ── Policy Evaluation ──────────────────────────────

    def check_access(self, domain: str) -> AccessRule:
        """
        Check if a domain is allowed by the active policy.

        Returns the AccessRule for the domain.
        If the domain is not whitelisted, returns a denied rule.
        """
        normalized = domain.lower().strip().rstrip("/")

        # Exact match
        if normalized in self._rules:
            return self._rules[normalized]

        # Subdomain match (e.g. "api.docs.aws.amazon.com" → "docs.aws.amazon.com")
        parts = normalized.split(".")
        for i in range(len(parts)):
            parent = ".".join(parts[i:])
            if parent in self._rules:
                return self._rules[parent]

        # Not whitelisted → denied
        return AccessRule(
            domain=normalized,
            allowed=False,
            access_mode="denied",
            display_name=normalized,
        )

    def get_allowed_domains(self) -> list[AccessRule]:
        """Get all currently whitelisted domains."""
        return [r for r in self._rules.values() if r.allowed]

    def resolve_search_domains(self, query: str) -> list[AccessRule]:
        """
        Given a user query, determine which whitelisted domains
        are relevant and should be searched.

        Strategy:
        1. Tokenize the user query
        2. Match tokens against DOMAIN_KEYWORD_MAP
        3. Return matching AccessRules, sorted by priority

        If no specific keywords match, returns ALL allowed domains
        (broad search).
        """
        query_lower = query.lower()
        matched_domains: set[str] = set()

        for keyword, domains in DOMAIN_KEYWORD_MAP.items():
            # Use word boundary matching for short keywords to avoid false positives
            if len(keyword) <= 3:
                pattern = rf"\b{re.escape(keyword)}\b"
                if re.search(pattern, query_lower):
                    matched_domains.update(domains)
            else:
                if keyword in query_lower:
                    matched_domains.update(domains)

        # If we matched specific domains, return only those
        if matched_domains:
            rules = [
                self._rules[d] for d in matched_domains
                if d in self._rules and self._rules[d].allowed
            ]
            rules.sort(key=lambda r: r.priority)
            logger.info(
                "Domain resolution for '%s…': %s",
                query[:50],
                [r.domain for r in rules],
            )
            return rules

        # No specific keywords → return all allowed domains
        all_allowed = self.get_allowed_domains()
        all_allowed.sort(key=lambda r: r.priority)
        logger.info(
            "No domain keywords matched for '%s…' — using all allowed: %s",
            query[:50],
            [r.domain for r in all_allowed],
        )
        return all_allowed

    def get_policy_summary(self) -> dict:
        """Get a summary of the active policy for health checks."""
        return {
            "policy_type": "temporary_test_policy",
            "total_rules": len(self._rules),
            "allowed_domains": [
                {"domain": r.domain, "mode": r.access_mode, "name": r.display_name}
                for r in self._rules.values()
                if r.allowed
            ],
            "note": "This is a temporary policy for development. "
                    "Production policies will be generated by the Policy Creator UI.",
        }
