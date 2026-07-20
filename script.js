/* ═══════════════════════════════════════════════════
   AI Learning Mentor — script.js
   All interactivity: navigation, simulations, canvas
═══════════════════════════════════════════════════ */

/* ══════════════════════════════════════
   READING PROGRESS (shared: shelf + books)
══════════════════════════════════════ */
// A book's reading progress is real, not hardcoded. Every page turn in a
// notebook records the content page the reader opened (see initNbBooks). The
// shelf (index.html) reads it back to fill each card's progress bar, so a
// fresh book shows 0% and progress grows as pages are opened, persisting
// across visits.
//
// Storage: localStorage["nbReadProgress"] = { <bookKey>: [<leafId>, ...] }.
// The bookKey is the book's cover section id (e.g. "nb-otel-cover"), which the
// shelf mirrors in its data so the two sides agree without any coupling.
window.NBProgress = (function () {
  const KEY = 'nbReadProgress';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* private mode */ }
  }
  return {
    // Mark one content page of a book as opened. Distinct pages only.
    record(bookKey, pageId) {
      if (!bookKey || !pageId) return;
      const all = load();
      const seen = all[bookKey] || (all[bookKey] = []);
      if (seen.indexOf(pageId) === -1) { seen.push(pageId); save(all); }
    },
    // How many distinct content pages of this book have been opened.
    pagesRead(bookKey) {
      return (load()[bookKey] || []).length;
    },
    // Progress as a 0-100 integer, capped so it can never exceed 100%.
    pct(bookKey, total) {
      if (!total) return 0;
      const n = Math.min(this.pagesRead(bookKey), total);
      return Math.round((n / total) * 100);
    }
  };
})();

/* ══════════════════════════════════════
   THEME TOGGLE
══════════════════════════════════════ */
// Theme toggling is wired by event delegation on any [data-theme-toggle]
// control, so it works from the shelf topbar OR the in-book bookmark rail
// (multi-page: the topbar is gone on topic pages). Every [data-theme-icon]
// span mirrors the current icon.
function nbThemeIcons(t) {
  document.querySelectorAll('[data-theme-icon]').forEach(el => {
    el.textContent = t === 'light' ? '☀️' : '🌙';
  });
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  nbThemeIcons(t);
  // Redraw canvases on theme change (each guards a missing canvas).
  drawLangGraph(lgCurrentNode);
  drawWorkflowCanvas();
  drawEmbedCanvas(embedCurrentQuery);
}

document.addEventListener('click', (e) => {
  const ctl = e.target.closest && e.target.closest('[data-theme-toggle]');
  if (!ctl) return;
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
});

// Apply saved theme early (avoid FOUC) — do NOT call setTheme() here
// because the canvas data arrays (LG_NODES, LG_EDGES, etc.) are declared
// with const/let further down the script and are still in the TDZ at this point.
// (Topic pages also apply this before paint via an inline <head> script.)
(function() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  nbThemeIcons(saved);
})();

/* ══════════════════════════════════════
   NAV GROUP ACCORDION
══════════════════════════════════════ */
function toggleNavGroup(id) {
  document.getElementById(id).classList.toggle('open');
}

/* ══════════════════════════════════════
   PROJECT DEEP DIVE TAB SWITCHER
══════════════════════════════════════ */
function showProject(proj) {
  // Switch tab button active state
  document.querySelectorAll('.pd-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.proj === proj);
  });
  // Show matching panel, hide others
  document.querySelectorAll('.pd-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== 'pd-' + proj);
  });
}

/* ══════════════════════════════════════
   SIDEBAR & MOBILE MENU
══════════════════════════════════════ */
// The sidebar chrome only exists on the (legacy single-page) layout; the
// multi-page split has no sidebar, so every access is guarded.
const sidebar        = document.getElementById('sidebar');
const hamburger      = document.getElementById('hamburger');
const sidebarOverlay = document.getElementById('sidebarOverlay');

if (hamburger && sidebar && sidebarOverlay) {
  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('open');
  });
  sidebarOverlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  });
}

/* ══════════════════════════════════════
   SMOOTH SCROLL HELPER
══════════════════════════════════════ */
function scrollTo_(id) {
  // Notebook nav links drive the page-turn book instead of scrolling to a
  // leaf that may be hidden. nbBookGoto is installed by initNbBook and
  // returns true when it handled a notebook page id.
  if (window.nbBookGoto && window.nbBookGoto(id)) {
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('open');
    return;
  }
  const el = document.querySelector(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (sidebar) sidebar.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('open');
}

// All nav links
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    scrollTo_(link.getAttribute('href'));
  });
});

/* ══════════════════════════════════════
   PROGRESS + ACTIVE NAV ON SCROLL
══════════════════════════════════════ */
const sections = document.querySelectorAll('.section, .content-section');
const navLinks = document.querySelectorAll('.nav-link');
const progFill = document.getElementById('progFill');
const progPct  = document.getElementById('progPct');
const visitedSections = new Set();

// Reflect one section as the active one across all three consumers:
// the sidebar nav link, the top-bar breadcrumb, and (implicitly) whatever
// reads .active. Kept in a helper so both the reveal/progress observer and
// the trigger-band observer below drive it identically.
let activeSectionId = null;
function setActiveSection(id) {
  // Each notebook is one .section that shows one leaf at a time. When the
  // global scroll-spy activates a book section, redirect to the leaf the book
  // is currently showing so the breadcrumb + nav track the page on screen.
  if (window.nbCurrentPage && window.nbCurrentPage[id]) id = window.nbCurrentPage[id];
  if (!id || id === activeSectionId) return;
  activeSectionId = id;
  // Active nav
  navLinks.forEach(l => {
    l.classList.toggle('active', l.dataset.section === id);
  });
  // Breadcrumb (top bar) — mirror the active section + its nav group
  const activeLink = [...navLinks].find(l => l.dataset.section === id);
  if (activeLink) {
    const tbSection = document.getElementById('tbSection');
    const tbGroup   = document.getElementById('tbGroup');
    const secLabel  = activeLink.querySelector('span:not(.ni):not(.nbadge)');
    if (tbSection) tbSection.textContent = (secLabel ? secLabel.textContent : activeLink.textContent).trim();
    const grpLabel = activeLink.closest('.nav-group')?.querySelector('.nav-group-toggle span:not(.ni):not(.nav-group-chevron)');
    // The shelf link is standalone (no nav-group); give it a sensible crumb.
    if (tbGroup) tbGroup.textContent = grpLabel ? grpLabel.textContent.trim() : (id === 'shelf' ? 'Library' : tbGroup.textContent);
  }
}

// Reveal + progress: fire as soon as any sliver of a section enters the
// viewport (threshold 0). This must NOT gate active-nav — a section many
// times taller than the viewport never reaches a positive ratio threshold,
// which is exactly the scroll-spy bug this replaces.
const revealObserver = new IntersectionObserver((entries) => {
  let changed = false;
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      visitedSections.add(entry.target.id);
      changed = true;
    }
  });
  if (changed && progFill && progPct) {
    const pct = Math.round((visitedSections.size / sections.length) * 100);
    progFill.style.width = pct + '%';
    progPct.textContent  = pct + '%';
  }
}, { threshold: 0 });

sections.forEach(s => revealObserver.observe(s));

// Active-section detection: a thin horizontal "trigger band" near the
// vertical middle of the viewport (collapsed via rootMargin). Whichever
// section is crossing that band is the one the reader is looking at — this
// is independent of section height, so a 7x-viewport section becomes active
// just like a short one. threshold 0 fires on entry/exit of the band.
const inBand = new Set();
const bandObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) inBand.add(entry.target);
    else inBand.delete(entry.target);
  });
  pickActiveSection();
}, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

function pickActiveSection() {
  if (inBand.size) {
    // Normally exactly one section crosses the thin band; if two do
    // (adjacent boundary), prefer the topmost so it reads deterministically.
    let top = null;
    inBand.forEach(el => {
      if (!top || el.getBoundingClientRect().top < top.getBoundingClientRect().top) top = el;
    });
    setActiveSection(top.id);
    return;
  }
  // No section in the band — happens at the very top or bottom of the page.
  // Fall back to the last section whose top has scrolled above the band line.
  const bandY = innerHeight * 0.45;
  let candidate = null;
  sections.forEach(el => {
    if (el.getBoundingClientRect().top <= bandY) candidate = el;
  });
  setActiveSection((candidate || sections[0]).id);
}

sections.forEach(s => bandObserver.observe(s));
// Resolve the initial active section (e.g. deep-linked #anchor load).
pickActiveSection();

/* ══════════════════════════════════════
   HERO PARTICLE CANVAS
══════════════════════════════════════ */
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;                 // hero canvas only exists on the AI page
  const ctx    = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = (Math.random() - 0.5) * 0.4;
      this.r  = Math.random() * 2 + 1;
      this.a  = Math.random() * 0.5 + 0.1;
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99,102,241,${this.a})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < 80; i++) particles.push(new Particle());

  function frame() {
    ctx.clearRect(0, 0, W, H);
    // Lines between close particles
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < 100) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(99,102,241,${0.15 * (1 - d/100)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
      particles[i].update();
      particles[i].draw();
    }
    requestAnimationFrame(frame);
  }
  frame();
})();

/* ══════════════════════════════════════
   MODULE 02 – TOKEN PREDICTION
══════════════════════════════════════ */
const tokenSequences = {
  'CrashLoopBackOff': {
    next: 'due to an OOMKilled error.',
    message: '✅ Exactly! "CrashLoopBackOff" is the most statistically likely token here based on training data from Kubernetes logs and docs.',
    followup: null
  },
  'Running': {
    next: 'successfully with all 3 replicas healthy.',
    message: '🟡 Possible, but statistically less likely in a diagnostic context. The training data biases toward problem states.',
    followup: null
  },
  'Pending': {
    next: 'due to insufficient node resources.',
    message: '🟡 Valid prediction — Pending is a common K8s state discussed in troubleshooting contexts.',
    followup: null
  },
  'Error': {
    next: 'state. Check kubectl describe pod for details.',
    message: '🟡 Plausible — "Error" is common in log contexts. The LLM is probabilistic; any token above 0% can be picked.',
    followup: null
  }
};

function pickToken(btn, token, prob) {
  const sentence = document.getElementById('tokenSentence');
  const choices  = document.getElementById('tokenChoices');
  const result   = document.getElementById('tokenResult');
  const seq      = tokenSequences[token];

  sentence.innerHTML = `The Kubernetes pod is in <strong style="color:var(--accent)">${token}</strong> ${seq.next}`;
  choices.innerHTML  = '';
  result.innerHTML   = `<span style="color:var(--orange)">${seq.message}</span><br><br>
    <span style="color:var(--txt2);font-size:0.82rem">The LLM picks the highest-probability token at each step. This is why context matters — <em>"a DevOps log says the pod is in…"</em> vs <em>"a success story says the pod is in…"</em> would yield different probability distributions.</span>`;
}

/* ══════════════════════════════════════
   MODULE 03 – AGENT LOOP ANIMATION
══════════════════════════════════════ */
const agentSteps = [
  { phase: 'think', msg: '🧠 [THINK] Alert received: api-server latency is 8.2s (P99). I need to find the root cause.' },
  { phase: 'act',   msg: '⚡ [ACT]   Calling tool: query_prometheus("histogram_quantile(0.99, api_latency_seconds)")' },
  { phase: 'obs',   msg: '👀 [OBS]   Result: DB queries = 7.9s, App logic = 0.3s. Database is the bottleneck.' },
  { phase: 'think', msg: '🧠 [THINK] DB is slow. Could be connection pool exhaustion, slow query, or lock contention.' },
  { phase: 'act',   msg: '⚡ [ACT]   Calling tool: run_kubectl("exec db-pod -- psql -c \'SELECT count(*) FROM pg_stat_activity\'")"' },
  { phase: 'obs',   msg: '👀 [OBS]   Result: 100 active connections (max_connections = 100). Pool is exhausted!' },
  { phase: 'think', msg: '🧠 [THINK] Connection pool at maximum. Need to scale or use a connection pooler (PgBouncer).' },
  { phase: 'act',   msg: '⚡ [ACT]   Calling tool: create_jira_ticket("P1: DB connection pool exhausted — increase pool size or add PgBouncer")' },
  { phase: 'obs',   msg: '👀 [OBS]   Ticket PLAT-2847 created. Notifying on-call via Slack #incidents.' },
  { phase: 'done',  msg: '✅ [DONE]  Root cause identified: DB connection pool exhausted. Ticket created. Incident resolved in 4 loops.' },
];

let agentLoopRunning = false;

async function runAgentLoop() {
  if (agentLoopRunning) return;
  agentLoopRunning = true;
  const btn  = document.getElementById('agentLoopBtn');
  const log  = document.getElementById('agentLog');
  const tn   = document.getElementById('alThink');
  const an   = document.getElementById('alAct');
  const on   = document.getElementById('alObserve');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';
  log.innerHTML = '';

  const nodeMap = { think: tn, act: an, obs: on };

  for (const step of agentSteps) {
    // Activate node
    [tn, an, on].forEach(n => n.classList.remove('active-node'));
    if (step.phase !== 'done') nodeMap[step.phase]?.classList.add('active-node');

    // Log line
    const line = document.createElement('div');
    line.className = `log-line ${step.phase}`;
    line.textContent = step.msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    await sleep(900);
  }
  [tn, an, on].forEach(n => n.classList.remove('active-node'));
  btn.disabled = false;
  btn.textContent = '▶ Run Again';
  agentLoopRunning = false;
}

/* ══════════════════════════════════════
   MODULE 04 – MULTI-AGENT CHAT SIM
══════════════════════════════════════ */
const multiAgentScript = [
  { agent: 'system',       text: '🚨 INCIDENT CREATED: api-deployment — CrashLoopBackOff × 5 in production namespace' },
  { agent: 'orchestrator', name: '🎯 Orchestrator', text: 'Incident received. Severity: P1. Dispatching to Planner Agent for investigation plan.' },
  { agent: 'planner',      name: '📋 Planner',      text: 'Creating investigation plan:\n1. Get pod describe & events\n2. Check resource limits vs usage\n3. Search runbooks for CrashLoopBackOff' },
  { agent: 'executor',     name: '⚡ Executor',      text: 'Running: kubectl describe pod api-deployment-7f8b9 -n production\n→ Last State: OOMKilled\n→ Exit Code: 137\n→ Memory limit: 256Mi, Usage: 254Mi' },
  { agent: 'executor',     name: '⚡ Executor',      text: 'Running: RAG search "OOMKilled CrashLoopBackOff"\n→ Retrieved Runbook: "Memory Limits" (similarity: 94%)\n→ Action: Increase memory limit, check for leaks' },
  { agent: 'reviewer',     name: '🔍 Reviewer',      text: 'Validating findings:\n✓ OOMKilled confirmed via exit code 137\n✓ Memory at 99.2% capacity\n✓ Runbook match is relevant\n⚠ Recommend: increase to 512Mi + enable VPA' },
  { agent: 'planner',      name: '📋 Planner',       text: 'Plan updated: Apply memory limit patch (256Mi → 512Mi). Requires human approval for production change.' },
  { agent: 'orchestrator', name: '🎯 Orchestrator',  text: '⏸ INTERRUPT: Requesting human approval for production patch.\nProposed: resources.limits.memory: 512Mi\nApproved by: on-call-sre@company.com ✅' },
  { agent: 'executor',     name: '⚡ Executor',       text: 'Applying patch:\nkubectl patch deploy api-deployment -n production --patch \'{"spec":{"template":{"spec":{"containers":[{"name":"api","resources":{"limits":{"memory":"512Mi"}}}]}}}}\'\n→ deployment.apps/api-deployment patched' },
  { agent: 'reviewer',     name: '🔍 Reviewer',       text: 'Verification in progress...\n✓ Pod restarted successfully\n✓ Status: Running (2/2)\n✓ Latency restored to 120ms P99' },
  { agent: 'reporter',     name: '📊 Reporter',       text: 'Incident report generated and posted to Confluence.\nJira ticket: PLAT-2848 → Resolved\nSlack #incidents: ✅ P1 resolved in 3m 42s' },
  { agent: 'resolved',     text: '✅ INCIDENT RESOLVED — Root cause: OOMKilled. Fix: Memory limit doubled. All agents completed.' },
];

let maSimRunning = false;

async function startMultiAgentSim() {
  if (maSimRunning) return;
  maSimRunning = true;
  const btn  = document.getElementById('maChatBtn');
  const msgs = document.getElementById('maChatMessages');
  btn.disabled = true;
  btn.textContent = '⏳ Simulating...';
  msgs.innerHTML = '';

  for (const item of multiAgentScript) {
    const div = document.createElement('div');
    div.className = `chat-msg ${item.agent}`;

    if (item.name) {
      const nameEl = document.createElement('div');
      nameEl.className = 'chat-agent-name';
      nameEl.textContent = item.name;
      div.appendChild(nameEl);
    }

    const textEl = document.createElement('div');
    textEl.style.whiteSpace = 'pre-line';
    textEl.textContent = item.text;
    div.appendChild(textEl);

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    await sleep(1100);
  }
  btn.disabled = false;
  btn.textContent = '▶ Run Again';
  maSimRunning = false;
}

function resetMultiAgentSim() {
  document.getElementById('maChatMessages').innerHTML = '<p class="log-hint">Click "Start Simulation" to watch agents collaborate…</p>';
  document.getElementById('maChatBtn').textContent = '▶ Start Simulation';
  document.getElementById('maChatBtn').disabled = false;
  maSimRunning = false;
}

/* ══════════════════════════════════════
   MODULE 05 – RAG PIPELINE ANIMATION
══════════════════════════════════════ */
let ragAnimRunning = false;

async function animateRAGPipeline() {
  if (ragAnimRunning) return;
  ragAnimRunning = true;
  const btn = document.getElementById('ragAnimBtn');
  btn.disabled = true;

  const ids = ['rs1','rs2','rs3','rs4','rs5','rs6','rs7','rs8','rs9'];
  // Reset
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active','done'); }
  });

  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.add('active');
    await sleep(600);
    el.classList.remove('active');
    el.classList.add('done');
  }

  btn.disabled = false;
  btn.textContent = '▶ Animate Again';
  ragAnimRunning = false;
}

/* ══════════════════════════════════════
   MODULE 05 – RAG INTERACTIVE DEMO
══════════════════════════════════════ */
const ragKnowledgeBase = [
  {
    id: 'ragDoc0',
    keywords: ['cpu','high cpu','cpu spike','cpu usage','load','top processes'],
    title: 'Runbook: High CPU',
    steps: [
      'Run: kubectl top pods -n <namespace> to identify high-CPU pods',
      'Check: kubectl exec -it <pod> -- top to see per-process usage',
      'Look for: zombie processes, unbounded loops, or memory leaks causing GC',
      'Short-term: kubectl scale deployment/<name> --replicas=<n> to distribute load',
      'Long-term: Set proper resource limits and add HPA based on CPU metrics'
    ]
  },
  {
    id: 'ragDoc1',
    keywords: ['oom','out of memory','oomkilled','memory','memory leak','memory limit'],
    title: 'Runbook: OOMKilled',
    steps: [
      'Confirm: kubectl describe pod <pod> | grep -i OOM or exit code 137',
      'Check current limits: kubectl get pod <pod> -o json | jq .spec.containers[].resources',
      'Increase limit: kubectl patch deploy <name> --patch \'{"spec":{"template":{"spec":{"containers":[{"name":"<c>","resources":{"limits":{"memory":"512Mi"}}}]}}}}\'',
      'Investigate leak: Enable jvm heap dumps or use pprof for Go services',
      'Long-term: Enable VPA (Vertical Pod Autoscaler) for automatic right-sizing'
    ]
  },
  {
    id: 'ragDoc2',
    keywords: ['connection','db','database','pool','postgres','connection pool','max connections'],
    title: 'Runbook: DB Connection',
    steps: [
      'Check connections: kubectl exec -it db-pod -- psql -c "SELECT count(*) FROM pg_stat_activity"',
      'If at max: Consider adding PgBouncer as a connection pooler',
      'Increase pool: Update DATABASE_POOL_SIZE env var and restart app pods',
      'Temporarily: kubectl rollout restart deployment/<db-dependent-service>',
      'Monitor: Set up alerts on pg_stat_activity count > 80% of max_connections'
    ]
  },
  {
    id: 'ragDoc3',
    keywords: ['crash','crashloop','crashloopbackoff','restart','restarting','pod restart','exit code'],
    title: 'Runbook: CrashLoopBackOff',
    steps: [
      'Get last logs: kubectl logs <pod> --previous to see crash logs',
      'Check events: kubectl describe pod <pod> | tail -30 for recent events',
      'Common causes: Bad env var, missing ConfigMap/Secret, failed health probe, OOMKilled',
      'Check config: kubectl get configmap <name> -o yaml to verify configs are correct',
      'If probe issue: Temporarily disable liveness probe to get the pod running for debugging'
    ]
  }
];

function runRAGDemo() {
  const query   = document.getElementById('ragQueryInput').value.trim().toLowerCase();
  const answer  = document.getElementById('ragAnswer');
  if (!query) return;

  // Highlight all docs first as "searching"
  ragKnowledgeBase.forEach(doc => {
    document.getElementById(doc.id)?.classList.remove('highlighted');
  });

  // Simple keyword matching to simulate vector similarity
  let best = null;
  let bestScore = 0;

  ragKnowledgeBase.forEach(doc => {
    let score = 0;
    doc.keywords.forEach(kw => {
      if (query.includes(kw)) score += kw.split(' ').length; // multi-word keywords score higher
    });
    if (score > bestScore) { bestScore = score; best = doc; }
  });

  // Partial fallback
  if (!best) {
    // Try first word
    const firstWord = query.split(' ')[0];
    ragKnowledgeBase.forEach(doc => {
      doc.keywords.forEach(kw => {
        if (kw.includes(firstWord) || firstWord.includes(kw.split(' ')[0])) {
          if (!best) best = doc;
        }
      });
    });
  }

  if (best) {
    document.getElementById(best.id).classList.add('highlighted');
    const stepsHTML = best.steps.map((s, i) =>
      `<div style="padding:6px 0 6px 20px;position:relative;font-size:0.82rem;color:var(--txt2);border-bottom:1px solid rgba(255,255,255,0.05)"><span style="position:absolute;left:0;color:var(--accent);font-weight:700">${i+1}.</span>${s}</div>`
    ).join('');
    answer.innerHTML = `
      <div style="margin-bottom:10px">
        <span style="font-size:0.72rem;color:var(--txt3)">🎯 Most relevant document (similarity: ${82 + bestScore * 3}%):</span>
        <div style="font-size:0.88rem;font-weight:700;color:var(--accent);margin:6px 0">${best.title}</div>
      </div>
      <div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:14px;margin-bottom:12px">
        <div style="font-size:0.78rem;font-weight:700;color:var(--txt2);margin-bottom:8px">📋 Step-by-step resolution:</div>
        ${stepsHTML}
      </div>
      <div style="font-size:0.78rem;color:var(--txt3);font-style:italic">⚡ In a real RAG system: your query is embedded to a vector, similarity search finds the top-k chunks from your knowledge base, then the LLM synthesises a grounded answer.</div>
    `;
  } else {
    answer.innerHTML = `<span style="color:var(--orange)">⚠ No close match found in knowledge base. In a real RAG system, the LLM would fall back to general knowledge. Try: "OOMKilled", "CrashLoopBackOff", "high CPU", or "DB connection".</span>`;
  }
}

// Allow pressing Enter
document.getElementById('ragQueryInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') runRAGDemo();
});

