# Azure Mission-Critical Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Plexus architecture project containing six diagrams modelling the Microsoft Azure Well-Architected Framework Mission-Critical reference architecture, one diagram per WAF design area.

**Architecture:** Use the `mcp__plexus__create_project` MCP tool to open the Plexus New Project dialog (user confirms interactively), then write six `.diagram` JSON files into the resulting project folder. No TODL files are authored — the project relies on the meta-model the user selects at creation time.

**Tech Stack:** Plexus MCP tools (`mcp__plexus__create_project`, `mcp__plexus__refresh_project`, `mcp__plexus__get_problems`), mural diagram JSON format v3, PowerShell / Write tool for file I/O.

**Spec:** `docs/superpowers/specs/2026-09-02-azure-mission-critical-architecture-design.md`

## Global Constraints

- Diagram files use mural JSON format `version: 3` exactly — no other version.
- The file content is the raw JSON string written directly to disk — no wrapper object, no extra keys.
- All node IDs must be unique strings within a diagram.
- Child nodes that belong inside a container node must set `visuals[id].parentId` to the container's ID.
- All coordinates are **absolute** (not relative to the parent container).
- `nextId` must be set to a value larger than any auto-generated numeric ID the runtime might assign — use `100` as a safe default.
- Do not author any `.todl` files — the meta-model selected at creation time supplies all concept types.

---

## Diagram JSON Schema Reference

Every `.diagram` file has this root shape:

```json
{
  "version": 3,
  "nodes": [ /* node objects */ ],
  "visuals": { /* nodeId → visual object */ },
  "connectors": [ /* connector objects */ ],
  "nextId": 100
}
```

**Node object:**
```json
{ "id": "unique-id", "type": "shape|container|text", "data": { ... } }
```

- `type: "shape"` → `data` has `kind` (`"rectangle"`, `"circle"`, etc.), optional `fill`, optional `text`
- `type: "container"` → `data` has optional `text` and `fill`

**Fill object:**
```json
{ "type": "solid", "color": "#RRGGBB", "opacity": 1 }
```

**Text object inside data:**
```json
{ "content": "Label", "fontSize": 12, "fontWeight": "Normal", "align": "Center" }
```

**Visual object:**
```json
{ "left": 100, "top": 200, "w": 180, "h": 60 }
```
Add `"parentId": "container-id"` when the node belongs inside a container.

**Connector object:**
```json
{
  "source": { "nodeId": "a" },
  "target": { "nodeId": "b" },
  "routingMode": "orthogonal",
  "text": { "content": "label", "fontSize": 10 }
}
```
Omit `text` when no label is needed. `routingMode` is one of `"straight"`, `"orthogonal"`, `"bezier"`.

---

## Task 1: Create the Plexus Project

**Files:**
- No files are written in this step — the MCP tool opens Plexus UI dialog; user confirms.

**Interfaces:**
- Produces: `PROJECT_FOLDER` — the absolute path returned in `CreateProjectResult.folder`. Every subsequent task writes files under this path.

- [ ] **Step 1: Call create_project**

```
mcp__plexus__create_project({
  name: "Azure Mission-Critical Architecture",
  type: "architecture"
})
```

The Plexus New Project dialog opens. The user selects a meta-model (e.g. `ea` or `tech-architecture`) and optionally libraries (e.g. `microsoft`), then clicks Create.

- [ ] **Step 2: Capture the project folder**

The tool returns a `CreateProjectResult`. Read the `folder` field — this is `PROJECT_FOLDER`. All six diagram files go directly into this directory (no subdirectory). If `cancelled: true` is returned, stop and ask the user to retry.

- [ ] **Step 3: Verify the manifest exists**

Read `{PROJECT_FOLDER}/project.plexus` and confirm it is valid JSON with `"type": "architecture"`.

- [ ] **Step 4: Commit**

```bash
git add "{PROJECT_FOLDER}"
git commit -m "feat: scaffold Azure Mission-Critical Architecture Plexus project"
```

---

## Task 2: Application Design Diagram

**Files:**
- Create: `{PROJECT_FOLDER}/app-design.diagram`

