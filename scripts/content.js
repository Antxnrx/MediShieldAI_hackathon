// MedShield content script: build UI, call backend, highlight safely
(async function () {
  console.log("🛡️ MedShield AI (NEW BUILD) loaded");


  // -------- CSS (inline so no missing-file issues) --------
  const SIDEBAR_CSS = `
/* General Sidebar Styles */
#medshield-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  height: 100%;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  display: flex;
  flex-direction: column;
  transition: background-color 0.3s, color 0.3s;
}

/* Light Theme (Default) */
#medshield-sidebar {
  background-color: #f9f9f9;
  color: #333;
  border-left: 1px solid #e0e0e0;
  box-shadow: -2px 0 15px rgba(0,0,0,0.1);
}

/* Header */
.ms-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}
.ms-header-title {
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
}
.ms-header-title .ms-icon {
  margin-right: 8px;
  font-size: 20px;
}
.ms-close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #888;
}

/* Content Area */
.ms-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

/* Claim Card */
.ms-card {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid #e0e0e0;
}
.ms-card h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #555;
  font-weight: 600;
}
.ms-card p {
  margin: 0 0 16px 0;
  line-height: 1.5;
}
.ms-verdict {
  font-weight: 700;
  font-size: 18px;
}
.ms-verdict.misinformation { color: #d93025; }
.ms-verdict.true { color: #1e8e3e; }
.ms-verdict.unclear { color: #f29900; }

/* Danger Meter */
.ms-danger-meter {
  height: 8px;
  width: 100%;
  background-color: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 4px;
}
.ms-danger-level {
  height: 100%;
  border-radius: 4px;
}
.ms-danger-level.low { background-color: #1e8e3e; width: 25%; }
.ms-danger-level.moderate { background-color: #f29900; width: 50%; }
.ms-danger-level.high { background-color: #d93025; width: 75%; }
.ms-danger-level.critical { background-color: #a50e0e; width: 100%; }

/* Sources */
.ms-source-link {
  display: block;
  background-color: #f1f3f4;
  padding: 10px;
  border-radius: 6px;
  margin-top: 8px;
  text-decoration: none;
  color: #333;
  font-weight: 500;
  word-wrap: break-word;
}
.ms-source-link:hover {
  background-color: #e8eaed;
}

/* ------------------- */
/* --- Dark Theme --- */
/* ------------------- */
body.dark-theme #medshield-sidebar {
  background-color: #121212;
  color: #e0e0e0;
  border-left: 1px solid #333;
  box-shadow: -2px 0 15px rgba(0,0,0,0.5);
}
body.dark-theme .ms-header { border-bottom: 1px solid #333; }
body.dark-theme .ms-close-btn { color: #bbb; }
body.dark-theme .ms-card { background-color: #1e1e1e; border: 1px solid #444; }
body.dark-theme .ms-card h3 { color: #aaa; }
body.dark-theme .ms-source-link { background-color: #2c2c2c; color: #e0e0e0; }
body.dark-theme .ms-source-link:hover { background-color: #383838; }
body.dark-theme .ms-danger-meter { background-color: #444; }

/* Controls */
.ms-controls {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.ms-controls button {
  background-color: #007bff;
  color: #fff;
  border: none;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.ms-controls button:hover { background-color: #0056b3; }
body.dark-theme .ms-controls button { background-color: #007bff; }
body.dark-theme .ms-controls button:hover { background-color: #0056b3; }

/* Legacy helpers */
.ms-danger { color:#b22222; font-weight:700; }
.ms-true { color:#1a7f37; font-weight:700; }
.ms-unclear { color:#a67c00; font-weight:700; }

#medshield-footer {
  padding:8px;
  border-top:1px solid #eee;
  font-size:12px;
  color:#555;
  text-align:center;
}
body.dark-theme #medshield-footer { border-top:1px solid #333; color:#aaa; }

mark { background: yellow; padding: 0 2px; }
`;

  // -------- Utility: inject css string into page --------
  function injectCSS(cssText) {
    try {
      const style = document.createElement("style");
      style.setAttribute("data-medshield", "1");
      style.textContent = cssText;
      (document.head || document.documentElement).appendChild(style);
      return true;
    } catch (e) {
      console.warn("MedShield: failed to inject CSS", e);
      return false;
    }
  }

  // -------- Utility: escape regex special chars (fixed) --------
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // -------- Safe text-highlighter using TreeWalker (only text nodes) --------
  function highlightTextInPage(needle) {
    try {
      if (!needle || typeof needle !== "string") return;
      const trimmed = needle.trim();
      if (trimmed.length < 4 || trimmed.length > 200) return; // avoid tiny or huge patterns

      const regex = new RegExp(escapeRegExp(trimmed), "gi");

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim())
              return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            // skip interactive or script/style elements
            if (
              ["script", "style", "textarea", "input", "iframe", "noscript", "svg"].includes(tag)
            )
              return NodeFilter.FILTER_REJECT;
            if (parent.closest && parent.closest("#medshield-sidebar"))
              return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      for (const node of nodes) {
        const text = node.nodeValue;
        if (!regex.test(text)) continue;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        regex.lastIndex = 0;
        let m;

        while ((m = regex.exec(text)) !== null) {
          const idx = m.index;
          if (idx > lastIndex)
            frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
          const mark = document.createElement("mark");
          mark.textContent = m[0];
          frag.appendChild(mark);
          lastIndex = regex.lastIndex;
          if (m.index === regex.lastIndex) regex.lastIndex++; // avoid zero-length match loops
        }
        if (lastIndex < text.length)
          frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        try {
          node.parentNode.replaceChild(frag, node);
        } catch (_e) {}
      }
    } catch (e) {
      console.warn("MedShield: highlight error", e);
    }
  }

  // -------- Build and show sidebar UI (programmatically) --------
  function showSidebar(results = []) {
    try {
      const old = document.getElementById("medshield-sidebar");
      if (old) old.remove();

      // container
      const sidebar = document.createElement("div");
      sidebar.id = "medshield-sidebar";

      // Respect system dark mode
      const isDarkMode =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (isDarkMode) {
        document.body.classList.add("dark-theme");
      }

      // header
      const header = document.createElement("div");
      header.className = "ms-header";
      const headerTitle = document.createElement("div");
      headerTitle.className = "ms-header-title";
      headerTitle.innerHTML = `<span class="ms-icon">🛡️</span> MedShield AI`;
      header.appendChild(headerTitle);

      const closeBtn = document.createElement("button");
      closeBtn.className = "ms-close-btn";
      closeBtn.textContent = "✕";
      closeBtn.onclick = () => sidebar.remove();
      header.appendChild(closeBtn);
      sidebar.appendChild(header);

      // content
      const content = document.createElement("div");
      content.className = "ms-content";

      if (!Array.isArray(results) || results.length === 0) {
        const card = document.createElement("div");
        card.className = "ms-card";
        card.innerHTML = `<p>No health misinformation detected ✅</p>`;
        content.appendChild(card);
      } else {
        // summary
        const total = results.length;
        const highCount = results.filter(
          (r) =>
            String(r.danger || "")
              .toLowerCase()
              .trim() === "critical" ||
            String(r.danger || "")
              .toLowerCase()
              .trim() === "high"
        ).length;

        const summaryCard = document.createElement("div");
        summaryCard.className = "ms-card";
        summaryCard.innerHTML = `<h3>Analysis Summary</h3>
          <p><strong>Detected:</strong> ${total} claims — <span class="ms-verdict misinformation">${highCount} high/critical</span></p>
          <div class="ms-danger-meter">
            <div class="ms-danger-level ${highCount > 0 ? "high" : "low"}"></div>
          </div>`;
        content.appendChild(summaryCard);

        // controls row
        const controls = document.createElement("div");
        controls.className = "ms-controls";
        const loginBtn = document.createElement("button");
        loginBtn.textContent = "Sign in (Google)";
        loginBtn.onclick = () => alert("Google Sign-in placeholder");

        const historyBtn = document.createElement("button");
        historyBtn.textContent = "History";
        historyBtn.onclick = () => alert("History placeholder");

        const copyAllBtn = document.createElement("button");
        copyAllBtn.textContent = "Copy all sources";
        copyAllBtn.onclick = () => {
          const allSources = (results.flatMap((r) => r.sources || [])).join("\n");
          navigator.clipboard.writeText(allSources).then(() => alert("Sources copied"));
        };

        controls.appendChild(loginBtn);
        controls.appendChild(historyBtn);
        controls.appendChild(copyAllBtn);
        content.appendChild(controls);

        // per-claim cards
        for (const r of results) {
          const claim = r?.claim || "—";
          const verdictRaw = String(r?.verdict || "").toLowerCase();
          const explanation = r?.explanation;
          const danger = r?.danger;

          const card = document.createElement("div");
          card.className = "ms-card";

          const claimHeader = document.createElement("h3");
          claimHeader.textContent = "Claim";
          card.appendChild(claimHeader);

          const claimText = document.createElement("p");
          claimText.textContent = claim;
          card.appendChild(claimText);

          // verdict class
          let verdictClass = "unclear";
          if (verdictRaw.includes("misinformation") || verdictRaw.includes("false")) {
            verdictClass = "misinformation";
            if (claim) highlightTextInPage(claim); // highlight in page
          } else if (verdictRaw.includes("true") || verdictRaw.includes("accurate")) {
            verdictClass = "true";
          }

          const verdict = document.createElement("div");
          verdict.className = `ms-verdict ${verdictClass}`;
          verdict.textContent = r?.verdict || "—";
          card.appendChild(verdict);

          if (explanation) {
            const explHeader = document.createElement("h3");
            explHeader.textContent = "Why";
            explHeader.style.marginTop = "16px";
            card.appendChild(explHeader);

            const expl = document.createElement("p");
            expl.textContent = explanation;
            card.appendChild(expl);
          }

          if (danger) {
            const dangerHeader = document.createElement("h3");
            dangerHeader.textContent = "Danger Level";
            dangerHeader.style.marginTop = "16px";
            card.appendChild(dangerHeader);

            const dangerText = document.createElement("p");
            dangerText.textContent = danger;
            card.appendChild(dangerText);

            const dangerLevel = String(danger).toLowerCase().trim();
            const meter = document.createElement("div");
            meter.className = "ms-danger-meter";
            const bar = document.createElement("div");
            bar.className = `ms-danger-level ${
              ["low", "moderate", "high", "critical"].includes(dangerLevel)
                ? dangerLevel
                : "low"
            }`;
            meter.appendChild(bar);
            card.appendChild(meter);
          }

          if (Array.isArray(r.sources) && r.sources.length) {
            const sourcesHeader = document.createElement("h3");
            sourcesHeader.textContent = "Sources";
            sourcesHeader.style.marginTop = "16px";
            card.appendChild(sourcesHeader);

            for (const s of r.sources) {
              try {
                const a = document.createElement("a");
                a.href = s;
                a.className = "ms-source-link";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = s;
                card.appendChild(a);
              } catch (_e) {}
            }
          }

          // action buttons
          const bwrap = document.createElement("div");
          bwrap.className = "ms-controls";

          const copyBtn = document.createElement("button");
          copyBtn.textContent = "Copy sources";
          copyBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText((r.sources || []).join("\n"));
              copyBtn.textContent = "Copied!";
              setTimeout(() => (copyBtn.textContent = "Copy sources"), 1200);
            } catch (_e) {
              alert("Cannot copy");
            }
          };

          const shareBtn = document.createElement("button");
          shareBtn.textContent = "Share";
          shareBtn.onclick = async () => {
            const payload = `${claim} — ${r?.verdict || ""}\n${
              explanation || ""
            }\n${(r.sources || []).join("\n")}`;
            if (navigator.share) {
              try {
                await navigator.share({ title: "MedShield AI - Claim", text: payload });
              } catch (_e) {
                await navigator.clipboard.writeText(payload);
                alert("Shared to clipboard");
              }
            } else {
              await navigator.clipboard.writeText(payload);
              alert("Copied claim to clipboard");
            }
          };

          const reportBtn = document.createElement("button");
          reportBtn.textContent = "Reverify / Report";
          reportBtn.onclick = () =>
            alert("Report submitted (placeholder). Developers will review.");

          bwrap.appendChild(copyBtn);
          bwrap.appendChild(shareBtn);
          bwrap.appendChild(reportBtn);
          card.appendChild(bwrap);

          content.appendChild(card);
        }
      }

      sidebar.appendChild(content);

      const footer = document.createElement("div");
      footer.id = "medshield-footer";
      footer.textContent = "MedShield AI — Trusted sources: WHO / CDC / PubMed";
      sidebar.appendChild(footer);

      document.documentElement.appendChild(sidebar);
      return sidebar;
    } catch (err) {
      console.error("MedShield: showSidebar error", err);
      return null;
    }
  }

  // -------- Get page text safely (limit length) --------
  function getPageText() {
    const title = document.title || "";
    const meta = (document.querySelector("meta[name='description']")?.content) || "";
    const body = document.body ? document.body.innerText : "";
    return (title + "\n" + meta + "\n" + body).slice(0, 50000);
  }

  // -------- Call backend (with timeout) and render --------
  async function scanPage() {
    try {
      const text = getPageText();
      const url = window.location.href;

      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch("http://localhost:5000/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, url }),
        signal: controller.signal,
      });

      clearTimeout(tId);

      if (!resp.ok) {
        console.error("MedShield backend HTTP error", resp.status, resp.statusText);
        // Render a friendly card instead of doing nothing
        showSidebar([]);
        return;
      }

      const payload = await resp.json();
      const results = Array.isArray(payload?.results) ? payload.results : [];

      showSidebar(results);

      // NOTE: claim highlighting is done per-card when verdict is "misinformation"
      // inside showSidebar() to avoid double-highlighting.
    } catch (err) {
      console.error("MedShield: error calling backend or rendering", err);
      showSidebar([]); // graceful fallback
    }
  }

  // inject CSS
  injectCSS(SIDEBAR_CSS);

  // Extension messages
  if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message.action === "showResults" && Array.isArray(message.results)) {
          showSidebar(message.results);
          sendResponse?.({ success: true });
        } else if (message.action === "triggerScan") {
          scanPage();
          sendResponse?.({ success: true });
        }
      } catch (e) {
        console.error("MedShield: onMessage error", e);
        sendResponse?.({ success: false, error: String(e) });
      }
      return true;
    });
  }

  // Initial scan
  await scanPage();
})();
