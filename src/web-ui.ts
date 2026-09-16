import { explainRawDump, explainRawLog } from "./explain.js";
import { toJson, toJsonRawDump, toMarkdown, toMarkdownRawDump } from "./output.js";
import { redactSensitiveData } from "./sanitiser.js";
import type { DebugPacket, EvidenceLine, ErrorPattern, RawDumpResult, Warning } from "./types.js";

const rawLogInput = getElement<HTMLTextAreaElement>("raw-log");
const analyzeButton = getElement<HTMLButtonElement>("analyze-button");
const redactToggle = getElement<HTMLInputElement>("redact-toggle");
const uploadInput = getElement<HTMLInputElement>("upload-input");
const sampleLogSelect = getElement<HTMLSelectElement>("sample-log-select");
const output = getElement<HTMLElement>("explainer-output");
const statusText = getElement<HTMLElement>("status-text");
const modeBadge = getElement<HTMLElement>("mode-badge");
const guidedModeRadio = getElement<HTMLInputElement>("mode-guided");
const rawDumpModeRadio = getElement<HTMLInputElement>("mode-rawdump");
const redactedTokenPattern = /\[REDACTED:[a-zA-Z0-9]+\]/g;
const maxRenderedListItems = 200;
const maxOverviewListItems = 3;

function formatEvidenceLine(entry: EvidenceLine): string {
  return `L${entry.line}${entry.isMatch ? "" : " (context)"}: ${entry.text}`;
}

type ExplainerMode = "guided" | "rawdump";
type PacketTab = "overview" | "evidence" | "matches" | "context" | "checks" | "raw" | "export";

interface PacketTabDefinition {
  id: PacketTab;
  label: string;
  count?: number;
  render: () => HTMLElement;
}

interface PacketActionConfig {
  markdown: string;
  json: string;
  markdownFilename: string;
  jsonFilename: string;
  rawContent: string;
}

interface SampleLog {
  id: string;
  label: string;
  content: string;
}

const sampleLogs: SampleLog[] = [
  {
    id: "timeout",
    label: "Timeout / Slow Response",
    content: [
      "2026-05-31T09:14:03Z INFO Request started GET /api/orders/active correlationId=req_7f92",
      "2026-05-31T09:14:04Z INFO User context loaded userId=synthetic-user-123",
      "2026-05-31T09:14:34Z ERROR Database timeout while executing query GetActiveOrders correlationId=req_7f92 durationMs=30000",
      "2026-05-31T09:14:34Z ERROR TimeoutException: The operation timed out after 30 seconds",
      "2026-05-31T09:14:34Z WARN Retrying request correlationId=req_7f92 attempt=1",
      "2026-05-31T09:15:04Z ERROR Retry failed correlationId=req_7f92 durationMs=30000",
      "2026-05-31T09:15:04Z INFO Request completed GET /api/orders/active status=500 durationMs=61012"
    ].join("\n")
  },
  {
    id: "auth-failure",
    label: "Authentication Failure",
    content: [
      "2026-05-31T10:02:11Z INFO Request started POST /api/auth/login correlationId=req_3a51",
      "2026-05-31T10:02:11Z INFO Client ip=203.0.113.42",
      "2026-05-31T10:02:11Z DEBUG Forwarding header Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlLWJ5dGVz",
      "2026-05-31T10:02:12Z ERROR Authentication failed: invalid token correlationId=req_3a51 userId=synthetic-user-882",
      "2026-05-31T10:02:12Z WARN Unauthorized access attempt status=401 correlationId=req_3a51",
      "2026-05-31T10:02:12Z ERROR Access denied for user email=jane.doe@example.com",
      "2026-05-31T10:02:12Z INFO Request completed POST /api/auth/login status=401 durationMs=142"
    ].join("\n")
  },
  {
    id: "crash",
    label: "Application Crash",
    content: [
      "2026-05-31T11:20:05Z INFO Request started GET /api/reports/summary correlationId=req_9c14",
      "2026-05-31T11:20:05Z INFO Loading report for userId=synthetic-user-410",
      "2026-05-31T11:20:06Z ERROR Unhandled exception: NullReferenceException: Object reference not set to an instance of an object",
      "2026-05-31T11:20:06Z ERROR   at ReportService.BuildSummary(ReportRequest request)",
      "2026-05-31T11:20:06Z ERROR   at ReportController.GetSummary(String correlationId)",
      "2026-05-31T11:20:06Z FATAL Process crashed while handling request correlationId=req_9c14",
      "2026-05-31T11:20:06Z INFO Request completed GET /api/reports/summary status=500 durationMs=812"
    ].join("\n")
  },
  {
    id: "rate-limit",
    label: "Rate Limiting",
    content: [
      "2026-05-31T14:45:00Z INFO Request started GET /api/search?q=widgets correlationId=req_5e88",
      "2026-05-31T14:45:00Z INFO Client ip=198.51.100.17",
      "2026-05-31T14:45:00Z WARN Rate limit exceeded for client correlationId=req_5e88",
      "2026-05-31T14:45:00Z ERROR Too many requests: quota exceeded (120/100 per minute) correlationId=req_5e88",
      "2026-05-31T14:45:00Z INFO Request completed GET /api/search status=429 durationMs=8",
      "2026-05-31T14:45:01Z WARN Retrying request correlationId=req_5e88 attempt=1",
      "2026-05-31T14:45:02Z ERROR Too many requests correlationId=req_5e88 status=429 durationMs=6"
    ].join("\n")
  }
];