/* ══════════════════════════════════════
   MODULE 06 – LANGGRAPH CANVAS VISUALIZER
══════════════════════════════════════ */
const LG_NODES = [
  { id: 'start',     x: 50,  y: 170, type: 'circle',  label: 'START',           color: '#10b981' },
  { id: 'receive',   x: 170, y: 170, type: 'rect',    label: '📨 Receive Alert', color: '#6366f1', sub: 'Parse incident data' },
  { id: 'analyze',   x: 310, y: 170, type: 'rect',    label: '🔍 Analyze',       color: '#6366f1', sub: 'Classify error type' },
  { id: 'route',     x: 430, y: 170, type: 'diamond', label: 'Route',            color: '#f59e0b', sub: 'OOM or Crash?' },
  { id: 'oom',       x: 550, y:  80, type: 'rect',    label: '💾 OOM Check',     color: '#3b82f6', sub: 'Memory analysis' },
  { id: 'crash',     x: 550, y: 260, type: 'rect',    label: '💥 Crash Check',   color: '#3b82f6', sub: 'Log analysis' },
  { id: 'remediate', x: 670, y: 170, type: 'rect',    label: '🔧 Remediate',     color: '#8b5cf6', sub: 'Apply fix' },
  { id: 'end',       x: 760, y: 170, type: 'circle',  label: 'END',             color: '#ef4444' },
];

const LG_EDGES = [
  { from: 'start',     to: 'receive'   },
  { from: 'receive',   to: 'analyze'   },
  { from: 'analyze',   to: 'route'     },
  { from: 'route',     to: 'oom',      label: 'OOM'   },
  { from: 'route',     to: 'crash',    label: 'Crash' },
  { from: 'oom',       to: 'remediate' },
  { from: 'crash',     to: 'remediate' },
  { from: 'remediate', to: 'end'       },
];

const LG_EXEC = [
  { node: 'start',
    state: { incident: 'CrashLoopBackOff', status: 'new', pod: null },
    log: '🚀 Workflow started — incident received' },
  { node: 'receive',
    state: { incident: 'CrashLoopBackOff', pod: 'api-server-9xf2k', ns: 'production' },
    log: '📨 receive_alert — Pod: api-server-9xf2k, Namespace: production, Alert: CrashLoopBackOff' },
  { node: 'analyze',
    state: { incident: 'CrashLoopBackOff', pod: 'api-server-9xf2k', error_type: 'OOMKilled', confidence: '94%' },
    log: '🔍 analyze_error — Classified: OOMKilled (exit code 137), Confidence: 94%' },
  { node: 'route',
    state: { route: 'oom', reason: 'exit_code_137' },
    log: '→  Conditional edge — routing to OOM investigation branch' },
  { node: 'oom',
    state: { memory_limit: '256Mi', peak_usage: '254Mi', recommendation: 'Increase to 512Mi' },
    log: '💾 investigate_oom — Limit: 256Mi, Peak usage: 254Mi (99.2%). Recommendation: 512Mi' },
  { node: 'remediate',
    state: { action: 'patch_memory_limit', new_limit: '512Mi', status: 'applied', approval: 'auto' },
    log: '🔧 remediate — Patching deployment: memory limit 256Mi → 512Mi. Applied successfully.' },
  { node: 'end',
    state: { status: 'resolved', duration: '2m 14s', action: 'Memory limit scaled', ticket: 'PLAT-2849' },
    log: '✅ END — Incident resolved! Duration: 2m 14s. Jira ticket: PLAT-2849 created.' },
];

var lgCurrentNode    = null;
var lgRunning        = false;
var lgCurrentExecIdx = 0;

function getNodeById(id) { return LG_NODES.find(n => n.id === id); }
function getTheme()      { return document.documentElement.getAttribute('data-theme') || 'dark'; }

function drawLangGraph(activeId = null) {
  const canvas = document.getElementById('lgCanvas');
  if (!canvas) return;
  const ctx   = canvas.getContext('2d');
  const dark  = getTheme() !== 'light';
  const W     = canvas.width;
  const H     = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const textCol   = dark ? '#e2e8f0' : '#1e293b';
  const subCol    = dark ? '#94a3b8' : '#64748b';
  const edgeCol   = dark ? 'rgba(255,255,255,0.2)' : 'rgba(99,102,241,0.25)';
  const nodeBg    = dark ? '#1e293b' : '#f0f4ff';

  ctx.font = '11px Segoe UI, system-ui';

  // ─── Draw edges ───
  LG_EDGES.forEach(e => {
    const fn = getNodeById(e.from);
    const tn = getNodeById(e.to);
    if (!fn || !tn) return;
    const [fx, fy] = nodeCenter(fn);
    const [tx, ty] = nodeCenter(tn);
    ctx.beginPath();
    ctx.strokeStyle = edgeCol;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([]);
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    // Arrow head
    drawArrow(ctx, fx, fy, tx, ty, edgeCol);
    // Edge label
    if (e.label) {
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2;
      ctx.fillStyle = subCol;
      ctx.font = '10px Segoe UI';
      ctx.fillText(e.label, mx - 12, my - 4);
      ctx.font = '11px Segoe UI';
    }
  });

  // ─── Draw nodes ───
  LG_NODES.forEach(node => {
    const isActive = node.id === activeId;
    drawNode(ctx, node, isActive, dark, nodeBg, textCol, subCol);
  });
}

function nodeCenter(node) {
  if (node.type === 'circle')  return [node.x, node.y];
  if (node.type === 'diamond') return [node.x, node.y];
  return [node.x, node.y];
}

function drawNode(ctx, node, isActive, dark, nodeBg, textCol, subCol) {
  const col   = node.color;
  const alpha = isActive ? 1 : 0.7;

  ctx.save();

  if (isActive) {
    // Glow
    ctx.shadowColor = col;
    ctx.shadowBlur  = 18;
  }

  if (node.type === 'circle') {
    ctx.beginPath();
    ctx.arc(node.x, node.y, 22, 0, Math.PI * 2);
    ctx.fillStyle   = isActive ? col : nodeBg;
    ctx.strokeStyle = col;
    ctx.lineWidth   = isActive ? 2.5 : 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = isActive ? '#fff' : col;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.font        = `bold 10px Segoe UI`;
    ctx.fillText(node.label, node.x, node.y);

  } else if (node.type === 'diamond') {
    const s = 28;
    ctx.beginPath();
    ctx.moveTo(node.x,     node.y - s);
    ctx.lineTo(node.x + s, node.y);
    ctx.lineTo(node.x,     node.y + s);
    ctx.lineTo(node.x - s, node.y);
    ctx.closePath();
    ctx.fillStyle   = isActive ? col : nodeBg;
    ctx.strokeStyle = col;
    ctx.lineWidth   = isActive ? 2.5 : 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = isActive ? '#fff' : col;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.font        = `bold 10px Segoe UI`;
    ctx.fillText(node.label, node.x, node.y);

  } else {
    const W = 100, H = 44;
    const x = node.x - W / 2;
    const y = node.y - H / 2;
    ctx.beginPath();
    roundRect(ctx, x, y, W, H, 8);
    ctx.fillStyle   = isActive ? hexToRgba(col, 0.25) : hexToRgba(col, 0.08);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth   = isActive ? 2 : 1;
    ctx.stroke();
    ctx.shadowBlur  = 0;
    // Label
    ctx.fillStyle   = textCol;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.font        = `bold 11px Segoe UI`;
    ctx.fillText(node.label, node.x, node.y - 6);
    // Sub
    if (node.sub) {
      ctx.font      = `10px Segoe UI`;
      ctx.fillStyle = subCol;
      ctx.fillText(node.sub, node.x, node.y + 8);
    }
  }
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
  const angle   = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 8;
  const ex = x2 - 22 * Math.cos(angle);
  const ey = y2 - 22 * Math.sin(angle);
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

async function runLangGraph() {
  if (lgRunning) return;
  lgRunning = true;
  const btn     = document.getElementById('lgRunBtn');
  const log     = document.getElementById('lgLog');
  const stateEl = document.getElementById('lgStateJson');
  btn.disabled  = true;
  btn.textContent = '⏳ Executing...';
  log.innerHTML = '';

  for (const step of LG_EXEC) {
    lgCurrentNode = step.node;
    drawLangGraph(step.node);

    // Update state
    stateEl.textContent = JSON.stringify(step.state, null, 2);

    // Log entry
    const line = document.createElement('div');
    line.className = 'log-line';
    const prefix = step.node === 'end' ? 'done' : step.node === 'route' ? 'obs' : 'think';
    line.classList.add(prefix);
    line.textContent = step.log;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;

    await sleep(1200);
  }

  lgCurrentNode = null;
  lgRunning     = false;
  btn.disabled  = false;
  btn.textContent = '▶ Run Again';
}

function resetLangGraph() {
  lgCurrentNode = null;
  lgRunning     = false;
  drawLangGraph(null);
  document.getElementById('lgLog').innerHTML = '<p class="log-hint">Click "Run Workflow" to execute the LangGraph…</p>';
  document.getElementById('lgStateJson').textContent = `{
  "incident": "CrashLoopBackOff",
  "status": "waiting",
  "current_node": null
}`;
  const btn = document.getElementById('lgRunBtn');
  if (btn) { btn.disabled = false; btn.textContent = '▶ Run Workflow'; }
}

// Initial draw when page loads
window.addEventListener('load', () => {
  drawLangGraph(null);
  drawWorkflowCanvas();
  drawEmbedCanvas(null);
});

/* ══════════════════════════════════════
   MODULE 06 – LANGGRAPH PATTERN DETAILS
══════════════════════════════════════ */
const patternDetails = {
  linear:      { title: 'Linear Chain', desc: 'Nodes execute in strict sequence. Each node reads the state, does work, and passes updated state to the next. Example: receive_alert → analyze → remediate → report. Best for simple pipelines without branching.' },
  conditional: { title: 'Conditional Routing', desc: 'A router node inspects the state and returns the name of the next node to visit. Example: if error_type == "OOM" → go to oom_node, else → go to crash_node. This is what makes LangGraph powerful — full if/else logic at workflow level.' },
  loop:        { title: 'Feedback Loop', desc: 'A node can route back to an earlier node, creating a loop. Example: verify_fix → if fix_failed → retry_remediation → verify_fix (loop). LangGraph tracks a max_iterations limit to prevent infinite loops. Great for retry logic or iterative generation.' },
  multi:       { title: 'Multi-Agent Dispatch', desc: 'An orchestrator node dispatches sub-tasks to multiple specialised agents running in parallel (using LangGraph\'s Send API). Example: orchestrator → [metrics_agent, logs_agent, traces_agent running in parallel] → synthesizer. Dramatically speeds up investigation workflows.' },
};

function showPatternDetail(key) {
  const box = document.getElementById('patternDetailBox');
  const d   = patternDetails[key];
  if (!d) return;
  box.innerHTML = `<strong style="color:var(--accent)">${d.title}</strong><p style="margin-top:8px;line-height:1.6">${d.desc}</p>`;
  document.querySelectorAll('.pattern-card').forEach(c => c.classList.remove('active-pattern'));
  event.currentTarget.classList.add('active-pattern');
}

/* ══════════════════════════════════════
   MODULE 07 – USE CASE ACCORDION
══════════════════════════════════════ */
function toggleUC(card) {
  const isOpen = card.classList.contains('expanded');
  document.querySelectorAll('.uc-card').forEach(c => c.classList.remove('expanded'));
  if (!isOpen) card.classList.add('expanded');
}

/* ══════════════════════════════════════
   MODULE 08 – AGENT DECISION SIMULATOR
══════════════════════════════════════ */
const agentScenarios = {
  incident: {
    goal: 'Resolve a P1 Incident: High API Latency',
    steps: [
      { phase: 'think', msg: '🧠 [THINK] P1 alert received: API latency at 8.4s. Priority: find root cause immediately.' },
      { phase: 'act',   msg: '⚡ [ACT]   query_prometheus: api_latency_p99 by service → api-service=8.1s, db-query=7.6s' },
      { phase: 'obs',   msg: '👀 [OBS]   Database is the bottleneck. App processing: 0.5s. DB queries: 7.6s.' },
      { phase: 'think', msg: '🧠 [THINK] Database slow. Check: slow queries, connection pool, lock contention.' },
      { phase: 'act',   msg: '⚡ [ACT]   run_kubectl: exec db-pod -- psql -c "SELECT count(*) FROM pg_stat_activity WHERE wait_event IS NOT NULL"' },
      { phase: 'obs',   msg: '👀 [OBS]   42 sessions waiting on lock_tuple. Multiple queries competing for same row.' },
      { phase: 'think', msg: '🧠 [THINK] Lock contention on high-traffic table. Missing index or N+1 query pattern likely.' },
      { phase: 'act',   msg: '⚡ [ACT]   rag_search: "database lock contention N+1 query runbook"' },
      { phase: 'obs',   msg: '👀 [OBS]   Runbook: "Add SKIP LOCKED to queue queries, add index on status column"' },
      { phase: 'act',   msg: '⚡ [ACT]   create_jira("P1: DB lock contention - Add index on orders.status + update queue queries with SKIP LOCKED")' },
      { phase: 'act',   msg: '⚡ [ACT]   notify_slack("#incidents: Root cause found: DB lock contention. DB team engaged. ETA: 30m")' },
      { phase: 'done',  msg: '✅ [DONE]  Incident root cause identified in 6 loops. Ticket created. Team notified.' },
    ]
  },
  deploy: {
    goal: 'Validate a Production Deployment',
    steps: [
      { phase: 'think', msg: '🧠 [THINK] Deployment v2.4.1 just completed. Running post-deploy validation checks.' },
      { phase: 'act',   msg: '⚡ [ACT]   run_kubectl: get deploy api-service -o json | jq .status' },
      { phase: 'obs',   msg: '👀 [OBS]   3/3 replicas ready. All pods running v2.4.1. ✅' },
      { phase: 'think', msg: '🧠 [THINK] Pods are up. Now validate health endpoints and key metrics.' },
      { phase: 'act',   msg: '⚡ [ACT]   http_check: GET https://api.internal/health → 200 OK, {"status":"healthy"}' },
      { phase: 'obs',   msg: '👀 [OBS]   Health check passed. Response time: 45ms. ✅' },
      { phase: 'act',   msg: '⚡ [ACT]   query_prometheus: error_rate_5m{service="api-service"} → 0.0012 (0.12%)' },
      { phase: 'obs',   msg: '👀 [OBS]   Error rate 0.12% — within threshold (< 1%). ✅ No regression detected.' },
      { phase: 'act',   msg: '⚡ [ACT]   compare_metrics: p99_latency before=120ms, after=118ms → -1.7% improvement ✅' },
      { phase: 'done',  msg: '✅ [DONE]  Deployment v2.4.1 validated. All checks passing. No rollback needed.' },
    ]
  },
  cost: {
    goal: 'Reduce Cloud Infrastructure Costs',
    steps: [
      { phase: 'think', msg: '🧠 [THINK] Monthly AWS bill increased 34%. Goal: identify and eliminate waste.' },
      { phase: 'act',   msg: '⚡ [ACT]   aws_cost_explorer: get_cost_by_service(last_30_days) → EC2: $12,400, RDS: $3,200, S3: $890' },
      { phase: 'obs',   msg: '👀 [OBS]   EC2 is 72% of spend. Focus there first.' },
      { phase: 'think', msg: '🧠 [THINK] Check for idle instances, over-provisioned types, and unused reserved capacity.' },
      { phase: 'act',   msg: '⚡ [ACT]   aws_cloudwatch: get_cpu_utilization(ec2_instances, avg_7d) → 12 instances < 5% avg CPU' },
      { phase: 'obs',   msg: '👀 [OBS]   12 idle instances found. Monthly waste: ~$3,600.' },
      { phase: 'act',   msg: '⚡ [ACT]   aws_trusted_advisor: check_rightsizing → 8 instances can be downsized (r5.2xlarge → r5.xlarge)' },
      { phase: 'obs',   msg: '👀 [OBS]   Downsizing savings: ~$2,100/month.' },
      { phase: 'act',   msg: '⚡ [ACT]   generate_terraform_pr: terminate 12 idle instances + downsize 8 instances' },
      { phase: 'done',  msg: '✅ [DONE]  Terraform PR created. Potential savings: $5,700/month (46% reduction). Awaiting approval.' },
    ]
  },
  security: {
    goal: 'Investigate a Security Alert',
    steps: [
      { phase: 'think', msg: '🧠 [THINK] SIEM alert: Unusual API authentication pattern from IP 185.220.x.x (Tor exit node).' },
      { phase: 'act',   msg: '⚡ [ACT]   query_auth_logs: filter(ip="185.220.*", last_1h) → 847 failed auth attempts' },
      { phase: 'obs',   msg: '👀 [OBS]   847 failed attempts in 1 hour. Pattern: credential stuffing attack.' },
      { phase: 'think', msg: '🧠 [THINK] Check if any attempts succeeded. Critical to assess breach scope.' },
      { phase: 'act',   msg: '⚡ [ACT]   query_auth_logs: filter(ip="185.220.*", status="success") → 3 successful logins' },
      { phase: 'obs',   msg: '👀 [OBS]   3 successful logins! Users: john.doe, svc-account-ci, admin@test.internal' },
      { phase: 'think', msg: '🧠 [THINK] Potential breach. Immediate action: revoke sessions, force password reset, notify users.' },
      { phase: 'act',   msg: '⚡ [ACT]   revoke_all_sessions(["john.doe","svc-account-ci","admin@test.internal"])' },
      { phase: 'act',   msg: '⚡ [ACT]   block_ip_range("185.220.0.0/16") via WAF + create_security_incident(severity="P0")' },
      { phase: 'done',  msg: '✅ [DONE]  Sessions revoked. IP blocked. P0 security incident created. SOC team notified.' },
    ]
  }
};

let simRunning = false;

async function runAgentSimulator() {
  if (simRunning) return;
  simRunning = true;
  const goal    = document.getElementById('simGoalSelect').value;
  const output  = document.getElementById('simOutput');
  const btn     = document.getElementById('simBtn');
  const scenario= agentScenarios[goal];
  btn.disabled  = true;
  btn.textContent = '⏳ Running...';
  output.innerHTML= `<span style="color:var(--accent);font-weight:700">🤖 Agent Goal: ${scenario.goal}</span><br><br>`;

  for (const step of scenario.steps) {
    const line     = document.createElement('div');
    line.className = `log-line ${step.phase}`;
    line.textContent = step.msg;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    await sleep(700);
  }
  btn.disabled = false;
  btn.textContent = '▶ Run Again';
  simRunning = false;
}

/* ══════════════════════════════════════
   MODULE 08 – WORKFLOW BUILDER
══════════════════════════════════════ */
let wbNodes = [];

const wbNodeDefs = {
  receive_alert: { label: '📨 Receive Alert', color: '#6366f1' },
  analyze:       { label: '🔍 Analyze Issue', color: '#6366f1' },
  search_runbook:{ label: '📚 Search Runbook',color: '#3b82f6' },
  remediate:     { label: '🔧 Remediate',     color: '#8b5cf6' },
  notify:        { label: '📢 Notify Team',   color: '#10b981' },
  escalate:      { label: '🚨 Escalate',      color: '#ef4444' },
};

const wbExecMessages = {
  receive_alert:  '📨 Alert received: Parsing incident data, extracting severity and metadata…',
  analyze:        '🔍 Analyzing issue: Running LLM classification, identifying error patterns…',
  search_runbook: '📚 RAG search: Querying vector store, retrieving top-3 matching runbook sections…',
  remediate:      '🔧 Remediation: Applying fix with dry-run validation, awaiting confirmation…',
  notify:         '📢 Notification sent: Posted to #incidents Slack channel with incident summary…',
  escalate:       '🚨 Escalating: Creating P1 Jira ticket, paging on-call engineer via PagerDuty…',
};

function addWBNode(id, label) {
  if (wbNodes.find(n => n.id === id)) return;
  wbNodes.push({ id, label });
  // Mark palette button as added
  document.querySelectorAll('.wb-node').forEach(el => {
    if (el.textContent.trim().startsWith(label.slice(0,3))) el.classList.add('added');
  });
  drawWorkflowCanvas();
}

function clearWorkflow() {
  wbNodes = [];
  document.querySelectorAll('.wb-node').forEach(el => el.classList.remove('added'));
  drawWorkflowCanvas();
  document.getElementById('wbLog').innerHTML = '<p class="log-hint">Add nodes and click Execute…</p>';
}

function drawWorkflowCanvas() {
  const canvas = document.getElementById('wbCanvas');
  if (!canvas) return;
  const ctx  = canvas.getContext('2d');
  const dark = getTheme() !== 'light';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (wbNodes.length === 0) {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.25)';
    ctx.textAlign = 'center';
    ctx.font = '13px Segoe UI';
    ctx.fillText('← Add nodes from the palette', canvas.width / 2, canvas.height / 2);
    return;
  }

  const nodeH  = 38;
  const nodeW  = 130;
  const startX = 30;
  const startY = (canvas.height - nodeH) / 2;
  const gap    = 30;
  const textCol= dark ? '#e2e8f0' : '#1e293b';

  wbNodes.forEach((n, i) => {
    const def = wbNodeDefs[n.id];
    const x   = startX + i * (nodeW + gap);
    const y   = startY;
    const col = def?.color || '#6366f1';

    // Arrow to next
    if (i < wbNodes.length - 1) {
      ctx.beginPath();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.25)' : 'rgba(99,102,241,0.3)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(x + nodeW, y + nodeH / 2);
      ctx.lineTo(x + nodeW + gap, y + nodeH / 2);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(99,102,241,0.4)';
      ctx.moveTo(x + nodeW + gap, y + nodeH / 2);
      ctx.lineTo(x + nodeW + gap - 7, y + nodeH / 2 - 4);
      ctx.lineTo(x + nodeW + gap - 7, y + nodeH / 2 + 4);
      ctx.fill();
    }

    // Node box
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, nodeW, nodeH, 8);
    ctx.fillStyle   = hexToRgba(col, dark ? 0.15 : 0.1);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();

    // Label
    ctx.fillStyle    = textCol;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = 'bold 10px Segoe UI';
    const label      = def?.label || n.label;
    ctx.fillText(label, x + nodeW / 2, y + nodeH / 2);
  });

  // Scroll canvas if too wide
  canvas.style.width = Math.min(wbNodes.length * (nodeW + gap) + 60, 480) + 'px';
}

let wbRunning = false;

async function executeWorkflow() {
  if (wbRunning || wbNodes.length === 0) {
    if (wbNodes.length === 0) {
      document.getElementById('wbLog').innerHTML = '<span style="color:var(--orange)">⚠ Add at least one node first!</span>';
    }
    return;
  }
  wbRunning = true;
  const log = document.getElementById('wbLog');
  log.innerHTML = `<span style="color:var(--accent);font-weight:700">▶ Executing workflow (${wbNodes.length} nodes)…</span><br><br>`;

  for (const node of wbNodes) {
    const msg   = wbExecMessages[node.id] || `✅ Node "${node.id}" executed`;
    const line  = document.createElement('div');
    line.className = 'log-line think';
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    await sleep(800);
  }

  const done = document.createElement('div');
  done.className = 'log-line done';
  done.textContent = `✅ Workflow complete! ${wbNodes.length} nodes executed successfully.`;
  log.appendChild(done);
  wbRunning = false;
}

/* ══════════════════════════════════════
   MODULE 08 – EMBEDDING VISUALISER
══════════════════════════════════════ */
const embedGroups = {
  performance: {
    label: '🔥 "Slow performance"',
    highlight: ['CPU spike', 'High memory', 'Perf issue', 'OOMKilled'],
    color: '#ef4444',
    result: '🎯 Retrieved: CPU spike, High memory usage, Performance issue, OOMKilled documents'
  },
  deploy: {
    label: '🚀 "Deployment failed"',
    highlight: ['Deployment', 'Release', 'Rollout'],
    color: '#f59e0b',
    result: '🎯 Retrieved: Deployment runbook, Release checklist, Rollout strategy documents'
  },
  memory: {
    label: '💾 "OOM error"',
    highlight: ['High memory', 'OOMKilled', 'Perf issue'],
    color: '#6366f1',
    result: '🎯 Retrieved: OOMKilled runbook, Memory limits guide, VPA configuration docs'
  },
  network: {
    label: '🌐 "Network timeout"',
    highlight: ['Network timeout', 'DNS', 'Connectivity'],
    color: '#06b6d4',
    result: '🎯 Retrieved: Network troubleshooting, DNS resolution, Service mesh docs'
  }
};

