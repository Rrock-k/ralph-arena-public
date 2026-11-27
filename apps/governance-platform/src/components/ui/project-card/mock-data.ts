import type { ProposalWithVotes } from "./types";

// Inline HTML previews rendered via data:text/html so iframes actually show content

const taskManagerHTML = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;overflow:hidden}
.nav{background:#1e293b;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #334155}
.nav h1{font-size:15px;font-weight:700;background:linear-gradient(135deg,#06b6d4,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.nav .dots{display:flex;gap:6px}.dot{width:8px;height:8px;border-radius:50%;background:#334155}
.dot.g{background:#22c55e}.dot.y{background:#eab308}
.board{display:flex;gap:14px;padding:16px;height:calc(100vh - 49px)}
.col{flex:1;background:#1e293b;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.col-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center}
.col-title span{background:#334155;border-radius:99px;padding:1px 7px;font-size:10px}
.card{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;font-size:11px}
.card h3{font-size:12px;font-weight:600;margin-bottom:4px;color:#f1f5f9}
.card p{color:#64748b;font-size:10px;line-height:1.4}
.tag{display:inline-block;font-size:9px;padding:2px 6px;border-radius:4px;margin-top:6px;font-weight:600}
.tag.high{background:#ef444420;color:#f87171;border:1px solid #ef444430}
.tag.med{background:#eab30820;color:#facc15;border:1px solid #eab30830}
.tag.low{background:#22c55e20;color:#4ade80;border:1px solid #22c55e30}
.avatar{width:18px;height:18px;border-radius:50%;background:#6366f1;margin-top:6px}
</style></head><body>
<div class="nav"><h1>TaskFlow AI</h1><div class="dots"><div class="dot g"></div><div class="dot y"></div><div class="dot"></div></div></div>
<div class="board">
<div class="col"><div class="col-title">To Do <span>3</span></div>
<div class="card"><h3>Setup auth flow</h3><p>Implement OAuth2 with Google & GitHub providers</p><div class="tag high">High</div></div>
<div class="card"><h3>Design landing page</h3><p>Hero section with feature highlights</p><div class="tag med">Medium</div></div>
<div class="card"><h3>Write API docs</h3><p>OpenAPI spec for all endpoints</p><div class="tag low">Low</div></div></div>
<div class="col"><div class="col-title">In Progress <span>2</span></div>
<div class="card"><h3>Dashboard UI</h3><p>Charts, stats, activity feed</p><div class="tag high">High</div><div class="avatar"></div></div>
<div class="card"><h3>AI priority model</h3><p>Train classifier on task metadata</p><div class="tag med">Medium</div></div></div>
<div class="col"><div class="col-title">Done <span>4</span></div>
<div class="card"><h3>Project setup</h3><p>Next.js, Tailwind, Prisma, DB</p><div class="tag low">Low</div></div>
<div class="card"><h3>User model</h3><p>Schema + CRUD + validation</p><div class="tag med">Medium</div></div></div>
</div></body></html>`;

const catanHTML = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#1a0e2e;color:#e2e8f0;overflow:hidden}
.hud-top{background:linear-gradient(180deg,rgba(0,0,0,0.7),transparent);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;position:absolute;top:0;left:0;right:0;z-index:10}
.hud-top h1{font-size:13px;font-weight:800;color:#fbbf24;letter-spacing:1px;text-transform:uppercase}
.turn{font-size:10px;color:#a78bfa;background:#4c1d9530;border:1px solid #7c3aed40;padding:3px 10px;border-radius:99px}
.board-area{display:flex;align-items:center;justify-content:center;height:100vh;position:relative}
.hex-grid{position:relative;width:240px;height:240px}
.hex{position:absolute;width:60px;height:52px;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:rgba(0,0,0,0.6);text-shadow:0 1px 2px rgba(255,255,255,0.2)}
.wheat{background:linear-gradient(135deg,#eab308,#ca8a04)}.ore{background:linear-gradient(135deg,#6b7280,#4b5563)}
.wood{background:linear-gradient(135deg,#16a34a,#15803d)}.brick{background:linear-gradient(135deg,#dc2626,#b91c1c)}
.sheep{background:linear-gradient(135deg,#84cc16,#65a30d)}.desert{background:linear-gradient(135deg,#d4a053,#b8860b)}
.players{position:absolute;bottom:12px;left:16px;right:16px;display:flex;gap:8px;z-index:10}
.player{flex:1;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);border-radius:8px;padding:8px;border:1px solid rgba(255,255,255,0.1)}
.player.active{border-color:#fbbf2460;box-shadow:0 0 12px #fbbf2420}
.player .name{font-size:10px;font-weight:700;margin-bottom:3px}
.player .vp{font-size:18px;font-weight:800;color:#fbbf24}
.player .label{font-size:8px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px}
.p1{color:#ef4444}.p2{color:#3b82f6}.p3{color:#22c55e}.p4{color:#f97316}
.res{display:flex;gap:4px;margin-top:4px}.res-dot{width:10px;height:10px;border-radius:2px;font-size:7px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
.dice{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:white;width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#1a0e2e;box-shadow:0 4px 20px rgba(0,0,0,0.5)}
</style></head><body>
<div class="hud-top"><h1>Settlers Online</h1><div class="turn">Turn 14 — Trading</div></div>
<div class="board-area">
<div class="hex-grid">
<div class="hex wheat" style="left:90px;top:0">5</div>
<div class="hex ore" style="left:150px;top:0">10</div>
<div class="hex wood" style="left:60px;top:44px">3</div>
<div class="hex brick" style="left:120px;top:44px">8</div>
<div class="hex sheep" style="left:180px;top:44px">6</div>
<div class="hex wheat" style="left:30px;top:88px">9</div>
<div class="hex desert" style="left:90px;top:88px"></div>
<div class="hex ore" style="left:150px;top:88px">11</div>
<div class="hex wood" style="left:60px;top:132px">4</div>
<div class="hex sheep" style="left:120px;top:132px">6</div>
<div class="hex brick" style="left:180px;top:132px">2</div>
<div class="hex wheat" style="left:90px;top:176px">12</div>
<div class="hex wood" style="left:150px;top:176px">9</div>
<div class="dice">8</div>
</div>
</div>
<div class="players">
<div class="player active"><div class="name p1">You</div><div class="vp">5</div><div class="label">Victory pts</div><div class="res"><div class="res-dot" style="background:#eab308">3</div><div class="res-dot" style="background:#6b7280">1</div><div class="res-dot" style="background:#16a34a">4</div></div></div>
<div class="player"><div class="name p2">Alice</div><div class="vp">4</div><div class="label">Victory pts</div></div>
<div class="player"><div class="name p3">Bob</div><div class="vp">3</div><div class="label">Victory pts</div></div>
<div class="player"><div class="name p4">AI</div><div class="vp">6</div><div class="label">Victory pts</div></div>
</div></body></html>`;

const cryptoHTML = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0b0f19;color:#e2e8f0;overflow:hidden}
.nav{background:#111827;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1f2937}
.nav h1{font-size:14px;font-weight:700;color:#10b981}
.nav .badge{font-size:9px;background:#10b98120;color:#34d399;padding:2px 8px;border-radius:99px;border:1px solid #10b98130}
.stats{display:flex;gap:10px;padding:12px 16px;background:#111827}
.stat{flex:1;background:#0b0f19;border:1px solid #1f2937;border-radius:8px;padding:10px}
.stat .label{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:1px}
.stat .val{font-size:18px;font-weight:800;margin-top:2px}
.stat .change{font-size:10px;margin-top:2px}
.green{color:#10b981}.red{color:#ef4444}
.chart{padding:8px 16px}
.chart-box{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:12px;position:relative;height:140px;overflow:hidden}
.chart-label{font-size:11px;font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between}
.chart-label span{color:#6b7280;font-size:10px}
.sparkline{position:absolute;bottom:12px;left:12px;right:12px;height:80px}
.sparkline svg{width:100%;height:100%}
.table{padding:8px 16px}
.row{display:flex;align-items:center;padding:8px;border-bottom:1px solid #1f293740;font-size:11px}
.row:first-child{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:1px}
.row .name{flex:2;font-weight:600;display:flex;align-items:center;gap:6px}
.row .price{flex:1;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.row .chg{flex:1;text-align:right;font-weight:600}
.coin{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff}
</style></head><body>
<div class="nav"><h1>CryptoFlow</h1><div class="badge">LIVE</div></div>
<div class="stats">
<div class="stat"><div class="label">Portfolio</div><div class="val">$24,831</div><div class="change green">+12.4%</div></div>
<div class="stat"><div class="label">24h P/L</div><div class="val green">+$1,204</div><div class="change green">+5.1%</div></div>
<div class="stat"><div class="label">BTC Fear</div><div class="val" style="color:#fbbf24">72</div><div class="change" style="color:#fbbf24">Greed</div></div>
</div>
<div class="chart"><div class="chart-box"><div class="chart-label">BTC / USD <span>1D</span></div>
<div class="sparkline"><svg viewBox="0 0 300 80" preserveAspectRatio="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10b981" stop-opacity="0.3"/><stop offset="100%" stop-color="#10b981" stop-opacity="0"/></linearGradient></defs>
<path d="M0,60 L20,55 40,58 60,45 80,48 100,35 120,40 140,30 160,32 180,20 200,25 220,15 240,18 260,10 280,12 300,8" fill="none" stroke="#10b981" stroke-width="2"/>
<path d="M0,60 L20,55 40,58 60,45 80,48 100,35 120,40 140,30 160,32 180,20 200,25 220,15 240,18 260,10 280,12 300,8 L300,80 L0,80Z" fill="url(#g)"/>
</svg></div></div></div>
<div class="table">
<div class="row"><div class="name">Asset</div><div class="price">Price</div><div class="chg">24h</div></div>
<div class="row"><div class="name"><div class="coin" style="background:#f7931a">B</div>Bitcoin</div><div class="price">$67,432</div><div class="chg green">+3.2%</div></div>
<div class="row"><div class="name"><div class="coin" style="background:#627eea">E</div>Ethereum</div><div class="price">$3,891</div><div class="chg green">+5.7%</div></div>
<div class="row"><div class="name"><div class="coin" style="background:#26a17b">T</div>Solana</div><div class="price">$142.80</div><div class="chg red">-1.2%</div></div>
</div></body></html>`;

const weatherHTML = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:linear-gradient(180deg,#1e3a5f 0%,#0f172a 100%);color:#e2e8f0;overflow:hidden;height:100vh}
.header{padding:16px;text-align:center}
.header .loc{font-size:13px;color:#94a3b8;letter-spacing:1px}
.header .temp{font-size:56px;font-weight:200;margin:4px 0;color:#fff}
.header .desc{font-size:13px;color:#93c5fd}
.header .hl{font-size:11px;color:#64748b;margin-top:2px}
.icon{font-size:40px;margin:8px 0}
.hourly{display:flex;gap:0;padding:12px 16px;overflow:hidden;border-top:1px solid #ffffff10;border-bottom:1px solid #ffffff10;background:rgba(0,0,0,0.15)}
.hour{flex:1;text-align:center;padding:8px 4px;min-width:50px}
.hour .time{font-size:9px;color:#64748b;margin-bottom:4px}
.hour .ic{font-size:16px;margin:4px 0}
.hour .t{font-size:12px;font-weight:600}
.hour.now{background:rgba(59,130,246,0.15);border-radius:10px}
.weekly{padding:8px 16px}
.day{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #ffffff08;font-size:12px}
.day .name{flex:1;color:#94a3b8}.day .ic2{flex:0 0 30px;text-align:center;font-size:14px}
.day .range{flex:1;display:flex;align-items:center;gap:6px;justify-content:flex-end}
.day .lo{color:#64748b}.day .hi{font-weight:600}
.bar{height:4px;width:50px;border-radius:2px;background:linear-gradient(90deg,#3b82f6,#f59e0b);opacity:0.5}
</style></head><body>
<div class="header">
<div class="loc">SAN FRANCISCO</div>
<div class="icon">&#9925;</div>
<div class="temp">18°</div>
<div class="desc">Partly Cloudy</div>
<div class="hl">H:22° L:14°</div>
</div>
<div class="hourly">
<div class="hour now"><div class="time">Now</div><div class="ic">&#9925;</div><div class="t">18°</div></div>
<div class="hour"><div class="time">1PM</div><div class="ic">&#9728;&#65039;</div><div class="t">20°</div></div>
<div class="hour"><div class="time">2PM</div><div class="ic">&#9728;&#65039;</div><div class="t">21°</div></div>
<div class="hour"><div class="time">3PM</div><div class="ic">&#9925;</div><div class="t">20°</div></div>
<div class="hour"><div class="time">4PM</div><div class="ic">&#9925;</div><div class="t">19°</div></div>
<div class="hour"><div class="time">5PM</div><div class="ic">&#127761;</div><div class="t">17°</div></div>
</div>
<div class="weekly">
<div class="day"><div class="name">Tuesday</div><div class="ic2">&#9728;&#65039;</div><div class="range"><div class="lo">13°</div><div class="bar"></div><div class="hi">24°</div></div></div>
<div class="day"><div class="name">Wednesday</div><div class="ic2">&#127782;&#65039;</div><div class="range"><div class="lo">11°</div><div class="bar"></div><div class="hi">19°</div></div></div>
<div class="day"><div class="name">Thursday</div><div class="ic2">&#9925;</div><div class="range"><div class="lo">12°</div><div class="bar"></div><div class="hi">21°</div></div></div>
<div class="day"><div class="name">Friday</div><div class="ic2">&#9728;&#65039;</div><div class="range"><div class="lo">14°</div><div class="bar"></div><div class="hi">25°</div></div></div>
</div></body></html>`;

function dataUrl(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export const proposedProposal: ProposalWithVotes = {
  id: "demo-1",
  title: "AI-Powered Task Manager",
  description:
    "A smart task manager that uses AI to automatically prioritize, categorize, and suggest deadlines for your tasks. Built with React and a lightweight ML model.",
  status: "PROPOSED",
  createdAt: new Date("2025-01-15"),
  archivedAt: null,
  projects: [],
  _count: { votes: 12 },
  votes: [],
};

export const buildingProposal: ProposalWithVotes = {
  id: "demo-2",
  title: "Multiplayer Catan Board Game",
  description:
    "Online multiplayer Settlers of Catan with real-time gameplay, trading, and AI opponents. WebSocket-based with beautiful 3D board rendering.",
  status: "PROPOSED",
  createdAt: new Date("2025-01-20"),
  archivedAt: null,
  projects: [
    {
      id: "proj-2",

      components: [{ powerIntent: "ON", runtimeState: "ABSENT", agentState: "RUNNING", blockers: [], lastOutcome: null }],
      agent: "claude-code",
      agentImpl: "direct",
      model: null,
      repoUrl: "https://github.com/ralph-arena/catan",
      repoBranch: "ralph-run-abc123",
      previewUrl: dataUrl(catanHTML),
      createdAt: new Date("2025-01-20"),
      budget: { isEnabled: true, totalCreditsUsd: 5.00, usedCreditsUsd: 1.85 },
    },
  ],
  _count: { votes: 34 },
  votes: [{ userId: "user-1" }],
};

export const deployedProposal: ProposalWithVotes = {
  id: "demo-3",
  title: "Real-Time Crypto Dashboard",
  description:
    "Live cryptocurrency tracker with interactive charts, portfolio management, and price alerts. Powered by CoinGecko API with WebSocket streaming.",
  status: "PROPOSED",
  createdAt: new Date("2025-01-10"),
  archivedAt: null,
  projects: [
    {
      id: "proj-3",

      components: [{ powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", blockers: [], lastOutcome: "COMPLETED" }],
      agent: "codex",
      agentImpl: "direct",
      model: null,
      repoUrl: "https://github.com/ralph-arena/crypto-dashboard",
      repoBranch: "main",
      previewUrl: dataUrl(cryptoHTML),
      createdAt: new Date("2025-01-10"),
      budget: { isEnabled: true, totalCreditsUsd: 10.00, usedCreditsUsd: 7.20 },
    },
  ],
  _count: { votes: 42 },
  votes: [{ userId: "user-1" }],
};

export const failedProposal: ProposalWithVotes = {
  id: "demo-4",
  title: "Weather Forecast App",
  description:
    "Beautiful weather app with animated maps, 7-day forecasts, and severe weather alerts.",
  status: "PROPOSED",
  createdAt: new Date("2025-01-22"),
  archivedAt: null,
  projects: [
    {
      id: "proj-4",

      components: [{ powerIntent: "OFF", runtimeState: "STOPPED", agentState: "IDLE", blockers: [], lastOutcome: "FAILED" }],
      agent: "codex",
      agentImpl: "direct",
      model: null,
      repoUrl: null,
      repoBranch: "main",
      previewUrl: dataUrl(weatherHTML),
      createdAt: new Date("2025-01-22"),
      budget: { isEnabled: true, totalCreditsUsd: 3.00, usedCreditsUsd: 2.95 },
    },
  ],
  _count: { votes: 8 },
  votes: [],
};

export const startingProposal: ProposalWithVotes = {
  id: "demo-5",
  title: "Social Media Analytics",
  description:
    "Track engagement metrics across platforms with AI-powered insights and automated reporting.",
  status: "PROPOSED",
  createdAt: new Date("2025-01-25"),
  archivedAt: null,
  projects: [
    {
      id: "proj-5",

      components: [{ powerIntent: "ON", runtimeState: "ABSENT", agentState: "RUNNING", blockers: [], lastOutcome: null }],
      agent: "claude-code",
      agentImpl: "direct",
      model: null,
      repoUrl: null,
      repoBranch: "main",
      previewUrl: null,
      createdAt: new Date("2025-01-25"),
    },
  ],
  _count: { votes: 15 },
  votes: [],
};

/* ── Budget scenario proposals ── */

export const lowBudgetProposal: ProposalWithVotes = {
  id: "demo-budget-low",
  title: "Multiplayer Catan Board Game",
  description:
    "Online multiplayer Settlers of Catan with real-time gameplay, trading, and AI opponents. WebSocket-based with beautiful 3D board rendering.",
  status: "PROPOSED",
  createdAt: new Date("2025-02-01"),
  archivedAt: null,
  projects: [
    {
      id: "proj-bl",

      components: [{ powerIntent: "ON", runtimeState: "ABSENT", agentState: "RUNNING", blockers: [], lastOutcome: null }],
      agent: "claude-code",
      agentImpl: "direct",
      model: null,
      repoUrl: "https://github.com/ralph-arena/catan",
      repoBranch: "ralph-run-bl",
      previewUrl: dataUrl(catanHTML),
      createdAt: new Date("2025-02-01"),
      budget: { isEnabled: true, totalCreditsUsd: 2.00, usedCreditsUsd: 0.40 },
    },
  ],
  _count: { votes: 28 },
  votes: [{ userId: "user-1" }],
};

export const highBudgetUsageProposal: ProposalWithVotes = {
  id: "demo-budget-high",
  title: "Real-Time Crypto Dashboard",
  description:
    "Live cryptocurrency tracker with interactive charts, portfolio management, and price alerts.",
  status: "PROPOSED",
  createdAt: new Date("2025-02-02"),
  archivedAt: null,
  projects: [
    {
      id: "proj-bh",

      components: [{ powerIntent: "ON", runtimeState: "ABSENT", agentState: "RUNNING", blockers: [], lastOutcome: null }],
      agent: "codex",
      agentImpl: "direct",
      model: null,
      repoUrl: "https://github.com/ralph-arena/crypto",
      repoBranch: "ralph-run-bh",
      previewUrl: dataUrl(cryptoHTML),
      createdAt: new Date("2025-02-02"),
      budget: { isEnabled: true, totalCreditsUsd: 5.00, usedCreditsUsd: 4.50 },
    },
  ],
  _count: { votes: 19 },
  votes: [],
};

export const exhaustedBudgetProposal: ProposalWithVotes = {
  id: "demo-budget-exhausted",
  title: "Weather Forecast App",
  description:
    "Beautiful weather app with animated maps, 7-day forecasts, and severe weather alerts.",
  status: "PROPOSED",
  createdAt: new Date("2025-02-03"),
  archivedAt: null,
  projects: [
    {
      id: "proj-be",

      components: [{ powerIntent: "ON", runtimeState: "ABSENT", agentState: "RUNNING", blockers: [], lastOutcome: null }],
      agent: "claude-code",
      agentImpl: "direct",
      model: null,
      repoUrl: null,
      repoBranch: "main",
      previewUrl: dataUrl(weatherHTML),
      createdAt: new Date("2025-02-03"),
      budget: { isEnabled: true, totalCreditsUsd: 3.00, usedCreditsUsd: 3.00 },
    },
  ],
  _count: { votes: 11 },
  votes: [],
};

export const noBudgetProposal: ProposalWithVotes = {
  id: "demo-no-budget",
  title: "AI-Powered Task Manager",
  description:
    "A smart task manager that uses AI to automatically prioritize, categorize, and suggest deadlines for your tasks.",
  status: "PROPOSED",
  createdAt: new Date("2025-02-04"),
  archivedAt: null,
  projects: [
    {
      id: "proj-nb",

      components: [{ powerIntent: "ON", runtimeState: "ABSENT", agentState: "RUNNING", blockers: [], lastOutcome: null }],
      agent: "claude-code",
      agentImpl: "direct",
      model: null,
      repoUrl: "https://github.com/ralph-arena/taskflow",
      repoBranch: "ralph-run-nb",
      previewUrl: dataUrl(taskManagerHTML),
      createdAt: new Date("2025-02-04"),
    },
  ],
  _count: { votes: 22 },
  votes: [{ userId: "user-1" }],
};