const rawDumpSampleLogs: SampleLog[] = [
  {
    id: "mixed-incidents",
    label: "Raw Dump: Mixed Incidents",
    content: [
      "2026-06-02T08:00:01Z INFO Service booted, listening on :8080",
      "2026-06-02T08:00:14Z INFO Request started GET /api/orders/active correlationId=req_a001",
      "2026-06-02T08:00:15Z INFO Cache miss for key orders:active:synthetic-user-201",
      "2026-06-02T08:00:44Z ERROR Database timeout while executing query GetActiveOrders correlationId=req_a001 durationMs=30000",
      "2026-06-02T08:00:44Z ERROR TimeoutException: The operation timed out after 30 seconds",
      "2026-06-02T08:00:44Z WARN Retrying request correlationId=req_a001 attempt=1",
      "2026-06-02T08:01:14Z ERROR Retry failed correlationId=req_a001 durationMs=30000",
      "2026-06-02T08:01:14Z INFO Request completed GET /api/orders/active status=500 durationMs=61012",
      "2026-06-02T08:03:02Z INFO Request started POST /api/auth/login correlationId=req_a002",
      "2026-06-02T08:03:02Z INFO Client ip=203.0.113.42",
      "2026-06-02T08:03:03Z ERROR Authentication failed: invalid token correlationId=req_a002 userId=synthetic-user-882",
      "2026-06-02T08:03:03Z WARN Unauthorized access attempt status=401 correlationId=req_a002",
      "2026-06-02T08:03:03Z ERROR Access denied for user email=jane.doe@example.com",
      "2026-06-02T08:03:03Z INFO Request completed POST /api/auth/login status=401 durationMs=142",
      "2026-06-02T08:05:41Z INFO Scheduled cache warm-up started",
      "2026-06-02T08:05:41Z INFO Cache warm-up completed in 812ms",
      "2026-06-02T08:07:19Z INFO Request started GET /api/search?q=widgets correlationId=req_a003",
      "2026-06-02T08:07:19Z WARN Rate limit exceeded for client correlationId=req_a003",
      "2026-06-02T08:07:19Z ERROR Too many requests: quota exceeded (120/100 per minute) correlationId=req_a003",
      "2026-06-02T08:07:19Z INFO Request completed GET /api/search status=429 durationMs=8",
      "2026-06-02T08:09:55Z INFO Request started GET /api/reports/summary correlationId=req_a004",
      "2026-06-02T08:09:56Z ERROR Unhandled exception: NullReferenceException: Object reference not set to an instance of an object",
      "2026-06-02T08:09:56Z ERROR   at ReportService.BuildSummary(ReportRequest request)",
      "2026-06-02T08:09:56Z FATAL Process crashed while handling request correlationId=req_a004",
      "2026-06-02T08:09:56Z INFO Request completed GET /api/reports/summary status=500 durationMs=812",
      "2026-06-02T08:11:03Z INFO Health check passed",
      "2026-06-02T08:12:47Z INFO Request started GET /api/orders/active correlationId=req_a005",
      "2026-06-02T08:12:47Z ERROR TimeoutException: The operation timed out after 30 seconds",
      "2026-06-02T08:12:47Z WARN Retrying request correlationId=req_a005 attempt=1",
      "2026-06-02T08:13:17Z ERROR Retry failed correlationId=req_a005 durationMs=30000",
      "2026-06-02T08:14:02Z INFO Nightly batch job started",
      "2026-06-02T08:14:55Z INFO Nightly batch job completed"
    ].join("\n")
  }
];