// Embed canvas data points
const embedPoints = [
  { label: 'CPU spike',    x: 0.18, y: 0.18, group: 'perf' },
  { label: 'High memory',  x: 0.24, y: 0.32, group: 'perf' },
  { label: 'Perf issue',   x: 0.14, y: 0.48, group: 'perf' },
  { label: 'OOMKilled',    x: 0.30, y: 0.22, group: 'perf' },
  { label: 'Deployment',   x: 0.65, y: 0.20, group: 'deploy' },
  { label: 'Release',      x: 0.72, y: 0.35, group: 'deploy' },
  { label: 'Rollout',      x: 0.60, y: 0.45, group: 'deploy' },
  { label: 'Network timeout',x: 0.45,y: 0.70, group: 'network' },
  { label: 'DNS',          x: 0.50, y: 0.82, group: 'network' },
  { label: 'Connectivity', x: 0.38, y: 0.78, group: 'network' },
];

var embedCurrentQuery = null;

function embedSimQuery(type) {
  embedCurrentQuery = type;
  drawEmbedCanvas(type);
  const g = embedGroups[type];
  document.getElementById('embedSimResult').innerHTML =
    `<span style="color:var(--green)">${g.result}</span>`;
}

function drawEmbedCanvas(queryType) {
  const canvas = document.getElementById('embedCanvas');
  if (!canvas) return;
  const ctx  = canvas.getContext('2d');
  const dark = getTheme() !== 'light';
  const W    = canvas.width;
  const H    = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const textCol  = dark ? '#94a3b8' : '#475569';
  const pointBg  = dark ? '#1e293b' : '#f0f4ff';
  const borderC  = dark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)';

  // Grid lines
  for (let i = 0; i <= 5; i++) {
    ctx.beginPath();
    ctx.strokeStyle = borderC;
    ctx.lineWidth   = 0.5;
    ctx.moveTo(i * W / 5, 0); ctx.lineTo(i * W / 5, H);
    ctx.moveTo(0, i * H / 5); ctx.lineTo(W, i * H / 5);
    ctx.stroke();
  }

  const g = queryType ? embedGroups[queryType] : null;

  // Draw similarity circle if query selected
  if (g) {
    const highlighted = embedPoints.filter(p => g.highlight.includes(p.label));
    if (highlighted.length > 0) {
      const cx  = highlighted.reduce((s, p) => s + p.x * W, 0) / highlighted.length;
      const cy  = highlighted.reduce((s, p) => s + p.y * H, 0) / highlighted.length;
      const rad = 70;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = g.color;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexToRgba(g.color, 0.08);
      ctx.fill();
      // Query point
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle   = g.color;
      ctx.shadowColor = g.color;
      ctx.shadowBlur  = 12;
      ctx.fill();
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#fff';
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.font        = 'bold 9px Segoe UI';
      ctx.fillText('Q', cx, cy);
      ctx.fillStyle   = textCol;
      ctx.font        = '10px Segoe UI';
      ctx.fillText('Your Query', cx, cy + 18);
    }
  }

  // Draw points
  embedPoints.forEach(p => {
    const px = p.x * W;
    const py = p.y * H;
    const isHighlighted = g && g.highlight.includes(p.label);
    const radius = isHighlighted ? 7 : 5;
    const col    = isHighlighted ? g.color : (dark ? '#4b5563' : '#94a3b8');

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = col;
    if (isHighlighted) { ctx.shadowColor = col; ctx.shadowBlur = 8; }
    ctx.fill();
    ctx.restore();

    // Label
    ctx.fillStyle    = isHighlighted ? (dark ? '#e2e8f0' : '#1e293b') : textCol;
    ctx.font         = isHighlighted ? 'bold 10px Segoe UI' : '9px Segoe UI';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(p.label, px, py + radius + 3);
  });

  // Axis labels
  ctx.fillStyle    = textCol;
  ctx.font         = '10px Segoe UI';
  ctx.textAlign    = 'center';
  ctx.fillText('← Vector Space Dimension 1 →', W / 2, H - 14);
}

/* ══════════════════════════════════════
   UTILITY
══════════════════════════════════════ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ══════════════════════════════════════
   AGENT TYPE TABS (Module 03)
══════════════════════════════════════ */
function showAgentType(type) {
  // Switch active tab button (buttons use onclick="showAgentType('type')")
  document.querySelectorAll('.atype-tab').forEach(btn => {
    const match = (btn.getAttribute('onclick') || '').match(/'(\w+)'/);
    const btnType = match ? match[1] : '';
    btn.classList.toggle('active', btnType === type);
  });
  // Show matching panel by id="atype-<type>", hide others with .hidden
  document.querySelectorAll('.atype-panel').forEach(panel => {
    const isMatch = panel.id === 'atype-' + type;
    panel.classList.toggle('hidden', !isMatch);
  });
}

/* ══════════════════════════════════════
   TOOL CALLING SIMULATOR (Module 03.5)
══════════════════════════════════════ */
const toolSimScenarios = [
  {
    problem : 'OOMKilled pods in production namespace',
    reasoning: [
      '🔍 Thinking: OOMKilled means container exceeded memory limit.',
      '📋 Plan: (1) Check current pod status, (2) Inspect resource limits, (3) Review recent memory metrics.',
      '🔧 Selected: kubectl_get_pods — need live pod status first.'
    ],
    tools    : ['kubectl_get_pods', 'get_resource_limits', 'get_metrics', 'create_incident'],
    chosen   : 'kubectl_get_pods',
    result   : '3 pods OOMKilled in last 10 min. Restarting with exit code 137.'
  },
  {
    problem : 'API latency spike > 5 seconds on /checkout',
    reasoning: [
      '🔍 Thinking: Latency spike could be DB, upstream service, or resource contention.',
      '📋 Plan: (1) Check current latency metrics, (2) Trace slow spans, (3) Inspect DB query times.',
      '🔧 Selected: query_prometheus — get time-series latency data first.'
    ],
    tools    : ['query_prometheus', 'get_traces', 'query_db_slow_log', 'get_metrics'],
    chosen   : 'query_prometheus',
    result   : 'p99 latency = 5.4s. Spike started 14:23 UTC. Correlates with deploy #847.'
  },
  {
    problem : 'CI/CD pipeline failing at integration test stage',
    reasoning: [
      '🔍 Thinking: Pipeline failure could be flaky tests, env issue, or code regression.',
      '📋 Plan: (1) Fetch recent pipeline runs, (2) Parse failure logs, (3) Check test history.',
      '🔧 Selected: get_pipeline_status — identify which jobs are failing.'
    ],
    tools    : ['get_pipeline_status', 'get_build_logs', 'list_recent_commits', 'query_prometheus'],
    chosen   : 'get_pipeline_status',
    result   : 'Stage "integration-tests" failing since commit a3f89c1. 4/5 runs failed.'
  },
  {
    problem : 'Cloud spend 40% above budget this month',
    reasoning: [
      '🔍 Thinking: Cost spike — need to identify which service/resource is over-spending.',
      '📋 Plan: (1) Pull cost breakdown by service, (2) Find top resource consumers, (3) Check scaling policies.',
      '🔧 Selected: get_cost_breakdown — get service-level cost data first.'
    ],
    tools    : ['get_cost_breakdown', 'list_ec2_instances', 'get_resource_limits', 'create_incident'],
    chosen   : 'get_cost_breakdown',
    result   : 'EC2 costs +$12,400. Auto-scaling triggered 847 instances. Policy misconfigured.'
  }
];

let tsCurrentIdx = 0;

function showToolSim(idx) {
  tsCurrentIdx = idx;
  const scenario = toolSimScenarios[idx];

  // Highlight active button
  document.querySelectorAll('.ts-prob-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });

  // Animate reasoning steps
  const reasoningEl = document.getElementById('tsReasoning');
  if (reasoningEl) {
    reasoningEl.innerHTML = '';
    scenario.reasoning.forEach((line, i) => {
      setTimeout(() => {
        const div = document.createElement('div');
        div.style.cssText = 'opacity:0;transform:translateY(6px);transition:all 0.3s ease;margin-bottom:6px;';
        div.textContent = line;
        reasoningEl.appendChild(div);
        requestAnimationFrame(() => {
          setTimeout(() => { div.style.opacity = '1'; div.style.transform = 'translateY(0)'; }, 20);
        });
      }, i * 280);
    });
  }

  // Render tool pills
  const toolsEl = document.getElementById('tsTools');
  if (toolsEl) {
    toolsEl.innerHTML = scenario.tools.map(t =>
      `<span class="ts-tool-pill${t === scenario.chosen ? ' selected' : ''}">${t}</span>`
    ).join('');
  }

  // Show chosen tool result
  const chosenEl = document.getElementById('tsChosen');
  if (chosenEl) {
    chosenEl.style.opacity = '0';
    setTimeout(() => {
      chosenEl.textContent = `▶ ${scenario.chosen}() → "${scenario.result}"`;
      chosenEl.style.transition = 'opacity 0.4s ease';
      chosenEl.style.opacity = '1';
    }, scenario.reasoning.length * 280 + 200);
  }
}

/* ══════════════════════════════════════
   HUMAN-IN-THE-LOOP DEMO (Module 06)
══════════════════════════════════════ */
function hitlDecision(decision) {
  const logEl    = document.getElementById('hitlLog');
  const boxEl    = document.getElementById('hitlBox');
  const approveNode = document.getElementById('hn-approval');
  const remediateNode = document.getElementById('hn-remediate');
  const reportNode = document.getElementById('hn-report');

  if (!logEl || !boxEl) return;

  // Hide the interrupt box
  boxEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  boxEl.style.opacity    = '0';
  boxEl.style.transform  = 'scale(0.95)';

  // Mark approval node as done (starts as hn-pending in HTML)
  if (approveNode) {
    approveNode.className = approveNode.className.replace(/hn-pending|hn-active|hn-waiting/, 'hn-done');
  }

  setTimeout(() => {
    boxEl.style.display = 'none';

    if (decision === 'approve') {
      // Animate remediate node active → done
      if (remediateNode) {
        remediateNode.className = remediateNode.className.replace(/hn-pending|hn-waiting/, 'hn-active');
        logEl.innerHTML += `<div style="color:#22c55e;margin-bottom:4px;">✅ [${timestamp()}] Human APPROVED. Resuming graph with Command(resume=True)...</div>`;

        setTimeout(() => {
          remediateNode.className = remediateNode.className.replace('hn-active', 'hn-done');
          logEl.innerHTML += `<div style="color:#22c55e;margin-bottom:4px;">🔧 [${timestamp()}] Remediation executed: Scaled deployment memory limit 512Mi → 1Gi.</div>`;

          // Animate report node
          setTimeout(() => {
            if (reportNode) {
              reportNode.className = reportNode.className.replace(/hn-pending|hn-waiting/, 'hn-active');
              setTimeout(() => {
                reportNode.className = reportNode.className.replace('hn-active', 'hn-done');
                logEl.innerHTML += `<div style="color:#a78bfa;margin-bottom:4px;">📋 [${timestamp()}] Incident report filed. Thread saved to checkpointer.</div>`;
                logEl.innerHTML += `<div style="color:#64748b;margin-top:8px;font-size:11px;">Graph run complete. All nodes ✅</div>`;
                logEl.scrollTop = logEl.scrollHeight;
              }, 1200);
            }
          }, 800);

          logEl.scrollTop = logEl.scrollHeight;
        }, 1000);
      }

    } else {
      // Rejected
      logEl.innerHTML += `<div style="color:#ef4444;margin-bottom:4px;">🚫 [${timestamp()}] Human REJECTED. Resuming graph with Command(resume=False)...</div>`;
      logEl.innerHTML += `<div style="color:#f59e0b;margin-bottom:4px;">📣 [${timestamp()}] Escalation triggered. On-call engineer paged via PagerDuty.</div>`;

      if (reportNode) {
        reportNode.className = reportNode.className.replace(/hn-pending|hn-waiting/, 'hn-active');
        setTimeout(() => {
          reportNode.className = reportNode.className.replace('hn-active', 'hn-done');
          logEl.innerHTML += `<div style="color:#a78bfa;margin-bottom:4px;">📋 [${timestamp()}] Rejection logged. Escalation report filed.</div>`;
          logEl.innerHTML += `<div style="color:#64748b;margin-top:8px;font-size:11px;">Graph run complete (escalation path). ✅</div>`;
          logEl.scrollTop = logEl.scrollHeight;
        }, 1000);
      }

      logEl.scrollTop = logEl.scrollHeight;
    }
  }, 350);
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function resetHitlDemo() {
  const boxEl = document.getElementById('hitlBox');
  const logEl = document.getElementById('hitlLog');
  const approveNode   = document.getElementById('hn-approval');
  const remediateNode = document.getElementById('hn-remediate');
  const reportNode    = document.getElementById('hn-report');

  if (boxEl) {
    boxEl.style.display   = '';
    boxEl.style.opacity   = '1';
    boxEl.style.transform = 'scale(1)';
  }
  if (logEl)  logEl.innerHTML = '<div style="color:#64748b;">// Waiting for graph to reach interrupt()...</div>';

  // Reset node classes to their initial HTML states
  const nodeMap = { 'hn-approval': 'hn-pending', 'hn-remediate': 'hn-waiting', 'hn-report': 'hn-waiting' };
  [approveNode, remediateNode, reportNode].forEach((el, i) => {
    if (!el) return;
    const id     = ['hn-approval','hn-remediate','hn-report'][i];
    const target = nodeMap[id];
    el.className = el.className.replace(/hn-(done|active|waiting|pending)/g, target);
  });
}

/* ══════════════════════════════════════
   INITIAL CANVAS DRAW + SIM INIT (after all data is declared)
══════════════════════════════════════ */
window.addEventListener('load', () => {
  drawLangGraph(lgCurrentNode);
  drawWorkflowCanvas();
  drawEmbedCanvas(embedCurrentQuery);
  // Pre-populate tool sim with first scenario
  if (document.getElementById('tsReasoning')) showToolSim(0);
});

/* ══════════════════════════════════════
   FOLDER STRUCTURE — INTERACTIVE TREE
══════════════════════════════════════ */
const FS_DATA = {
  src: {
    name: 'src/my_ai_project/',
    subtitle: 'Main Python Package',
    desc: 'The top-level Python package. All importable code lives here. Keeps the root clean and enables proper packaging with pyproject.toml. Only one src/ package — avoid nested src/ trees.',
    files: [
      { name: '__init__.py', desc: 'Package marker — exposes the public API surface' },
    ],
    rule: '💡 Use <strong>src/ layout</strong> (not flat) so you can\'t accidentally import from the local directory instead of the installed package. Prevents subtle import bugs in CI.'
  },
  agents: {
    name: 'agents/',
    subtitle: 'Reasoning Units',
    desc: 'Agent definitions and logic. Each agent is the "brain" inside a graph node — it decides what to do given the current state. Agents should be stateless; state lives in schemas/.',
    files: [
      { name: 'base_agent.py',       desc: 'Abstract base — shared prompt loading, error handling, retry logic' },
      { name: 'diagnostics_agent.py',desc: 'Concrete agent: takes state in, returns updated state out' },
    ],
    rule: '💡 <strong>Agents know nothing about graphs.</strong> An agent receives a state dict and returns a state dict. The graph decides what happens next — not the agent.'
  },
  graphs: {
    name: 'graphs/',
    subtitle: 'LangGraph State Machines',
    desc: 'Defines the DAG — nodes, edges, and conditional routing. This is your workflow orchestration layer. Think of it as the runbook: it says "after classify, if actionable go to diagnose, else end".',
    files: [
      { name: 'main_graph.py',    desc: 'Root orchestrator — adds nodes, wires edges, compiles the graph' },
      { name: 'sub_graph.py',     desc: 'Encapsulated sub-workflow, callable from main_graph as a node' },
      { name: 'routing.py',       desc: 'All conditional edge functions extracted here — keeps graph files clean' },
    ],
    rule: '💡 Extract all <strong>routing.py</strong> conditions out of the graph file. Conditional logic grows fast and clutters graph definitions. Keep graphs as pure wiring diagrams.'
  },
  tools: {
    name: 'tools/',
    subtitle: 'Agent Actions / Capabilities',
    desc: 'Everything an agent can call — kubectl wrappers, Slack messengers, log analyzers, metric scrapers. Organised into sub-folders by domain. Tools are pure functions: input → output, no side-effects beyond the declared action.',
    files: [
      { name: 'base_tool.py',           desc: 'Base tool interface — enforces name, description, and run() contract' },
      { name: 'kubernetes/kubectl_tool.py', desc: 'kubectl wrapper: get, describe, logs, exec' },
      { name: 'communication/slack_tool.py',desc: 'Slack messaging & threads' },
      { name: 'analysis/log_analyzer.py',  desc: 'Log pattern matching & anomaly detection' },
    ],
    rule: '💡 Group tools by <strong>domain, not by size.</strong> Three Kubernetes tools → kubernetes/ subfolder. Don\'t keep everything flat in tools/ once you have more than 5 files.'
  },
  prompts: {
    name: 'prompts/',
    subtitle: 'First-Class Prompt Assets',
    desc: 'All prompt templates stored as files, never hardcoded in Python. A loader.py reads and renders them. Prompts can be reviewed by non-engineers, versioned in git, and swapped without a code deploy.',
    files: [
      { name: 'loader.py',               desc: 'Reads .md/.txt/.jinja2 files, renders with Jinja2 if needed' },
      { name: 'system/diagnostics.md',   desc: 'System prompt for the diagnostics agent' },
      { name: 'templates/incident_summary.md', desc: 'Jinja2 template: fills in incident vars at runtime' },
    ],
    rule: '💡 Treat prompts like <strong>ConfigMaps</strong> — config shouldn\'t be baked into the container image. Never hardcode a system prompt string in Python.'
  },
  schemas: {
    name: 'schemas/',
    subtitle: 'Data Contracts & State Shapes',
    desc: 'Pydantic models, TypedDicts, and LangGraph State definitions. This is the contract layer — everyone agrees on the shape of data before it moves between nodes, APIs, and tools. Nothing else should define data shapes.',
    files: [
      { name: 'state.py',  desc: 'LangGraph TypedDict state — the shared context flowing through the graph' },
      { name: 'inputs.py', desc: 'Pydantic models for API request bodies' },
      { name: 'outputs.py',desc: 'Pydantic models for API response shapes' },
    ],
    rule: '💡 <strong>schemas/ vs models/</strong> — schemas/ is your protobuf definition (what the data looks like). models/ is your gRPC client setup (how to call the LLM). Never mix them.'
  },
  models: {
    name: 'models/',
    subtitle: 'LLM & Embedding Config',
    desc: 'LLM wrappers and embedding initialisation. One place to swap models, adjust temperature, add retry logic, or route to different providers. llm_factory.py is the single source of truth for all model clients.',
    files: [
      { name: 'llm_factory.py', desc: 'Initialises ChatAnthropic, ChatOpenAI etc from config — one function call for agents to get a model' },
      { name: 'embeddings.py',  desc: 'Embedding model setup for RAG and vector search' },
    ],
    rule: '💡 Agents should <strong>never</strong> call ChatAnthropic() directly. They call llm_factory.get_model("fast") or get_model("powerful") — the factory resolves the config.'
  },
  guardrails: {
    name: 'guardrails/',
    subtitle: 'Safety Layer',
    desc: 'Input validation, output validation, PII detection, prompt injection checks, and human-in-the-loop approval gates. Agents call guardrails — guardrails never call agents. This layer is orthogonal to the rest of the graph.',
    files: [
      { name: 'input_guards.py',   desc: 'Checks for prompt injection, banned topics, PII in user input' },
      { name: 'output_guards.py',  desc: 'Validates agent output before it leaves the system' },
      { name: 'approval_gate.py',  desc: 'Human-in-the-loop interrupt: pause graph, notify, wait for decision' },
    ],
    rule: '💡 Think of guardrails/ as a <strong>WAF (Web Application Firewall)</strong> — it sits in front of and after your agents, not inside them. Mixing guardrail logic into agents makes it easy to bypass.'
  },
  memory: {
    name: 'memory/',
    subtitle: 'Persistence & Checkpointing',
    desc: 'LangGraph checkpointer setup and long-term memory stores. Checkpointing enables pause/resume, human-in-the-loop, and crash recovery. The graph accesses memory — not individual agents.',
    files: [
      { name: 'checkpointer.py', desc: 'Configures SqliteSaver (dev) or AsyncRedisSaver / PostgresSaver (prod)' },
      { name: 'store.py',        desc: 'Long-term memory store for cross-thread facts and user context' },
    ],
    rule: '💡 Use <strong>SqliteSaver in dev</strong>, swap to Redis or Postgres in prod — same interface, zero code change. Never hardcode the checkpointer backend in graph files.'
  },
  api: {
    name: 'api/',
    subtitle: 'HTTP / WebSocket Layer',
    desc: 'FastAPI routes, middleware, and entry point. This layer translates HTTP requests into graph invocations. It should be thin — no business logic here. Routes call graphs; they don\'t contain agent logic.',
    files: [
      { name: 'main.py',               desc: 'FastAPI app factory — mounts routers, registers middleware, lifespan' },
      { name: 'routes/webhooks.py',    desc: 'POST /webhooks/alertmanager — receives and validates incoming alerts' },
      { name: 'routes/health.py',      desc: '/health/live, /health/ready for Kubernetes probes' },
      { name: 'middleware/auth.py',    desc: 'API key / JWT validation middleware' },
    ],
    rule: '💡 Routes should be <strong>3–5 lines</strong>: validate input → invoke graph → return response. If a route has more logic than that, extract it into agents/ or a service layer.'
  },
  utils: {
    name: 'utils/',
    subtitle: 'Shared Helpers (Keep Small)',
    desc: 'Truly cross-cutting utilities with no better home: structured logger instance, retry decorator, date formatters. If utils/ grows past 4 files, each file probably has a real home somewhere else.',
    files: [
      { name: 'logger.py', desc: 'Structured JSON logger instance — import this everywhere, not logging.getLogger' },
      { name: 'retry.py',  desc: 'Exponential backoff decorator for external API calls' },
    ],
    rule: '⚠️ <strong>utils/ is a warning sign when it grows.</strong> utils/k8s_helpers.py → tools/kubernetes/. utils/llm_cache.py → memory/. A vague folder name hides architecture debt.'
  },
  configs: {
    name: 'configs/',
    subtitle: '12-Factor App Config',
    desc: 'Environment-specific YAML overrides following the 12-factor app pattern. base.yaml holds shared defaults. Each environment file only overrides what differs. Loaded and deep-merged at startup.',
    files: [
      { name: 'base.yaml',    desc: 'Shared defaults: model names, timeouts, feature flags, log level' },
      { name: 'dev.yaml',     desc: 'Overrides: sqlite checkpointer, debug logging, lower rate limits' },
      { name: 'staging.yaml', desc: 'Overrides: Redis checkpointer, staging API keys, stricter guardrails' },
      { name: 'prod.yaml',    desc: 'Overrides: Postgres, prod endpoints, alerting thresholds' },
    ],
    rule: '💡 Think <strong>Helm values.yaml + env overlays.</strong> No secrets in YAML — only structure. Secrets go in .env / Vault / K8s Secrets. The .env.example lists every required secret key.'
  },
  tests: {
    name: 'tests/',
    subtitle: 'Three-Layer Test Strategy',
    desc: 'Tests split into three distinct layers with different run strategies. unit/ and integration/ run on every PR. evals/ run separately — LLM outputs are probabilistic and cannot be part of a deterministic CI gate.',
    files: [
      { name: 'unit/',        desc: 'Fast, isolated — mock all I/O. Tests routing logic, state transforms, validators' },
      { name: 'integration/', desc: 'Real infra, real LLM calls — tests graph flows end-to-end with a test checkpointer' },
      { name: 'evals/',       desc: 'LLM quality tests: accuracy, hallucination rate, latency. Run in a separate CI job' },
    ],
    rule: '💡 <strong>evals/ are not pytest tests.</strong> They\'re probabilistic measurements — like chaos tests. Never let a flaky model output fail a standard PR build. Run evals/ on a schedule or pre-release.'
  },
  'tools-kubernetes': {
    name: 'tools/kubernetes/',
    subtitle: 'Kubernetes Tool Domain',
    desc: 'All Kubernetes-specific tools grouped together. kubectl_tool.py wraps kubectl commands — get, describe, logs, exec, patch. Grouping by domain keeps tools/ flat and easy to navigate as the project grows.',
    files: [
      { name: 'kubectl_tool.py', desc: 'get, describe, logs, exec, patch — covers ~90% of K8s diagnostic operations' },
    ],
    rule: '💡 One domain = one subfolder. If you add a Helm tool or a K8s events watcher, they also go here — not back in the root tools/ folder.'
  },
  'tools-communication': {
    name: 'tools/communication/',
    subtitle: 'Notification & Messaging Tools',
    desc: 'Tools for sending messages and notifications. Slack for real-time incident threads, email for formal escalations. Both share the same base tool interface — swappable without touching agent code.',
    files: [
      { name: 'slack_tool.py', desc: 'Post messages, create threads, add reactions — uses Slack WebClient' },
      { name: 'email_tool.py', desc: 'Send formatted incident reports via SMTP or SendGrid' },
    ],
    rule: '💡 Agents call send_notification(channel="slack", ...) — not slack_tool directly. Wrap tools behind a common interface so you can swap providers without touching agent logic.'
  },
  'tools-analysis': {
    name: 'tools/analysis/',
    subtitle: 'Observability Analysis Tools',
    desc: 'Tools that parse and interpret observability data. log_analyzer.py does regex-based pattern matching and anomaly scoring on raw logs. metric_analyzer.py detects time-series anomalies from Prometheus data.',
    files: [
      { name: 'log_analyzer.py',    desc: 'Pattern matching, error rate scoring, log clustering for incident triage' },
      { name: 'metric_analyzer.py', desc: 'Time-series spike detection, baseline comparison, SLO burn rate calc' },
    ],
    rule: '💡 These are <strong>pure analysis functions</strong> — they take data in, return structured findings out. No side effects, no external calls. Easy to unit test without mocking infrastructure.'
  },
  'prompts-system': {
    name: 'prompts/system/',
    subtitle: 'System Prompts',
    desc: 'Static system prompts loaded once at agent initialisation. Written in Markdown for readability. Each agent has its own system prompt file — never share system prompts between agents with different roles.',
    files: [
      { name: 'diagnostics.md', desc: 'System prompt for the diagnostics agent — role, constraints, output format' },
      { name: 'postmortem.md',  desc: 'System prompt for the postmortem writer — tone, structure, required sections' },
    ],
    rule: '💡 Write system prompts in <strong>Markdown, not f-strings.</strong> They\'re documents, not code. Reviewable by non-engineers, diffable in git, and editable without touching Python.'
  },
  'prompts-templates': {
    name: 'prompts/templates/',
    subtitle: 'Dynamic Jinja2 Templates',
    desc: 'Parameterised prompt templates rendered at runtime with Jinja2. Used when the prompt body changes based on incident data, user context, or retrieved documents. loader.py renders these with the current state dict.',
    files: [
      { name: 'incident_summary.md', desc: 'Template: fills in {{ pod_name }}, {{ error_type }}, {{ runbook_steps }} at runtime' },
    ],
    rule: '💡 Use Jinja2 templates for <strong>dynamic prompts</strong>, plain .md files for static ones. Never concatenate strings in Python to build prompts — that\'s the hardcoded anti-pattern.'
  },
  'api-routes': {
    name: 'api/routes/',
    subtitle: 'HTTP Route Handlers',
    desc: 'One file per route group. Routes are thin — they validate input, call into graphs or services, and return the response. No business logic lives here. If a route grows past ~20 lines, extract the logic.',
    files: [
      { name: 'health.py',   desc: 'GET /health/live, /health/ready — used by K8s liveness and readiness probes' },
      { name: 'webhooks.py', desc: 'POST /webhooks/alertmanager — validates HMAC, parses payload, invokes graph' },
      { name: 'chat.py',     desc: 'WebSocket /chat — streams graph output tokens back to the UI in real time' },
    ],
    rule: '💡 <strong>Routes are the thinnest layer.</strong> health.py should be 5 lines. webhooks.py should be 10–15. If it\'s longer, you\'ve put business logic in the wrong place.'
  },
  'api-middleware': {
    name: 'api/middleware/',
    subtitle: 'Request Middleware',
    desc: 'Cross-cutting concerns that run on every request: authentication, rate limiting, request ID injection, logging. Middleware is registered once in main.py and applies globally — not per route.',
    files: [
      { name: 'auth.py', desc: 'API key validation or JWT verification — rejects unauthenticated requests before they hit routes' },
    ],
    rule: '💡 Middleware is <strong>not guardrails.</strong> Middleware handles HTTP-level concerns (auth, headers, rate limits). Guardrails handle AI-level concerns (prompt injection, PII). Keep them separate.'
  },
  docker: {
    name: 'docker/',
    subtitle: 'Container & Compose Config',
    desc: 'Dockerfile and Docker Compose for local development and deployment. compose.yaml wires up the app, Redis, and Postgres so any dev can run the full stack with one command.',
    files: [
      { name: 'Dockerfile',    desc: 'Multi-stage build: deps layer cached separately from app code' },
      { name: 'compose.yaml',  desc: 'Local stack: app + Redis (checkpointer) + Postgres (state store)' },
    ],
    rule: '💡 Use a <strong>multi-stage Dockerfile</strong>: builder stage installs deps, final stage copies only the app. Keeps the image lean. Never copy .env or credentials into the image.'
  },
};

(function initFolderTree() {
  const tree       = document.getElementById('fsTree');
  const detailPanel = document.getElementById('fsDetailPanel');
  if (!tree || !detailPanel) return;

  function renderDetail(key) {
    const d = FS_DATA[key];
    if (!d) return;
    const filesHtml = d.files.map(f => `
      <div class="fs-detail-file-item">
        <code>${f.name}</code>
        <span>${f.desc}</span>
      </div>`).join('');
    detailPanel.innerHTML = `
      <div class="fs-detail-content">
        <div class="fs-detail-name">${d.name}</div>
        <div class="fs-detail-subtitle">${d.subtitle}</div>
        <div class="fs-detail-desc">${d.desc}</div>
        <div class="fs-detail-files">
          <div class="fs-detail-files-title">Key Files</div>
          ${filesHtml}
        </div>
        <div class="fs-detail-rule">${d.rule}</div>
      </div>`;
  }

  tree.querySelectorAll('.fs-dir').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.folder;
      const children = tree.querySelector(`.fs-children[data-parent="${key}"]`);

      // Toggle open/closed
      if (children) children.classList.toggle('open');

      // Active highlight
      tree.querySelectorAll('.fs-dir').forEach(e => e.classList.remove('fs-active'));
      el.classList.add('fs-active');

      // Show detail
      renderDetail(key);
    });
  });

  // Auto-open src on load
  const srcEl = tree.querySelector('[data-folder="src"]');
  if (srcEl) {
    const srcChildren = tree.querySelector('.fs-children[data-parent="src"]');
    if (srcChildren) srcChildren.classList.add('open');
  }
})();

