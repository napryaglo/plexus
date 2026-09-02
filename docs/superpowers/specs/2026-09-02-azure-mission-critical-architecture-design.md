# Azure Mission-Critical Architecture — Plexus Project Design

**Date:** 2026-09-02
**Source:** Microsoft Azure Well-Architected Framework — Mission-Critical workloads

---

## Overview

Create a Plexus architecture project that models the Microsoft Azure Mission-Critical reference architecture. The project organises six diagrams, one per WAF design area, so the project tree mirrors the official documentation structure and is navigable by concern.

The Mission-Critical pattern is the largest and most structurally rich reference architecture in the WAF catalog: multi-region active-active, AKS-based microservices, event-driven via Service Bus, global traffic distribution via Azure Front Door, geo-replicated state in Cosmos DB, and full coverage of all five WAF pillars (Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency).

---

## Project Structure

| Field | Value |
|-------|-------|
| **Name** | `Azure Mission-Critical Architecture` |
| **Type** | `architecture` |
| **Meta-model** | Selected by user in New Project dialog |
| **Libraries** | Selected by user in New Project dialog |
| **Location** | User's default projects directory |

### Diagrams

| File | WAF Design Area |
|------|----------------|
| `app-design.diagram` | Application Design |
| `networking.diagram` | Networking & Connectivity |
| `data-platform.diagram` | Data Platform |
| `deployment.diagram` | Deployment & Testing |
| `operations.diagram` | Operational Procedures |
| `security.diagram` | Security |

No custom TODL model files are authored. The project relies on the meta-model selected at creation time for concept types.

---

## Diagram Content

### 1 — Application Design (`app-design.diagram`)

Models the core request and event flow across regional stamps.

**Components:**
- Azure Front Door (global entry point)
- Regional AKS stamps (grouping boundary per region)
- Ingestion Service → Azure Service Bus (async enqueue)
- Workflow Service → Delivery Service, Package Service, Drone Scheduler (fan-out)
- Redis Cache (delivery state reads)

**Edges:** Sync calls shown as →; async/event flows shown as ⇢. Scale-unit boundaries shown as groupings around stamp-scoped components.

---

### 2 — Networking & Connectivity (`networking.diagram`)

Models the perimeter-to-workload network control model ("no public internet to workload resources").

**Components:**
- Azure Front Door + WAF (edge)
- Virtual Network per region with subnet segmentation: AKS node pool subnet, private endpoints subnet, management subnet
- Azure Bastion (operator access)
- Private DNS zones
- NSGs and UDRs

**Edges:** Traffic ingress path from internet → Front Door → private endpoint → AKS ingress controller.

---

### 3 — Data Platform (`data-platform.diagram`)

Models state, messaging, and caching topology — showing what is global vs. regional.

**Components:**
- Cosmos DB (global, multi-region write replicas)
- Azure Service Bus namespace (per regional stamp)
- Azure Managed Redis (per stamp, delivery state cache)
- Azure Storage Account (per stamp, blob/queue)

**Edges:** Replication arrows between Cosmos DB regions; consume/produce arrows between microservices and Service Bus; read/write arrows to Redis and Storage.

---

### 4 — Deployment & Testing (`deployment.diagram`)

Models the CI/CD pipeline and deployment stamp lifecycle.

**Components:**
- GitHub Actions pipeline
- Infrastructure-as-code (Bicep/Terraform) provisioning step
- Helm chart deployment to AKS stamp
- Blue/green rollout per stamp
- Canary traffic shift gate
- Load testing gate

**Edges:** Pipeline stage progression left-to-right: code commit → IaC provision → Helm deploy → canary gate → traffic shift → full rollout.

---

### 5 — Operational Procedures (`operations.diagram`)

Models observability, policy enforcement, and DevSecOps flows.

**Components:**
- Azure Monitor + Log Analytics workspace (global)
- Application Insights (per stamp)
- Distributed tracing flow across microservices
- Azure Policy (baseline enforcement)
- RBAC role assignments per DevOps function
- Alert → runbook path

**Edges:** Telemetry push from each microservice → Application Insights → Log Analytics; policy evaluation → resource; alert → runbook trigger.

---

### 6 — Security (`security.diagram`)

Models the Zero Trust boundary, identity, and secret management.

**Components:**
- Microsoft Entra ID (workload identity, managed identities)
- Azure Key Vault (per stamp, secrets and certs)
- Microsoft Defender for Containers
- Private endpoints (eliminating public surface)
- TLS everywhere with cert rotation
- Least-privilege RBAC assignments per service principal

**Edges:** Identity flows from each AKS workload → Entra ID (managed identity auth); secret fetch arrows from workloads → Key Vault; Defender → alert path.

---

## Implementation Steps

1. **Create project via MCP** — call `mcp__plexus__create_project` with `name` and `type` prefilled; user selects meta-model and libraries in the New Project dialog and confirms.
2. **Populate six diagrams** — for each diagram, add nodes and edges per the content spec above; node types follow the selected meta-model's concept vocabulary.
3. **No TODL authoring** — project relies entirely on the selected meta-model; no `.todl` files are written.
4. **Commit** — once all six diagrams are populated and reviewed, commit project files to git.

---

## References

- [Architecture pattern for mission-critical workloads on Azure](https://learn.microsoft.com/azure/well-architected/mission-critical/mission-critical-architecture-pattern)
- [Application design of mission-critical workloads](https://learn.microsoft.com/azure/well-architected/mission-critical/mission-critical-application-design)
- [Microservices architecture on AKS](https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks-microservices/aks-microservices)
- [Azure Well-Architected Framework pillars](https://learn.microsoft.com/azure/well-architected/pillars)