let patterns: ErrorPattern[] = [];
let mode: ExplainerMode = "guided";
let activePacketTab: PacketTab = "overview";
let selectedRawDumpMatchIndex = 0;
const samplePlaceholderValue = "";

analyzeButton.addEventListener("click", () => {
  renderCurrentMode(rawLogInput.value);
});

redactToggle.addEventListener("change", () => {
  renderCurrentMode(rawLogInput.value);
});

rawLogInput.addEventListener("input", () => {
  analyzeButton.disabled = rawLogInput.value.trim().length === 0;
});

sampleLogSelect.addEventListener("change", () => {
  if (sampleLogSelect.value === samplePlaceholderValue) {
    return;
  }

  applySample(sampleLogSelect.value);
});

guidedModeRadio.addEventListener("change", () => {
  if (guidedModeRadio.checked) {
    setMode("guided");
  }
});

rawDumpModeRadio.addEventListener("change", () => {
  if (rawDumpModeRadio.checked) {
    setMode("rawdump");
  }
});

uploadInput.addEventListener("change", () => {
  const file = uploadInput.files?.[0];
  uploadInput.value = "";

  if (file === undefined) {
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    rawLogInput.value = typeof reader.result === "string" ? reader.result : "";
    analyzeButton.disabled = rawLogInput.value.trim().length === 0;
    renderCurrentMode(rawLogInput.value);
  };

  reader.onerror = () => {
    output.replaceChildren(renderSection("Unable to Analyze", `Could not read "${file.name}" as text.`));
    statusText.textContent = "Upload failed";
  };

  reader.readAsText(file);
});

populateSampleOptions();

analyzeButton.disabled = true;
statusText.textContent = "Loading error patterns...";
void loadPatternsAndInit();