/* ══════════════════════════════════════
   RESIZE HANDLER
══════════════════════════════════════ */
window.addEventListener('resize', () => {
  drawLangGraph(lgCurrentNode);
  drawWorkflowCanvas();
  drawEmbedCanvas(embedCurrentQuery);
});

/* ══════════════════════════════════════════════════════════
   HELM CHARTS — ALL INTERACTIVITY
   1. helmChartTree()      — anatomy file tree
   2. renderHelmTemplate() — template renderer (module 03 panel)
   3. updateHelmSim()      — sim 1 live renderer
   4. hlsStep()            — sim 2 lifecycle stepper
   5. selectHelmDep()      — sim 3 dependency tree
   6. animateHelmInstall() — sim 3 install animation
══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════
   1. HELM ANATOMY FILE TREE
══════════════════════════════════════ */
const HELM_FILE_DATA = {
  'chart-yaml': {
    title: 'Chart.yaml',
    subtitle: 'Chart Metadata — The Passport',
    desc: 'Every chart must have a Chart.yaml. It names the chart, sets its semver version, and declares what app version it deploys. Helm reads this file first on every command.',
    example: `apiVersion: v2
name: mychart
description: A production-ready app chart
type: application
version: 1.3.0       # Chart version (semver)
appVersion: "2.4.1"  # App image tag
maintainers:
  - name: platform-team`,
    tip: '💡 Bump <strong>version</strong> on every chart change. <strong>appVersion</strong> is informational — it does not affect Helm logic.',
  },
  'values-yaml': {
    title: 'values.yaml',
    subtitle: 'Default Configuration Values',
    desc: 'All configurable parameters with their default values. Users override these with --values prod.yaml or --set key=value. Think of this as your ConfigMap template.',
    example: `replicaCount: 1
image:
  repository: myapp
  tag: "latest"
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
ingress:
  enabled: false
resources:
  limits:
    memory: 256Mi`,
    tip: '💡 Provide sensible <strong>defaults for development</strong>. Never put real secrets here — use a secrets manager or --set in CI.',
  },
  'values-schema': {
    title: 'values.schema.json',
    subtitle: 'Values Validation Schema',
    desc: 'A JSON Schema that Helm validates values against before rendering. Catches wrong types, missing required fields, and bad enum values before anything reaches the cluster.',
    example: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["image"],
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "required": ["tag"],
      "properties": {
        "tag": { "type": "string" }
      }
    }
  }
}`,
    tip: '💡 Add schema validation as soon as your chart has more than 5 configurable values. It saves hours of "why is it not rendering?" debugging.',
  },
  'helmignore': {
    title: '.helmignore',
    subtitle: 'Like .gitignore for helm package',
    desc: 'Controls which files are excluded when running helm package. Keeps your chart tarballs lean — exclude CI config, test fixtures, and local dev files.',
    example: `# Patterns to exclude from helm package
.git
.gitignore
*.md
tests/
ci/
.env*
*.test.yaml`,
    tip: '💡 Always exclude <strong>README.md</strong> if it\'s large — it\'s embedded in the chart package and inflates download sizes.',
  },
  'charts-dir': {
    title: 'charts/',
    subtitle: 'Downloaded Sub-chart Dependencies',
    desc: 'This folder is populated by helm dependency update. It contains the .tgz archives of all charts listed in the dependencies block of Chart.yaml. Commit this folder to git OR add it to .helmignore and regenerate in CI.',
    example: `charts/
  postgresql-13.2.0.tgz
  redis-18.1.0.tgz
  # Chart.lock records exact versions
`,
    tip: '💡 <strong>Committing charts/ is safer for air-gapped environments.</strong> Using .helmignore + helm dep update in CI is cleaner for internet-connected teams.',
  },
  'templates-dir': {
    title: 'templates/',
    subtitle: 'Kubernetes Manifests with Go Templating',
    desc: 'All your Kubernetes YAML files live here, with {{ .Values.xxx }} placeholders. Helm renders them into real manifests at install/upgrade time. Non-YAML files are ignored by Helm.',
    example: `templates/
  deployment.yaml   # Workload
  service.yaml      # Networking
  ingress.yaml      # Ingress rule
  _helpers.tpl      # Named partials
  NOTES.txt         # Post-install msg
  tests/            # helm test pods`,
    tip: '💡 Files starting with <strong>underscore (_)</strong> are not rendered as manifests — they\'re helper files for named templates only.',
  },
  'deployment-yaml': {
    title: 'templates/deployment.yaml',
    subtitle: 'Core Workload Template',
    desc: 'A standard Kubernetes Deployment with Go template placeholders. Values flow in from values.yaml at render time. Labels and selectors should use the named templates from _helpers.tpl for consistency.',
    example: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    spec:
      containers:
      - name: {{ .Chart.Name }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"`,
    tip: '💡 Always use <strong>{{ .Release.Name }}</strong> (not the chart name) in resource names — allows multiple releases of the same chart in one namespace.',
  },
  'service-yaml': {
    title: 'templates/service.yaml',
    subtitle: 'Service Networking Template',
    desc: 'Exposes the deployment pods inside the cluster. Type is configurable via values — ClusterIP for internal, LoadBalancer for external, NodePort for bare-metal.',
    example: `apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
  selector:
    app: {{ .Release.Name }}`,
    tip: '💡 Use <code>ClusterIP</code> as the default — don\'t expose services externally unless explicitly configured by the user.',
  },
  'ingress-yaml': {
    title: 'templates/ingress.yaml',
    subtitle: 'Ingress Rule Template (Optional)',
    desc: 'Conditionally rendered only when ingress.enabled is true. Wrapping optional resources in {{- if .Values.x }} ... {{- end }} is the standard Helm pattern for optional features.',
    example: `{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Release.Name }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  rules:
    - host: {{ .Values.ingress.host }}
{{- end }}`,
    tip: '💡 <strong>{{- if ... -}}</strong> with dashes trims surrounding whitespace — required when wrapping YAML blocks to avoid blank lines in the rendered output.',
  },
  'helpers-tpl': {
    title: 'templates/_helpers.tpl',
    subtitle: 'Named Template Partials — DRY Principle',
    desc: 'Define reusable template snippets with {{- define "name" -}} ... {{- end }}. Call them with {{ include "name" . }}. Especially useful for labels and selectors used across multiple resources.',
    example: `{{/*
  Standard labels applied to all resources
*/}}
{{- define "mychart.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}`,
    tip: '💡 Always define standard labels in _helpers.tpl and <code>include</code> them everywhere. Consistent labels are what make <code>kubectl get all -l app.kubernetes.io/instance=myapp</code> work.',
  },
  'notes-txt': {
    title: 'templates/NOTES.txt',
    subtitle: 'Post-install Message to the User',
    desc: 'Rendered and printed to the terminal after a successful install or upgrade. Use it to show access instructions, next steps, or important config reminders. Supports Go templating.',
    example: `Thank you for installing {{ .Chart.Name }}!

Your release {{ .Release.Name }} is deployed in
namespace {{ .Release.Namespace }}.

{{- if .Values.ingress.enabled }}
Access your app at:
  http://{{ .Values.ingress.host }}
{{- else }}
Port-forward to access locally:
  kubectl port-forward svc/{{ .Release.Name }} 8080:{{ .Values.service.port }}
{{- end }}`,
    tip: '💡 Always include a port-forward command in NOTES.txt — it\'s the first thing developers run after installing your chart.',
  },
  'tests-dir': {
    title: 'templates/tests/',
    subtitle: 'Helm Test Pod Definitions',
    desc: 'Contains Job or Pod definitions annotated with "helm.sh/hook": test. Running helm test myapp creates these pods, waits for them to complete, and reports pass/fail.',
    example: `templates/tests/
  test-connection.yaml  # curl/wget health check
`,
    tip: '💡 Keep test pods minimal — a single <code>wget</code> or <code>curl</code> command against your service is enough to verify the release is functional.',
  },
  'test-connection': {
    title: 'tests/test-connection.yaml',
    subtitle: 'Connection Health Test',
    desc: 'A Pod annotated as a helm test hook. It runs after helm test is called, attempts to connect to the service, and exits 0 for pass or non-zero for fail.',
    example: `apiVersion: v1
kind: Pod
metadata:
  name: {{ .Release.Name }}-test
  annotations:
    "helm.sh/hook": test
spec:
  containers:
  - name: wget
    image: busybox
    command: ['wget']
    args:
      - '--spider'
      - '{{ .Release.Name }}:{{ .Values.service.port }}'
  restartPolicy: Never`,
    tip: '💡 Use <code>--spider</code> with wget for a lightweight HTTP check — it returns exit 0 on 200/30x without downloading the response body.',
  },
};

(function helmChartTree() {
  const tree = document.getElementById('helmTree');
  const panel = document.getElementById('helmDetailPanel');
  if (!tree || !panel) return;

  function renderHelmDetail(key) {
    const d = HELM_FILE_DATA[key];
    if (!d) return;
    panel.innerHTML = `
      <div class="fs-detail-content">
        <div class="fs-detail-name" style="color:var(--cyan)">${d.title}</div>
        <div class="fs-detail-subtitle">${d.subtitle}</div>
        <div class="fs-detail-desc">${d.desc}</div>
        <div class="fs-detail-files">
          <div class="fs-detail-files-title">Example</div>
          <pre class="cb-code" style="margin:0;font-size:0.75rem;white-space:pre;overflow-x:auto">${d.example}</pre>
        </div>
        <div class="fs-detail-rule">${d.tip}</div>
      </div>`;
  }

  tree.querySelectorAll('[data-helm-file]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      tree.querySelectorAll('[data-helm-file]').forEach(x => x.classList.remove('fs-active'));
      el.classList.add('fs-active');
      renderHelmDetail(el.dataset.helmFile);
    });
  });

  // Auto-select Chart.yaml on load
  const first = tree.querySelector('[data-helm-file="chart-yaml"]');
  if (first) { first.classList.add('fs-active'); renderHelmDetail('chart-yaml'); }
})();

/* ══════════════════════════════════════
   2. MODULE 03 TEMPLATE RENDERER PANEL
══════════════════════════════════════ */
function renderHelmTemplate() {
  const replicas = document.getElementById('hv-replicas')?.value || '2';
  const tag      = document.getElementById('hv-tag')?.value      || 'latest';
  const port     = document.getElementById('hv-port')?.value     || '80';
  const ingress  = document.getElementById('hv-ingress')?.value  || 'false';
  const memory   = document.getElementById('hv-memory')?.value   || '256Mi';

  let out = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-release
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: my-release
  template:
    spec:
      containers:
      - name: app
        image: myapp:${tag}
        ports:
        - containerPort: ${port}
        resources:
          limits:
            memory: ${memory}`;

  if (ingress === 'true') {
    out += `
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-release
spec:
  rules:
  - host: my-release.example.com`;
  }

  const el = document.getElementById('helmRenderedOutput');
  if (el) el.textContent = out;
}
// Init on load
document.addEventListener('DOMContentLoaded', renderHelmTemplate);

/* ══════════════════════════════════════
   3. SIM 1 — LIVE TEMPLATE RENDERER
══════════════════════════════════════ */
function updateHelmSim() {
  const replicas = document.getElementById('hsv-rep')?.value    || '2';
  const tag      = document.getElementById('hsv-tag')?.value    || 'v1.0.0';
  const port     = document.getElementById('hsv-port')?.value   || '80';
  const ingress  = document.getElementById('hsv-ingress')?.value || 'false';
  const memory   = document.getElementById('hsv-mem')?.value    || '256Mi';

  let out = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-release
  labels:
    app.kubernetes.io/name: myapp
    app.kubernetes.io/instance: my-release
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: my-release
  template:
    metadata:
      labels:
        app: my-release
    spec:
      containers:
      - name: myapp
        image: myapp:${tag}
        ports:
        - containerPort: ${port}
          name: http
        resources:
          limits:
            memory: ${memory}
          requests:
            memory: ${Math.round(parseInt(memory)||256 / 2)}${memory.replace(/[0-9]/g,'')}
---
apiVersion: v1
kind: Service
metadata:
  name: my-release
spec:
  type: ClusterIP
  ports:
  - port: ${port}
    targetPort: http
  selector:
    app: my-release`;

  if (ingress === 'true') {
    out += `
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-release
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: my-release.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-release
            port:
              number: ${port}`;
  }

  const el = document.getElementById('helmSimOutput');
  if (el) el.textContent = out;
}
document.addEventListener('DOMContentLoaded', updateHelmSim);

/* ══════════════════════════════════════
   4. SIM 2 — LIFECYCLE STEPPER
══════════════════════════════════════ */
const HLS_STEPS = [
  {
    cmd: '$ helm install myapp ./mychart --values prod.yaml',
    states: [{ label: 'pending-install', cls: 'helm-state-pending' }, { label: '...', cls: '' }],
    history: []
  },
  {
    cmd: '✅ Release "myapp" deployed — revision 1',
    states: [{ label: 'deployed', cls: 'helm-state-deployed' }],
    history: [{ rev: 1, status: 'deployed', chart: 'mychart-1.0.0', desc: 'Install complete' }]
  },
  {
    cmd: '$ helm upgrade myapp ./mychart --set image.tag=v2.0.0',
    states: [{ label: 'deployed', cls: 'helm-state-deployed' }, { label: '→ pending-upgrade', cls: 'helm-state-pending' }],
    history: [{ rev: 1, status: 'superseded', chart: 'mychart-1.0.0', desc: 'Install complete' }]
  },
  {
    cmd: '✅ Release "myapp" upgraded — revision 2',
    states: [{ label: 'deployed (v2)', cls: 'helm-state-deployed' }],
    history: [
      { rev: 1, status: 'superseded', chart: 'mychart-1.0.0', desc: 'Install complete' },
      { rev: 2, status: 'deployed',   chart: 'mychart-1.0.0', desc: 'Upgrade complete' }
    ]
  },
  {
    cmd: '$ helm upgrade myapp ./mychart --set image.tag=v3.0.0-rc1\n❌ UPGRADE FAILED: CrashLoopBackOff in new pods',
    states: [{ label: 'failed', cls: 'helm-state-failed' }],
    history: [
      { rev: 1, status: 'superseded', chart: 'mychart-1.0.0', desc: 'Install complete' },
      { rev: 2, status: 'superseded', chart: 'mychart-1.0.0', desc: 'Upgrade complete' },
      { rev: 3, status: 'failed',     chart: 'mychart-1.0.0', desc: 'Upgrade failed: CrashLoopBackOff' }
    ]
  },
  {
    cmd: '$ helm rollback myapp 2\n✅ Rollback to revision 2 — revision 4',
    states: [{ label: 'deployed (rollback v2)', cls: 'helm-state-deployed' }],
    history: [
      { rev: 1, status: 'superseded', chart: 'mychart-1.0.0', desc: 'Install complete' },
      { rev: 2, status: 'superseded', chart: 'mychart-1.0.0', desc: 'Upgrade complete' },
      { rev: 3, status: 'failed',     chart: 'mychart-1.0.0', desc: 'Upgrade failed' },
      { rev: 4, status: 'deployed',   chart: 'mychart-1.0.0', desc: 'Rollback to revision 2' }
    ]
  }
];

let hlsCurrentStep = 0;

function hlsRender() {
  const step = HLS_STEPS[hlsCurrentStep];
  const cmdEl    = document.getElementById('hlsCommand');
  const stateRow = document.getElementById('hlsStateRow');
  const tbody    = document.getElementById('hlsHistoryBody');
  const counter  = document.getElementById('hlsStepCounter');
  const prevBtn  = document.getElementById('hlsPrevBtn');
  const nextBtn  = document.getElementById('hlsNextBtn');
  if (!cmdEl) return;

  cmdEl.textContent = '$ ' + step.cmd.replace(/^\$ /, '');
  cmdEl.textContent = step.cmd;

  // States
  stateRow.innerHTML = step.states.map(s =>
    `<div class="helm-state ${s.cls}"><span class="hs-dot"></span>${s.label}</div>`
  ).join('<span class="helm-state-arr">→</span>');

  // History
  tbody.innerHTML = step.history.map(r => {
    const statusCls = r.status === 'deployed' ? 'deployed' : r.status === 'failed' ? 'failed' : '';
    const isLatest  = r === step.history[step.history.length - 1];
    return `<tr class="${isLatest ? 'helm-table-active hls-tr-new' : ''}">
      <td>${r.rev}</td>
      <td><span class="helm-status-pill ${statusCls}">${r.status}</span></td>
      <td>${r.chart}</td>
      <td>${r.desc}</td>
    </tr>`;
  }).join('');

  counter.textContent = `Step ${hlsCurrentStep + 1} / ${HLS_STEPS.length}`;
  prevBtn.disabled = hlsCurrentStep === 0;
  nextBtn.disabled = hlsCurrentStep === HLS_STEPS.length - 1;
}

