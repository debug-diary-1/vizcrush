# vizcrush Architecture & Workflow Diagrams

## 1. High-Level Data Flow

```mermaid
flowchart TB
    subgraph APP["Your Application"]
        DS[("Data Source<br/>API, CSV, WebSocket")]
        CL["Chart Library<br/>D3, Three.js, Plotly, Canvas"]
    end

    subgraph VC["vizcrush"]
        INIT["init() → detect capabilities"]

        subgraph ENGINE["Compute Engine"]
            WASM["WASM<br/>(Rust compiled)"]
            JS["JS Fallback"]
        end

        subgraph ALGOS["Algorithm Layer"]
            DOWN["Downsample<br/>LTTB, MinMax,<br/>M4, LTOB"]
            BIN["Bin<br/>histogram, bin2d,<br/>hexbin, bin3d"]
            SPAT["Spatial<br/>Quadtree, kd-tree,<br/>Octree, kNN,<br/>Frustum Cull"]
            AGG["Aggregate<br/>Stats, Streaming,<br/>Percentiles,<br/>t-digest"]
            TRANS["Transform<br/>Sort, Normalize,<br/>Filter"]
        end

        MCP["MCP Server<br/>24 tools · 3 prompts · 2 resources"]
    end

    DS -->|"Raw Data<br/>Float64Array<br/>(millions of points)"| INIT
    INIT --> ENGINE
    ENGINE --> ALGOS
    ALGOS -->|"Optimized Data<br/>Float64Array<br/>(thousands of points)"| CL
    MCP -.->|"AI Agents<br/>stdio / HTTP"| ALGOS

    style VC fill:#0d1117,stroke:#3b9ecf,stroke-width:2px,color:#e0e0e8
    style ENGINE fill:#111827,stroke:#4f46e5,color:#a5b4fc
    style ALGOS fill:#111827,stroke:#22c55e,color:#bbf7d0
    style APP fill:#1a1a2e,stroke:#6b7280,color:#e0e0e8
```

## 2. Compute Backend Selection

Only two paths are real: WASM (one SIMD-enabled binary, always built — there is
no separate scalar build) and the pure-JS core. There is no WebGPU compute
path; `detectCapabilities()` still probes `navigator.gpu` for reporting, but
`selectBackend()` never returns it (see `packages/core/src/types.ts` and ADR
0002/0003, which found WASM's real advantage to be engine-dependent, not a
GPU-vs-CPU story).

```mermaid
flowchart TD
    CALL(["algorithm called<br/>e.g. lttb(x, y, threshold)"]) --> OPT{"backend option?"}

    OPT -->|"'js'"| JSFORCED["JS core"]
    OPT -->|"'wasm'"| WASMFORCED{"WASM module<br/>loaded?"}
    OPT -->|"'auto' (default)"| SIZE{"input size ≥<br/>auto threshold?<br/>(1000, per-kernel)"}

    SIZE -->|No| JSAUTO["JS core"]
    SIZE -->|Yes| WASMAUTO{"WASM module<br/>loaded?"}

    WASMFORCED -->|Yes| WASM["WASM"]
    WASMFORCED -->|"No / load failed"| JSFALLBACK["JS core<br/>(graceful fallback)"]
    WASMAUTO -->|Yes| WASM
    WASMAUTO -->|"No / load failed"| JSFALLBACK

    style WASM fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    style JSFORCED fill:#7f1d1d,stroke:#ef4444,color:#fecaca
    style JSAUTO fill:#7f1d1d,stroke:#ef4444,color:#fecaca
    style JSFALLBACK fill:#7f1d1d,stroke:#ef4444,color:#fecaca
```

## 3. WASM Module Loading