async function loadPatternsAndInit(): Promise<void> {
  try {
    const response = await fetch("/patterns/default-patterns.json");

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    patterns = (await response.json()) as ErrorPattern[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.replaceChildren(renderSection("Unable to Load Error Patterns", message));
    statusText.textContent = "Failed to load error patterns";
    return;
  }

  renderEmpty();
}

function currentSampleLogs(): SampleLog[] {
  return mode === "guided" ? sampleLogs : rawDumpSampleLogs;
}

function populateSampleOptions(): void {
  const options = currentSampleLogs();
  sampleLogSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = samplePlaceholderValue;
  placeholder.textContent = "Load sample...";
  sampleLogSelect.append(placeholder);

  for (const sample of options) {
    const option = document.createElement("option");
    option.value = sample.id;
    option.textContent = sample.label;
    sampleLogSelect.append(option);
  }

  sampleLogSelect.value = samplePlaceholderValue;
}

function setMode(nextMode: ExplainerMode): void {
  mode = nextMode;
  populateSampleOptions();
  rawLogInput.placeholder =
    mode === "guided"
      ? "Paste raw log lines here..."
      : "Paste or upload a large, unconstrained log dump here...";
  modeBadge.textContent = mode === "guided" ? "Demo preview" : "Raw dump preview";
  activePacketTab = "overview";
  selectedRawDumpMatchIndex = 0;
  sampleLogSelect.value = samplePlaceholderValue;
  renderCurrentMode(rawLogInput.value);
}

function renderCurrentMode(rawContent: string): void {
  if (mode === "guided") {
    renderExplanation(rawContent);
  } else {
    renderRawDumpExplanation(rawContent);
  }
}

function applySample(id: string): void {
  const options = currentSampleLogs();
  const sample = options.find((entry) => entry.id === id) ?? options[0];
  sampleLogSelect.value = sample.id;
  rawLogInput.value = sample.content;
  analyzeButton.disabled = false;
  activePacketTab = "overview";
  selectedRawDumpMatchIndex = 0;
  renderCurrentMode(sample.content);
}

function renderExplanation(rawContent: string): void {
  if (rawContent.trim().length === 0) {
    renderEmpty();
    return;
  }

  try {
    const redact = redactToggle.checked;
    const { packet, warnings } = explainRawLog(rawContent, patterns, { redact });
    output.replaceChildren(renderGuidedDebugPacket(packet, warnings, rawContent, redact));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.replaceChildren(renderSection("Unable to Analyze", message));
    statusText.textContent = "Analysis failed";
  }
}

function renderEmpty(): void {
  output.replaceChildren(
    renderSection("Waiting for Log", "Paste a raw log to preview the kind of structured explanation this tool will produce.")
  );
  statusText.textContent = "Ready";
}

function renderRawDumpExplanation(rawContent: string): void {
  if (rawContent.trim().length === 0) {
    renderEmpty();
    return;
  }

  try {
    const redact = redactToggle.checked;
    const { result, warnings } = explainRawDump(rawContent, patterns, { redact });
    selectedRawDumpMatchIndex = Math.min(selectedRawDumpMatchIndex, Math.max(result.matches.length - 1, 0));
    output.replaceChildren(renderRawDumpDebugPacket(result, warnings, rawContent, redact));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.replaceChildren(renderSection("Unable to Analyze", message));
    statusText.textContent = "Analysis failed";
  }
}

function renderGuidedDebugPacket(
  packet: DebugPacket,
  warnings: Warning[],
  rawContent: string,
  redact: boolean
): HTMLElement {
  const exportConfig: PacketActionConfig = {
    markdown: toMarkdown(packet, warnings),
    json: toJson(packet, warnings),
    markdownFilename: "debug-packet.md",
    jsonFilename: "debug-packet.json",
    rawContent
  };
  const tabs: PacketTabDefinition[] = [
    {
      id: "overview",
      label: "Overview",
      render: () => renderGuidedOverview(packet, warnings)
    },
    {
      id: "evidence",
      label: "Evidence",
      count: packet.relevantLines.length,
      render: () => renderListSection("Evidence", packet.relevantLines.map(formatEvidenceLine), "No relevant lines extracted.", true)
    },
    {
      id: "context",
      label: "Context",
      render: () => renderContextSection(packet.context)
    },
    {
      id: "checks",
      label: "Next Checks",
      count: packet.nextChecks.length,
      render: () => renderListSection("What to Check Next", packet.nextChecks, "No next steps available.", false)
    },
    {
      id: "raw",
      label: "Raw Lines",
      count: lineCount(rawContent),
      render: () => renderRawLinesSection(rawContent, redact)
    },
    {
      id: "export",
      label: "Packet Output",
      render: () => renderExportPanel(exportConfig)
    }
  ];

  return renderPacketShell({
    title: packet.category,
    subtitle: packet.summary,
    badge: "Guided packet",
    metrics: [
      { label: "Evidence", value: `${packet.relevantLines.length}` },
      { label: "Status", value: packet.context.status ?? "Not found" }
    ],
    actions: renderPacketActions(exportConfig),
    tabs
  });
}

function renderRawDumpDebugPacket(
  result: RawDumpResult,
  warnings: Warning[],
  rawContent: string,
  redact: boolean
): HTMLElement {
  const primaryMatch = result.matches[selectedRawDumpMatchIndex];
  const exportConfig: PacketActionConfig = {
    markdown: toMarkdownRawDump(result, warnings),
    json: toJsonRawDump(result, warnings),
    markdownFilename: "raw-dump-debug-packet.md",
    jsonFilename: "raw-dump-debug-packet.json",
    rawContent
  };
  const tabs: PacketTabDefinition[] = [
    {
      id: "overview",
      label: "Overview",
      render: () => renderRawDumpOverviewPanel(result, warnings)
    },
    {
      id: "matches",
      label: "Matches",
      count: result.matches.length,
      render: () => renderRawDumpMatchesPanel(result, rawContent)
    },
    {
      id: "context",
      label: "Context",
      render: () => renderContextSection(result.context)
    },
    {
      id: "raw",
      label: "Raw Lines",
      count: lineCount(rawContent),
      render: () => renderRawLinesSection(rawContent, redact)
    },
    {
      id: "export",
      label: "Packet Output",
      render: () => renderExportPanel(exportConfig)
    }
  ];

  const analysedLines = result.totalLines - result.truncatedLineCount;
  const linesLabel =
    result.truncatedLineCount > 0
      ? `${analysedLines} of ${result.totalLines}`
      : `${result.totalLines}`;

  return renderPacketShell({
    title: primaryMatch?.category ?? "No Known Pattern Matched",
    subtitle:
      primaryMatch?.summary ??
      "None of the known issue patterns were confidently matched anywhere in this dump.",
    badge: "Raw dump packet",
    metrics: [
      { label: "Matches", value: `${result.matches.length}` },
      { label: "Lines", value: linesLabel },
      { label: "Uncategorized", value: `${result.uncategorizedLineCount}` }
    ],
    actions: renderPacketActions(exportConfig),
    tabs
  });
}

function renderPacketShell(options: {
  title: string;
  subtitle: string;
  badge: string;
  metrics: Array<{ label: string; value: string }>;
  actions: HTMLElement;
  tabs: PacketTabDefinition[];
}): HTMLElement {
  const availableTabs = options.tabs.map((tab) => tab.id);
  const activeTab = availableTabs.includes(activePacketTab) ? activePacketTab : "overview";
  const selectedTab = options.tabs.find((tab) => tab.id === activeTab) ?? options.tabs[0];

  const shell = document.createElement("article");
  shell.className = "packet-shell";

  const chrome = document.createElement("div");
  chrome.className = "packet-chrome";

  const summary = document.createElement("div");
  summary.className = "packet-summary";

  const titleBlock = document.createElement("div");
  titleBlock.className = "packet-title-block";

  const badge = document.createElement("span");
  badge.className = "packet-badge";
  badge.textContent = options.badge;

  const title = document.createElement("h3");
  title.className = "packet-title";
  title.textContent = options.title;

  const subtitle = document.createElement("p");
  subtitle.className = "packet-subtitle";
  subtitle.textContent = options.subtitle;

  titleBlock.append(badge, title, subtitle);

  const metricStrip = document.createElement("dl");
  metricStrip.className = "packet-metric-strip";

  for (const metric of options.metrics) {
    const item = document.createElement("div");
    item.className = "packet-metric";

    const label = document.createElement("dt");
    label.textContent = metric.label;

    const value = document.createElement("dd");
    value.textContent = metric.value;

    item.append(label, value);
    metricStrip.append(item);
  }

  summary.append(titleBlock, metricStrip);

  const nav = document.createElement("nav");
  nav.className = "packet-tabs";
  nav.setAttribute("aria-label", "Debug packet sections");

  for (const tab of options.tabs) {
    const button = document.createElement("button");
    button.className = tab.id === activeTab ? "packet-tab packet-tab-active" : "packet-tab";
    button.type = "button";
    button.setAttribute("aria-current", tab.id === activeTab ? "page" : "false");
    button.textContent = tab.count === undefined ? tab.label : `${tab.label} ${tab.count}`;
    button.addEventListener("click", () => {
      activePacketTab = tab.id;
      renderCurrentMode(rawLogInput.value);
    });
    nav.append(button);
  }

  const workflow = renderPacketWorkflow(options.actions);

  chrome.append(summary, workflow, nav);

  const panel = document.createElement("div");
  panel.className = "packet-panel";
  panel.append(selectedTab.render());

  shell.append(chrome, panel);
  return shell;
}

function renderGuidedOverview(packet: DebugPacket, warnings: Warning[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "diagnosis-grid";

  const diagnosis = document.createElement("section");
  diagnosis.className = "result-section diagnosis-primary";

  const summaryHeading = document.createElement("h2");
  summaryHeading.textContent = "Summary";

  const summary = document.createElement("p");
  summary.className = "diagnosis-copy";
  summary.textContent = packet.summary;

  const causeHeading = document.createElement("h2");
  causeHeading.textContent = "Likely Cause";

  const cause = document.createElement("p");
  cause.className = "diagnosis-copy";
  cause.textContent = packet.likelyCause;

  diagnosis.append(summaryHeading, summary, causeHeading, cause);

  const evidence = renderListSection(
    "Top Evidence",
    packet.relevantLines.slice(0, maxOverviewListItems).map(formatEvidenceLine),
    "No relevant lines extracted.",
    true
  );

  const checks = renderListSection(
    "First Checks",
    packet.nextChecks.slice(0, maxOverviewListItems),
    "No next steps available.",
    false
  );

  wrap.append(diagnosis, evidence, checks, renderWarningSection(warnings));
  return wrap;
}

function renderRawDumpOverviewPanel(result: RawDumpResult, warnings: Warning[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "diagnosis-grid";
  wrap.append(renderRawDumpOverview(result));

  const primaryMatch = result.matches[0];

  if (primaryMatch === undefined) {
    wrap.append(
      renderSection("No Known Pattern Matched", "None of the known issue patterns were confidently matched anywhere in this dump.")
    );
  } else {
    const section = document.createElement("section");
    section.className = "result-section diagnosis-primary";

    const heading = document.createElement("h2");
    heading.textContent = "Primary Match";

    const title = document.createElement("p");
    title.className = "match-headline";
    title.textContent = primaryMatch.category;

    const summary = document.createElement("p");
    summary.className = "diagnosis-copy";
    summary.textContent = primaryMatch.summary;

    const cause = document.createElement("p");
    cause.className = "muted";
    cause.textContent = `Likely cause: ${primaryMatch.likelyCause}`;

    section.append(heading, title, summary, cause);
    wrap.append(section);
    wrap.append(
      renderListSection(
        "Top Evidence",
        primaryMatch.relevantLines.slice(0, maxOverviewListItems).map(formatEvidenceLine),
        "No relevant lines extracted.",
        true
      )
    );
  }

  if (result.additionalMatchCount > 0) {
    wrap.append(renderAdditionalMatchesNote(result.additionalMatchCount));
  }

  wrap.append(renderWarningSection(warnings));
  return wrap;
}

function renderRawDumpMatchesPanel(result: RawDumpResult, rawContent: string): HTMLElement {
  if (result.matches.length === 0) {
    return renderSection("No Known Pattern Matched", "None of the known issue patterns were confidently matched anywhere in this dump.");
  }

  const browser = document.createElement("div");
  browser.className = "match-browser";

  const list = document.createElement("div");
  list.className = "match-list";
  list.setAttribute("aria-label", "Matched issue patterns");

  result.matches.forEach((match, index) => {
    const button = document.createElement("button");
    button.className = index === selectedRawDumpMatchIndex ? "match-selector match-selector-active" : "match-selector";
    button.type = "button";
    button.textContent = `${index + 1}. ${match.category}`;
    button.addEventListener("click", () => {
      selectedRawDumpMatchIndex = index;
      activePacketTab = "matches";
      renderCurrentMode(rawContent);
    });

    const meta = document.createElement("span");
    meta.textContent = `${match.relevantLines.length} evidence line${match.relevantLines.length === 1 ? "" : "s"}`;
    button.append(meta);
    list.append(button);
  });

  const selectedMatch = result.matches[selectedRawDumpMatchIndex] ?? result.matches[0];
  const detail = document.createElement("div");
  detail.className = "match-detail";

  const heading = document.createElement("section");
  heading.className = "result-section diagnosis-primary";

  const title = document.createElement("h2");
  title.textContent = selectedMatch.category;

  const summary = document.createElement("p");
  summary.className = "diagnosis-copy";
  summary.textContent = selectedMatch.summary;

  const cause = document.createElement("p");
  cause.className = "muted";
  cause.textContent = `Likely cause: ${selectedMatch.likelyCause}`;

  heading.append(title, summary, cause);
  detail.append(
    heading,
    renderListSection("Evidence", selectedMatch.relevantLines.map(formatEvidenceLine), "No relevant lines extracted.", true),
    renderListSection("What to Check Next", selectedMatch.nextChecks, "No next steps available.", false)
  );

  browser.append(list, detail);
  return browser;
}

function renderPacketActions(config: PacketActionConfig): HTMLElement {
  const row = document.createElement("div");
  row.className = "actions-row packet-actions";

  const copyButton = document.createElement("button");
  copyButton.className = "secondary-action";
  copyButton.type = "button";
  copyButton.textContent = "Copy Markdown";
  copyButton.addEventListener("click", () => {
    navigator.clipboard
      .writeText(config.markdown)
      .then(() => {
        statusText.textContent = "Markdown copied to clipboard";
      })
      .catch(() => {
        statusText.textContent = "Could not copy to clipboard";
      });
  });

  const downloadMarkdownButton = document.createElement("button");
  downloadMarkdownButton.className = "secondary-action";
  downloadMarkdownButton.type = "button";
  downloadMarkdownButton.textContent = "Download MD";
  downloadMarkdownButton.addEventListener("click", () => {
    downloadFile(config.markdown, config.markdownFilename, "text/markdown");
  });

  const downloadJsonButton = document.createElement("button");
  downloadJsonButton.className = "secondary-action";
  downloadJsonButton.type = "button";
  downloadJsonButton.textContent = "Download JSON";
  downloadJsonButton.addEventListener("click", () => {
    downloadFile(config.json, config.jsonFilename, "application/json");
  });

  row.append(copyButton, downloadMarkdownButton, downloadJsonButton);
  return row;
}

function renderPacketWorkflow(actions: HTMLElement): HTMLElement {
  const workflow = document.createElement("div");
  workflow.className = "packet-workflow";

  const packetStep = document.createElement("section");
  packetStep.className = "packet-step packet-step-ready";

  const packetHeading = document.createElement("h4");
  packetHeading.textContent = "Structured packet";

  const packetCopy = document.createElement("p");
  packetCopy.textContent = "Clean summary, context, evidence, checks, and warnings — ready to paste into Claude, ChatGPT, or your AI assistant of choice for a guided triage review.";

  packetStep.append(packetHeading, packetCopy, actions);

  const aiStep = document.createElement("section");
  aiStep.className = "packet-step packet-step-pending";

  const aiHeading = document.createElement("h4");
  aiHeading.textContent = "Next: In-app AI summary";

  const aiCopy = document.createElement("p");
  aiCopy.textContent = "An in-app AI call isn't built yet — see docs/integration-path.md Phase 5. In the meantime, copy or download the packet above; it includes built-in instructions for whatever AI assistant you paste it into.";

  const aiButton = document.createElement("button");
  aiButton.className = "secondary-action";
  aiButton.type = "button";
  aiButton.textContent = "Not wired yet";
  aiButton.disabled = true;
  aiButton.title = "In-app AI integration is a planned future capability (see docs/integration-path.md Phase 5) — not implemented yet. You can already hand the exported packet to an external AI assistant yourself.";

  aiStep.append(aiHeading, aiCopy, aiButton);
  workflow.append(packetStep, aiStep);
  return workflow;
}

function renderExportPanel(config: PacketActionConfig): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-section export-panel";

  const heading = document.createElement("h2");
  heading.textContent = "Structured Packet Output";

  const paragraph = document.createElement("p");
  paragraph.textContent =
    "Download or copy the structured packet — it's ready to hand to an external AI assistant (paste or upload), attach to a ticket, or archive.";

  section.append(heading, paragraph, renderPacketActions(config));
  return section;
}

function lineCount(rawContent: string): number {
  const trimmed = rawContent.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\r?\n/).length;
}

function renderRawDumpOverview(result: RawDumpResult): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-section result-grid";

  const heading = document.createElement("h2");
  heading.className = "result-grid-heading";
  heading.textContent = "Overview";

  const analysedLines = result.totalLines - result.truncatedLineCount;
  const linesLabel =
    result.truncatedLineCount > 0
      ? `${analysedLines} of ${result.totalLines} (truncated)`
      : `${result.totalLines}`;

  section.append(
    heading,
    renderMetric("Lines Analysed", linesLabel),
    renderMetric("Matches Found", `${result.matches.length}`),
    renderMetric("Uncategorized Lines", `${result.uncategorizedLineCount}`)
  );
  return section;
}