function hlsStep(dir) {
  hlsCurrentStep = Math.max(0, Math.min(HLS_STEPS.length - 1, hlsCurrentStep + dir));
  hlsRender();
}

document.addEventListener('DOMContentLoaded', hlsRender);

/* ══════════════════════════════════════
   5. SIM 3 — DEPENDENCY TREE CLICK
══════════════════════════════════════ */
const HELM_DEP_DATA = {
  myapp: {
    snippet: `name: myapp
version: 2.1.0
dependencies:
  - name: postgresql
    version: "~13.0"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
  - name: redis
    version: "~18.0"
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
  - name: ingress-nginx
    version: "~4.8"
    repository: "https://kubernetes.github.io/ingress-nginx"`,
    note: '🌳 Root chart — declares all 3 sub-charts as dependencies. Run <code>helm dependency update</code> to download them into charts/'
  },
  postgresql: {
    snippet: `name: postgresql
version: 13.2.0
appVersion: "15.3.0"
description: PostgreSQL packaged by Bitnami
# No further dependencies — leaf chart`,
    note: '🐘 Leaf chart. No sub-charts. Helm installs this first (depth-first, leaves before parent).'
  },
  redis: {
    snippet: `name: redis
version: 18.1.0
appVersion: "7.2.0"
description: Redis packaged by Bitnami
# No further dependencies — leaf chart`,
    note: '🔴 Leaf chart. Installed before the parent. Condition: <code>redis.enabled=true</code>.'
  },
  nginx: {
    snippet: `name: ingress-nginx
version: 4.8.0
appVersion: "1.9.0"
description: NGINX Ingress Controller
# No further dependencies — leaf chart`,
    note: '🌐 Ingress controller chart. Often installed as a cluster-wide chart rather than per-app dependency.'
  }
};

function selectHelmDep(name) {
  document.querySelectorAll('.hdt-node').forEach(n => n.classList.remove('hdt-active'));
  const nodeId = { myapp: 'hdtMyapp', postgresql: 'hdtPostgres', redis: 'hdtRedis', nginx: 'hdtNginx' }[name];
  if (nodeId) document.getElementById(nodeId)?.classList.add('hdt-active');

  const d = HELM_DEP_DATA[name];
  const detail = document.getElementById('hdtDetail');
  if (d && detail) {
    detail.innerHTML = `
      <div class="hdt-detail-inner">
        <div style="font-weight:700;font-size:0.85rem;margin-bottom:6px;color:var(--helm)">${name} — Chart.yaml</div>
        <pre class="cb-code" style="margin:4px 0 8px;font-size:0.74rem;white-space:pre;overflow-x:auto">${d.snippet}</pre>
        <div style="font-size:0.8rem;color:var(--txt2)">${d.note}</div>
      </div>`;
  }
}

/* ══════════════════════════════════════
   6. SIM 3 — INSTALL ORDER ANIMATION
══════════════════════════════════════ */
function animateHelmInstall() {
  const order = ['hdtPostgres', 'hdtRedis', 'hdtNginx', 'hdtMyapp'];
  const ids   = ['postgresql',  'redis',    'nginx',    'myapp'];
  // Reset
  document.querySelectorAll('.hdt-node').forEach(n => {
    n.classList.remove('hdt-installing', 'hdt-installed', 'hdt-active');
  });

  order.forEach((nodeId, i) => {
    setTimeout(() => {
      const el = document.getElementById(nodeId);
      if (!el) return;
      el.classList.add('hdt-installing');
      selectHelmDep(ids[i]);
      setTimeout(() => {
        el.classList.remove('hdt-installing');
        el.classList.add('hdt-installed');
      }, 800);
    }, i * 1100);
  });
}


/* ══════════════════════════════════════
   KUBECTL → HELM LAB — TAB SWITCHER
══════════════════════════════════════ */
function showKHStep(step) {
  // Hide all panels
  document.querySelectorAll('.kh-panel').forEach(p => p.classList.add('hidden'));
  // Deactivate all tabs
  document.querySelectorAll('.kh-tab').forEach(t => t.classList.remove('active'));

  // Show target panel
  const panel = document.getElementById('kh-' + step);
  if (panel) panel.classList.remove('hidden');

  // Activate matching tab
  document.querySelectorAll('.kh-tab').forEach(t => {
    if (t.getAttribute('onclick')?.includes("'" + step + "'")) {
      t.classList.add('active');
    }
  });
}

// ════════════════════════════════════════════════
// HELM VERSION CONTROL — Release History Inspector
// ════════════════════════════════════════════════

const HELM_REV_DATA = {
  1: {
    chart: 'mychart-1.0.0',
    appVersion: '1.1.0',
    date: 'Mar 10, 2026 09:12 UTC',
    status: 'superseded',
    description: 'Install complete',
    values: `replicaCount: 2
image:
  tag: "v1.1.0"
service:
  port: 8080
ingress:
  enabled: false
autoscaling:
  enabled: false
resources:
  memory: "256Mi"`,
    isCurrent: false,
    note: 'This was the first install. All defaults from values.yaml. Ingress and HPA were off.'
  },
  2: {
    chart: 'mychart-1.1.0',
    appVersion: '1.3.0',
    date: 'Mar 12, 2026 14:30 UTC',
    status: 'superseded',
    description: 'Upgrade: image v1.1.0 → v1.3.0, enabled ingress',
    values: `replicaCount: 3
image:
  tag: "v1.3.0"
service:
  port: 8080
ingress:
  enabled: true
  host: "myapp.example.com"
autoscaling:
  enabled: false
resources:
  memory: "256Mi"`,
    isCurrent: false,
    note: 'Stable production release. Ingress enabled with TLS. This is the last known-good revision.'
  },
  3: {
    chart: 'mychart-1.2.0',
    appVersion: '1.4.0-rc1',
    date: 'Mar 14, 2026 10:05 UTC',
    status: 'failed',
    description: 'Upgrade failed: CrashLoopBackOff — DB migration error',
    values: `replicaCount: 3
image:
  tag: "v1.4.0-rc1"
service:
  port: 8080
ingress:
  enabled: true
  host: "myapp.example.com"
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
resources:
  memory: "512Mi"`,
    isCurrent: false,
    note: '⚠️ FAILED — RC image had a missing DB_MIGRATION_KEY env var. Pods crashed on startup. Rollback was triggered.'
  },
  4: {
    chart: 'mychart-1.1.0',
    appVersion: '1.3.0',
    date: 'Mar 14, 2026 10:08 UTC',
    status: 'superseded',
    description: 'Rollback to revision 2 — production restored',
    values: `replicaCount: 3
image:
  tag: "v1.3.0"
service:
  port: 8080
ingress:
  enabled: true
  host: "myapp.example.com"
autoscaling:
  enabled: false
resources:
  memory: "256Mi"`,
    isCurrent: false,
    note: 'Helm restored the exact state of revision 2. Took 34 seconds from alert to green pods.'
  },
  5: {
    chart: 'mychart-1.2.1',
    appVersion: '1.4.0',
    date: 'Mar 15, 2026 16:44 UTC',
    status: 'deployed',
    description: 'Upgrade: hotfix v1.4.0 with DB migration fix',
    values: `replicaCount: 3
image:
  tag: "v1.4.0"
service:
  port: 8080
ingress:
  enabled: true
  host: "myapp.example.com"
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
resources:
  memory: "512Mi"`,
    isCurrent: true,
    note: 'Fixed the DB_MIGRATION_KEY env var. This is the current live release.'
  }
};

function selectHelmRev(rev) {
  // Update timeline selection
  document.querySelectorAll('.hvi-rev').forEach(el => {
    el.classList.remove('hvi-rev-selected', 'hvi-rev-active');
  });
  const selected = document.querySelector(`.hvi-rev[data-rev="${rev}"]`);
  if (selected) selected.classList.add('hvi-rev-selected');

  const d = HELM_REV_DATA[rev];
  if (!d) return;

  const statusColor = d.status === 'deployed' ? 'var(--green)'
    : d.status === 'failed' ? 'var(--red)' : 'var(--txt2)';

  const rollbackBlock = d.isCurrent
    ? `<div class="hvi-d-rollback-cmd is-current">✅ This is the current live revision — no rollback needed</div>`
    : `<div class="hvi-d-section-label">Roll back to this revision</div>
       <div class="hvi-d-rollback-cmd">
         helm rollback myapp ${rev} -n production
         <span style="font-size:0.7rem;opacity:.6">— or dry-run: --dry-run</span>
       </div>
       <div class="hvi-d-note">Rollback will create a new revision restoring revision ${rev}'s exact templates and values.</div>`;

  document.getElementById('hviDetail').innerHTML = `
    <div class="hvi-d-header">
      <span class="hvi-d-rev">Revision ${rev}</span>
      <span class="helm-status-pill ${d.status === 'deployed' ? 'deployed' : d.status === 'failed' ? 'failed' : ''}" style="${d.status === 'superseded' ? 'background:rgba(150,150,150,.15);color:var(--txt2);' : ''}">${d.status}</span>
      <span class="hvi-d-chart">${d.chart}</span>
      <span class="hvi-d-date">${d.date}</span>
    </div>
    <div>
      <div class="hvi-d-section-label">Description</div>
      <div style="font-size:0.83rem;color:var(--txt1)">${d.description}</div>
    </div>
    <div>
      <div class="hvi-d-section-label">Values active at this revision <small style="text-transform:none;letter-spacing:0;font-size:0.68rem">(helm get values myapp --revision ${rev})</small></div>
      <pre class="cb-code" style="margin:0;font-size:0.75rem;max-height:140px;overflow:auto">${d.values}</pre>
    </div>
    <div style="font-size:0.78rem;color:var(--txt2);background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.15);border-radius:var(--radius);padding:8px 12px">💡 ${d.note}</div>
    ${rollbackBlock}
  `;
}