**Interfaces:**
- Consumes: `PROJECT_FOLDER` from Task 1.
- Produces: `app-design.diagram` — models the request/event flow across the AKS-based microservices within a regional stamp.

- [ ] **Step 1: Write the file**

Write the following JSON to `{PROJECT_FOLDER}/app-design.diagram`:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "front-door",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Azure Front Door", "fontSize": 13, "fontWeight": "Bold", "align": "Center" }
      }
    },
    {
      "id": "stamp",
      "type": "container",
      "data": {
        "text": { "content": "Regional Stamp  (Active-Active × N regions)", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#EFF6FF", "opacity": 1 }
      }
    },
    {
      "id": "aks",
      "type": "container",
      "data": {
        "text": { "content": "AKS Cluster", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#F5F5F5", "opacity": 1 }
      }
    },
    {
      "id": "ingestion",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Ingestion Service", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "service-bus",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#E87722", "opacity": 1 },
        "text": { "content": "Azure Service Bus", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "workflow",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Workflow Service", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "delivery",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Delivery Service", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "package",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Package Service", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "drone",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Drone Scheduler", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "redis",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#C00000", "opacity": 1 },
        "text": { "content": "Azure Managed Redis", "fontSize": 12, "align": "Center" }
      }
    }
  ],
  "visuals": {
    "front-door":  { "left": 590, "top": 30,  "w": 220, "h": 60 },
    "stamp":       { "left": 30,  "top": 130, "w": 1340, "h": 760 },
    "aks":         { "left": 60,  "top": 175, "w": 1280, "h": 580, "parentId": "stamp" },
    "ingestion":   { "left": 580, "top": 235, "w": 220,  "h": 60,  "parentId": "aks" },
    "service-bus": { "left": 580, "top": 360, "w": 220,  "h": 60,  "parentId": "aks" },
    "workflow":    { "left": 580, "top": 485, "w": 220,  "h": 60,  "parentId": "aks" },
    "delivery":    { "left": 160, "top": 620, "w": 200,  "h": 60,  "parentId": "aks" },
    "package":     { "left": 580, "top": 620, "w": 200,  "h": 60,  "parentId": "aks" },
    "drone":       { "left": 1000,"top": 620, "w": 200,  "h": 60,  "parentId": "aks" },
    "redis":       { "left": 1000,"top": 485, "w": 200,  "h": 60,  "parentId": "aks" }
  },
  "connectors": [
    { "source": { "nodeId": "front-door" }, "target": { "nodeId": "ingestion" },  "routingMode": "orthogonal", "text": { "content": "HTTPS", "fontSize": 10 } },
    { "source": { "nodeId": "ingestion" },  "target": { "nodeId": "service-bus" },"routingMode": "orthogonal", "text": { "content": "enqueue ⇢", "fontSize": 10 } },
    { "source": { "nodeId": "service-bus" },"target": { "nodeId": "workflow" },   "routingMode": "orthogonal", "text": { "content": "consume ⇢", "fontSize": 10 } },
    { "source": { "nodeId": "workflow" },   "target": { "nodeId": "delivery" },   "routingMode": "orthogonal" },
    { "source": { "nodeId": "workflow" },   "target": { "nodeId": "package" },    "routingMode": "orthogonal" },
    { "source": { "nodeId": "workflow" },   "target": { "nodeId": "drone" },      "routingMode": "orthogonal" },
    { "source": { "nodeId": "delivery" },   "target": { "nodeId": "redis" },      "routingMode": "orthogonal", "text": { "content": "cache", "fontSize": 10 } }
  ],
  "nextId": 100
}
```

- [ ] **Step 2: Verify JSON is valid**

Parse the file as JSON (e.g. `Get-Content app-design.diagram | ConvertFrom-Json`). If it throws, fix the JSON before continuing.

- [ ] **Step 3: Commit**

```bash
git add "{PROJECT_FOLDER}/app-design.diagram"
git commit -m "feat: add Application Design diagram (WAF mission-critical)"
```

---

## Task 3: Networking & Connectivity Diagram

**Files:**
- Create: `{PROJECT_FOLDER}/networking.diagram`

**Interfaces:**
- Consumes: `PROJECT_FOLDER` from Task 1.
- Produces: `networking.diagram` — models the perimeter-to-workload network control (no public internet to workload resources).

- [ ] **Step 1: Write the file**

Write the following JSON to `{PROJECT_FOLDER}/networking.diagram`:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "internet",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#767676", "opacity": 1 },
        "text": { "content": "Internet / Client", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "front-door",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Azure Front Door + WAF", "fontSize": 13, "fontWeight": "Bold", "align": "Center" }
      }
    },
    {
      "id": "vnet",
      "type": "container",
      "data": {
        "text": { "content": "Azure Virtual Network (per region)", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#EFF6FF", "opacity": 1 }
      }
    },
    {
      "id": "pub-subnet",
      "type": "container",
      "data": {
        "text": { "content": "Public Subnet", "fontSize": 10, "align": "Center" },
        "fill": { "type": "solid", "color": "#DDEEFF", "opacity": 1 }
      }
    },
    {
      "id": "load-balancer",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Internal Load Balancer", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "aks-subnet",
      "type": "container",
      "data": {
        "text": { "content": "AKS Subnet", "fontSize": 10, "align": "Center" },
        "fill": { "type": "solid", "color": "#F5F5F5", "opacity": 1 }
      }
    },
    {
      "id": "ingress",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Ingress Controller", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "aks-cluster",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "AKS Cluster", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "pe-subnet",
      "type": "container",
      "data": {
        "text": { "content": "Private Endpoints Subnet", "fontSize": 10, "align": "Center" },
        "fill": { "type": "solid", "color": "#FFF4E6", "opacity": 1 }
      }
    },
    {
      "id": "cosmos-pe",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "Cosmos DB\nPrivate Endpoint", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "sb-pe",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#E87722", "opacity": 1 },
        "text": { "content": "Service Bus\nPrivate Endpoint", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "mgmt-subnet",
      "type": "container",
      "data": {
        "text": { "content": "Management Subnet", "fontSize": 10, "align": "Center" },
        "fill": { "type": "solid", "color": "#F9F0FF", "opacity": 1 }
      }
    },
    {
      "id": "bastion",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#5C2D91", "opacity": 1 },
        "text": { "content": "Azure Bastion", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "private-dns",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#004E8C", "opacity": 1 },
        "text": { "content": "Private DNS Zone", "fontSize": 12, "align": "Center" }
      }
    }
  ],
  "visuals": {
    "internet":     { "left": 580, "top": 20,  "w": 240, "h": 50 },
    "front-door":   { "left": 510, "top": 110, "w": 380, "h": 60 },
    "vnet":         { "left": 30,  "top": 220, "w": 1340, "h": 720 },
    "pub-subnet":   { "left": 60,  "top": 270, "w": 420, "h": 160, "parentId": "vnet" },
    "load-balancer":{ "left": 130, "top": 315, "w": 200, "h": 60,  "parentId": "pub-subnet" },
    "aks-subnet":   { "left": 60,  "top": 470, "w": 420, "h": 200, "parentId": "vnet" },
    "ingress":      { "left": 90,  "top": 520, "w": 180, "h": 60,  "parentId": "aks-subnet" },
    "aks-cluster":  { "left": 310, "top": 520, "w": 140, "h": 60,  "parentId": "aks-subnet" },
    "pe-subnet":    { "left": 540, "top": 270, "w": 380, "h": 300, "parentId": "vnet" },
    "cosmos-pe":    { "left": 570, "top": 320, "w": 200, "h": 60,  "parentId": "pe-subnet" },
    "sb-pe":        { "left": 570, "top": 440, "w": 200, "h": 60,  "parentId": "pe-subnet" },
    "mgmt-subnet":  { "left": 980, "top": 270, "w": 340, "h": 160, "parentId": "vnet" },
    "bastion":      { "left": 1010,"top": 315, "w": 200, "h": 60,  "parentId": "mgmt-subnet" },
    "private-dns":  { "left": 470, "top": 760, "w": 260, "h": 60,  "parentId": "vnet" }
  },
  "connectors": [
    { "source": { "nodeId": "internet" },     "target": { "nodeId": "front-door" },  "routingMode": "orthogonal", "text": { "content": "HTTPS", "fontSize": 10 } },
    { "source": { "nodeId": "front-door" },   "target": { "nodeId": "load-balancer" },"routingMode": "orthogonal", "text": { "content": "private link", "fontSize": 10 } },
    { "source": { "nodeId": "load-balancer" },"target": { "nodeId": "ingress" },     "routingMode": "orthogonal" },
    { "source": { "nodeId": "ingress" },      "target": { "nodeId": "aks-cluster" }, "routingMode": "orthogonal" },
    { "source": { "nodeId": "aks-cluster" },  "target": { "nodeId": "cosmos-pe" },   "routingMode": "orthogonal", "text": { "content": "read/write", "fontSize": 10 } },
    { "source": { "nodeId": "aks-cluster" },  "target": { "nodeId": "sb-pe" },       "routingMode": "orthogonal", "text": { "content": "enqueue/consume", "fontSize": 10 } }
  ],
  "nextId": 100
}
```