```mermaid
sequenceDiagram
    participant Browser
    participant TS as TypeScript Package
    participant WASM as WASM Binary
    participant Rust as Rust Algorithms

    Browser->>TS: import '@vizcrush/downsample'
    TS->>TS: loadWasm() called on import

    alt WASM files exist (after build-wasm.sh)
        TS->>WASM: dynamic import('../wasm/vizcrush_*.js')
        WASM->>WASM: WebAssembly.instantiate()
        WASM-->>TS: wasmReady = true
        Note over TS,Rust: All calls route through Rust WASM
        Browser->>TS: lttb(x, y, 1920)
        TS->>Rust: WASM lttb() (or JS core fallback)
        Rust-->>TS: interleaved Float64Array
        TS-->>Browser: { x: Float64Array, y: Float64Array }
    else WASM files missing (dev mode)
        TS->>TS: catch → wasmReady = false
        Note over TS: Silent fallback, no 404 errors
        Browser->>TS: lttb(x, y, 1920)
        TS->>TS: JS lttbSync() fallback
        TS-->>Browser: { x: Float64Array, y: Float64Array }
    end
```

## 4. LTTB Downsampling Algorithm

```mermaid
flowchart TD
    INPUT["Input: 1,000,000 points<br/>(x: Float64Array, y: Float64Array)"] --> FIRST["Keep first point"]

    FIRST --> DIVIDE["Divide remaining into<br/>1,918 equal buckets"]

    DIVIDE --> LOOP["For each bucket i"]

    LOOP --> AVG["Compute average (x, y)<br/>of NEXT bucket<br/>(look-ahead)"]

    AVG --> TRIANGLE["For each candidate point<br/>in current bucket:<br/>Triangle area = |cross product|<br/>of (prev_selected, candidate, next_avg)"]

    TRIANGLE --> MAX["Keep point with<br/>LARGEST triangle area<br/>(most visually significant)"]

    MAX --> NEXT{"More<br/>buckets?"}
    NEXT -->|Yes| LOOP
    NEXT -->|No| LAST["Keep last point"]

    LAST --> OUTPUT["Output: 1,920 points<br/>O(n) single pass<br/>~2ms for 1M points"]

    style INPUT fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    style OUTPUT fill:#166534,stroke:#22c55e,color:#bbf7d0
    style TRIANGLE fill:#78350f,stroke:#f59e0b,color:#fef3c7
```

## 5. Octree Build & Query

```mermaid
flowchart TD
    subgraph BUILD["BUILD (one-time, ~200ms @ 500K)"]
        B1["500K 3D points"] --> B2["Find bounds<br/>Add padding"]
        B2 --> B3["Root node<br/>contains all points"]
        B3 --> B4{"Points > 64?"}
        B4 -->|Yes| B5["Split into 8 octants<br/>(2³ = 8 children)"]
        B5 --> B4
        B4 -->|No| B6["Leaf node<br/>Store point indices"]
    end

    subgraph RANGE["RANGE QUERY (<1ms)"]
        R1["Query box:<br/>(xMin,xMax,yMin,yMax,zMin,zMax)"] --> R2{"Box intersects<br/>node bounds?"}
        R2 -->|No| R3["🚫 SKIP<br/>entire subtree"]
        R2 -->|Yes| R4{"Box fully<br/>contains node?"}
        R4 -->|Yes| R5["✅ RETURN<br/>all points in subtree"]
        R4 -->|No| R6["Check individual<br/>points + recurse<br/>into children"]
    end

    subgraph KNN["kNN QUERY (0.3ms)"]
        K1["Query point (px,py,pz)<br/>k = 10"] --> K2["Search nearer<br/>child first"]
        K2 --> K3["Update candidate<br/>list + max distance"]
        K3 --> K4{"Split plane<br/>closer than<br/>best candidate?"}
        K4 -->|Yes| K5["Search farther<br/>child too"]
        K4 -->|No| K6["🚫 PRUNE<br/>farther child"]
    end

    style BUILD fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    style RANGE fill:#166534,stroke:#22c55e,color:#bbf7d0
    style KNN fill:#4c1d95,stroke:#8b5cf6,color:#ddd6fe
```

## 6. LOD (Level of Detail) Pipeline

