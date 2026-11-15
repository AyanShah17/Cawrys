"""Tests for formatted GitHub Flavored Markdown (GFM) preview in chat interface
and backend markdown prompting instructions.
"""
import json
import os
import subprocess
import uuid
import pytest
from fastapi.testclient import TestClient

from services.execution.app.auth import make_token
from services.execution.app.chat_routes import _build_system_prompt
from services.execution.app.main import app as exec_app

TENANT_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def auth_headers():
    token = make_token("u-test-md", TENANT_ID, "engineer", "engineer@liontix.local")
    return {"Authorization": f"Bearer {token}"}


def test_r2_backend_system_prompt_instructs_markdown():
    """R2: Backend system prompt must explicitly instruct assistant responses to be formatted in Markdown."""
    context = {
        "metrics": {
            "oee": "89.2%",
            "production_target": "1,200 units",
            "operational_status": "Optimal",
            "system_health": "Nominal",
            "risk_level": "NORMAL",
            "active_work_orders": 12,
            "active_documents": 8,
        },
        "connections": [{"app_name": "SAP S/4HANA", "status": "connected"}],
        "tools": [{"name": "get_stock", "description": "Fetch inventory"}],
        "documents": [],
    }

    prompt = _build_system_prompt(context)

    # 1. Must explicitly instruct assistant to format responses in Markdown
    assert "Markdown" in prompt
    assert "GitHub Flavored Markdown" in prompt

    # 2. Must detail formatting elements (headings, bold, lists, code blocks, tables, task lists, links)
    assert "headings" in prompt.lower()
    assert "bold" in prompt.lower()
    assert "code blocks" in prompt.lower()
    assert "tables" in prompt.lower()

    # 3. Must retain industrial guidelines (strictly ZERO emojis)
    assert "ZERO emojis" in prompt