- [ ] **Step 2: Verify JSON is valid**

Parse the file: `Get-Content networking.diagram | ConvertFrom-Json`. Fix any errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add "{PROJECT_FOLDER}/networking.diagram"
git commit -m "feat: add Networking & Connectivity diagram (WAF mission-critical)"
```

---

## Task 4: Data Platform Diagram

**Files:**
- Create: `{PROJECT_FOLDER}/data-platform.diagram`

**Interfaces:**
- Consumes: `PROJECT_FOLDER` from Task 1.
- Produces: `data-platform.diagram` — models global Cosmos DB geo-replication and per-stamp messaging/cache/storage topology.

- [ ] **Step 1: Write the file**

Write the following JSON to `{PROJECT_FOLDER}/data-platform.diagram`:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "global",
      "type": "container",
      "data": {
        "text": { "content": "Global Layer — Cosmos DB (multi-region write)", "fontSize": 11, "fontWeight": "Bold", "align": "Center" },
        "fill": { "type": "solid", "color": "#E6F2FF", "opacity": 1 }
      }
    },
    {
      "id": "cosmos-east",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "Cosmos DB\nEast US\n(primary write)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "cosmos-west",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "Cosmos DB\nWest US\n(write replica)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "cosmos-europe",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "Cosmos DB\nNorth Europe\n(write replica)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "stamp-a",
      "type": "container",
      "data": {
        "text": { "content": "Regional Stamp A  (East US)", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#EFF6FF", "opacity": 1 }
      }
    },
    {
      "id": "sb-a",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#E87722", "opacity": 1 },
        "text": { "content": "Azure Service Bus\nNamespace", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "redis-a",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#C00000", "opacity": 1 },
        "text": { "content": "Azure Managed Redis\n(delivery state cache)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "storage-a",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#004E8C", "opacity": 1 },
        "text": { "content": "Azure Storage\nAccount", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "stamp-b",
      "type": "container",
      "data": {
        "text": { "content": "Regional Stamp B  (West US)", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#EFF6FF", "opacity": 1 }
      }
    },
    {
      "id": "sb-b",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#E87722", "opacity": 1 },
        "text": { "content": "Azure Service Bus\nNamespace", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "redis-b",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#C00000", "opacity": 1 },
        "text": { "content": "Azure Managed Redis\n(delivery state cache)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "storage-b",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#004E8C", "opacity": 1 },
        "text": { "content": "Azure Storage\nAccount", "fontSize": 11, "align": "Center" }
      }
    }
  ],
  "visuals": {
    "global":        { "left": 30,   "top": 30,  "w": 1340, "h": 220 },
    "cosmos-east":   { "left": 120,  "top": 100, "w": 220,  "h": 80,  "parentId": "global" },
    "cosmos-west":   { "left": 570,  "top": 100, "w": 220,  "h": 80,  "parentId": "global" },
    "cosmos-europe": { "left": 1020, "top": 100, "w": 220,  "h": 80,  "parentId": "global" },
    "stamp-a":       { "left": 30,   "top": 310, "w": 580,  "h": 320 },
    "sb-a":          { "left": 80,   "top": 380, "w": 200,  "h": 70,  "parentId": "stamp-a" },
    "redis-a":       { "left": 80,   "top": 490, "w": 200,  "h": 70,  "parentId": "stamp-a" },
    "storage-a":     { "left": 350,  "top": 435, "w": 200,  "h": 70,  "parentId": "stamp-a" },
    "stamp-b":       { "left": 690,  "top": 310, "w": 580,  "h": 320 },
    "sb-b":          { "left": 740,  "top": 380, "w": 200,  "h": 70,  "parentId": "stamp-b" },
    "redis-b":       { "left": 740,  "top": 490, "w": 200,  "h": 70,  "parentId": "stamp-b" },
    "storage-b":     { "left": 1010, "top": 435, "w": 200,  "h": 70,  "parentId": "stamp-b" }
  },
  "connectors": [
    { "source": { "nodeId": "cosmos-east" },   "target": { "nodeId": "cosmos-west" },   "routingMode": "straight", "text": { "content": "geo-replication", "fontSize": 10 } },
    { "source": { "nodeId": "cosmos-west" },   "target": { "nodeId": "cosmos-east" },   "routingMode": "straight" },
    { "source": { "nodeId": "cosmos-west" },   "target": { "nodeId": "cosmos-europe" }, "routingMode": "straight", "text": { "content": "geo-replication", "fontSize": 10 } },
    { "source": { "nodeId": "cosmos-europe" }, "target": { "nodeId": "cosmos-west" },   "routingMode": "straight" },
    { "source": { "nodeId": "cosmos-east" },   "target": { "nodeId": "sb-a" },          "routingMode": "orthogonal", "text": { "content": "write", "fontSize": 10 } },
    { "source": { "nodeId": "cosmos-west" },   "target": { "nodeId": "sb-b" },          "routingMode": "orthogonal", "text": { "content": "write", "fontSize": 10 } }
  ],
  "nextId": 100
}
```