```mermaid
flowchart LR
    CAM["📷 Camera<br/>Position"] --> BANDS

    subgraph BANDS["Distance Bands"]
        NEAR["🟢 NEAR<br/>< 100 units<br/>Every point<br/>(full density)"]
        MID["🟡 MID<br/>100-250 units<br/>Every 4th point<br/>(25% density)"]
        FAR["🔴 FAR<br/>> 250 units<br/>Every 16th point<br/>(6% density)"]
    end

    NEAR --> MERGE["Merge subsets"]
    MID --> MERGE
    FAR --> MERGE

    MERGE --> RESULT["500K total → 60-80K rendered<br/>72-85% savings<br/>Visually identical"]
    RESULT --> RENDERER["Three.js / Canvas<br/>renders at 60fps"]

    style NEAR fill:#166534,stroke:#22c55e,color:#bbf7d0
    style MID fill:#78350f,stroke:#f59e0b,color:#fef3c7
    style FAR fill:#7f1d1d,stroke:#ef4444,color:#fecaca
```

## 7. WGSL Shaders (One Wired, Four Drafts)

Five `.wgsl` compute shaders live alongside the TypeScript source:

- `packages/bin/src/shaders/bin2d.wgsl` — **wired** as an opt-in compute path
  (`bin2d(..., { backend: "webgpu" })`, silent fallback to wasm/js). Measured
  correct but ~15× slower than WASM at every tested size on Apple
  Silicon/Metal — see ADR 0004; it is never auto-selected.
- `packages/bin/src/shaders/hexbin.wgsl`
- `packages/bin3d/src/shaders/bin3d.wgsl`
- `packages/spatial/src/shaders/quadtree.wgsl`
- `packages/spatial3d/src/shaders/octree-morton.wgsl`

The four drafts are design sketches only — nothing compiles or dispatches
them. Default compute always runs on WASM or the JS core, as shown in
section 2; `webgpu` is a per-call request on bin2d, never a selected
backend (ADR 0002/0004).

## 8. MCP Server Architecture

```mermaid
flowchart TB
    subgraph AGENTS["AI Agents"]
        CC["Claude Code"]
        CUR["Cursor"]
        VSC["VS Code Copilot"]
    end

    subgraph TRANSPORT["Transport Layer"]
        STDIO["stdio<br/>(default, local)"]
        HTTP["Streamable HTTP<br/>(port 3847, remote)"]
    end

    subgraph SERVER["@vizcrush/mcp-server"]
        subgraph TOOLS["Tools (23)"]
            T1["vizcrush_lttb<br/>vizcrush_minmax_lttb<br/>vizcrush_auto_downsample"]
            T2["vizcrush_histogram<br/>vizcrush_bin2d<br/>vizcrush_bin3d"]
            T3["vizcrush_build_index<br/>vizcrush_query_range<br/>vizcrush_build_index_3d<br/>vizcrush_query_range_3d<br/>vizcrush_frustum_cull"]
            T4["vizcrush_stats<br/>vizcrush_normalize<br/>vizcrush_sort"]
            T5["vizcrush_load_file<br/>vizcrush_inspect_file<br/>vizcrush_capabilities<br/>vizcrush_benchmark"]
        end

        PROMPTS["Prompts (3)<br/>optimize_chart<br/>profile_data<br/>migration_guide"]

        RESOURCES["Resources (2)<br/>vizcrush://indexes<br/>vizcrush://indexes/{id}"]
    end

    CC --> STDIO
    CUR --> STDIO
    VSC --> STDIO
    CC -.-> HTTP

    STDIO --> SERVER
    HTTP --> SERVER

    style AGENTS fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    style SERVER fill:#0d1117,stroke:#3b9ecf,color:#e0e0e8
```

## 9. Package Dependency Graph

```mermaid
flowchart BT
    CORE["@vizcrush/core<br/>init, detectCapabilities,<br/>selectBackend, defineKernel, types"]

    DOWN["@vizcrush/downsample"] --> CORE
    BIN["@vizcrush/bin"] --> CORE
    AGG["@vizcrush/aggregate"] --> CORE
    TRANS["@vizcrush/transform"] --> CORE
    SPAT["@vizcrush/spatial"] --> CORE
    SPAT3D["@vizcrush/spatial3d"] --> CORE
    BIN3D["@vizcrush/bin3d"] --> CORE

    REACT["@vizcrush/react<br/>useDownsample, useBin2d,<br/>useStats, useStreamingStats"] --> DOWN
    REACT --> BIN
    REACT --> AGG
    REACT --> TRANS
    REACT --> SPAT

    MCP["@vizcrush/mcp-server<br/>24 tools, 3 prompts"] --> DOWN
    MCP --> BIN
    MCP --> AGG
    MCP --> TRANS

    style CORE fill:#166534,stroke:#22c55e,color:#bbf7d0
    style REACT fill:#4c1d95,stroke:#8b5cf6,color:#ddd6fe
    style MCP fill:#78350f,stroke:#f59e0b,color:#fef3c7
```

