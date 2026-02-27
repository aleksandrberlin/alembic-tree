import * as vscode from "vscode";

type RevisionId = string;

export interface GraphNode {
    revision: RevisionId;
    downRevisions: RevisionId[];
    filePath: string;
    label: string;
}

export interface GraphData {
    nodes: Map<RevisionId, GraphNode>;
    edges: Array<{ from: RevisionId; to: RevisionId }>;
    bases: Set<RevisionId>;
    heads: Set<RevisionId>;
}

function getNonce(): string {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeId(rev: string): string {
    return `rev:${rev}`;
}

function prettySlug(filePath: string): string {
    const base = filePath.split(/[\\/]/).pop() || filePath;
    const slug = base.replace(/\.py$/i, "");
    return slug.replace(/_/g, " ");
}

function nodeLabel(rev: string, filePath: string): string {
    return `${rev}\n(${prettySlug(filePath)})`;
}

export function openMigrationGraphWebview(
    context: vscode.ExtensionContext,
    graph: GraphData,
    title = "Alembic Migration Graph",
) {
    const panel = vscode.window.createWebviewPanel("alembicMigrationGraph", title, vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });

    const cytoscapeJs = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "cytoscape", "dist", "cytoscape.min.js"),
    );
    const dagreJs = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "dagre", "dist", "dagre.min.js"),
    );
    const cytoscapeDagreJs = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "cytoscape-dagre", "cytoscape-dagre.js"),
    );

    const elements: unknown[] = [];

    for (const [rev, n] of graph.nodes.entries()) {
        elements.push({
            data: {
                id: safeId(rev),
                rev,
                label: nodeLabel(rev, n.filePath),
                fullLabel: n.label,
                filePath: n.filePath,
                isBase: graph.bases.has(rev),
                isHead: graph.heads.has(rev),
                isMerge: n.downRevisions.length > 1,
            },
        });
    }

    for (const e of graph.edges) {
        if (!graph.nodes.has(e.from) || !graph.nodes.has(e.to)) {
            continue;
        }

        elements.push({
            data: {
                id: `edge:${e.from}->${e.to}`,
                source: safeId(e.from),
                target: safeId(e.to),
            },
        });
    }

    const nonce = getNonce();

    panel.webview.html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${panel.webview.cspSource} data:;
             style-src ${panel.webview.cspSource} 'unsafe-inline';
             script-src ${panel.webview.cspSource} 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      padding: 0;
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 2;
    }
    input[type="search"] {
      width: 420px;
      max-width: 60vw;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      outline: none;
    }
    button {
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
    }
    #cy {
      width: 100%;
      height: calc(100vh - 50px);
      display: block;
    }
    .hint {
      opacity: .75;
      font-size: 12px;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Search revision / filename..." />
    <button id="fit">Fit</button>
    <button id="layout">Relayout</button>
    <button id="latest">Focus Latest Head</button>
    <span class="hint">Click node to open file &bull; Shift+Click to copy revision</span>
  </div>

  <div id="cy"></div>

  <script nonce="${nonce}" src="${cytoscapeJs}"></script>
  <script nonce="${nonce}" src="${dagreJs}"></script>
  <script nonce="${nonce}" src="${cytoscapeDagreJs}"></script>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const elements = ${JSON.stringify(elements)};

    cytoscape.use(cytoscapeDagre);

    function themeColor(name, fallback) {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    }

    const baseColor = themeColor("--vscode-gitDecoration-addedResourceForeground", "#2ea043");
    const headColor = themeColor("--vscode-gitDecoration-modifiedResourceForeground", "#d29922");
    const fg = themeColor("--vscode-foreground", "#c9d1d9");
    const bg = themeColor("--vscode-editor-background", "#0d1117");
    const border = themeColor("--vscode-panel-border", "#30363d");

    const cy = cytoscape({
      container: document.getElementById("cy"),
      elements,
      style: [
        {
          selector: "node",
          style: {
            "label": "data(label)",
            "color": fg,
            "text-wrap": "wrap",
            "text-max-width": 300,
            "text-valign": "center",
            "text-halign": "center",
            "width": "label",
            "height": "label",
            "padding": 14,
            "shape": "round-rectangle",
            "background-color": bg,
            "border-width": 2,
            "border-color": border,
            "text-justification": "center",
            "min-zoomed-font-size": 6,
            "font-size": 12
          }
        },
        {
          selector: "edge",
          style: {
            "width": 2,
            "line-color": fg,
            "line-opacity": 0.45,
            "target-arrow-shape": "triangle",
            "target-arrow-color": fg,
            "arrow-scale": 0.8,
            "curve-style": "bezier"
          }
        },
        { selector: "node[?isBase]", style: { "border-width": 3, "border-color": baseColor } },
        {
          selector: "node[?isHead]",
          style: {
            "border-width": 3,
            "border-color": headColor,
            "background-color": headColor,
            "background-opacity": 0.15
          }
        },
        { selector: "node[?isMerge]", style: { "border-style": "double", "border-width": 4 } },
        { selector: ".dim", style: { "opacity": 0.12 } },
        { selector: ".hit", style: { "border-width": 4 } }
      ],
      wheelSensitivity: 0.18
    });

    function doLayout() {
      cy.layout({
        name: "dagre",
        rankDir: "TB",
        nodeSep: 20,
        rankSep: 40,
        edgeSep: 10,
        spacingFactor: 1.0,
        animate: false,
        nodeDimensionsIncludeLabels: true
      }).run();
    }

    cy.ready(function () {
      cy.nodes().forEach(function (n) { n.emit("style"); });
      setTimeout(function () {
        doLayout();
        cy.fit(undefined, 60);
      }, 0);
    });

    var headNodes = cy.nodes().filter(function (n) { return !!n.data("isHead"); });

    function focusLatest() {
      if (headNodes.length > 0) {
        var bb = headNodes.boundingBox();
        cy.zoom({ level: 0.75, position: { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 } });
        cy.center(headNodes);
      } else {
        cy.fit(undefined, 30);
      }
    }

    document.getElementById("fit").addEventListener("click", function () { cy.fit(undefined, 30); });
    document.getElementById("layout").addEventListener("click", function () { doLayout(); cy.fit(undefined, 30); });
    document.getElementById("latest").addEventListener("click", focusLatest);

    cy.on("tap", "node", function (evt) {
      var n = evt.target;
      var filePath = n.data("filePath");
      var rev = n.data("rev");

      if (evt.originalEvent && evt.originalEvent.shiftKey) {
        vscode.postMessage({ type: "copyRevision", revision: rev });
        return;
      }

      if (filePath) {
        vscode.postMessage({ type: "openFile", filePath: filePath });
      }
    });

    function applySearch(q) {
      var query = (q || "").trim().toLowerCase();
      cy.nodes().removeClass("dim hit");
      if (!query) { return; }

      cy.nodes().forEach(function (n) {
        var rev = (n.data("rev") || "").toLowerCase();
        var file = (n.data("filePath") || "").toLowerCase();
        var fullLabel = (n.data("fullLabel") || "").toLowerCase();
        var match = rev.includes(query) || file.includes(query) || fullLabel.includes(query);
        n.addClass(match ? "hit" : "dim");
      });
    }

    document.getElementById("q").addEventListener("input", function (e) { applySearch(e.target.value); });
  </script>
</body>
</html>`;

    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === "openFile" && typeof msg.filePath === "string" && msg.filePath.length) {
            const uri = vscode.Uri.file(msg.filePath);
            await vscode.window.showTextDocument(uri, { preview: true });
            return;
        }

        if (msg?.type === "copyRevision" && typeof msg.revision === "string") {
            await vscode.env.clipboard.writeText(msg.revision);
            vscode.window.setStatusBarMessage(`Copied revision: ${msg.revision}`, 1500);
            return;
        }
    });
}