- [ ] **Step 2: Verify JSON is valid**

Parse: `Get-Content data-platform.diagram | ConvertFrom-Json`. Fix any errors.

- [ ] **Step 3: Commit**

```bash
git add "{PROJECT_FOLDER}/data-platform.diagram"
git commit -m "feat: add Data Platform diagram (WAF mission-critical)"
```

---

## Task 5: Deployment & Testing Diagram

**Files:**
- Create: `{PROJECT_FOLDER}/deployment.diagram`

**Interfaces:**
- Consumes: `PROJECT_FOLDER` from Task 1.
- Produces: `deployment.diagram` — models the CI/CD pipeline stages and deployment stamp lifecycle (left-to-right pipeline).

- [ ] **Step 1: Write the file**

Write the following JSON to `{PROJECT_FOLDER}/deployment.diagram`:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "github-repo",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#24292E", "opacity": 1 },
        "text": { "content": "GitHub\nRepository", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "gha",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#2088FF", "opacity": 1 },
        "text": { "content": "GitHub Actions\nPipeline", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "iac",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "IaC Provision\n(Bicep)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "stamp-a-deploy",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Stamp A\nHelm Deploy", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "load-test",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#5C2D91", "opacity": 1 },
        "text": { "content": "Load Testing\nGate", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "canary",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#E87722", "opacity": 1 },
        "text": { "content": "Canary\nTraffic Shift", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "stamp-b-deploy",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Stamp B\nHelm Deploy", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "rollout",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "Full Traffic\nRollout", "fontSize": 11, "align": "Center" }
      }
    }
  ],
  "visuals": {
    "github-repo":   { "left": 40,   "top": 200, "w": 160, "h": 70 },
    "gha":           { "left": 260,  "top": 200, "w": 160, "h": 70 },
    "iac":           { "left": 480,  "top": 200, "w": 160, "h": 70 },
    "stamp-a-deploy":{ "left": 700,  "top": 200, "w": 160, "h": 70 },
    "load-test":     { "left": 920,  "top": 200, "w": 160, "h": 70 },
    "canary":        { "left": 1140, "top": 200, "w": 160, "h": 70 },
    "stamp-b-deploy":{ "left": 1360, "top": 200, "w": 160, "h": 70 },
    "rollout":       { "left": 1580, "top": 200, "w": 160, "h": 70 }
  },
  "connectors": [
    { "source": { "nodeId": "github-repo" },    "target": { "nodeId": "gha" },            "routingMode": "straight", "text": { "content": "push", "fontSize": 10 } },
    { "source": { "nodeId": "gha" },            "target": { "nodeId": "iac" },            "routingMode": "straight", "text": { "content": "provision", "fontSize": 10 } },
    { "source": { "nodeId": "iac" },            "target": { "nodeId": "stamp-a-deploy" }, "routingMode": "straight", "text": { "content": "deploy", "fontSize": 10 } },
    { "source": { "nodeId": "stamp-a-deploy" }, "target": { "nodeId": "load-test" },      "routingMode": "straight" },
    { "source": { "nodeId": "load-test" },      "target": { "nodeId": "canary" },         "routingMode": "straight", "text": { "content": "pass", "fontSize": 10 } },
    { "source": { "nodeId": "canary" },         "target": { "nodeId": "stamp-b-deploy" }, "routingMode": "straight" },
    { "source": { "nodeId": "stamp-b-deploy" }, "target": { "nodeId": "rollout" },        "routingMode": "straight", "text": { "content": "100% traffic", "fontSize": 10 } }
  ],
  "nextId": 100
}
```

- [ ] **Step 2: Verify JSON is valid**

Parse: `Get-Content deployment.diagram | ConvertFrom-Json`. Fix any errors.

- [ ] **Step 3: Commit**

```bash
git add "{PROJECT_FOLDER}/deployment.diagram"
git commit -m "feat: add Deployment & Testing diagram (WAF mission-critical)"
```

---

## Task 6: Operational Procedures Diagram

**Files:**
- Create: `{PROJECT_FOLDER}/operations.diagram`

**Interfaces:**
- Consumes: `PROJECT_FOLDER` from Task 1.
- Produces: `operations.diagram` — models global observability, distributed tracing, Azure Policy enforcement, and alert → runbook flows.

- [ ] **Step 1: Write the file**

Write the following JSON to `{PROJECT_FOLDER}/operations.diagram`:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "global",
      "type": "container",
      "data": {
        "text": { "content": "Global Observability", "fontSize": 11, "fontWeight": "Bold", "align": "Center" },
        "fill": { "type": "solid", "color": "#E6F2FF", "opacity": 1 }
      }
    },
    {
      "id": "log-analytics",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Log Analytics\nWorkspace", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "azure-monitor",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Azure Monitor", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "stamp-a",
      "type": "container",
      "data": {
        "text": { "content": "Regional Stamp A", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#EFF6FF", "opacity": 1 }
      }
    },
    {
      "id": "appinsights-a",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#5C2D91", "opacity": 1 },
        "text": { "content": "Application Insights", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "microservices-a",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Microservices (AKS)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "stamp-b",
      "type": "container",
      "data": {
        "text": { "content": "Regional Stamp B", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#EFF6FF", "opacity": 1 }
      }
    },
    {
      "id": "appinsights-b",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#5C2D91", "opacity": 1 },
        "text": { "content": "Application Insights", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "microservices-b",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Microservices (AKS)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "policy",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#004E8C", "opacity": 1 },
        "text": { "content": "Azure Policy", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "alert-rules",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#D13438", "opacity": 1 },
        "text": { "content": "Alert Rules", "fontSize": 12, "align": "Center" }
      }
    },
    {
      "id": "runbook",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "Runbook /\nAction Group", "fontSize": 12, "align": "Center" }
      }
    }
  ],
  "visuals": {
    "global":         { "left": 30,   "top": 30,  "w": 1340, "h": 170 },
    "log-analytics":  { "left": 400,  "top": 85,  "w": 240,  "h": 60,  "parentId": "global" },
    "azure-monitor":  { "left": 700,  "top": 85,  "w": 220,  "h": 60,  "parentId": "global" },
    "stamp-a":        { "left": 30,   "top": 260, "w": 560,  "h": 280 },
    "appinsights-a":  { "left": 70,   "top": 320, "w": 200,  "h": 60,  "parentId": "stamp-a" },
    "microservices-a":{ "left": 340,  "top": 320, "w": 200,  "h": 60,  "parentId": "stamp-a" },
    "stamp-b":        { "left": 670,  "top": 260, "w": 560,  "h": 280 },
    "appinsights-b":  { "left": 710,  "top": 320, "w": 200,  "h": 60,  "parentId": "stamp-b" },
    "microservices-b":{ "left": 980,  "top": 320, "w": 200,  "h": 60,  "parentId": "stamp-b" },
    "policy":         { "left": 180,  "top": 630, "w": 220,  "h": 60 },
    "alert-rules":    { "left": 560,  "top": 630, "w": 220,  "h": 60 },
    "runbook":        { "left": 940,  "top": 630, "w": 220,  "h": 60 }
  },
  "connectors": [
    { "source": { "nodeId": "microservices-a" }, "target": { "nodeId": "appinsights-a" },  "routingMode": "orthogonal", "text": { "content": "telemetry", "fontSize": 10 } },
    { "source": { "nodeId": "microservices-b" }, "target": { "nodeId": "appinsights-b" },  "routingMode": "orthogonal", "text": { "content": "telemetry", "fontSize": 10 } },
    { "source": { "nodeId": "appinsights-a" },   "target": { "nodeId": "log-analytics" },  "routingMode": "orthogonal" },
    { "source": { "nodeId": "appinsights-b" },   "target": { "nodeId": "log-analytics" },  "routingMode": "orthogonal" },
    { "source": { "nodeId": "log-analytics" },   "target": { "nodeId": "azure-monitor" },  "routingMode": "straight" },
    { "source": { "nodeId": "azure-monitor" },   "target": { "nodeId": "alert-rules" },    "routingMode": "orthogonal" },
    { "source": { "nodeId": "alert-rules" },     "target": { "nodeId": "runbook" },        "routingMode": "straight", "text": { "content": "trigger", "fontSize": 10 } },
    { "source": { "nodeId": "policy" },          "target": { "nodeId": "microservices-a" },"routingMode": "orthogonal", "text": { "content": "enforce", "fontSize": 10 } },
    { "source": { "nodeId": "policy" },          "target": { "nodeId": "microservices-b" },"routingMode": "orthogonal", "text": { "content": "enforce", "fontSize": 10 } }
  ],
  "nextId": 100
}
```