// Initialise with revision 1 selected on page load
(function initHVI() {
  // Wait for DOM to be ready — use a tiny delay in case section not visible yet
  const tryInit = () => {
    const detail = document.getElementById('hviDetail');
    if (detail) {
      selectHelmRev(1);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();

/* ══════════════════════════════════════
   ARGOCD — SIMULATIONS & INTERACTIVE
══════════════════════════════════════ */

/* ─── HEALTH STATE DATA ─── */
const ARGO_HEALTH_DATA = {
  healthy: {
    icon: '🟢',
    title: 'Healthy',
    color: '#10b981',
    summary: 'All Kubernetes resources are running as expected. Deployments are fully available, pods are passing readinessProbe, Services have endpoints.',
    causes: [
      'All pods in the Deployment are Running + Ready',
      'Deployment.status.availableReplicas == spec.replicas',
      'StatefulSet all replicas ready',
      'Service has at least one endpoint'
    ],
    kubectl: [
      'kubectl get pods -n production',
      'kubectl describe deployment myapp -n production'
    ],
    argoResponse: '✅ No action needed. ArgoCD monitors continuously and will alert if health changes.'
  },
  progressing: {
    icon: '🟡',
    title: 'Progressing',
    color: '#f59e0b',
    summary: 'Resources exist and are being updated. A rolling deployment is underway — new pods are starting, old pods are terminating. This is a transient state.',
    causes: [
      'Deployment rollout in progress (new pods starting)',
      'PVC provisioning (waiting for PersistentVolume)',
      'Pod pulling container image for first time',
      'Init containers running before main container starts'
    ],
    kubectl: [
      'kubectl rollout status deployment/myapp -n production',
      'kubectl get pods -n production -w'
    ],
    argoResponse: '⏳ ArgoCD waits for the rollout to complete. If it stalls, it transitions to Degraded. Check rollout timeout settings.'
  },
  degraded: {
    icon: '🔴',
    title: 'Degraded',
    color: '#ef4444',
    summary: 'Resources exist but are not healthy. At least one pod is failing, the Deployment is unavailable, or a required resource returned an error.',
    causes: [
      'Pod in CrashLoopBackOff (app keeps crashing)',
      'OOMKilled — pod exceeds memory limit',
      'ImagePullBackOff — wrong image tag or registry auth',
      'Deployment unavailable (0 of N replicas ready)',
      'Liveness probe failing → pod restarted repeatedly'
    ],
    kubectl: [
      'kubectl describe pod <pod-name> -n production',
      'kubectl logs <pod-name> -n production --previous',
      'kubectl get events -n production --sort-by=.lastTimestamp'
    ],
    argoResponse: '🚨 ArgoCD shows red in UI and fires notifications (if configured). Does NOT auto-rollback — that is your responsibility (git revert or argocd app rollback).'
  },
  suspended: {
    icon: '⏸️',
    title: 'Suspended',
    color: '#94a3b8',
    summary: 'The application has been manually suspended via the UI or CLI. No automatic syncs will run until resumed. Manual sync is also blocked.',
    causes: [
      'Manually suspended via: argocd app set myapp --operation sync --suspended',
      'Sync window is active (deny window configured)',
      'Application paused via ArgoCD UI'
    ],
    kubectl: [
      'argocd app get myapp | grep Suspended',
      'argocd app resume myapp'
    ],
    argoResponse: '⏸️ ArgoCD takes no action while suspended. Unsuspend to resume: argocd app set myapp --sync-option selfHeal=true'
  },
  unknown: {
    icon: '❓',
    title: 'Unknown',
    color: '#94a3b8',
    summary: 'ArgoCD cannot determine the health status. Usually happens for custom resources without a registered health check, or when the cluster is temporarily unreachable.',
    causes: [
      'Custom Resource without ArgoCD health check configured',
      'Cluster API server temporarily unreachable',
      'ArgoCD App Controller restarting',
      'Resource type not supported by built-in health checks'
    ],
    kubectl: [
      'kubectl get <resource> -n production',
      'argocd admin settings resource-overrides list'
    ],
    argoResponse: '⚠️ ArgoCD ignores Unknown health in sync decisions by default. Add custom health checks in argocd-cm ConfigMap for your CRDs.'
  },
  missing: {
    icon: '🚫',
    title: 'Missing',
    color: '#ef4444',
    summary: 'A resource exists in Git (desired state) but is NOT present in the Kubernetes cluster. Was it deleted manually? Did a previous sync fail?',
    causes: [
      'Resource was manually deleted from cluster (kubectl delete)',
      'Previous sync failed before creating this resource',
      'RBAC denied ArgoCD from creating this resource type',
      'Namespace does not exist (forgot CreateNamespace=true)'
    ],
    kubectl: [
      'kubectl get <resource> -n production',
      'argocd app sync myapp --force'
    ],
    argoResponse: '🔄 If auto-sync is enabled: ArgoCD recreates the missing resource on next sync cycle. If manual: run argocd app sync myapp.'
  }
};

function selectArgoHealth(state) {
  // Update active button
  document.querySelectorAll('.argocd-health-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.argocd-health-btn[onclick*="${state}"]`);
  if (btn) btn.classList.add('active');

  const d = ARGO_HEALTH_DATA[state];
  if (!d) return;

  const detail = document.getElementById('argoHealthDetail');
  if (!detail) return;

  const causesHtml = d.causes.map(c => `<li>${c}</li>`).join('');
  const kubectlHtml = d.kubectl.map(k => `<code>${k}</code>`).join('');

  detail.innerHTML = `
    <div class="argocd-hd-title" style="color:${d.color}">${d.icon} ${d.title}</div>
    <div class="argocd-hd-causes">
      <strong>What this means:</strong><p style="margin:4px 0 8px">${d.summary}</p>
      <strong>Common causes:</strong>
      <ul style="margin:4px 0 0 16px;line-height:1.8">${causesHtml}</ul>
    </div>
    <div class="argocd-hd-kubectl">
      <strong style="font-size:0.8rem;display:block;margin-bottom:6px">🔍 kubectl to investigate:</strong>
      ${kubectlHtml}
    </div>
    <div class="argocd-hd-response">${d.argoResponse}</div>
  `;
}

/* ─── SYNC LIFECYCLE STEPPER ─── */
const ARGO_LCS_STEPS = [
  {
    cmd: 'git commit -m "bump image to v2.0.0" && git push origin main',
    badge: '✅ Synced',
    badgeClass: 'argocd-sync-synced',
    desc: 'Developer pushes a change to Git. ArgoCD is currently in sync — cluster matches the previous Git state. Nothing has changed in the cluster yet.'
  },
  {
    cmd: 'ArgoCD polls Git (every ~3 min) / webhook received',
    badge: '⚠️ OutOfSync',
    badgeClass: 'argocd-sync-outofsync',
    desc: 'ArgoCD detects that Git has changed. The rendered manifests from the new commit differ from the cluster. Status changes to OutOfSync. UI shows a red indicator.'
  },
  {
    cmd: 'argocd app sync payments-api  (or auto-sync triggers)',
    badge: '🔄 Syncing',
    badgeClass: 'argocd-sync-syncing',
    desc: 'Sync initiated. The Repo Server clones the new commit and renders manifests (Helm template / kustomize build). App Controller computes the diff and calls kubectl apply for changed resources only.'
  },
  {
    cmd: 'kubectl rollout status deployment/payments-api -n production',
    badge: '🟡 Progressing',
    badgeClass: 'argocd-sync-outofsync',
    desc: 'Resources applied. New pods are starting (pulling image, running init containers). Old pods are terminating. Health status = Progressing while rollout is underway.'
  },
  {
    cmd: 'kubectl patch deployment payments-api -p \'{"spec":{"replicas":1}}\'',
    badge: '⚠️ OutOfSync',
    badgeClass: 'argocd-sync-outofsync',
    desc: 'Someone ran a manual kubectl patch on the live cluster. ArgoCD\'s reconciliation detects the drift (Git says replicas:3, cluster says replicas:1). Status: OutOfSync again.'
  },
  {
    cmd: 'selfHeal: true → ArgoCD auto-reverts drift',
    badge: '✅ Synced + 🟢 Healthy',
    badgeClass: 'argocd-sync-synced',
    desc: 'Self-healing fires. ArgoCD applies the Git state, restoring replicas to 3. Cluster is back to desired state. Full lifecycle complete — zero manual intervention needed.'
  }
];

let argoLcsCurrentStep = 0;

function argoLcsRender() {
  const step = ARGO_LCS_STEPS[argoLcsCurrentStep];
  const counter  = document.getElementById('argoLcsCounter');
  const cmd      = document.getElementById('argoLcsCmd');
  const badge    = document.getElementById('argoLcsBadge');
  const desc     = document.getElementById('argoLcsDesc');
  const prevBtn  = document.getElementById('argoLcsPrev');
  const nextBtn  = document.getElementById('argoLcsNext');
  if (!step || !counter) return;

  counter.textContent = `Step ${argoLcsCurrentStep + 1} / ${ARGO_LCS_STEPS.length}`;
  cmd.textContent     = step.cmd;
  badge.textContent   = step.badge;
  badge.className     = `argocd-lcs-badge argocd-sync-badge ${step.badgeClass}`;
  desc.textContent    = step.desc;
  if (prevBtn) prevBtn.disabled = argoLcsCurrentStep === 0;
  if (nextBtn) nextBtn.disabled = argoLcsCurrentStep === ARGO_LCS_STEPS.length - 1;
}

function argoLcsStep(dir) {
  argoLcsCurrentStep = Math.max(0, Math.min(ARGO_LCS_STEPS.length - 1, argoLcsCurrentStep + dir));
  argoLcsRender();
}

/* ─── DRIFT DETECTOR SIM ─── */
let driftState = 'synced';  // 'synced' | 'drifted' | 'syncing'
let driftAutoHealEnabled = false;
let driftAutoHealTimer = null;

function driftLog(msg) {
  const el = document.getElementById('driftLog');
  if (!el) return;
  el.textContent = '> ' + msg;
}

function driftIntroduce() {
  if (driftState !== 'synced') return;
  driftState = 'drifted';

  const cluster = document.getElementById('driftClusterState');
  if (cluster) {
    cluster.innerHTML = cluster.innerHTML
      .replace('replicas: 2', '<span style="color:var(--red);font-weight:700">replicas: 5</span>')
      .replace('payments-api:v1.0.0', 'payments-api:v1.0.0');
  }

  const statusBadge = document.getElementById('driftStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = '⚠️ OutOfSync';
    statusBadge.className = 'argocd-sync-badge argocd-sync-outofsync';
  }

  const diff = document.getElementById('driftDiffPanel');
  const diffContent = document.getElementById('driftDiffContent');
  if (diff && diffContent) {
    diffContent.innerHTML = '<span style="color:var(--red)">- replicas: 2  (Git / desired)</span>\n<span style="color:var(--green)">+ replicas: 5  (Cluster / actual)</span>';
    diff.style.display = 'block';
  }

  const syncBtn = document.getElementById('driftSyncBtn');
  const introBtn = document.getElementById('driftIntroduceBtn');
  if (syncBtn) syncBtn.style.display = 'inline-block';
  if (introBtn) introBtn.disabled = true;

  driftLog('kubectl scale deploy payments-api --replicas=5 executed. ArgoCD detected OutOfSync.');

  if (driftAutoHealEnabled) {
    driftLog('Auto-heal enabled — restoring in 3 seconds...');
    driftAutoHealTimer = setTimeout(() => driftSync(), 3000);
  }
}

function driftSync() {
  if (driftState === 'synced') return;
  driftState = 'syncing';

  const statusBadge = document.getElementById('driftStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = '🔄 Syncing...';
    statusBadge.className = 'argocd-sync-badge argocd-sync-syncing';
  }
  driftLog('ArgoCD sync initiated — applying Git state to cluster...');

  setTimeout(() => {
    driftState = 'synced';
    const cluster = document.getElementById('driftClusterState');
    if (cluster) {
      cluster.innerHTML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: app
        image: payments-api:v1.0.0`;
    }

    if (statusBadge) {
      statusBadge.textContent = '✅ Synced';
      statusBadge.className = 'argocd-sync-badge argocd-sync-synced';
    }

    const diff = document.getElementById('driftDiffPanel');
    if (diff) diff.style.display = 'none';

    const syncBtn = document.getElementById('driftSyncBtn');
    const introBtn = document.getElementById('driftIntroduceBtn');
    if (syncBtn) syncBtn.style.display = 'none';
    if (introBtn) introBtn.disabled = false;

    driftLog('✅ Sync complete. Cluster restored to Git state (replicas: 2).');
  }, 1500);
}

function toggleDriftAutoHeal() {
  driftAutoHealEnabled = !driftAutoHealEnabled;
  const btn   = document.getElementById('driftAutoHealBtn');
  const badge = document.getElementById('driftAutoHealBadge');
  if (btn) {
    btn.textContent = driftAutoHealEnabled ? '🛡️ Disable Auto-Heal' : '🛡️ Enable Auto-Heal';
    btn.style.borderColor = driftAutoHealEnabled ? 'var(--green)' : '';
    btn.style.color       = driftAutoHealEnabled ? 'var(--green)' : '';
  }
  if (badge) badge.style.display = driftAutoHealEnabled ? 'inline-flex' : 'none';
}

/* ─── GITOPS PIPELINE STEPPER ─── */
const ARGO_STEPS = [
  {
    cmd: 'git commit -m "bump image to v2.0.0"\ngit push origin main',
    state: '✅ Synced (pre-change)',
    stateColor: 'var(--green)',
    desc: 'Developer edits values-production.yaml, changes image.tag to v2.0.0. Creates a PR, gets approval, merges to main. This is the ONLY manual action required in a GitOps workflow.'
  },
  {
    cmd: 'ArgoCD webhook received\n→ polling Git for changes',
    state: '🔍 Checking...',
    stateColor: 'var(--blue)',
    desc: 'ArgoCD\'s Application Controller detects the new commit. Either a GitHub webhook fires instantly, or ArgoCD\'s 3-minute polling cycle picks it up. Either way: no human needed.'
  },
  {
    cmd: 'helm template payments-api ./charts \\\n  -f values.yaml \\\n  -f values-production.yaml',
    state: '⚠️ OutOfSync',
    stateColor: 'var(--orange)',
    desc: 'The Repo Server clones the new commit and renders the Helm chart into pure YAML. The App Controller diffs rendered YAML vs cluster state. Detects: image tag changed from v1.5.0 → v2.0.0. Status: OutOfSync.'
  },
  {
    cmd: 'kubectl apply -f deployment.yaml \n# (only the diff — image tag change)',
    state: '🔄 Syncing',
    stateColor: 'var(--blue)',
    desc: 'ArgoCD applies ONLY the changed resources using kubectl apply. The Deployment is patched with the new image tag. A rolling update begins — Kubernetes starts new pods with v2.0.0 before terminating old pods.'
  },
  {
    cmd: 'kubectl rollout status deployment/payments-api\n# Waiting for rollout...',
    state: '🟡 Progressing',
    stateColor: 'var(--orange)',
    desc: 'New pods are pulling the v2.0.0 image, running init containers, and starting up. Old pods are being terminated. Health = Progressing. ArgoCD waits for the rollout to complete before declaring Healthy.'
  },
  {
    cmd: 'kubectl get deployment payments-api\n# READY: 3/3   UP-TO-DATE: 3',
    state: '✅ Synced + 🟢 Healthy',
    stateColor: 'var(--green)',
    desc: 'All 3 pods running v2.0.0 pass readinessProbe. Deployment is fully available. ArgoCD marks the app Synced + Healthy. Full GitOps deploy complete. Zero kubectl commands run by the developer. Full audit trail in Git.'
  }
];

let argoCurrentStep = 0;

function argoStepRender() {
  const step     = ARGO_STEPS[argoCurrentStep];
  const counter  = document.getElementById('argoStepCounter');
  const dotsEl   = document.getElementById('argoStepDots');
  const cmdEl    = document.getElementById('argoStepCmd');
  const stateEl  = document.getElementById('argoStepState');
  const descEl   = document.getElementById('argoStepDesc');
  const prevBtn  = document.getElementById('argoStepPrev');
  const nextBtn  = document.getElementById('argoStepNext');
  if (!step || !counter) return;

  counter.textContent   = `Step ${argoCurrentStep + 1} / ${ARGO_STEPS.length}`;
  cmdEl.textContent     = step.cmd;
  stateEl.textContent   = step.state;
  stateEl.style.color   = step.stateColor;
  descEl.textContent    = step.desc;

  if (dotsEl) {
    dotsEl.innerHTML = ARGO_STEPS.map((_, i) =>
      `<div class="argocd-ps-dot${i === argoCurrentStep ? ' active' : ''}"></div>`
    ).join('');
  }

  if (prevBtn) prevBtn.disabled = argoCurrentStep === 0;
  if (nextBtn) nextBtn.disabled = argoCurrentStep === ARGO_STEPS.length - 1;
}

function argoStep(dir) {
  argoCurrentStep = Math.max(0, Math.min(ARGO_STEPS.length - 1, argoCurrentStep + dir));
  argoStepRender();
}

/* ─── INITIALISE ALL ARGOCD SIMS ─── */
(function initArgoSims() {
  selectArgoHealth('healthy');
  argoLcsRender();
  argoStepRender();
})();

/* ══════════════════════════════════════════════════════════
   MCP — MODEL CONTEXT PROTOCOL SIMULATIONS
══════════════════════════════════════════════════════════ */

/* ── Lifecycle Stepper (Architecture section) ─────────────── */
const MCP_LCS_STEPS = [
  {
    title: 'Step 1: Initialize',
    desc: 'Client sends <code>initialize</code> — declares its MCP protocol version and capabilities. This is the handshake. Without this step, neither side knows what the other supports.'
  },
  {
    title: 'Step 2: Handshake',
    desc: 'Server responds with its own protocol version and a list of what it supports — tools, resources, prompts, sampling. Both sides now know what they can do together.'
  },
  {
    title: 'Step 3: Discover Tools',
    desc: 'Client calls <code>tools/list</code> — server returns all available tools with their names, descriptions, and input schemas. This happens <strong>ONCE per session</strong> — much more token-efficient than repeating schemas in every LLM request.'
  },
  {
    title: 'Step 4: Execute',
    desc: 'LLM decides to call a tool. Client sends <code>tools/call</code> with tool name and arguments. Server executes the action (calls Bitbucket API, reads a file, queries a DB) and returns the result. LLM receives the result as context.'
  },
  {
    title: 'Step 5: Dynamic Updates',
    desc: 'When the server adds or removes tools at runtime, it sends a <code>notifications/tools/list_changed</code> notification. Client automatically re-runs <code>tools/list</code> to get the updated list. No restart required.'
  }
];

let mcpLcsCurrentStep = 0;
function mcpLcsRender() {
  const step = MCP_LCS_STEPS[mcpLcsCurrentStep];
  const titleEl   = document.getElementById('mcpLcsTitle');
  const descEl    = document.getElementById('mcpLcsDesc');
  const counterEl = document.getElementById('mcpLcsCounter');
  const prevBtn   = document.getElementById('mcpLcsPrev');
  const nextBtn   = document.getElementById('mcpLcsNext');
  if (!titleEl) return;

  titleEl.textContent  = step.title;
  descEl.innerHTML     = step.desc;
  counterEl.textContent = `Step ${mcpLcsCurrentStep + 1} / ${MCP_LCS_STEPS.length}`;
  prevBtn.disabled = mcpLcsCurrentStep === 0;
  nextBtn.disabled = mcpLcsCurrentStep === MCP_LCS_STEPS.length - 1;

  for (let i = 0; i < MCP_LCS_STEPS.length; i++) {
    const dot = document.getElementById(`mcpLcsDot${i}`);
    if (dot) dot.classList.toggle('active', i === mcpLcsCurrentStep);
  }
}
function mcpLcsStep(dir) {
  mcpLcsCurrentStep = Math.max(0, Math.min(MCP_LCS_STEPS.length - 1, mcpLcsCurrentStep + dir));
  mcpLcsRender();
}

/* ── Concept Explorer (Core Concepts section) ─────────────── */
const MCP_CONCEPTS = {
  tools_list: {
    json: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
    desc: 'Client asks: what tools do you have? This happens ONCE per session. The server returns all tool names, descriptions, and input schemas — much more token-efficient than repeating schemas in every LLM request.'
  },
  tools_call: {
    json: `{"jsonrpc":"2.0","id":3,"method":"tools/call",\n "params":{\n   "name":"get_pipeline_status",\n   "arguments":{\n     "repository":"sre-autopilot",\n     "limit":5\n   }\n }}`,
    desc: 'LLM requests a tool call. The MCP client routes this to the correct server. The server executes the action and returns the result. The LLM receives the result as context.'
  },
  resources_list: {
    json: `{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}`,
    desc: 'Client asks: what read-only data can I access? Server returns a list of resource URIs. Resources are like file paths — you read them once to get context, you don\'t "call" them.'
  },
  resources_read: {
    json: `{"jsonrpc":"2.0","id":5,"method":"resources/read",\n "params":{\n   "uri":"system://info"\n }}`,
    desc: 'Client reads a specific resource by URI. Server returns the content — like reading a config file or a system metrics snapshot. The AI uses this as background context.'
  },
  notification: {
    json: `{"jsonrpc":"2.0",\n "method":"notifications/tools/list_changed"\n // No "id" field = notification, not a request\n // Server sends this when tools change at runtime\n}`,
    desc: 'No "id" field means this is a notification — not a request, no reply expected. Server sends this when it adds or removes tools dynamically. Client automatically re-runs tools/list.'
  }
};

function showMcpConcept(key) {
  const c = MCP_CONCEPTS[key];
  if (!c) return;
  const jsonEl = document.getElementById('mcpConceptJson');
  const descEl = document.getElementById('mcpConceptDesc');
  if (jsonEl) jsonEl.textContent = c.json;
  if (descEl) descEl.textContent = c.desc;
  document.querySelectorAll('.mcp-concept-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick') === `showMcpConcept('${key}')`);
  });
}

/* ── Sim 1: Protocol Flow Visualizer ──────────────────────── */
const MCP_FLOW_STEPS = [
  {
    json: `{"jsonrpc":"2.0","id":1,"method":"initialize",\n "params":{\n   "protocolVersion":"2025-03-26",\n   "capabilities":{}\n }}`,
    title: '1. Client sends initialize',
    desc: 'Client declares its MCP version and supported capabilities. This is the handshake that starts every MCP connection. Like a TCP SYN — nothing else happens until this completes.'
  },
  {
    json: `{"jsonrpc":"2.0","id":1,"result":{\n   "protocolVersion":"2025-03-26",\n   "capabilities":{\n     "tools":{},\n     "resources":{}\n   }\n }}`,
    title: '2. Server responds with capabilities',
    desc: 'Server confirms protocol version and tells the client what it supports — tools, resources, prompts, sampling. This response determines what the client is allowed to ask for.'
  },
  {
    json: `{"jsonrpc":"2.0","id":2,\n "method":"tools/list","params":{}}`,
    title: '3. Client discovers tools',
    desc: 'Client asks: what can you do? Server returns a list of all available tools with their schemas. This happens ONCE per session — much more efficient than repeating schemas in every LLM request.'
  },
  {
    json: `{"jsonrpc":"2.0","id":3,\n "method":"tools/call",\n "params":{\n   "name":"list_repositories",\n   "arguments":{"workspace":"myorg"}\n }}`,
    title: '4. LLM decides to call a tool',
    desc: 'Based on the user\'s question ("what repos do we have?"), the LLM decides to call list_repositories. The MCP client routes this call to the Bitbucket MCP server.'
  },
  {
    json: `{"jsonrpc":"2.0","id":3,"result":{\n   "content":[{\n     "type":"text",\n     "text":"[{\\"name\\":\\"sre-autopilot\\",\n       \\"slug\\":\\"sre-autopilot\\"}]"\n   }]\n }}`,
    title: '5. Server executes and returns result',
    desc: 'The Bitbucket MCP server calls the Bitbucket REST API, gets the repos, and returns the formatted result. The LLM receives this as context to compose its answer.'
  },
  {
    json: `"The workspace myorg has 1 repository: sre-autopilot.\nThe repo slug is sre-autopilot.\nYou can use this slug with other tools\nlike get_pull_requests('sre-autopilot')."`,
    title: '6. LLM composes final answer',
    desc: 'LLM receives the tool result, reasons about it, and formulates a natural language response. The entire JSON-RPC exchange was invisible to the user — they just see the answer.'
  }
];

let mcpFlowCurrentStep = 0;
function mcpFlowRender() {
  const step = MCP_FLOW_STEPS[mcpFlowCurrentStep];
  const el = document.getElementById('mcpFlowSim');
  if (!el) return;
  el.querySelector('#mcpFlowJson').textContent    = step.json;
  el.querySelector('#mcpFlowTitle').textContent   = step.title;
  el.querySelector('#mcpFlowDesc').textContent    = step.desc;
  el.querySelector('#mcpFlowCounter').textContent = `Step ${mcpFlowCurrentStep + 1} / ${MCP_FLOW_STEPS.length}`;
  el.querySelector('#mcpFlowPrev').disabled = mcpFlowCurrentStep === 0;
  el.querySelector('#mcpFlowNext').disabled = mcpFlowCurrentStep === MCP_FLOW_STEPS.length - 1;
}
function mcpFlowStep(dir) {
  mcpFlowCurrentStep = Math.max(0, Math.min(MCP_FLOW_STEPS.length - 1, mcpFlowCurrentStep + dir));
  mcpFlowRender();
}

/* ── Sim 2: Tool Builder ──────────────────────────────────── */
const MCP_BUILDER_STEPS = [
  {
    label: 'Step 1 — Name it',
    code: `@mcp.tool()\ndef get_pipeline_status(...):\n    ...`
  },
  {
    label: 'Step 2 — Describe it (the LLM reads this!)',
    code: `@mcp.tool()\ndef get_pipeline_status(...):\n    """Get recent pipeline runs for a repository.\n    Use this when the user asks about build status,\n    CI failures, or deployment history."""\n    ...`
  },
  {
    label: 'Step 3 — Define inputs',
    code: `@mcp.tool()\ndef get_pipeline_status(\n    repository: str,\n    limit: int = 5\n) -> str:\n    """Get recent pipeline runs.\n    Args:\n        repository: Repo slug (e.g. 'sre-autopilot')\n        limit: Number of results to return (default 5)\n    """\n    ...`
  },
  {
    label: 'Step 4 — Implement it',
    code: `@mcp.tool()\ndef get_pipeline_status(\n    repository: str,\n    limit: int = 5\n) -> str:\n    """Get recent pipeline runs.\n    Args:\n        repository: Repo slug (e.g. 'sre-autopilot')\n        limit: Number of results to return (default 5)\n    """\n    r = requests.get(\n        f"{BBHOST}/repositories/{WORKSPACE}/{repository}/pipelines",\n        headers=auth_headers(),\n        params={"pagelen": limit},\n        timeout=30\n    )\n    r.raise_for_status()\n    pipes = [\n        {"build": x.get("build_number"),\n         "state": x["state"]["name"],\n         "branch": x.get("target", {}).get("branch", {}).get("name", "")}\n        for x in r.json().get("values", [])\n    ]\n    return json.dumps(pipes)  # Always return JSON string`
  }
];

let mcpBuilderStep = 0;
function mcpBuilderRender() {
  const el = document.getElementById('mcpBuilderSim');
  if (!el) return;
  el.querySelector('#mcpBuilderCode').textContent  = MCP_BUILDER_STEPS[mcpBuilderStep].code;
  el.querySelector('#mcpBuilderLabel').textContent = MCP_BUILDER_STEPS[mcpBuilderStep].label;
  el.querySelector('#mcpBuilderPrev').disabled = mcpBuilderStep === 0;
  el.querySelector('#mcpBuilderNext').disabled = mcpBuilderStep === MCP_BUILDER_STEPS.length - 1;
}
function mcpBuilderStepFn(dir) {
  mcpBuilderStep = Math.max(0, Math.min(MCP_BUILDER_STEPS.length - 1, mcpBuilderStep + dir));
  mcpBuilderRender();
}

/* ── Sim 3: Agent Trace Viewer ────────────────────────────── */
const MCP_TRACE_STEPS = [
  { type: 'user',   text: 'User: "My server CPU is at 87% — what is causing it?"' },
  { type: 'llm',    text: 'Agent thinking: "I need CPU data. I have get_cpu_usage tool available. Let me call it to get the current reading."' },
  { type: 'tool',   text: '→ tools/call: get_cpu_usage()' },
  { type: 'result', text: '← Result: "CPU: 87.3% — above normal threshold (>80%)"' },
  { type: 'llm',    text: 'Agent thinking: "CPU is high. I need to know which process. I have get_top_processes tool. Let me check."' },
  { type: 'tool',   text: '→ tools/call: get_top_processes(sort_by="cpu", limit=5)' },
  { type: 'result', text: '← Result: "[{\"name\":\"python3\",\"cpu_percent\":41.2},{\"name\":\"java\",\"cpu_percent\":28.1},{\"name\":\"nginx\",\"cpu_percent\":8.3}...]"' },
  { type: 'llm',    text: 'Agent thinking: "python3 is consuming 41.2%. This is likely the ML model inference. I should check the application logs to confirm."' },
  { type: 'tool',   text: '→ tools/call: read_file(path="/var/log/app.log", tail=50)' },
  { type: 'result', text: '← Result: "2026-04-05 14:32 WARN: LangGraph agent loop running without timeout limit set. recursion_limit not configured."' },
  { type: 'answer', text: '✅ Final Answer: "Root cause identified. The python3 process (41% CPU) is your LangGraph agent running in an infinite loop without a recursion limit. Fix: add config={"recursion_limit": 25} to your graph.invoke() call. The loop will now terminate after 25 steps. No restart needed — just update the code and redeploy."' }
];

let mcpTraceCurrentStep = 0;
function mcpTraceRender() {
  const el = document.getElementById('mcpTraceSim');
  if (!el) return;
  const container = el.querySelector('#mcpTraceSteps');
  container.innerHTML = MCP_TRACE_STEPS.slice(0, mcpTraceCurrentStep + 1).map(s => {
    const cls = s.type === 'llm'    ? 'mcp-trace-llm'    :
                s.type === 'tool'   ? 'mcp-trace-tool'   :
                s.type === 'result' ? 'mcp-trace-result' :
                s.type === 'answer' ? 'mcp-trace-answer' :
                s.type === 'user'   ? 'mcp-trace-user'   : '';
    return `<div class="mcp-trace-step ${cls}">${s.text}</div>`;
  }).join('');
  el.querySelector('#mcpTracePrev').disabled = mcpTraceCurrentStep === 0;
  el.querySelector('#mcpTraceNext').disabled = mcpTraceCurrentStep === MCP_TRACE_STEPS.length - 1;
  el.querySelector('#mcpTraceCounter').textContent = `${mcpTraceCurrentStep + 1} / ${MCP_TRACE_STEPS.length}`;
}
function mcpTraceStep(dir) {
  mcpTraceCurrentStep = Math.max(0, Math.min(MCP_TRACE_STEPS.length - 1, mcpTraceCurrentStep + dir));
  mcpTraceRender();
}

/* ── Init all MCP interactive elements ───────────────────── */
(function initMcpSims() {
  mcpLcsRender();
  showMcpConcept('tools_list');
  mcpFlowRender();
  mcpBuilderRender();
  mcpTraceRender();
})();

/* ══════════════════════════════════════════════════════════
   AWS ADOT — SIMULATIONS
══════════════════════════════════════════════════════════ */

/* ── Install Tabs ─────────────────────────────────────── */
function adotTab(id) {
  document.querySelectorAll('.adot-tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.adot-tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('adotTab' + id.charAt(0).toUpperCase() + id.slice(1));
  if (pane) pane.classList.add('active');
  event.target.classList.add('active');
}

/* ── Sim 1: Distributed Trace Waterfall ───────────────── */
const ADOT_SPANS = [
  { name: 'GET /api/sre/diagnose',   service: 'api-gateway',  start:  0, dur: 342, status: 'ok',   depth: 0,
    detail: 'Root span — the entire user request. Trace ID: abc-123-xyz-456. Created by API Gateway when it receives the HTTP request.' },
  { name: 'sre_diagnose handler',    service: 'fastapi-app',  start:  8, dur: 325, status: 'ok',   depth: 1,
    detail: 'FastAPI route handler. Auto-instrumented by FastAPIInstrumentor. Parent: api-gateway span.' },
  { name: 'langgraph.agent.init',    service: 'langgraph',    start: 12, dur: 15,  status: 'ok',   depth: 2,
    detail: 'LangGraph agent initialization — loading tools and system prompt. Custom span added manually with tracer.start_as_current_span().' },
  { name: 'redis.get cache:diag:42', service: 'redis',        start: 30, dur:  4,  status: 'ok',   depth: 2,
    detail: 'Redis cache lookup. Auto-instrumented by RedisInstrumentor. Attribute cache.hit=false — cache miss, must query Postgres.' },
  { name: 'db.query SELECT events',  service: 'postgres',     start: 36, dur: 258, status: 'slow', depth: 2,
    detail: '⚠️ SLOW SPAN: 258ms! db.statement="SELECT * FROM events WHERE team_id=?". db.rows_returned=50000. Plan: FULL_TABLE_SCAN. Missing index on team_id column.' },
  { name: 'langgraph.reasoning',     service: 'langgraph',    start:297, dur: 28,  status: 'ok',   depth: 2,
    detail: 'LangGraph ReAct loop — 4 reasoning steps. Attributes: agent.steps=4, agent.model=claude-sonnet-4-6, diagnosis.found=true.' },
  { name: 'HTTP 200 OK response',    service: 'fastapi-app',  start:330, dur:  3,  status: 'ok',   depth: 1,
    detail: 'Response sent. http.status_code=200. Total request duration: 342ms. Root span ends.' },
];
const TRACE_TOTAL_MS = 342;
let adotTraceCurrentStep = -1;

function adotTraceRender() {
  const container = document.getElementById('adotTraceWaterfall');
  if (!container) return;
  const visible = ADOT_SPANS.slice(0, adotTraceCurrentStep + 1);
  container.innerHTML = visible.map(s => {
    const leftPct  = (s.start / TRACE_TOTAL_MS) * 100;
    const widthPct = Math.max((s.dur  / TRACE_TOTAL_MS) * 100, 1.5);
    const cls      = s.status === 'slow' ? 'adot-span-slow' : s.status === 'err' ? 'adot-span-err' : 'adot-span-ok';
    const indent   = s.depth * 16;
    return `<div class="adot-span-row">
      <div class="adot-span-name" style="padding-left:${indent}px" title="${s.service}">
        <span style="opacity:0.5;font-size:0.72rem">${'└─'.repeat(s.depth)}</span>${s.name}
      </div>
      <div class="adot-span-bar-wrap">
        <div class="adot-span-bar ${cls}" style="left:${leftPct}%;width:${widthPct}%">${s.dur >= 20 ? s.dur+'ms' : ''}</div>
      </div>
      <div class="adot-span-dur">${s.dur}ms</div>
    </div>`;
  }).join('');

  const totalEl = document.getElementById('adotTraceTotal');
  if (totalEl) totalEl.textContent = adotTraceCurrentStep >= 0 ? `${ADOT_SPANS[adotTraceCurrentStep].start + ADOT_SPANS[adotTraceCurrentStep].dur}ms elapsed` : '—';

  const detailEl = document.getElementById('adotTraceDetail');
  if (detailEl && adotTraceCurrentStep >= 0)
    detailEl.innerHTML = `<strong style="color:var(--adot)">${ADOT_SPANS[adotTraceCurrentStep].service}</strong> → ${ADOT_SPANS[adotTraceCurrentStep].detail}`;
  else if (detailEl) detailEl.innerHTML = 'Click "Add Next Span →" to start the trace.';

  const counter = document.getElementById('adotTraceCounter');
  if (counter) counter.textContent = `${Math.max(0, adotTraceCurrentStep + 1)} / ${ADOT_SPANS.length} spans`;
  const prev = document.getElementById('adotTracePrev');
  const next = document.getElementById('adotTraceNext');
  if (prev) prev.disabled = adotTraceCurrentStep < 0;
  if (next) next.disabled = adotTraceCurrentStep >= ADOT_SPANS.length - 1;
}
function adotTraceStep(dir) {
  adotTraceCurrentStep = Math.max(-1, Math.min(ADOT_SPANS.length - 1, adotTraceCurrentStep + dir));
  adotTraceRender();
}
function adotTraceReset() {
  adotTraceCurrentStep = -1;
  adotTraceRender();
}

/* ── Sim 2: Collector Pipeline Visualizer ─────────────── */
const ADOT_PIPELINE_STEPS = [
  {
    stage: 'OTLP Receiver',
    done: [],
    title: 'Step 1: OTLP Receiver — Data Arrives',
    desc: 'Raw telemetry arrives from the FastAPI app over gRPC (port 4317). The receiver deserializes the Protobuf payload into ADOT\'s internal span representation.',
    data: `// Raw OTLP data received (7 spans)
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        {"key":"service.name","value":"sre-autopilot"}
      ]
    },
    "scopeSpans": [{
      "spans": [
        {"name":"GET /api/sre/diagnose","duration":"342ms"},
        {"name":"redis.get","duration":"4ms"},
        {"name":"db.query","duration":"258ms"},
        // ... 4 more spans
      ]
    }]
  }]
}`
  },
  {
    stage: 'Batch Processor',
    done: ['OTLP Receiver'],
    title: 'Step 2: Batch Processor — Buffer for Efficiency',
    desc: 'Batches 1024 spans before exporting. Without batching, every span would trigger an API call. With batching, one API call sends 1024 spans — 1000x fewer API calls, much lower cost.',
    data: `// After batching: 1024 spans buffered
{
  "batch_size": 1024,
  "timeout": "5s",
  "spans_buffered": 7,
  "status": "waiting for 5s timeout or 1024 spans",
  // Combines spans from multiple requests
  // before sending to exporters
}`
  },
  {
    stage: 'Sampler (10%)',
    done: ['OTLP Receiver','Batch Processor'],
    title: 'Step 3: Probabilistic Sampler — Cost Control',
    desc: 'Keeps 10% of traces, drops 90%. But ERRORS always pass through (see config). This reduces X-Ray costs by 10x while keeping full visibility on failures and the random 10% for performance baselines.',
    data: `// Sampling decisions
{
  "sampling_rate": 0.10,
  "spans_in":   7,
  "spans_out":  7,  // ← kept (error path always kept)
  "reason": "db.query span has status=SLOW",
  // Tail-based: keeps entire trace if
  // ANY span in it is slow or errored.
  "rule_matched": "slow_span_rule"
}`
  },
  {
    stage: 'Resource Processor',
    done: ['OTLP Receiver','Batch Processor','Sampler (10%)'],
    title: 'Step 4: Resource Processor — Enrich with Metadata',
    desc: 'Adds Kubernetes and environment metadata to every span. This lets you filter traces by namespace, cluster, or team in X-Ray without changing app code.',
    data: `// After resource processor — new attributes added
{
  "attributes_added": {
    "environment":          "production",
    "k8s.cluster.name":    "sre-autopilot-cluster",
    "k8s.namespace.name":  "production",
    "k8s.pod.name":        "fastapi-app-7d9b-xk2p",
    "k8s.node.name":       "ip-10-0-1-42.ec2.internal",
    "service.team":        "platform-sre",
    "aws.region":          "us-east-1"
  }
}`
  },
  {
    stage: 'AWS X-Ray Export',
    done: ['OTLP Receiver','Batch Processor','Sampler (10%)','Resource Processor'],
    title: 'Step 5: AWS X-Ray Exporter — Traces Shipped',
    desc: 'Converts OTel spans to X-Ray Segment format and calls the X-Ray PutTraceSegments API. The trace is now visible in the X-Ray console. Slow Postgres span will show up highlighted in orange.',
    data: `// X-Ray Segment format (converted from OTel)
{
  "trace_id": "1-64f3a2b1-abc123xyz456",
  "id": "span001",
  "name": "GET /api/sre/diagnose",
  "start_time": 1693834881.123,
  "end_time":   1693834881.465,
  "subsegments": [
    {"name":"postgres","fault":false,
     "sql":{"sanitized_query":"SELECT * FROM events WHERE team_id=?"},
     "duration": 0.258}
  ]
}`
  },
  {
    stage: 'CloudWatch Export',
    done: ['OTLP Receiver','Batch Processor','Sampler (10%)','Resource Processor','AWS X-Ray Export'],
    title: 'Step 6: CloudWatch EMF Exporter — Metrics Shipped',
    desc: 'Publishes metrics in EMF (Embedded Metric Format) to CloudWatch Logs. CloudWatch automatically extracts metric data from EMF and creates metric data points. P99 latency, error rate, and request count are now in CloudWatch.',
    data: `// EMF (Embedded Metric Format) payload
{
  "_aws": {
    "CloudWatchMetrics": [{
      "Namespace": "SREAutopilot",
      "Dimensions": [["service.name","environment"]],
      "Metrics": [
        {"Name":"http.server.duration","Unit":"Milliseconds"},
        {"Name":"http.server.requests","Unit":"Count"},
        {"Name":"http.server.errors","Unit":"Count"}
      ]
    }]
  },
  "service.name": "sre-autopilot",
  "environment": "production",
  "http.server.duration": 342,
  "http.server.requests": 1,
  "http.server.errors": 0
}`
  }
];

let adotPipelineCurrentStep = 0;

function adotPipelineRender() {
  const step = ADOT_PIPELINE_STEPS[adotPipelineCurrentStep];
  if (!document.getElementById('adotPipelineSim')) return;

  // Render stage list
  const stagesEl = document.getElementById('adotPipelineStages');
  if (stagesEl) {
    const allStages = ADOT_PIPELINE_STEPS.map(s => s.stage);
    stagesEl.innerHTML = allStages.map((name, i) => {
      const isActive = i === adotPipelineCurrentStep;
      const isDone   = step.done.includes(name);
      const cls = isActive ? 'active' : isDone ? 'done' : '';
      return `<div class="adot-ps-stage-box ${cls}">${isActive ? '▶ ' : isDone ? '✓ ' : '○ '}${name}</div>`;
    }).join('');
  }

  const titleEl   = document.getElementById('adotPipelineTitle');
  const descEl    = document.getElementById('adotPipelineDesc');
  const dataEl    = document.getElementById('adotPipelineData');
  const counterEl = document.getElementById('adotPipelineCounter');
  const prevBtn   = document.getElementById('adotPipelinePrev');
  const nextBtn   = document.getElementById('adotPipelineNext');

  if (titleEl)   titleEl.textContent  = step.title;
  if (descEl)    descEl.textContent   = step.desc;
  if (dataEl)    dataEl.textContent   = step.data;
  if (counterEl) counterEl.textContent = `Step ${adotPipelineCurrentStep + 1} / ${ADOT_PIPELINE_STEPS.length}`;
  if (prevBtn)   prevBtn.disabled = adotPipelineCurrentStep === 0;
  if (nextBtn)   nextBtn.disabled = adotPipelineCurrentStep === ADOT_PIPELINE_STEPS.length - 1;
}
function adotPipelineStep(dir) {
  adotPipelineCurrentStep = Math.max(0, Math.min(ADOT_PIPELINE_STEPS.length - 1, adotPipelineCurrentStep + dir));
  adotPipelineRender();
}

/* ── Sim 3: RCA Investigation ─────────────────────────── */
const ADOT_RCA_STEPS = [
  { type: 'alert',   text: '🚨 ALERT: P99 latency = 850ms (SLO: 200ms) on sre-autopilot-prod. CloudWatch Alarm fires. PagerDuty pages on-call at 14:34 UTC.' },
  { type: 'observe', text: '📊 CloudWatch Dashboard: Spike started at 14:32 UTC. P99 jumped from 18ms → 850ms. Error rate: 0.1% → 2.3%. Request rate: dropped from 120 to 85 req/s (users retrying).' },
  { type: 'trace',   text: '🔍 Open AWS X-Ray Service Map: sre-autopilot-prod → postgres node highlighted RED. All other nodes green. The Postgres connection is the bottleneck.' },
  { type: 'trace',   text: '🔎 X-Ray Trace Analytics: Filter traces by responsetime > 0.5. Found 847 slow traces in last 10 minutes. Click into one trace to see the waterfall.' },
  { type: 'span',    text: '🎯 Slow Span Found: db.query "SELECT * FROM events WHERE team_id=?" duration=258ms (normal: 12ms). Status: SLOW. Parent span: sre_diagnose handler.' },
  { type: 'attr',    text: '📋 Span Attributes: db.system=postgresql, db.rows_returned=50000, db.statement="SELECT * FROM events WHERE team_id=?". No index hint. Query plan: FULL_TABLE_SCAN.' },
  { type: 'attr',    text: '📅 Correlate with deployment: ArgoCD history shows deploy abc1234 at 14:30 UTC. Commit message: "feat: add team analytics — includes migration 0043_remove_team_idx.sql".' },
  { type: 'cause',   text: '⚡ ROOT CAUSE: Migration 0043 dropped the team_id index on the events table. 50K-row full table scans on every diagnostic request. Impact started exactly 2 minutes after deploy.' },
  { type: 'fix',     text: '🔧 Remediation: kubectl rollout undo deployment/sre-autopilot (ArgoCD: 30-second rollback). Estimated recovery: 3 minutes. Migration 0043 will be fixed to ADD index, not DROP.' },
  { type: 'verify',  text: '✅ Recovery confirmed: P99 latency: 850ms → 18ms. Error rate: 2.3% → 0.1%. All X-Ray spans green. CloudWatch alarm cleared at 14:42 UTC. MTTR: 8 minutes.' },
];

let adotRcaCurrentStep = 0;
function adotRcaRender() {
  const el = document.getElementById('adotRcaSim');
  if (!el) return;
  const container = el.querySelector('#adotRcaSteps');
  container.innerHTML = ADOT_RCA_STEPS.slice(0, adotRcaCurrentStep + 1).map(s => {
    const cls = 'adot-rca-' + s.type;
    return `<div class="adot-rca-step ${cls}">${s.text}</div>`;
  }).join('');
  el.querySelector('#adotRcaPrev').disabled = adotRcaCurrentStep === 0;
  el.querySelector('#adotRcaNext').disabled = adotRcaCurrentStep === ADOT_RCA_STEPS.length - 1;
  el.querySelector('#adotRcaCounter').textContent = `${adotRcaCurrentStep + 1} / ${ADOT_RCA_STEPS.length}`;
}
function adotRcaStep(dir) {
  adotRcaCurrentStep = Math.max(0, Math.min(ADOT_RCA_STEPS.length - 1, adotRcaCurrentStep + dir));
  adotRcaRender();
}

/* ── Sim 4: Live Metrics Dashboard ────────────────────── */
const ADOT_METRIC_MODES = {
  normal: {
    latency: 18, errors: 0.1, rps: 120, cpu: 42,
    alert: false,
    status: '✅ System healthy — all metrics within SLO thresholds'
  },
  degraded: {
    latency: 180, errors: 0.8, rps: 105, cpu: 65,
    alert: false,
    status: '⚠️ Degraded: latency elevated, approaching SLO boundary (200ms). Monitor closely.'
  },
  incident: {
    latency: 850, errors: 4.7, rps: 68, cpu: 78,
    alert: true,
    status: '🚨 INCIDENT: P99 latency 850ms (SLO: 200ms). Error rate 4.7%. CloudWatch Alarm FIRING.'
  },
  recovering: {
    latency: 45, errors: 0.3, rps: 98, cpu: 51,
    alert: false,
    status: '🔧 Recovering: rollback in progress. Latency improving. Estimated full recovery: 90s.'
  }
};

let adotMetricsTimer = null;
let adotCurrentMode  = 'normal';

function adotMetricsMode(mode) {
  if (adotMetricsTimer) clearInterval(adotMetricsTimer);
  adotCurrentMode = mode;
  adotMetricsUpdate();
  adotMetricsTimer = setInterval(adotMetricsUpdate, 1500);
}

function adotMetricsUpdate() {
  const base = ADOT_METRIC_MODES[adotCurrentMode];
  if (!base) return;

  const jitter = v => Math.max(0, v + (Math.random() - 0.5) * v * 0.08);
  const vals = {
    latency: Math.round(jitter(base.latency)),
    errors:  Math.round(jitter(base.errors) * 10) / 10,
    rps:     Math.round(jitter(base.rps)),
    cpu:     Math.round(jitter(base.cpu))
  };

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('adotValLatency', vals.latency);
  set('adotValErrors',  vals.errors.toFixed(1));
  set('adotValRps',     vals.rps);
  set('adotValCpu',     vals.cpu);

  ['adotMetricLatency','adotMetricErrors','adotMetricRps','adotMetricCpu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('alert', base.alert);
  });

  const statusEl = document.getElementById('adotStatusBar');
  if (statusEl) {
    statusEl.textContent = base.status;
    statusEl.classList.toggle('alert', base.alert);
  }
}

/* ── Init all ADOT sims ───────────────────────────────── */
(function initAdotSims() {
  adotTraceRender();
  adotPipelineRender();
  adotRcaRender();
  adotMetricsMode('normal');
})();

// ═══════════════════════════════════════
// WORKSTATION SETUP — Component JS
// (ported from Setup Guide)
// ═══════════════════════════════════════

// ── Sub-tab switching (Setup sections) ──
document.querySelectorAll('.section .sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const section = tab.closest('.section');
        section.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
        section.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-sub');
        const subPanel = section.querySelector('#sub-' + target);
        if (subPanel) subPanel.classList.add('active');
        const globalDone = document.getElementById('cc-global-done');
        if (globalDone) globalDone.style.display = target === 'global' ? 'block' : 'none';
    });
});

// ── Step progress (click step number to toggle done) ──
function setupStepKey(step) {
    const section = step.closest('.section');
    const sectionId = section ? section.id : 'unknown';
    const siblings = Array.from(section.querySelectorAll('.step'));
    return sectionId + '-step-' + siblings.indexOf(step);
}

function updateSetupNavDot(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const steps = section.querySelectorAll('.step');
    if (steps.length === 0) return;
    const allDone = Array.from(steps).every(s => s.classList.contains('done'));
    // Map section id (setup-X) to nav link data-section (setup-X)
    const navLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (navLink) {
        const navItem = navLink.closest('li');
        if (navItem) navItem.classList.toggle('all-done', allDone);
    }
}

document.querySelectorAll('.section .step').forEach(step => {
    const key = setupStepKey(step);
    // restore from localStorage
    if (localStorage.getItem(key) === '1') step.classList.add('done');

    const indexEl = step.querySelector('.step-index');
    if (indexEl) {
        indexEl.addEventListener('click', () => {
            step.classList.toggle('done');
            localStorage.setItem(key, step.classList.contains('done') ? '1' : '0');
            const section = step.closest('.section');
            if (section) updateSetupNavDot(section.id);
        });
    }
});

// Init all setup nav dots on load
document.querySelectorAll('.section').forEach(s => updateSetupNavDot(s.id));

// ── Copy buttons ──
document.querySelectorAll('.term-copy').forEach(btn => {
    btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-copy');
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const original = btn.textContent;
            btn.textContent = '\u2713 Copied';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = original;
                btn.classList.remove('copied');
            }, 1400);
        });
    });
});