function renderAdditionalMatchesNote(additionalMatchCount: number): HTMLElement {
  return renderSection(
    "Additional Matches",
    `${additionalMatchCount} more lower-confidence match${additionalMatchCount === 1 ? "" : "es"} were found but are not shown above.`
  );
}

function renderContextSection(context: DebugPacket["context"]): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-section result-grid";

  const heading = document.createElement("h2");
  heading.className = "result-grid-heading";
  heading.textContent = "Context";

  section.append(
    heading,
    renderMetric("Correlation ID", context.correlationId ?? "Not found"),
    renderMetric("Endpoint", context.endpoint ?? "Not found"),
    renderMetric("Status", context.status ?? "Not found"),
    renderMetric("Duration", context.durationMs ? `${context.durationMs}ms` : "Not found")
  );
  return section;
}

function renderSection(title: string, body: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-section";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.textContent = body;

  section.append(heading, paragraph);
  return section;
}

function renderListSection(title: string, items: string[], emptyText: string, codeStyle: boolean): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-section";

  const heading = document.createElement("h2");
  heading.textContent = title;

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = emptyText;
    section.append(heading, empty);
    return section;
  }

  const list = document.createElement("ol");
  list.className = codeStyle ? "line-list" : "check-list";
  const cappedItems = items.slice(0, maxRenderedListItems);

  for (const item of cappedItems) {
    const listItem = document.createElement("li");
    listItem.className = codeStyle ? `log-line-item ${lineSeverityClass(item)}` : "check-list-item";
    if (codeStyle) {
      const code = document.createElement("code");
      code.append(renderLineContent(item));
      listItem.append(code);
    } else {
      listItem.textContent = item;
    }
    list.append(listItem);
  }

  section.append(heading, list);

  const hiddenCount = items.length - cappedItems.length;
  if (hiddenCount > 0) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `+${hiddenCount} more not shown.`;
    section.append(note);
  }

  return section;
}