## 10. Rust Crate Dependency Graph

```mermaid
flowchart BT
    RCORE["vizcrush-core<br/>shared bounds-finding"]

    RDOWN["vizcrush-downsample<br/>LTTB, MinMax, M4, LTOB"]
    RBIN["vizcrush-bin<br/>histogram, bin2d, hexbin"] --> RCORE
    RTRANS["vizcrush-transform<br/>radix sort, normalize, filter"]
    RSPAT["vizcrush-spatial<br/>quadtree, hash grid<br/>(kd-tree: Rust-only, unwired)"] --> RCORE
    RSPAT3D["vizcrush-spatial3d<br/>octree, frustum cull"] --> RCORE
    RBIN3D["vizcrush-bin3d<br/>voxel binning"] --> RCORE

    RAGG["vizcrush-aggregate<br/>stats, streaming,<br/>append+downsample<br/>(t-digest: Rust-only, unwired)"]
    RAGG --> RDOWN

    style RCORE fill:#166534,stroke:#22c55e,color:#bbf7d0
    style RAGG fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
```

## 11. Build Pipeline

```mermaid
flowchart LR
    subgraph RUST["Rust Source"]
        RS["crates/*.rs"]
    end

    subgraph WASM_BUILD["WASM Build"]
        CARGO["cargo build<br/>--target wasm32<br/>SIMD128 enabled"]
        BINDGEN["wasm-bindgen<br/>--target web"]
        OPT["wasm-opt -O3"]
    end

    subgraph TS_BUILD["TypeScript Build"]
        TSC["tsc<br/>(turbo orchestrated)"]
    end

    subgraph SHADERS["WGSL Shader Drafts"]
        WGSL["*.wgsl files<br/>unwired drafts<br/>(not built, not dispatched)"]
    end

    subgraph OUTPUT["Output"]
        WASM_OUT[".wasm binaries<br/>(15-42KB each)"]
        JS_OUT[".js + .d.ts<br/>packages/*/dist/"]
    end

    subgraph TESTS["Test Suite"]
        RTEST["cargo test<br/>158 Rust tests"]
        VTEST["vitest run<br/>179 TS tests"]
        BENCH["benchmarks<br/>regression checks"]
    end

    RS --> CARGO --> OPT --> BINDGEN --> WASM_OUT
    RS --> RTEST
    TSC --> JS_OUT
    JS_OUT --> VTEST
    WASM_OUT --> VTEST
    JS_OUT --> BENCH

    style RUST fill:#78350f,stroke:#f59e0b,color:#fef3c7
    style OUTPUT fill:#166534,stroke:#22c55e,color:#bbf7d0
    style TESTS fill:#4c1d95,stroke:#8b5cf6,color:#ddd6fe
```

## 12. Three.js Integration Pattern

```mermaid
flowchart TD
    DATA["Generate / Load<br/>1M 3D points"] --> BUILD["vizcrush: buildOctree()<br/>one-time build cost"]

    BUILD --> TREE["Octree in memory"]

    subgraph FRAME["Every Frame (60fps)"]
        CAM["Camera moves"] --> LOD["vizcrush: LOD selection<br/>Near=full, Mid=1/4, Far=1/16"]
        LOD --> SUBSET["~60-80K points selected"]

        CAM --> KNN["vizcrush: queryNearest3d()<br/>0.3ms for hover tooltip"]

        SUBSET --> UPLOAD["Update Three.js<br/>BufferGeometry"]
        UPLOAD --> RENDER["Three.js WebGL<br/>renders subset"]
    end

    TREE --> LOD
    TREE --> KNN

    style BUILD fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    style FRAME fill:#0d1117,stroke:#3b9ecf,color:#e0e0e8
    style KNN fill:#166534,stroke:#22c55e,color:#bbf7d0
```