- [ ] **Step 2: Verify JSON is valid**

Parse: `Get-Content operations.diagram | ConvertFrom-Json`. Fix any errors.

- [ ] **Step 3: Commit**

```bash
git add "{PROJECT_FOLDER}/operations.diagram"
git commit -m "feat: add Operational Procedures diagram (WAF mission-critical)"
```

---

## Task 7: Security Diagram

**Files:**
- Create: `{PROJECT_FOLDER}/security.diagram`

**Interfaces:**
- Consumes: `PROJECT_FOLDER` from Task 1.
- Produces: `security.diagram` — models the Zero Trust boundary: Entra ID managed identity auth, Key Vault secret management, Defender for Containers, private endpoints, TLS, and RBAC.

- [ ] **Step 1: Write the file**

Write the following JSON to `{PROJECT_FOLDER}/security.diagram`:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "entra",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "Microsoft Entra ID\n(workload identity)", "fontSize": 13, "fontWeight": "Bold", "align": "Center" }
      }
    },
    {
      "id": "stamp",
      "type": "container",
      "data": {
        "text": { "content": "Regional Stamp  (Zero Trust boundary)", "fontSize": 11, "align": "Center" },
        "fill": { "type": "solid", "color": "#FFF4E6", "opacity": 1 }
      }
    },
    {
      "id": "aks-workload",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#0078D4", "opacity": 1 },
        "text": { "content": "AKS Workload\n(Managed Identity)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "key-vault",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#FFB900", "opacity": 1 },
        "text": { "content": "Azure Key Vault\n(secrets & certs)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "defender",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#A4262C", "opacity": 1 },
        "text": { "content": "Microsoft Defender\nfor Containers", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "private-ep",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#004E8C", "opacity": 1 },
        "text": { "content": "Private Endpoints\n(no public surface)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "tls",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#107C10", "opacity": 1 },
        "text": { "content": "TLS Termination\n(cert rotation)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "rbac",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#5C2D91", "opacity": 1 },
        "text": { "content": "Azure RBAC\n(least-privilege)", "fontSize": 11, "align": "Center" }
      }
    },
    {
      "id": "resources",
      "type": "shape",
      "data": {
        "kind": "rectangle",
        "fill": { "type": "solid", "color": "#767676", "opacity": 1 },
        "text": { "content": "Protected Resources", "fontSize": 12, "align": "Center" }
      }
    }
  ],
  "visuals": {
    "entra":       { "left": 540, "top": 30,  "w": 300, "h": 60 },
    "stamp":       { "left": 30,  "top": 140, "w": 1340, "h": 580 },
    "aks-workload":{ "left": 80,  "top": 230, "w": 240,  "h": 70,  "parentId": "stamp" },
    "key-vault":   { "left": 520, "top": 230, "w": 220,  "h": 70,  "parentId": "stamp" },
    "defender":    { "left": 960, "top": 230, "w": 240,  "h": 70,  "parentId": "stamp" },
    "private-ep":  { "left": 80,  "top": 410, "w": 240,  "h": 70,  "parentId": "stamp" },
    "tls":         { "left": 520, "top": 410, "w": 220,  "h": 70,  "parentId": "stamp" },
    "rbac":        { "left": 960, "top": 410, "w": 240,  "h": 70,  "parentId": "stamp" },
    "resources":   { "left": 520, "top": 590, "w": 220,  "h": 60,  "parentId": "stamp" }
  },
  "connectors": [
    { "source": { "nodeId": "aks-workload" }, "target": { "nodeId": "entra" },      "routingMode": "orthogonal", "text": { "content": "auth (managed identity)", "fontSize": 10 } },
    { "source": { "nodeId": "aks-workload" }, "target": { "nodeId": "key-vault" },  "routingMode": "orthogonal", "text": { "content": "secret fetch", "fontSize": 10 } },
    { "source": { "nodeId": "defender" },     "target": { "nodeId": "aks-workload" },"routingMode": "orthogonal", "text": { "content": "protect", "fontSize": 10 } },
    { "source": { "nodeId": "tls" },          "target": { "nodeId": "aks-workload" },"routingMode": "orthogonal", "text": { "content": "TLS enforcement", "fontSize": 10 } },
    { "source": { "nodeId": "rbac" },         "target": { "nodeId": "resources" },  "routingMode": "orthogonal", "text": { "content": "authorize", "fontSize": 10 } },
    { "source": { "nodeId": "private-ep" },   "target": { "nodeId": "resources" },  "routingMode": "orthogonal", "text": { "content": "private access only", "fontSize": 10 } }
  ],
  "nextId": 100
}
```

- [ ] **Step 2: Verify JSON is valid**

Parse: `Get-Content security.diagram | ConvertFrom-Json`. Fix any errors.

- [ ] **Step 3: Commit**

```bash
git add "{PROJECT_FOLDER}/security.diagram"
git commit -m "feat: add Security diagram (WAF mission-critical)"
```

---

## Task 8: Verify and Final Commit

**Files:**
- No new files. Verification and cleanup only.

**Interfaces:**
- Consumes: all six `.diagram` files from Tasks 2–7.

- [ ] **Step 1: Refresh the project**

```
mcp__plexus__refresh_project({})
```

Confirm the result shows the `Azure Mission-Critical Architecture` project with no critical errors.

- [ ] **Step 2: Check for problems**

```
mcp__plexus__get_problems({})
```

Review the output. Diagram files have no TODL validation — any problems here would be from the manifest binding. If problems appear referencing a meta-model that isn't installed, ask the user to verify the meta-model selection in the New Project dialog.

- [ ] **Step 3: Final commit**

```bash
cd "{PROJECT_FOLDER}"
git add .
git commit -m "docs: Azure Mission-Critical Architecture project — all six WAF design area diagrams complete"
```