def test_r2_backend_chat_message_synthesizes_markdown(auth_headers):
    """Verifies that the chat message service generates markdown-formatted responses."""
    client = TestClient(exec_app)
    res = client.post(
        "/v1/chat/message",
        json={"message": "Show operational metrics summary"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    content = data.get("content", "")

    # Assistant response must contain markdown formatting (bold, headings, bullet points)
    assert "**" in content or "###" in content
    assert not any(ord(char) > 0x1F000 for char in content), "Zero emojis in assistant response"


def test_r1_frontend_markdown_preview_renders_all_gfm_elements():
    """R1: Frontend Markdown preview must render all GFM elements as visual HTML without exposing raw tokens."""
    script = r"""
const fs = require("fs");
const sucrase = require("sucrase");
const React = require("react");
const ReactDOMServer = require("react-dom/server");

const mockNextLink = ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
const mockIconCheck = (props) => React.createElement("svg", props, "check");

const code = fs.readFileSync("./components/markdown-preview.tsx", "utf8");
const transformed = sucrase.transform(code, {
  transforms: ["jsx", "typescript", "imports"],
}).code;

const moduleExports = {};
const moduleRequire = (id) => {
  if (id === "react") return React;
  if (id === "next/link") return mockNextLink;
  if (id === "@/components/ui/icons") return { IconCheck: mockIconCheck };
  return require(id);
};

const fn = new Function("exports", "require", "React", transformed);
fn(moduleExports, moduleRequire, React);

const { renderChatMarkdown } = moduleExports;

// Test full GFM sample containing all required elements:
// - Headings (#, ##, ###, ####)
// - Bold (**text**, __text__)
// - Italic (*text*, _text_)
// - Inline code (`code`)
// - Strikethrough (~~text~~)
// - Links ([text](url) and autolinks)
// - GFM Tables (| col | col |)
// - Task lists (- [ ] / - [x])
// - Fenced code blocks (```lang ... ```)
// - Bullet and numbered lists
// - Blockquotes
const markdownSample = `
# Plant Operations Report
## Machine Diagnostics
### Spindle Unit 01
#### Critical Tolerances

Live Status: **Optimal** (evaluated by _FastMCP_ telemetry stream).
Legacy target: ~~1,000 units~~ | Active target: **1,200 units**
Documentation: [Cawrys Portal](https://cawrys.industrial/docs) or visit https://telemetry.liontix.local for raw feeds.
Parameter check: \`spindle_rpm = 12,000\` within +/- 0.0015 mm tolerance.

### Operational Parameters Table
| Parameter | Setpoint | Live Value | Status |
| :--- | :---: | ---: | :--- |
| Spindle Speed | 12,000 RPM | 12,040 RPM | **Nominal** |
| Lubrication Pressure | 4.5 bar | 4.4 bar | Optimal |
| Bearing Temperature | 65.0 C | 61.2 C | Optimal |

### Maintenance Task Checklist
- [x] Spindle vibration baseline verified
- [ ] Thermal sensors recalibrated
- [X] Lubrication level confirmed

### Active Tool Integrations
- SAP S/4HANA ERP
  - Storage Location 1000
  - Bin 42-A
- Siemens Teamcenter PLM

### Inspection Sequence
1. Isolate main drive
2. Check hydraulic pressure
3. Verify zero drift

> Warning: Spindle runout must not exceed 0.002 mm under continuous load.

\`\`\`json
{
  "unit_id": "CNC-4002",
  "oee": "87.4%",
  "status": "APPROVED"
}
\`\`\`
`;

const element = renderChatMarkdown(markdownSample);
const html = ReactDOMServer.renderToStaticMarkup(element);

// Verifications
const assertions = [];

// 1. Headings rendered with role="heading" and appropriate level
assertions.push({ name: "H1 rendered", ok: html.includes('role="heading" aria-level="1">Plant Operations Report</div>') });
assertions.push({ name: "H2 rendered", ok: html.includes('role="heading" aria-level="2">Machine Diagnostics</div>') });
assertions.push({ name: "H3 rendered", ok: html.includes('role="heading" aria-level="3">Spindle Unit 01</div>') });
assertions.push({ name: "H4 rendered", ok: html.includes('role="heading" aria-level="4">Critical Tolerances</div>') });

// 2. Bold rendered as <strong> without raw **
assertions.push({ name: "Bold Optimal rendered", ok: html.includes('<strong class="font-semibold text-neutral-950">Optimal</strong>') });
assertions.push({ name: "No raw ** in HTML", ok: !html.includes("**Optimal**") });

// 3. Italic rendered as <em> without raw _
assertions.push({ name: "Italic FastMCP rendered", ok: html.includes('<em class="italic text-neutral-800">FastMCP</em>') });

// 4. Strikethrough rendered as <del> without raw ~~
assertions.push({ name: "Strikethrough rendered", ok: html.includes('<del class="line-through text-neutral-400">1,000 units</del>') });
assertions.push({ name: "No raw ~~ in HTML", ok: !html.includes("~~1,000 units~~") });

// 5. Links rendered as <a>
assertions.push({ name: "Markdown Link rendered", ok: html.includes('<a href="https://cawrys.industrial/docs"') });
assertions.push({ name: "Autolink rendered", ok: html.includes('<a href="https://telemetry.liontix.local"') });

// 6. Inline code rendered as <code>
assertions.push({ name: "Inline code rendered", ok: html.includes('<code class="rounded bg-neutral-100') && html.includes("spindle_rpm = 12,000") });

// 7. GFM Table rendered as structured HTML table with alignments
assertions.push({ name: "Table element rendered", ok: html.includes("<table class=") });
assertions.push({ name: "Table thead rendered", ok: html.includes("<thead class=") });
assertions.push({ name: "Table tbody rendered", ok: html.includes("<tbody class=") });
assertions.push({ name: "Table th left-aligned", ok: html.includes('style="text-align:left">Parameter</th>') });
assertions.push({ name: "Table th center-aligned", ok: html.includes('style="text-align:center">Setpoint</th>') });
assertions.push({ name: "Table th right-aligned", ok: html.includes('style="text-align:right">Live Value</th>') });
assertions.push({ name: "Table row td rendered", ok: html.includes('style="text-align:left">Spindle Speed</td>') });
assertions.push({ name: "Table cell with inline bold", ok: html.includes('<strong class="font-semibold text-neutral-950">Nominal</strong>') });

// 8. Task lists rendered with checkboxes and strikethrough for completed
assertions.push({ name: "Task checked rendered with input checkbox", ok: html.includes('type="checkbox"') && html.includes('checked=""') });
assertions.push({ name: "Task completed has strikethrough", ok: html.includes('class="line-through text-neutral-400">Spindle vibration baseline verified</span>') });
assertions.push({ name: "Task pending unchecked", ok: html.includes('<span class="text-neutral-800">Thermal sensors recalibrated</span>') });
assertions.push({ name: "No raw - [ ] exposed", ok: !html.includes("- [ ]") && !html.includes("- [x]") });

// 9. Fenced code block rendered in formatted code container
assertions.push({ name: "Code block pre/code rendered", ok: html.includes("<pre class=") && html.includes("<code>") });
assertions.push({ name: "Code block language label shown", ok: html.includes(">json</span>") });
assertions.push({ name: "Code block copy button shown", ok: html.includes("<span>Copy</span>") });
assertions.push({ name: "No raw triple backticks exposed", ok: !html.includes("```") });

// 10. Lists & blockquotes
assertions.push({ name: "Ordered list rendered", ok: html.includes("<ol class=") && html.includes("Isolate main drive") });
assertions.push({ name: "Blockquote rendered", ok: html.includes("<blockquote class=") && html.includes("Spindle runout must not exceed") });

const failed = assertions.filter(a => !a.ok);
if (failed.length > 0) {
  console.error("FAILURES:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log("ALL " + assertions.length + " GFM RENDERING ASSERTIONS PASSED!");
"""

    res = subprocess.run(
        ["node", "-e", script],
        cwd=os.path.join(os.path.dirname(__file__), "../apps/web"),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, f"Node verification failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    assert "ALL" in res.stdout
    assert "PASSED" in res.stdout


def test_r1_frontend_markdown_edge_cases():
    """R1: Frontend Markdown preview must handle nested bold/italic, trailing URL punctuation, and link sanitization."""
    script = r"""
const fs = require("fs");
const sucrase = require("sucrase");
const React = require("react");
const ReactDOMServer = require("react-dom/server");

const mockNextLink = ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
const mockIconCheck = (props) => React.createElement("svg", props, "check");

const code = fs.readFileSync("./components/markdown-preview.tsx", "utf8");
const transformed = sucrase.transform(code, {
  transforms: ["jsx", "typescript", "imports"],
}).code;

const moduleExports = {};
const moduleRequire = (id) => {
  if (id === "react") return React;
  if (id === "next/link") return mockNextLink;
  if (id === "@/components/ui/icons") return { IconCheck: mockIconCheck };
  return require(id);
};

const fn = new Function("exports", "require", "React", transformed);
fn(moduleExports, moduleRequire, React);

const { renderChatMarkdown } = moduleExports;

const assertions = [];

// 1. Nested bold with italic: **bold with *italic* inside**
const h1 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("This is **bold with *italic* inside** text."));
assertions.push({
  name: "Nested bold with italic rendered as strong containing em",
  ok: h1.includes('<strong class="font-semibold text-neutral-950">bold with <em class="italic text-neutral-800">italic</em> inside</strong>') && !h1.includes("**"),
});

// 2. Nested italic with bold: _italic with **bold** inside_
const h2 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("This is _italic with **bold** inside_ text."));
assertions.push({
  name: "Nested italic with bold rendered as em containing strong",
  ok: h2.includes('<em class="italic text-neutral-800">italic with <strong class="font-semibold text-neutral-950">bold</strong> inside</em>') && !h2.includes("**"),
});

// 3. Standalone URLs with trailing sentence punctuation: https://example.com.
const h3 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("Please visit https://example.com. Thanks!"));
assertions.push({
  name: "Trailing sentence dot not included in link href",
  ok: h3.includes('href="https://example.com"') && !h3.includes('href="https://example.com."') && h3.includes("</a>. Thanks!"),
});

// 4. Standalone URLs with trailing comma: https://liontix.local/status,
const h4 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("See https://liontix.local/status, updated."));
assertions.push({
  name: "Trailing comma not included in link href",
  ok: h4.includes('href="https://liontix.local/status"') && !h4.includes('href="https://liontix.local/status,"') && h4.includes("</a>, updated."),
});

// 5. Malicious URL scheme neutralization
const h5 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("Click [here](javascript:alert(1)) to test."));
assertions.push({
  name: "javascript: protocol neutralized to safe target",
  ok: !h5.includes('href="javascript:alert(1)"'),
});

// 6. Multiple separate tables in one message
const multiTableMd = `
| Head 1 | Head 2 |
| :--- | :--- |
| Val 1 | Val 2 |

Between tables.

| Head A | Head B |
| ---: | :---: |
| Data A | Data B |
`;
const h6 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(multiTableMd));
assertions.push({
  name: "Multiple tables both rendered properly",
  ok: (h6.match(/<table /g) || []).length === 2 && h6.includes("Val 1") && h6.includes("Data A"),
});

// 7. Underscore nested italic inside bold: __bold with _italic_ inside__
const h7 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("This is __bold with _italic_ inside__ text."));
assertions.push({
  name: "Underscore nested bold with italic rendered as strong containing em without raw tokens",
  ok: h7.includes('<strong class="font-semibold text-neutral-950">bold with <em class="italic text-neutral-800">italic</em> inside</strong>') && !h7.includes("__"),
});

// 8. Underscore nested bold inside italic: _italic with __bold__ inside_
const h8 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("This is _italic with __bold__ inside_ text."));
assertions.push({
  name: "Underscore nested italic with bold rendered as em containing strong without raw tokens",
  ok: h8.includes('<em class="italic text-neutral-800">italic with <strong class="font-semibold text-neutral-950">bold</strong> inside</em>') && !h8.includes("__"),
});

// 9. Table cells with inline code containing pipes: `cat file | grep error`
const tableCodePipeMd = `
| Command | Explanation |
| :--- | :--- |
| \`cat file | grep error\` | Pipe search |
`;
const h9 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(tableCodePipeMd));
assertions.push({
  name: "Table cell with pipe inside code does not split cells or truncate columns",
  ok: h9.includes('<code class="rounded bg-neutral-100') &&
      h9.includes("cat file | grep error") &&
      h9.includes("Pipe search") &&
      !h9.includes("`cat file") &&
      !h9.includes("grep error`"),
});

// 10. Table cells with Windows paths preserve backslashes
const tablePathMd = `
| System | Path |
| :--- | :--- |
| Windows | C:\\path\\to\\file |
`;
const h10 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(tablePathMd));
assertions.push({
  name: "Table cell preserves Windows backslashes",
  ok: h10.includes("C:\\path\\to\\file"),
});

// 11. Double backtick inline code
const h11 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("Use ``code`` and ``foo `bar` baz`` here."));
assertions.push({
  name: "Double backticks render formatted code without leaking raw tokens",
  ok: h11.includes('<code class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-neutral-900 border border-neutral-200/70">code</code>') &&
      h11.includes('<code class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-neutral-900 border border-neutral-200/70">foo `bar` baz</code>') &&
      !h11.includes("``"),
});

// 12. Markdown link with balanced parentheses (e.g. Wikipedia URL)
const h12 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("See [Wiki](https://en.wikipedia.org/wiki/Rust_(programming_language)) for details."));
assertions.push({
  name: "Markdown link with balanced parentheses retains full destination without dangling parens",
  ok: h12.includes('href="https://en.wikipedia.org/wiki/Rust_(programming_language)"') &&
      h12.includes(">Wiki</a> for details.") &&
      !h12.includes(">Wiki</a>) for details."),
});

// 13. Parenthesized autolink trims outer closing paren
const h13 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("Check (https://example.com) now."));
assertions.push({
  name: "Parenthesized autolink trims outer closing paren per GFM Section 6.9",
  ok: h13.includes('(<!-- --><a href="https://example.com"') || h13.includes('(<a href="https://example.com"'),
});

// 14. List items with indented continuation lines stay in single list item
const h14 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("- Step 1: verify telemetry\n  Ensure reading is within 5% tolerance\n- Step 2: finalize"));
assertions.push({
  name: "Indented continuation line stays within same list item instead of splitting list",
  ok: (h14.match(/<ul /g) || []).length === 1 &&
      h14.includes("Step 1: verify telemetry Ensure reading is within 5% tolerance") &&
      h14.includes("Step 2: finalize"),
});

// 15. Asterisk nested bold inside italic: *italic with **bold** inside*
const h15 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("This is *italic with **bold** inside* text."));
assertions.push({
  name: "Asterisk nested bold inside italic renders em containing strong without raw asterisk tokens",
  ok: h15.includes('<em class="italic text-neutral-800">italic with <strong class="font-semibold text-neutral-950">bold</strong> inside</em>') &&
      !h15.includes("*italic") &&
      !h15.includes("inside*"),
});

// 16. Exponentiation operators do not trigger bold due to delimiter whitespace boundaries
const h16 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("In Python, 2 ** 3 = 8 and 3 ** 2 = 9."));
assertions.push({
  name: "Exponentiation operators do not format as bold",
  ok: h16.includes("2 ** 3 = 8 and 3 ** 2 = 9") && !h16.includes("<strong"),
});

// 17. Strikethrough with nested bold
const h17 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("Review ~~deprecated **legacy** protocol~~ now."));
assertions.push({
  name: "Strikethrough with nested bold renders del containing strong",
  ok: h17.includes('<del class="line-through text-neutral-400">deprecated <strong class="font-semibold text-neutral-950">legacy</strong> protocol</del>'),
});

// 18. Strikethrough with interior delimiter whitespace is not treated as strikethrough
const h18 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("This ~~ not strike ~~ here."));
assertions.push({
  name: "Strikethrough with edge whitespace is left as plain text",
  ok: h18.includes("This ~~ not strike ~~ here.") && !h18.includes("<del"),
});

// 19. Headings with closing hashes strip trailing hashes
const h19 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("## Machine Diagnostics ##"));
assertions.push({
  name: "Headings strip optional trailing closing hashes",
  ok: h19.includes('role="heading" aria-level="2">Machine Diagnostics</div>') && !h19.includes("Diagnostics ##"),
});

// 20. Markdown links with optional titles
const h20 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown('[Google](https://google.com "Google Search")'));
assertions.push({
  name: "Markdown link with title renders title attribute without leaking raw syntax",
  ok: h20.includes('title="Google Search"') && h20.includes('href="https://google.com"') && !h20.includes("[Google]"),
});

// 21. Ordered task lists
const h21 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("1. [ ] Calibrate drive\n2. [x] Run baseline"));
assertions.push({
  name: "Ordered task lists render styled checkboxes without leaking raw bracket tokens",
  ok: h21.includes("<ol") && h21.includes('type="checkbox"') && h21.includes('checked=""') &&
      !h21.includes("[ ]") && !h21.includes("[x]") && h21.includes("line-through text-neutral-400"),
});

// 22. Table boundary stops before heading with pipe
const tableHeadingMd = `| A | B |\n| --- | --- |\n| 1 | 2 |\n# Section | Title`;
const h22 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(tableHeadingMd));
assertions.push({
  name: "Table boundary terminates before heading with pipe instead of swallowing it as a row",
  ok: h22.includes("<table") && h22.includes('role="heading" aria-level="1">Section | Title</div>') &&
      (h22.match(/<tr/g) || []).length === 2,
});

// 23. Adjacent tables without blank line
const adjacentTablesMd = `| Col 1 | Col 2 |\n| --- | --- |\n| 1 | 2 |\n| Table 2 | Other |\n| --- | --- |\n| Val A | Val B |`;
const h23 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(adjacentTablesMd));
assertions.push({
  name: "Adjacent tables without blank line render as two separate tables without delimiter row leakage",
  ok: (h23.match(/<table/g) || []).length === 2 && !h23.includes(">---<"),
});

// 24. Task list with continuation lines
const taskContMd = `- [ ] Perform spindle alignment\n  Ensure laser sensor tolerance within 0.002 mm\n- [x] Record runout`;
const h24 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(taskContMd));
assertions.push({
  name: "Task list items accumulate continuation lines within the same item",
  ok: (h24.match(/<ul/g) || []).length === 1 &&
      h24.includes("Perform spindle alignment Ensure laser sensor tolerance within 0.002 mm"),
});

// 25. Email autolink
const h25 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown("Contact <engineer@liontix.local> for details."));
assertions.push({
  name: "Email autolinks format as mailto links",
  ok: h25.includes('href="mailto:engineer@liontix.local"') && h25.includes(">engineer@liontix.local</a>"),
});

// 26. Nested task list indentation
const nestedTasksMd = `- [ ] Root task\n  - [ ] Subtask 1\n    - [x] Sub-subtask 2`;
const h26 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(nestedTasksMd));
assertions.push({
  name: "Nested task list items receive indentation classes",
  ok: h26.includes("ml-3") && h26.includes("ml-6"),
});

// 27. Table row ending with escaped pipe does not strip escaped pipe delimiter
const tableEscapedPipeMd = "Col 1 | Col 2\n--- | ---\ncell 1 | cell 2\\|";
const h27 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(tableEscapedPipeMd));
assertions.push({
  name: "Table row without trailing delimiter retains escaped pipe in cell text",
  ok: h27.includes("cell 2|") && !h27.includes("cell 2\\"),
});

// 28. Heading with pipe followed by delimiter does not get swallowed into table header
const headingWithPipeMd = "# Section | Title\n| --- | --- |\n| 1 | 2 |";
const h28 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(headingWithPipeMd));
assertions.push({
  name: "Heading with pipe renders as heading and does not leak raw # into table header",
  ok: h28.includes('role="heading" aria-level="1">Section | Title</div>') && !h28.includes("<th") && !h28.includes("# Section"),
});

// 29. Spaced horizontal rules render as hr instead of unordered list
const hrSpacedMd = "- - -\n\n* * *";
const h29 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(hrSpacedMd));
assertions.push({
  name: "Spaced horizontal rules render as hr tags without leaking list bullets",
  ok: (h29.match(/<hr /g) || []).length === 2 && !h29.includes("<ul") && !h29.includes("<li>"),
});

// 30. GFM Section 6.6 www autolink
const wwwAutolinkMd = "Visit www.liontix.local for metrics.";
const h30 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(wwwAutolinkMd));
assertions.push({
  name: "GFM www prefix autolinks render with https href",
  ok: h30.includes('href="https://www.liontix.local"') && h30.includes(">www.liontix.local</a>"),
});

// 31. ATX heading with 1-3 leading spaces
const indentedHeadingMd = "   ## Machine Diagnostics";
const h31 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(indentedHeadingMd));
assertions.push({
  name: "ATX heading with leading spaces renders as styled heading without leaking ##",
  ok: h31.includes('role="heading" aria-level="2">Machine Diagnostics</div>') && !h31.includes("<p") && !h31.includes("##"),
});

// 32. Thematic break inside unordered list terminates list and renders hr
const hrInUlMd = "- item 1\n- - -\n- item 2";
const h32 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(hrInUlMd));
assertions.push({
  name: "Thematic break inside unordered list renders hr without leaking - - list item",
  ok: h32.includes("<hr") && !h32.includes(">- -<") && (h32.match(/<ul /g) || []).length === 2,
});

// 33. Link containing URL text does not nest an <a> inside an <a>
const urlInLinkMd = "[https://cawrys.org](https://cawrys.org) and [www.cawrys.org](https://cawrys.org)";
const h33 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(urlInLinkMd));
assertions.push({
  name: "Link containing URL text renders valid HTML without nested <a> tags",
  ok: (h33.match(/<a /g) || []).length === 2 && !h33.includes("<a href=\"https://cawrys.org\"><a"),
});

// 34. Code block with 4 or more backticks preserves inner backticks and correct language
const quadTicksMd = "````markdown\n```js\nconst x = 1;\n```\n````";
const h34 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(quadTicksMd));
assertions.push({
  name: "Code block with 4 backticks captures correct language and does not terminate on inner fence",
  ok: h34.includes(">markdown</span>") && !h34.includes(">`markdown</span>") && h34.includes("const x = 1;") && (h34.match(/<pre /g) || []).length === 1,
});

// 35. Quoted URLs exclude surrounding single quotes from href and text
const quotedUrlsMd = "Visit 'https://example.com' and 'www.example.com' now.";
const h35 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(quotedUrlsMd));
assertions.push({
  name: "Quoted URLs exclude surrounding single quotes from href and text",
  ok: h35.includes('href="https://example.com"') && h35.includes('href="https://www.example.com"') && !h35.includes("example.com&#x27;"),
});

// 36. Ordered list starting at number > 1 preserves start attribute on ol
const olStartMd = "4. Step four\n5. Step five";
const h36 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(olStartMd));
assertions.push({
  name: "Ordered list starting at number > 1 preserves start attribute on ol",
  ok: h36.includes('start="4"'),
});

// 37. Empty ATX heading renders styled heading without leaking #
const emptyHeadingMd = "# ";
const h37 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(emptyHeadingMd));
assertions.push({
  name: "Empty ATX heading renders styled heading without leaking #",
  ok: h37.includes('role="heading" aria-level="1"') && !h37.includes("<p"),
});

// 38. Multi-level percent-encoded javascript URL is safely neutralized
const doubleEncodedJsMd = "[click](java%2573cript:alert(1))";
const h38 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(doubleEncodedJsMd));
assertions.push({
  name: "Multi-level percent-encoded javascript URL is safely neutralized",
  ok: !h38.includes("javascript"),
});

// 39. Escaped brackets in link labels are preserved without prematurely closing link
const escapedBracketsMd = "[label \\[with\\] brackets](https://example.com)";
const h39 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(escapedBracketsMd));
assertions.push({
  name: "Escaped brackets in link labels are preserved without prematurely closing link",
  ok: h39.includes(">label [with] brackets</a>"),
});

// 40. Link labels with code spans containing brackets do not break link parsing
const codeBracketsInLinkMd = "[array `a[0]` item](https://example.com) and [`items[id]`](https://liontix.local/api)";
const h40 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(codeBracketsInLinkMd));
assertions.push({
  name: "Link labels with code spans containing brackets render links cleanly without leaking raw brackets",
  ok: h40.includes('<a href="https://example.com"') && h40.includes("a[0]</code>") &&
      h40.includes('<a href="https://liontix.local/api"') && h40.includes("items[id]</code>") &&
      !h40.includes("[array") && !h40.includes("[<code"),
});

// 41. Angle-bracketed link destination containing spaces
const angleSpaceLinkMd = "[spaced link](<https://example.com/path with spaces>)";
const h41 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(angleSpaceLinkMd));
assertions.push({
  name: "Angle-bracketed link destination containing spaces renders valid link href",
  ok: h41.includes('href="https://example.com/path with spaces"') && h41.includes(">spaced link</a>") &&
      !h41.includes("&lt;") && !h41.includes("&gt;"),
});

// 42. Empty link label renders link without leaking brackets or parens
const emptyLinkMd = "[](https://example.com)";
const h42 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(emptyLinkMd));
assertions.push({
  name: "Empty link label renders link without leaking raw bracket tokens",
  ok: h42.includes('href="https://example.com"') && !h42.includes("[]("),
});

// 43. Standalone email autolink per GFM Section 6.8
const emailMd = "Contact engineer@liontix.local for details.";
const h43 = ReactDOMServer.renderToStaticMarkup(renderChatMarkdown(emailMd));
assertions.push({
  name: "Standalone email autolinks format as mailto links per GFM Section 6.8",
  ok: h43.includes('href="mailto:engineer@liontix.local"') && h43.includes(">engineer@liontix.local</a>"),
});

const failed = assertions.filter(a => !a.ok);
if (failed.length > 0) {
  console.error("FAILURES:", JSON.stringify(failed, null, 2));
  process.exit(1);
}
console.log("ALL " + assertions.length + " EDGE CASE ASSERTIONS PASSED!");
"""

    res = subprocess.run(
        ["node", "-e", script],
        cwd=os.path.join(os.path.dirname(__file__), "../apps/web"),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, f"Node verification failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    assert "ALL" in res.stdout
    assert "PASSED" in res.stdout