/* ══════════════════════════════════════
   OPENTELEMETRY — Sample-Project Simulation
   (module 09). Self-contained; telemetry is simulated in JS.
══════════════════════════════════════ */
const OTEL_SIM_STEPS = [
  {
    tab: 'Blind', backend: '🖥️ App console (no telemetry)', legend: false,
    desc: 'Step 0 — Blind. The orders service has zero instrumentation. A downstream call fails, but all you get is one log line. No idea where the time went or what broke.',
    code:
`<span class="cmt"># app.py — no OpenTelemetry at all</span>
<span class="kw">@app.route</span>(<span class="str">"/orders"</span>, methods=[<span class="str">"POST"</span>])
<span class="kw">def</span> create_order():
    order = request.get_json()
    validate(order)
    charge(order)   <span class="cmt"># calls payments service</span>
    save(order)
    <span class="kw">return</span> {<span class="str">"status"</span>: <span class="str">"placed"</span>}

<span class="cmt"># All you ever see in the logs:</span>
<span class="cmt"># ERROR: request failed</span>`,
    log: [
      { t: '03:14:22', level: 'INFO', msg: 'POST /orders received', cls: 'dim' },
      { t: '03:14:24', level: 'ERROR', msg: 'request failed', cls: 'err' },
      { t: '', level: '', msg: '↳ where? which step? how long? unknown.', cls: 'dim' },
    ],
  },
  {
    tab: 'Auto', backend: '🔭 Jaeger UI — auto spans', legend: true,
    desc: 'Step 1 — Auto. Launch with opentelemetry-instrument (zero code changes). Flask, requests and psycopg are auto-instrumented → a real trace waterfall appears: the HTTP request, the payments call and the DB insert, with timings.',
    code:
`<span class="cmt"># No code changes — just launch differently:</span>
$ pip install opentelemetry-distro opentelemetry-exporter-otlp
$ opentelemetry-bootstrap -a install
$ OTEL_SERVICE_NAME=orders-api \\
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \\
  opentelemetry-instrument python app.py

<span class="cmt"># You instantly get spans for every library call.</span>`,
    total: 904,
    spans: [
      { name: 'POST /orders', depth: 0, start: 0, dur: 904, status: 'ok', attr: 'http.route=/orders' },
      { name: 'POST http://payments/charge', depth: 1, start: 40, dur: 803, status: 'ok', attr: 'http.status_code=200' },
      { name: 'INSERT orders', depth: 1, start: 863, dur: 38, status: 'ok', attr: 'db.system=postgresql' },
    ],
  },
  {
    tab: 'Manual', backend: '🔭 Jaeger UI — hybrid', legend: true,
    desc: 'Step 2 — Manual. Add named business spans on top of auto. validate_order, charge_payment and save_order nest into the auto spans automatically (shared context) and carry attributes like order.value.',
    code:
`<span class="kw">from</span> opentelemetry <span class="kw">import</span> trace
tracer = trace.get_tracer(__name__)

<span class="kw">def</span> create_order():                 <span class="cmt"># auto span: POST /orders</span>
    order = request.get_json()
    <span class="kw">with</span> tracer.start_as_current_span(<span class="str">"validate_order"</span>) <span class="kw">as</span> s:
        s.set_attribute(<span class="str">"order.value"</span>, order[<span class="str">"total"</span>])
        validate(order)
    <span class="kw">with</span> tracer.start_as_current_span(<span class="str">"charge_payment"</span>) <span class="kw">as</span> s:
        s.set_attribute(<span class="str">"payment.amount"</span>, order[<span class="str">"total"</span>])
        charge(order)                 <span class="cmt"># auto span nests here</span>
    <span class="kw">with</span> tracer.start_as_current_span(<span class="str">"save_order"</span>):
        save(order)`,
    total: 904,
    spans: [
      { name: 'POST /orders', depth: 0, start: 0, dur: 904, status: 'ok', attr: 'http.route=/orders' },
      { name: 'validate_order', depth: 1, start: 4, dur: 18, status: 'ok', manual: true, attr: 'order.value=249.99' },
      { name: 'charge_payment', depth: 1, start: 32, dur: 820, status: 'ok', manual: true, attr: 'payment.amount=249.99' },
      { name: 'POST http://payments/charge', depth: 2, start: 40, dur: 803, status: 'ok', attr: 'http.status_code=200' },
      { name: 'save_order', depth: 1, start: 860, dur: 42, status: 'ok', manual: true },
      { name: 'INSERT orders', depth: 2, start: 863, dur: 38, status: 'ok', attr: 'db.system=postgresql' },
    ],
  },
  {
    tab: 'Break it', backend: '🔭 Jaeger UI — failure', legend: true,
    desc: 'Step 3 — Break it. The payments service times out. record_exception + set_status paint the exact failing span red with its error — OTel pinpoints the root cause instantly, no log grep required.',
    code:
`<span class="kw">from</span> opentelemetry.trace <span class="kw">import</span> Status, StatusCode

<span class="kw">with</span> tracer.start_as_current_span(<span class="str">"charge_payment"</span>) <span class="kw">as</span> s:
    s.set_attribute(<span class="str">"payment.amount"</span>, order[<span class="str">"total"</span>])
    <span class="kw">try</span>:
        requests.post(<span class="str">"http://payments/charge"</span>, timeout=<span class="num">2</span>)
    <span class="kw">except</span> Exception <span class="kw">as</span> e:
        s.record_exception(e)                       <span class="cmt"># stack on the span</span>
        s.set_status(Status(StatusCode.ERROR, str(e)))  <span class="cmt"># span turns red</span>
        <span class="kw">raise</span>`,
    total: 2100,
    spans: [
      { name: 'POST /orders', depth: 0, start: 0, dur: 2100, status: 'err', attr: 'http.status_code=502' },
      { name: 'validate_order', depth: 1, start: 4, dur: 18, status: 'ok', manual: true, attr: 'order.value=249.99' },
      { name: 'charge_payment', depth: 1, start: 32, dur: 2058, status: 'err', manual: true, attr: 'status=ERROR "ConnectTimeout"' },
      { name: 'POST http://payments/charge', depth: 2, start: 40, dur: 2048, status: 'err', attr: 'exception=ConnectTimeout' },
    ],
  },
];

const otelSimState = { step: 0, revealed: 0, timer: null };

function otelSimRenderWaterfall(step, count) {
  const cfg = OTEL_SIM_STEPS[step];
  const out = document.getElementById('otelSimOutput');
  if (!out) return;
  const spans = cfg.spans.slice(0, count);
  out.innerHTML = spans.map(s => {
    const leftPct  = (s.start / cfg.total) * 100;
    const widthPct = Math.max((s.dur / cfg.total) * 100, 0.8);
    const cls = s.status === 'err' ? 'otel-span-err' : s.status === 'slow' ? 'otel-span-slow'
              : s.manual ? 'otel-span-manual' : 'otel-span-ok';
    const indent = s.depth * 14;
    const arrow = s.depth ? '<span style="opacity:.45">' + '└'.repeat(1) + ' </span>' : '';
    const tag = s.manual ? '<span class="otel-manual-tag">manual</span>' : '';
    const label = s.dur >= 60 ? s.dur + 'ms' : '';
    return `<div class="otel-span-row">
      <div class="otel-span-name" style="padding-left:${indent}px" title="${s.attr||''}">${arrow}${s.name}${tag}</div>
      <div class="otel-span-barwrap"><div class="otel-span-bar ${cls}" style="left:${leftPct}%;width:${widthPct}%">${label}</div></div>
      <div class="otel-span-dur">${s.dur}ms</div>
    </div>` + (s.attr ? `<div class="otel-logline dim" style="padding-left:${indent+14}px;font-size:.68rem">${s.attr}</div>` : '');
  }).join('');
  const totalEl = document.getElementById('otelTraceTotal');
  if (totalEl) totalEl.textContent = count > 0 ? `${cfg.total}ms total` : '';
}

function otelSimRenderLog(step) {
  const cfg = OTEL_SIM_STEPS[step];
  const out = document.getElementById('otelSimOutput');
  if (!out) return;
  out.innerHTML = cfg.log.map(l =>
    `<div class="otel-logline ${l.cls}">${l.t ? '['+l.t+'] ' : ''}${l.level ? l.level+': ' : ''}${l.msg}</div>`
  ).join('');
}

function otelSimPlaceholder(step) {
  const cfg = OTEL_SIM_STEPS[step];
  const out = document.getElementById('otelSimOutput');
  if (!out) return;
  out.innerHTML = cfg.log
    ? '<div class="otel-empty">▶ Click "Run request" to send POST /orders and see the log.</div>'
    : '<div class="otel-empty">▶ Click "Run request" to send POST /orders and watch the trace render span by span.</div>';
  const totalEl = document.getElementById('otelTraceTotal');
  if (totalEl) totalEl.textContent = '';
}

function otelSimRun() {
  const step = otelSimState.step;
  const cfg = OTEL_SIM_STEPS[step];
  if (otelSimState.timer) { clearInterval(otelSimState.timer); otelSimState.timer = null; }
  if (cfg.log) { otelSimRenderLog(step); return; }
  // progressively reveal spans
  otelSimState.revealed = 0;
  otelSimRenderWaterfall(step, 0);
  otelSimState.timer = setInterval(() => {
    otelSimState.revealed++;
    otelSimRenderWaterfall(step, otelSimState.revealed);
    if (otelSimState.revealed >= cfg.spans.length) {
      clearInterval(otelSimState.timer); otelSimState.timer = null;
    }
  }, 420);
}

