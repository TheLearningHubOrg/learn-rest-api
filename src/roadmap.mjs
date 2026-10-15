/**
 * The Learning Hub - REST API Architecture & HTTP Semantics Roadmap
 */

export const REST_STAGES = [
  {
    stageNumber: 1,
    title: "Fielding Constraints & The Richardson Maturity Model",
    domainFocus: "Client-Server separation, statelessness, cacheability, uniform interface, Levels 0-3 (POX to HATEOAS)",
    completed: true,
    keyTopics: ["Roy Fielding's 5 Constraints", "Level 0: POX RPC", "Level 1: Distinct URIs", "Level 2: Verbs & Statuses", "Level 3: HATEOAS Links"]
  },
  {
    stageNumber: 2,
    title: "HTTP Protocol Mechanics, Verbs & Idempotency Invariants",
    domainFocus: "Safe vs Idempotent matrix, conditional requests (ETags, If-None-Match), Cache-Control headers",
    completed: true,
    keyTopics: ["Safe & Idempotent Verbs (GET/PUT/DELETE)", "POST vs PUT vs PATCH", "Weak & Strong ETags", "Cache-Control & 304 Not Modified"]
  },
  {
    stageNumber: 3,
    title: "Resource Modeling, URI Design & Keyset Cursor Pagination",
    domainFocus: "Hierarchical URIs, plural nouns, query string filtering, offset vs keyset pagination performance",
    completed: true,
    keyTopics: ["Plural Resource Nouns", "O(1) Keyset Cursor Pagination", "Filtering, Sparse Fieldsets, Sorting", "Deep Sub-Resources"]
  },
  {
    stageNumber: 4,
    title: "API Versioning Strategies & RFC 7807 Error Standards",
    domainFocus: "URI vs Header vs Content Negotiation versioning, application/problem+json data contract",
    completed: true,
    keyTopics: ["URI Path Versioning (/v1)", "Accept Header Negotiation", "RFC 7807 ProblemDetails Schema", "Backward Compatibility Rules"]
  },
  {
    stageNumber: 5,
    title: "Idempotency Keys, Rate Limiting & Security Hardening",
    domainFocus: "Distributed Idempotency-Key deduplication, sliding window rate limits, CORS, TLS termination",
    completed: true,
    keyTopics: ["Idempotency-Key Header Caching", "429 Too Many Requests & Retry-After", "CORS Preflight (OPTIONS)", "Bearer JWT Auth"]
  },
  {
    stageNumber: 6,
    title: "OpenAPI 3.1 Specification, Contract Testing & Mocking",
    domainFocus: "JSON Schema 2020-12 alignment, Prism mock servers, automated contract verification with Spectral",
    completed: true,
    keyTopics: ["OpenAPI 3.1 AST Structure", "Spectral Linter Governance", "Prism HTTP Mocking", "Consumer-Driven Contract Tests"]
  },
  {
    stageNumber: 7,
    title: "Staff API Architect Interview Handbook & Cheatsheet",
    domainFocus: "40+ staff scenario Q&As, breaking change migration without downtime, zombie lock recovery",
    completed: true,
    keyTopics: ["Dual-Writing Migration Strategy", "Thundering Herd Mitigation", "Global Multi-Region Latency", "Enterprise Production Cheatsheet"]
  }
];

export function getCompletedCount() {
  return REST_STAGES.filter(s => s.completed).length;
}

export function getProgressPercentage() {
  return Math.round((getCompletedCount() / REST_STAGES.length) * 100);
}