function lineSeverityClass(text: string): string {
  if (/\b(FATAL|CRITICAL)\b/i.test(text)) {
    return "log-line-fatal";
  }

  if (/\bERROR\b/i.test(text)) {
    return "log-line-error";
  }

  if (/\bWARN(?:ING)?\b/i.test(text)) {
    return "log-line-warn";
  }

  return "log-line-info";
}

function renderLineContent(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(redactedTokenPattern)) {
    const start = match.index ?? 0;

    if (start > lastIndex) {
      fragment.append(document.createTextNode(text.slice(lastIndex, start)));
    }

    const redactedToken = document.createElement("span");
    redactedToken.className = "redacted-token";
    redactedToken.title = "Sensitive data redacted before display";
    redactedToken.textContent = match[0];
    fragment.append(redactedToken);

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    fragment.append(document.createTextNode(text.slice(lastIndex)));
  }

  return fragment;
}

function renderWarningSection(warnings: Warning[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "result-section";

  const heading = document.createElement("h2");
  heading.textContent = "Sensitive Data Warnings";

  if (warnings.length === 0) {
    const paragraph = document.createElement("p");
    paragraph.className = "muted";
    paragraph.textContent = "No sensitive-data patterns detected.";
    section.append(heading, paragraph);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "warning-list";

  for (const warning of warnings) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = warning.count > 1 ? `${warning.type} ×${warning.count}` : warning.type;
    const code = document.createElement("code");
    code.append(renderLineContent(warning.value));
    item.append(label, code);
    list.append(item);
  }

  section.append(heading, list);
  return section;
}

function renderRawLinesSection(rawContent: string, redact: boolean): HTMLElement {
  const lines = rawContent.split(/\r?\n/).map((line) => (redact ? redactSensitiveData(line) : line));
  return renderListSection("Raw Lines", lines, "No raw lines available.", true);
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderMetric(label: string, value: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "metric";

  const term = document.createElement("span");
  term.className = "metric-label";
  term.textContent = label;

  const detail = document.createElement("span");
  detail.className = "metric-value";
  detail.textContent = value;

  item.append(term, detail);
  return item;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}