function otelSimStep(n) {
  n = Math.max(0, Math.min(OTEL_SIM_STEPS.length - 1, n));
  otelSimState.step = n;
  if (otelSimState.timer) { clearInterval(otelSimState.timer); otelSimState.timer = null; }
  const cfg = OTEL_SIM_STEPS[n];
  // tabs
  OTEL_SIM_STEPS.forEach((_, i) => {
    const t = document.getElementById('otelTab' + i);
    if (t) t.classList.toggle('active', i === n);
  });
  // texts
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('otelSimDesc', cfg.desc);
  set('otelSimBackend', cfg.backend);
  set('otelSimCounter', `Step ${n} of ${OTEL_SIM_STEPS.length - 1}`);
  const codeEl = document.getElementById('otelSimCode');
  if (codeEl) codeEl.innerHTML = cfg.code;
  const legend = document.getElementById('otelTraceLegend');
  if (legend) legend.style.display = cfg.legend ? 'flex' : 'none';
  const prev = document.getElementById('otelPrevBtn');
  const next = document.getElementById('otelNextBtn');
  if (prev) prev.disabled = n === 0;
  if (next) next.disabled = n === OTEL_SIM_STEPS.length - 1;
  otelSimPlaceholder(n);
}

/* Init OTel simulation */
(function initOtelSim() {
  if (document.getElementById('otelSimOutput')) otelSimStep(0);
})();

/* ══════════════════════════════════════
   KUBERNETES NOTES — plain-text accessibility toggle
   Swaps the handwriting fonts for a clean sans across the
   whole notebook module by toggling html.nb-plain. Code
   blocks stay monospace (they never read the handwriting
   vars). The choice persists in localStorage. Copy buttons
   inside the notebook reuse the existing .term-copy handler.
══════════════════════════════════════ */
function toggleNbPlain() {
  const on = document.documentElement.classList.toggle('nb-plain');
  localStorage.setItem('nbPlain', on ? '1' : '0');
  syncNbPlainButtons(on);
}
function syncNbPlainButtons(on) {
  document.querySelectorAll('.nb-plain-toggle').forEach(btn => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Aa Handwriting' : 'Aa Plain text';
  });
}
(function initNbPlain() {
  const on = localStorage.getItem('nbPlain') === '1';
  if (on) document.documentElement.classList.add('nb-plain');
  syncNbPlainButtons(on);
})();

/* ══════════════════════════════════════
   NOTEBOOKS — multi-book page-turn engine
   Every .nb-book on the page becomes an independent page-turn
   "book": a book-open swing on the cover, 3D rotateY page turns
   between leaves, per-leaf internal scrolling, and a book-close
   swing onto an end leaf. Progressive enhancement: if this never
   runs the leaves just stack and scroll (see the CSS fallback).
   Reduced motion collapses every swing to an instant switch.

   The current leaf of each book is published in window.nbCurrentPage
   (sectionId -> leafId) so setActiveSection() can redirect the book
   section to the leaf on screen, keeping the breadcrumb/nav honest.
   window.nbBookGoto(href) is the shared hook used by scrollTo_ and
   deep links to drive whichever book owns that page id.
══════════════════════════════════════ */
window.nbCurrentPage = window.nbCurrentPage || {};
(function initNbBooks() {
  const books = Array.from(document.querySelectorAll('.nb-book'));
  if (!books.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TURN_MS = reduced ? 0 : 620;
  const controllers = [];

  function makeBook(book) {
    const stage   = book.querySelector('.nb-stage');
    const section = book.closest('.nb-section');
    const leaves  = Array.from(stage.querySelectorAll(':scope > .nb-leaf'));
    if (!stage || !section || !leaves.length) return null;

    // Page id per leaf. Leaf 0 (cover) uses the book section id (the anchor).
    const ids = leaves.map((lf, i) => (i === 0 ? section.id : lf.id));
    const N   = leaves.length;
    const prevBtn   = book.querySelector('.nb-prev');
    const nextBtn   = book.querySelector('.nb-next');
    const indicator = book.querySelector('.nb-page-indicator');
    const cornerPrev = stage.querySelector('.nb-corner-prev');
    const cornerNext = stage.querySelector('.nb-corner-next');
    // The end leaf (if any) keeps the last content page highlighted in the nav.
    const lastContentId = ids[Math.max(1, N - 2)] || section.id;

    let current = 0, busy = false, opened = false;
    let tabs = [];   // bookmark ribbon buttons, one per non-end leaf

    const pageLabel = (i) => i === 0 ? 'Cover' : (i === N - 1 ? 'The End' : 'Page ' + i + ' / ' + (N - 2));

    function setT(lf, t, animate) {
      if (animate) { lf.style.transform = t; return; }
      lf.style.transition = 'none'; lf.style.transform = t;
      void lf.offsetHeight; lf.style.transition = '';
    }

    function render(writeHash) {
      leaves.forEach((lf, i) => {
        lf.classList.remove('is-current', 'is-under', 'is-turning');
        lf.style.transition = 'none';
        if (i === current) { lf.classList.add('is-current'); lf.style.transform = 'rotateY(0deg)'; }
        else if (i < current) lf.style.transform = 'rotateY(-168deg)';
        else lf.style.transform = 'rotateY(0deg)';
        void lf.offsetHeight; lf.style.transition = '';
      });
      if (prevBtn) prevBtn.disabled = current === 0;
      if (nextBtn) nextBtn.disabled = current === N - 1;
      if (indicator) indicator.textContent = pageLabel(current);
      const activeId = current === N - 1 ? lastContentId : ids[current];
      window.nbCurrentPage[section.id] = activeId;
      // Record real reading progress: the reader opened a content page
      // (not the cover at index 0 nor the end leaf at N-1). The shelf reads
      // this back to fill each book's progress bar.
      if (current >= 1 && current <= N - 2 && window.NBProgress) {
        window.NBProgress.record(section.id, ids[current]);
      }
      if (typeof setActiveSection === 'function') setActiveSection(activeId);
      // Drive the breadcrumb directly from data attributes so it works without
      // a sidebar/nav list (multi-page layout): group = the topic, section =
      // the current leaf's label.
      const tbGroup = document.getElementById('tbGroup');
      const tbSection = document.getElementById('tbSection');
      if (tbGroup && section.dataset.topic) tbGroup.textContent = section.dataset.topic;
      if (tbSection) {
        tbSection.textContent = current === N - 1
          ? 'The End'
          : (leaves[current].dataset.label || pageLabel(current));
      }
      tabs.forEach(t => {
        const on = +t.dataset.idx === current;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      // Only user-driven turns own the URL hash. During the initial mass-render
      // every book would otherwise fight to stamp its own cover into the hash.
      if (writeHash !== false) {
        try { history.replaceState(null, '', '#' + ids[current]); } catch (e) { /* file:// */ }
      }
    }

    function animateTo(to) {
      const from = current, dir = to > from ? 1 : -1;
      const leaving = leaves[from], arriving = leaves[to];
      const isOpen = to === 0, isClose = to === N - 1;
      leaves.forEach(l => l.classList.remove('is-current', 'is-under', 'is-turning'));
      if (isOpen) {
        arriving.classList.add('is-current'); setT(arriving, 'rotateY(-92deg)', false);
        requestAnimationFrame(() => { arriving.style.transform = 'rotateY(0deg)'; });
      } else if (dir > 0 && !isClose) {
        arriving.classList.add('is-under');  setT(arriving, 'rotateY(0deg)', false);
        leaving.classList.add('is-turning'); setT(leaving,  'rotateY(0deg)', false);
        requestAnimationFrame(() => { leaving.style.transform = 'rotateY(-168deg)'; });
      } else if (isClose) {
        leaving.classList.add('is-under');    setT(leaving,  'rotateY(0deg)',  false);
        arriving.classList.add('is-turning'); setT(arriving, 'rotateY(92deg)', false);
        requestAnimationFrame(() => { arriving.style.transform = 'rotateY(0deg)'; });
      } else {
        leaving.classList.add('is-under');    setT(leaving,  'rotateY(0deg)',   false);
        arriving.classList.add('is-turning'); setT(arriving, 'rotateY(-168deg)', false);
        requestAnimationFrame(() => { arriving.style.transform = 'rotateY(0deg)'; });
      }
      current = to;
    }

    function go(to) {
      if (busy) return;
      to = Math.max(0, Math.min(N - 1, to));
      if (to === current) return;
      busy = true; opened = opened || to === 0;
      animateTo(to);
      window.setTimeout(() => { busy = false; render(); }, TURN_MS + 40);
    }

    function playOpenOnce() {
      if (opened) return; opened = true;
      if (reduced || current !== 0) return;
      const cover = leaves[0];
      cover.classList.add('is-current');
      setT(cover, 'rotateY(-92deg)', false);
      requestAnimationFrame(() => { cover.style.transform = 'rotateY(0deg)'; });
    }

    // Explicit open swing on the cover — used when the bookshelf opens a book,
    // so the open animation replays even if the book was opened before.
    function openSwing() {
      if (busy) return;
      opened = true;
      leaves.forEach(l => l.classList.remove('is-current', 'is-under', 'is-turning'));
      current = 0;
      const cover = leaves[0];
      cover.classList.add('is-current');
      if (reduced) { render(); return; }
      busy = true;
      setT(cover, 'rotateY(-92deg)', false);
      requestAnimationFrame(() => { cover.style.transform = 'rotateY(0deg)'; });
      window.setTimeout(() => { busy = false; render(); }, TURN_MS + 40);
    }

    // Resolve a hash to a leaf index. Ported inner pages keep their bare
    // original ids (e.g. "otel-intro") while covers and the Kubernetes pages
    // use the "nb-<topic>-..." form. Normalise by dropping a leading "nb-" on
    // both sides so a deep link works in either convention (e.g. both
    // "#nb-otel-intro" and "#otel-intro" resolve to the otel intro leaf).
    const normId = (s) => String(s || '').replace(/^#/, '').replace(/^nb-/, '');
    const indexOfId = (hash) => {
      const h = normId(hash);
      if (!h) return -1;
      return ids.findIndex((id) => normId(id) === h);
    };

    if (prevBtn)    prevBtn.addEventListener('click', () => go(current - 1));
    if (nextBtn)    nextBtn.addEventListener('click', () => go(current + 1));
    if (cornerPrev) cornerPrev.addEventListener('click', () => go(current - 1));
    if (cornerNext) cornerNext.addEventListener('click', () => go(current + 1));
    stage.querySelectorAll('[data-nb-goto]').forEach(b =>
      b.addEventListener('click', () => { const t = indexOfId(b.getAttribute('data-nb-goto')); if (t >= 0) go(t); }));
    stage.querySelectorAll('[data-nb-finish]').forEach(b =>
      b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })));

    // Keyboard: Left/Right turn pages, but only while THIS book fills the view.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const r = section.getBoundingClientRect(), mid = window.innerHeight * 0.5;
      if (!(r.top < mid && r.bottom > mid)) return;
      e.preventDefault();
      go(current + (e.key === 'ArrowRight' ? 1 : -1));
    });

    // Touch swipe: horizontal drag turns the page (vertical still scrolls).
    let sx = 0, sy = 0, tracking = false;
    stage.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; tracking = true;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (!tracking) return; tracking = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(current + (dx < 0 ? 1 : -1));
    }, { passive: true });

    // Replay the open swing whenever the cover scrolls into view fresh.
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting && current === 0) playOpenOnce(); });
    }, { threshold: 0.35 });
    io.observe(section);

    // ── Page-width tiers (fix the dead-ruled-area bug) ──
    // Text-only pages get a narrow, readable page; pages with diagrams,
    // tables or grids get a wide page so their columns sit side by side.
    const WIDE = '.nb-cols,.two-col,[class*="grid"],table,canvas,pre,.otel-seq,' +
      '.otel-wf,.otel-cpipe,.otel-anat,.otel-comp,.nb-table-wrap,.nb-diagram,' +
      '.nb-podbox,.sim-card,.sim-stage,.adot-arch-diagram,.mcp-arch-diagram,' +
      '.timeline,.card-grid-4,.card-grid-3,.devops-box';
    leaves.forEach(lf => {
      if (lf.classList.contains('nb-leaf-cover') || lf.classList.contains('nb-backcover')) return;
      const sheet = lf.querySelector('.nb-sheet');
      lf.classList.add(sheet && sheet.querySelector(WIDE) ? 'nb-w-wide' : 'nb-w-text');
    });

    // ── Notebook header + date band on each leaf (real-notebook feel) ──
    // ONE compact header line: marker topic title + page number on the LEFT,
    // handwritten "Date ____" on the RIGHT, under a ruled hairline. The old
    // standalone big centred masthead row is removed to reclaim top space.
    const topic = section.dataset.topic || '';
    leaves.forEach((lf, i) => {
      if (lf.classList.contains('nb-backcover')) return;
      const sheet = lf.querySelector('.nb-sheet');
      if (!sheet || sheet.querySelector('.nb-headband')) return;
      const isCover = lf.classList.contains('nb-leaf-cover');
      const band = document.createElement('div');
      band.className = 'nb-headband';
      const run = document.createElement('span');
      run.className = 'nb-hb-run';
      // Cover keeps its own big title below, so its band shows just "Cover".
      run.innerHTML = isCover
        ? '<span class="nb-hb-page">Cover</span>'
        : '<span class="nb-hb-title">' + topic + '</span>' +
          '<span class="nb-hb-page">' + pageLabel(i) + '</span>';
      const rightWrap = document.createElement('span');
      rightWrap.className = 'nb-hb-right';
      const date = document.createElement('span');
      date.className = 'nb-hb-date';
      date.innerHTML = 'Date <span class="nb-hb-line" aria-hidden="true"></span>';
      rightWrap.appendChild(date);
      // Fold the plain-text toggle into the header band (was absolute corner).
      const pt = sheet.querySelector('.nb-plain-toggle');
      if (pt) { pt.classList.add('nb-hb-plain'); rightWrap.appendChild(pt); }
      band.appendChild(run);
      band.appendChild(rightWrap);
      // Drop the old separate "- Page N -" line and the big centred masthead
      // title row (the band now carries the title + page). The cover's own
      // .nb-cover-title is left intact.
      const oldPageNum = sheet.querySelector('.nb-pagenum');
      if (oldPageNum) oldPageNum.remove();
      if (!isCover) {
        const oldMast = sheet.querySelector('.nb-masthead');
        if (oldMast) oldMast.remove();
      }
      const rings = sheet.querySelector('.nb-rings');
      sheet.insertBefore(band, rings ? rings.nextSibling : sheet.firstChild);
    });

    // ── Bookmark ribbon rail (in-book sub-topic nav + back to shelf) ──
    // Label source: the leaf's data-label (multi-page), falling back to a
    // matching sidebar nav link (legacy single-page), then the aria-label.
    function labelFor(i) {
      const dl = leaves[i].dataset.label;
      if (dl && dl.trim()) return dl.trim();
      const link = document.querySelector('.nav-link[data-section="' + ids[i] + '"]');
      if (link) {
        const span = link.querySelector('span:not(.ni):not(.nbadge)');
        if (span && span.textContent.trim()) return span.textContent.trim();
      }
      const al = leaves[i].getAttribute('aria-label');
      return al ? al.replace(/^.*page /i, 'Page ') : 'Page ' + i;
    }
    const rail = document.createElement('div');
    rail.className = 'nb-bookmarks';
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-label', (section.dataset.topic || 'Notebook') + ' sections');
    // Back to the shelf. On the multi-page site this is a real link to
    // index.html; on the legacy single page (shelf present) it scrolls up.
    const back = document.createElement('a');
    back.className = 'nb-to-shelf'; back.href = 'index.html';
    back.innerHTML = '← Shelf';
    back.setAttribute('aria-label', 'Back to the bookshelf');
    back.addEventListener('click', (e) => {
      const shelf = document.getElementById('shelf');
      if (shelf) { e.preventDefault(); shelf.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
      // else: let the link navigate to index.html (multi-page)
    });
    // A compact theme toggle lives in the rail header (the topbar is gone on
    // topic pages); it toggles via the shared [data-theme-toggle] delegation.
    const railHead = document.createElement('div');
    railHead.className = 'nb-rail-head';
    railHead.appendChild(back);
    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'nb-rail-theme';
    themeBtn.setAttribute('data-theme-toggle', '');
    themeBtn.setAttribute('aria-label', 'Toggle light or dark theme');
    themeBtn.innerHTML = '<span data-theme-icon>🌙</span>';
    railHead.appendChild(themeBtn);
    rail.appendChild(railHead);
    nbThemeIcons(document.documentElement.getAttribute('data-theme') || 'dark');
    leaves.forEach((lf, i) => {
      if (lf.classList.contains('nb-backcover')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'nb-bm'; b.dataset.idx = i;
      b.setAttribute('role', 'tab');
      b.textContent = labelFor(i);
      b.title = b.textContent;
      b.setAttribute('aria-label', 'Go to ' + b.textContent);
      b.addEventListener('click', () => go(i));
      rail.appendChild(b); tabs.push(b);
    });
    book.insertBefore(rail, book.firstChild);

    book.classList.add('nb-ready');
    return { section, ids, go, render, indexOfId, openSwing,
      hasId: (h) => indexOfId(h) >= 0,
      set current(v) { current = v; }, get current() { return current; },
      set opened(v) { opened = v; } };
  }

  books.forEach(b => { const c = makeBook(b); if (c) controllers.push(c); });

  // Shared hook: route a page id to whichever book owns it.
  window.nbBookGoto = function (href) {
    const c = controllers.find(ctl => ctl.hasId(href));
    if (!c) return false;
    c.section.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    const idx = c.indexOfId(href);
    if (idx === 0) c.openSwing();          // opening a book -> replay the open swing
    else if (idx === c.current) c.render();
    else c.go(idx);
    return true;
  };

  // Init each book: honour a deep link on its own leaves, else open at cover.
  // render(false) so the mass-render does not stamp the hash (only the target
  // book keeps/sets it below).
  const hash = location.hash;
  let deepBook = null, coverBook = null;
  controllers.forEach(c => {
    const idx = c.indexOfId(hash);
    if (idx > 0) { c.current = idx; c.opened = true; c.render(false); deepBook = c; }
    else { if (idx === 0) coverBook = c; c.current = 0; c.render(false); }
  });
  const target = deepBook || coverBook;
  if (target) {
    try { history.replaceState(null, '', '#' + target.ids[target.current]); } catch (e) { /* file:// */ }
    // Scroll so the book lands under the sticky chrome (top bar + mobile rail),
    // clearing scroll-margin. Re-assert on a short timer so we win against the
    // browser's own fragment jump to the (hidden) deep-linked leaf.
    const land = () => target.section.scrollIntoView({ block: 'start' });
    requestAnimationFrame(() => requestAnimationFrame(land));
    window.setTimeout(land, 160);
  }

  // Any hash change (address bar, back/forward, cross-book links, a #shelf
  // link) routes through the shared opener so we scroll to the OWNING book and
  // open it at the right page - even when crossing from another book or the
  // shelf. nbBookGoto handles cover (open swing) vs inner page and always
  // scrolls the target book into view.
  window.addEventListener('hashchange', () => {
    if (!location.hash || location.hash === '#shelf') {
      const shelf = document.getElementById('shelf');
      if (shelf) shelf.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    window.nbBookGoto(location.hash);
  });
})();

/* ══════════════════════════════════════
   BOOKSHELF LANDING
   Each book is a real link to its own topic page (e.g. helm.html),
   so clicking navigates natively. We only add Space-to-activate for
   parity with a button. Grouping lives in NB_LIBRARY below, so
   regrouping is a data change, not a markup move.
══════════════════════════════════════ */
// ── Bookshelf landing (index.html) ──
// One data structure drives every card. Each book carries its own display
// data plus `key` (its notebook's cover section id) and `pages` (real content
// page count), so progress bars read straight from NBProgress. Regroup the
// shelf by moving a book between LIBRARY groups here, not by editing markup.
window.NB_LIBRARY = [
  {
    title: 'Foundations',
    books: [
      { key: 'nb-setup-cover',  href: 'workstation-setup.html', title: 'Workstation Setup', emoji: '🖥️', brand: 'var(--accent-ink)', tag: 'Getting started', pages: 10, desc: 'Set up Git, SSH, Docker and your CLI so a fresh machine is ready to ship.' },
      { key: 'nb-ai-cover',     href: 'ai.html',                title: 'AI Engineering',   emoji: '🤖', brand: 'var(--brand-2)',   tag: 'Intermediate',    pages: 14, desc: 'Work with Claude, prompts and agent workflows in day-to-day engineering.' },
      { key: 'nb-mcp-cover',    href: 'mcp.html',               title: 'MCP',              emoji: '🔌', brand: 'var(--mcp)',       tag: 'Intermediate',    pages: 10, desc: 'Wire tools and data into models with the Model Context Protocol.' },
    ],
  },
  {
    title: 'Orchestration & Delivery',
    books: [
      { key: 'nb-k8s-cover',    href: 'kubernetes.html', title: 'Kubernetes',  emoji: '☸️', brand: 'var(--red)',    tag: 'Core',         pages: 5,  desc: 'The core objects. Pods, Services and Deployments, and how they fit.' },
      { key: 'nb-helm-cover',   href: 'helm.html',       title: 'Helm Charts', emoji: '⛵', brand: 'var(--helm)',   tag: 'Intermediate', pages: 15, desc: 'Package and template Kubernetes apps you can version and reuse.' },
      { key: 'nb-argocd-cover', href: 'argocd.html',     title: 'Argo CD',     emoji: '🐙', brand: 'var(--argocd)', tag: 'Advanced',     pages: 10, desc: 'Run GitOps delivery so the cluster matches what is committed to Git.' },
    ],
  },
  {
    title: 'Observability',
    books: [
      { key: 'nb-otel-cover',   href: 'opentelemetry.html', title: 'OpenTelemetry', emoji: '🔭', brand: 'var(--cyan)', tag: 'Advanced', pages: 18, desc: 'Instrument traces, metrics and logs against one open standard.' },
      { key: 'nb-adot-cover',   href: 'aws-adot.html',      title: 'AWS ADOT',      emoji: '📡', brand: 'var(--adot)', tag: 'Advanced', pages: 11, desc: 'Ship OpenTelemetry data into AWS with the managed ADOT collector.' },
    ],
  },
  {
    title: 'Automation',
    books: [
      { key: 'nb-pyauto-cover', href: 'python-automation.html', title: 'Python Automation', emoji: '🐍', brand: 'var(--pyauto)', tag: 'Advanced', pages: 10, desc: 'The Python and Fabric engine Jenkins drives to automate tenant and infra tasks.' },
    ],
  },
];

(function initShelf() {
  const root = document.getElementById('libRoot');
  if (!root || !Array.isArray(window.NB_LIBRARY)) return;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function cardHTML(b) {
    const pct = window.NBProgress ? window.NBProgress.pct(b.key, b.pages) : 0;
    const aria = `Open the ${b.title} notebook. ${b.pages} pages, ${pct}% read.`;
    return `<a class="lib-book" href="${esc(b.href)}" style="--book:${b.brand}"
        data-book-key="${esc(b.key)}" data-pages="${b.pages}" aria-label="${esc(aria)}">
      <div class="lib-book-top">
        <span class="lib-tag">${esc(b.tag)}</span>
        <span class="lib-emoji" aria-hidden="true">${b.emoji}</span>
      </div>
      <div class="lib-book-body">
        <div class="lib-book-title">${esc(b.title)}</div>
        <p class="lib-book-desc">${esc(b.desc)}</p>
      </div>
      <div class="lib-book-foot">
        <div class="lib-foot-meta">
          <span>${b.pages} pages</span>
          <span class="lib-pct">${pct}% read</span>
        </div>
        <div class="lib-prog"><span style="width:${pct}%"></span></div>
      </div>
    </a>`;
  }

  root.innerHTML = window.NB_LIBRARY.map((group) => `
    <section class="lib-cat">
      <div class="lib-cat-head">
        <h2 class="lib-cat-title">${esc(group.title)}</h2>
        <span class="lib-cat-count">${group.books.length}</span>
      </div>
      <div class="lib-grid">${group.books.map(cardHTML).join('')}</div>
    </section>`).join('');

  // Links open on Enter natively; add Space for parity with buttons.
  root.querySelectorAll('.lib-book').forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        const href = el.getAttribute('href');
        if (href) window.location.href = href;
      }
    });
  });
})();
