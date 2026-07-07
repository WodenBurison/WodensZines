// Static site generator for Woden's Adventures -- a multi-verse zine hub.
//
// Reads markdown content directly from the Obsidian vault, resolves wikilinks,
// and emits a plain static HTML/CSS site into ./docs for GitHub Pages (no
// build step on GitHub's end -- this script is run manually whenever you
// want to publish).
//
// Each "verse" is one game/campaign. Game-specific rendering (Iron Vault
// mechanics blocks, character sheets) is pluggable per verse via
// SYSTEM_RENDERER_FACTORIES, and visual theming is pluggable per verse via
// THEMES -- a verse with neither set still builds a complete, readable site,
// it just won't have those extras. This is what lets you add a verse for a
// different game (or no Iron Vault at all) without touching this file.
//
// Usage: npm run build

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------- Site-wide config ----------------
const VAULT_ROOT = path.resolve(__dirname, "../Woden_Starforged_Vault");
const DOCS_DIR = path.join(__dirname, "docs");
const HUB_TITLE = "Woden's Adventures";
const HUB_TAGLINE = "A shelf of tabletop journals, one verse per game";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

// Custom domain for the published site. Leave "" until wodenszines.online is
// bought and its DNS actually points at GitHub Pages -- when this is set, a
// docs/CNAME file gets (re)written on every build, which is what tells
// GitHub Pages which domain the site should answer to. Setting it before DNS
// is ready is harmless (GitHub just won't verify the domain yet), but leave
// it blank until you're ready so a stale/wrong CNAME never ships in a build.
const SITE_DOMAIN = "wodenzines.online";

// ---------------- System renderers ----------------
// A "system renderer" is the pluggable, game-specific piece of a verse: how
// to render `iron-vault-mechanics` code fences (move/roll/track/clock/oracle
// blocks), standalone progress-track pages, and character-sheet frontmatter.
// A verse that doesn't set `systemRenderer` (or names one that isn't
// registered below) still builds fine -- mechanics fences fall back to a
// plain code block, and character pages fall back to a plain frontmatter
// table -- it just doesn't get the fancy widgets. Add a new game system by
// writing a factory shaped like createIronVaultIronswornRenderer(ctx) below
// and registering it here; nothing else in this file needs to change.
const SYSTEM_RENDERER_FACTORIES = {
  "iron-vault-ironsworn": createIronVaultIronswornRenderer,
};

// ---------------- Theme stylesheets ----------------
// BASE_CSS (defined near the bottom of this file) covers the universal site
// chrome -- topbar, sidebar/nav, page header, prose typography, and the
// mechanics-widget/character-sheet *structure* -- so any verse looks
// complete and readable with zero theme at all. THEMES layer an additional,
// mood-specific palette and decoration on top of that. Today there's just
// the Ironsworn sci-fi HUD look (dark blue/green palette, scanline map
// frames); a verse with no `theme` set just gets BASE_CSS's default palette.
const THEMES = {
  "starforged-hud": () => STARFORGED_HUD_CSS,
};

// ---------------- Verse registry ----------------
// Each "verse" is one game/campaign living in its own subfolder of the vault
// and published to its own subfolder of the site (docs/<id>/), with its own
// theme. To add a new verse: add an entry here, point contentDir at its
// vault folder, and pick a systemRenderer/theme (or leave them out for a
// plain-styled verse with no special widgets -- fine for a game you're not
// tracking through Iron Vault at all). Nothing else in this file needs to
// change -- buildVerse and the hub both handle any number of verses, mixed
// systems and themes included.
const VERSES = [
  {
    id: "starforged",
    title: "Woden is Starforged",
    tagline: "An Ironsworn: Starforged solo playthrough",
    system: "Ironsworn: Starforged",
    genre: "Sci-fi",
    status: "In progress",
    summary:
      "A solo Ironsworn: Starforged campaign, logged session by session, with wiki pages for the crew, sectors, and factions of the Forge.",
    // Custom-designed cover art (full bleed, text baked in) for the hub's
    // magazine-rack card. Path is relative to the hub's own assets/ folder.
    coverImage: "sfzine1.webp",
    contentDir: path.join(VAULT_ROOT, "Woden_is_Starforged"),
    graphicsDir: path.join(VAULT_ROOT, "Graphics"),
    // Top-level vault folders that are Obsidian-only reference material (roll
    // tables, oracles, etc.) and should never be published to the site at all.
    excludedTopLevel: new Set(["Custom Content"]),
    // Individual files (relative to contentDir, posix-style) to keep private
    // even though their parent folder is otherwise published.
    excludedFiles: new Set([
      "Adventure Crafter/Quick Reference.md",
      "Adventure Crafter/Adventure Sheet.md",
    ]),
    systemRenderer: "iron-vault-ironsworn",
    assetsDataPath: path.join(__dirname, "data", "starforged-assets.json"),
    theme: "starforged-hud",
  },
];

// ================================================================
// Iron Vault / Ironsworn system renderer
// Everything in here is specific to Ironsworn-family games played through
// the Iron Vault Obsidian plugin: the KDL mechanics-block syntax, the
// edge/heart/iron/shadow/wits stat block, the -6..+10 momentum track, and
// asset rules text. A future verse for a different game (or one not using
// Iron Vault at all) just omits `systemRenderer`, or gets a new factory
// written for it -- this one doesn't need to change or generalize further.
// ================================================================
function createIronVaultIronswornRenderer(ctx) {
  const { resolveWikiTarget, relHref, escapeHtml, assetsDataPath } = ctx;

  // Rules text pulled from the official Datasworn dataset (Ironsworn:
  // Starforged Assets, Shawn Tomkin, CC BY 4.0 -- https://ironswornrpg.com).
  // Keyed by the asset id path used in Iron Vault's frontmatter
  // (category/asset-name). Only covers assets actually in play so far;
  // extend the verse's data file as new ones show up.
  const ASSETS_DATA =
    assetsDataPath && fs.existsSync(assetsDataPath)
      ? JSON.parse(fs.readFileSync(assetsDataPath, "utf-8"))
      : {};

  function titleCase(str) {
    return String(str ?? "")
      .replace(/[_/-]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // ---- KDL tokenizer/parser (ported from the earlier Quartz plugin) ----
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "\n") { tokens.push({ type: "NEWLINE" }); i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "{") { tokens.push({ type: "LBRACE" }); i++; continue; }
      if (c === "}") { tokens.push({ type: "RBRACE" }); i++; continue; }
      if (c === "=") { tokens.push({ type: "EQUALS" }); i++; continue; }
      if (c === '"') {
        let j = i + 1, out = "";
        while (j < n && src[j] !== '"') {
          if (src[j] === "\\" && j + 1 < n) {
            const next = src[j + 1];
            if (next === "n") out += "\n";
            else if (next === "t") out += "\t";
            else out += next;
            j += 2;
          } else { out += src[j]; j++; }
        }
        tokens.push({ type: "STRING", value: out });
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < n && !/[\s{}"=]/.test(src[j])) j++;
      if (j === i) { i++; continue; }
      tokens.push({ type: "BARE", value: src.slice(i, j) });
      i = j;
    }
    tokens.push({ type: "EOF" });
    return tokens;
  }

  function parseNodes(tokens, pos) {
    const nodes = [];
    while (true) {
      while (tokens[pos].type === "NEWLINE") pos++;
      if (tokens[pos].type === "RBRACE" || tokens[pos].type === "EOF") break;
      const nameTok = tokens[pos];
      if (nameTok.type !== "BARE" && nameTok.type !== "STRING") { pos++; continue; }
      pos++;
      const node = { name: nameTok.value, args: [], props: {}, children: [] };
      while (
        tokens[pos].type !== "NEWLINE" &&
        tokens[pos].type !== "LBRACE" &&
        tokens[pos].type !== "RBRACE" &&
        tokens[pos].type !== "EOF"
      ) {
        const tok = tokens[pos];
        if ((tok.type === "BARE" || tok.type === "STRING") && tokens[pos + 1]?.type === "EQUALS") {
          const key = tok.value;
          pos += 2;
          const valTok = tokens[pos];
          if (valTok.type === "BARE" || valTok.type === "STRING") { node.props[key] = valTok.value; pos++; }
          continue;
        }
        if (tok.type === "BARE" || tok.type === "STRING") { node.args.push(tok.value); pos++; continue; }
        pos++;
      }
      if (tokens[pos].type === "LBRACE") {
        pos++;
        const result = parseNodes(tokens, pos);
        node.children = result.nodes;
        pos = result.pos;
        if (tokens[pos].type === "RBRACE") pos++;
      }
      nodes.push(node);
    }
    return { nodes, pos };
  }

  function parseKdl(src) {
    return parseNodes(tokenize(src), 0).nodes;
  }

  function resolveArgs(node, paramNames) {
    const result = {};
    let argIdx = 0;
    for (const p of paramNames) {
      if (p in node.props) result[p] = node.props[p];
      else if (argIdx < node.args.length) { result[p] = node.args[argIdx]; argIdx++; }
    }
    return result;
  }

  function num(v, fallback = 0) {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  }

  function mdInlineFactory(currentSlug) {
    return function mdInline(text) {
      if (text === undefined || text === null) return "";
      let t = String(text).replace(/\\\//g, "/");
      const placeholders = [];
      function stash(html) {
        const key = " P" + placeholders.length + " ";
        placeholders.push(html);
        return key;
      }
      t = t.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p, alias) => {
        const display = alias || p.split("/").pop();
        const slug = resolveWikiTarget(p);
        if (slug) return stash(`<a href="${escapeHtml(relHref(currentSlug, slug))}">${escapeHtml(display)}</a>`);
        return stash(`<strong>${escapeHtml(display)}</strong>`);
      });
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
        if (url.match(/^(asset|move|oracle|datasworn):/)) return stash(`<strong>${escapeHtml(label)}</strong>`);
        return stash(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
      });
      let escaped = escapeHtml(t);
      escaped = escaped.replace(/ P(\d+) /g, (_m, i) => placeholders[Number(i)]);
      return escaped;
    };
  }

  function outcomeOf(score, vs1, vs2) {
    const gt1 = score > vs1, gt2 = score > vs2;
    const match = vs1 === vs2;
    let outcome;
    if (gt1 && gt2) outcome = "strong-hit";
    else if (gt1 || gt2) outcome = "weak-hit";
    else outcome = "miss";
    return { outcome, match };
  }

  const OUTCOME_LABEL = { "strong-hit": "Strong Hit", "weak-hit": "Weak Hit", miss: "Miss" };

  function badge(outcome, match) {
    const label = OUTCOME_LABEL[outcome] ?? outcome;
    const matchTag = match ? `<span class="ivm-match">MATCH</span>` : "";
    return `<span class="ivm-badge ivm-badge--${outcome}">${escapeHtml(label)}</span>${matchTag}`;
  }

  function detail(label, value) {
    if (value === undefined || value === null || value === "") return "";
    return `<span class="ivm-detail"><span class="ivm-detail-label">${escapeHtml(label)}</span><span class="ivm-detail-value">${value}</span></span>`;
  }

  function trackTicksFromRank(rank) {
    const table = { troublesome: 12, dangerous: 8, formidable: 4, extreme: 2, epic: 1 };
    return table[String(rank).toLowerCase()] ?? 4;
  }
  function ticksToBoxesTicks(t) { return { boxes: Math.floor(t / 4), ticks: t % 4 }; }
  function boxesTicksToTotal(b, t) { return num(b) * 4 + num(t); }

  // Renders one Ironsworn progress-track box as an SVG tally mark: 0 ticks =
  // empty square, then diagonal, diagonal (X), vertical, horizontal strokes
  // accumulate until the box reads as an 8-point asterisk at 4 ticks.
  function tallyBoxSvg(ticks, opts = {}) {
    const filled = opts.justFilled === true;
    const strokeColor = filled ? "var(--accent-green)" : "var(--accent-blue)";
    const bg = ticks >= 4 ? (filled ? "rgba(61,220,151,0.16)" : "rgba(79,179,217,0.12)") : "transparent";
    let strokes = "";
    if (ticks >= 1) strokes += `<line x1="4" y1="4" x2="20" y2="20" />`;
    if (ticks >= 2) strokes += `<line x1="20" y1="4" x2="4" y2="20" />`;
    if (ticks >= 3) strokes += `<line x1="12" y1="3" x2="12" y2="21" />`;
    if (ticks >= 4) strokes += `<line x1="3" y1="12" x2="21" y2="12" />`;
    return `<svg class="ivm-tally-box" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="3" fill="${bg}" stroke="var(--border)" stroke-width="1.5" />
      <g stroke="${strokeColor}" stroke-width="2" stroke-linecap="round">${strokes}</g>
    </svg>`;
  }

  function trackBoxesHtml(fromTicks, toTicks, maxTicks = 40) {
    const totalBoxes = Math.ceil(maxTicks / 4);
    const fromB = ticksToBoxesTicks(fromTicks), toB = ticksToBoxesTicks(toTicks);
    let boxes = "";
    for (let i = 0; i < totalBoxes; i++) {
      const boxStart = i * 4;
      const priorTicks = Math.max(0, Math.min(4, fromTicks - boxStart));
      const currentTicks = Math.max(0, Math.min(4, toTicks - boxStart));
      const justFilled = currentTicks > priorTicks;
      boxes += tallyBoxSvg(currentTicks, { justFilled });
    }
    const changed = fromTicks !== toTicks;
    return `<div class="ivm-track-boxes">${boxes}</div>
      <span class="ivm-progress-bar-label">${toB.boxes}.${toB.ticks} / ${totalBoxes} boxes${changed ? ` <span class="ivm-meter-up">(was ${fromB.boxes}.${fromB.ticks})</span>` : ""}</span>`;
  }

  function progressBarHtml(fromTicks, toTicks, maxTicks = 40) {
    return `<div class="ivm-progress-bar">${trackBoxesHtml(fromTicks, toTicks, maxTicks)}</div>`;
  }

  function meterBarHtml(from, to, min = 0, max = 10) {
    const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    const delta = to - from;
    const deltaClass = delta > 0 ? "ivm-meter-up" : delta < 0 ? "ivm-meter-down" : "";
    const deltaSign = delta > 0 ? "+" : "";
    return `<div class="ivm-meter">
      <div class="ivm-meter-track"><div class="ivm-meter-fill" style="width:${pct(to)}%"></div></div>
      <span class="ivm-meter-label">${from} &rarr; ${to} <span class="${deltaClass}">(${deltaSign}${delta})</span></span>
    </div>`;
  }

  // Ironsworn momentum is a -6..+10 ruler that acts as a roll modifier, so the
  // sign always matters -- this renders it as a labeled scale with the
  // current value called out, rather than a generic 0-max meter bar.
  function momentumTrackHtml(value) {
    const min = -6;
    const max = 10;
    const clamped = Math.max(min, Math.min(max, value));

    let boxes = "";
    for (let i = min; i <= max; i++) {
      const isLast = i === max;
      const isCurrent = i === clamped;
      const zone = i > 0 ? "momentum-box--pos" : i < 0 ? "momentum-box--neg" : "momentum-box--zero";
      const label = i > 0 ? `+${i}` : `${i}`;
      const z = max - i; // earlier boxes paint over the next box's edge, so their point appears to stab into it
      boxes += `<div class="momentum-box ${zone}${isCurrent ? " momentum-box--current" : ""}${isLast ? " momentum-box--last" : ""}" style="z-index:${z}"><span>${label}</span></div>`;
    }

    return `<div class="momentum-track"><div class="momentum-boxes">${boxes}</div></div>`;
  }

  function renderMechanicsBlock(src, currentSlug) {
    const mdInline = mdInlineFactory(currentSlug);
    let nodes;
    try { nodes = parseKdl(src); }
    catch { return `<pre class="ivm-parse-error"><code>${escapeHtml(src)}</code></pre>`; }

    function renderRoll(node, state) {
      const a = resolveArgs(node, ["stat-name", "action", "stat", "adds", "vs1", "vs2"]);
      const action = num(a.action), stat = num(a.stat), adds = num(a.adds, 0);
      const vs1 = num(a.vs1), vs2 = num(a.vs2);
      const explicitScore = node.props.score !== undefined ? num(node.props.score) : undefined;
      const score = explicitScore ?? Math.min(10, action + stat + adds);
      const { outcome, match } = outcomeOf(score, vs1, vs2);
      Object.assign(state, { score, vs1, vs2, outcome, match });
      return `<div class="ivm-node ivm-roll">${badge(outcome, match)}<div class="ivm-details">
        ${detail("Action die", action)}${detail("Stat", stat)}
        ${a["stat-name"] ? detail("Stat name", escapeHtml(a["stat-name"])) : ""}
        ${detail("Adds", adds)}${detail("Score", score)}${detail("Challenge dice", `${vs1} / ${vs2}`)}
      </div></div>`;
    }
    function renderProgressRoll(node, state) {
      const a = resolveArgs(node, ["name", "score", "vs1", "vs2"]);
      const score = num(a.score), vs1 = num(a.vs1), vs2 = num(a.vs2);
      const { outcome, match } = outcomeOf(score, vs1, vs2);
      Object.assign(state, { score, vs1, vs2, outcome, match });
      return `<div class="ivm-node ivm-roll">${badge(outcome, match)}<div class="ivm-details">
        ${a.name ? detail("Track", mdInline(a.name)) : ""}${detail("Progress score", score)}${detail("Challenge dice", `${vs1} / ${vs2}`)}
      </div></div>`;
    }
    function renderReroll(node, state) {
      const a = resolveArgs(node, ["action", "vs1", "vs2"]);
      const oldVs1 = state.vs1, oldVs2 = state.vs2, oldScore = state.score;
      const newVs1 = a.vs1 !== undefined ? num(a.vs1) : oldVs1;
      const newVs2 = a.vs2 !== undefined ? num(a.vs2) : oldVs2;
      const rows = [];
      if (a.action !== undefined) rows.push(detail("Old action die", state.actionDie ?? "?"), detail("New action die", a.action));
      if (a.vs1 !== undefined) rows.push(detail("Old challenge die 1", oldVs1), detail("New challenge die 1", newVs1));
      if (a.vs2 !== undefined) rows.push(detail("Old challenge die 2", oldVs2), detail("New challenge die 2", newVs2));
      const { outcome, match } = outcomeOf(oldScore, newVs1, newVs2);
      Object.assign(state, { vs1: newVs1, vs2: newVs2, outcome, match });
      return `<div class="ivm-node ivm-reroll"><span class="ivm-node-label">Reroll</span>${badge(outcome, match)}
        <div class="ivm-details">${rows.join("")}${detail("New score", oldScore)}</div></div>`;
    }
    function renderOutcomeOverride(node, state) {
      const a = resolveArgs(node, ["outcome", "reason"]);
      state.outcome = a.outcome;
      return `<div class="ivm-node ivm-outcome-override">${badge(a.outcome, state.match)}
        ${a.reason ? `<div class="ivm-details">${detail("Reason", mdInline(a.reason))}</div>` : ""}</div>`;
    }
    function renderMeter(node) {
      const a = resolveArgs(node, ["name", "from", "to"]);
      return `<div class="ivm-node ivm-meter-node"><span class="ivm-node-label">${escapeHtml(a.name ?? "Meter")}</span>${meterBarHtml(num(a.from), num(a.to))}</div>`;
    }
    function renderBurn(node, state) {
      const a = resolveArgs(node, ["from", "to"]);
      const from = num(a.from), to = num(a.to);
      let recompute = "";
      if (state.vs1 !== undefined && state.vs2 !== undefined) {
        const { outcome, match } = outcomeOf(to, state.vs1, state.vs2);
        Object.assign(state, { score: to, outcome, match });
        recompute = `<div class="ivm-details">${detail("New score", to)}${detail("Challenge dice", `${state.vs1} / ${state.vs2}`)}</div>${badge(outcome, match)}`;
      }
      return `<div class="ivm-node ivm-burn"><span class="ivm-node-label">Burn Momentum</span>${meterBarHtml(from, to, -6, 10)}${recompute}</div>`;
    }
    function renderProgress(node) {
      const a = resolveArgs(node, ["name", "from", "rank", "steps"]);
      const steps = num(a.steps, 1);
      const ticksPerMark = trackTicksFromRank(a.rank);
      let fromTotal = (node.props["from-boxes"] !== undefined || node.props["from-ticks"] !== undefined)
        ? boxesTicksToTotal(node.props["from-boxes"], node.props["from-ticks"]) : num(a.from, 0);
      const toTotal = Math.min(40, fromTotal + ticksPerMark * steps);
      return `<div class="ivm-node ivm-progress"><span class="ivm-node-label">${escapeHtml(a.name ?? "Progress")}</span>
        <div class="ivm-details">${a.rank ? detail("Rank", escapeHtml(a.rank)) : ""}${steps !== 1 ? detail("Steps", steps) : ""}</div>
        ${progressBarHtml(fromTotal, toTotal)}</div>`;
    }
    function renderTrack(node) {
      const name = node.props.name ?? node.args[0];
      if (node.props.status) {
        return `<div class="ivm-node ivm-track-status"><span class="ivm-node-label">Track</span>${detail("Name", mdInline(name))}
          <span class="ivm-status-badge ivm-status-badge--${node.props.status}">${escapeHtml(node.props.status)}</span></div>`;
      }
      const fromTotal = (node.props["from-boxes"] !== undefined || node.props["from-ticks"] !== undefined)
        ? boxesTicksToTotal(node.props["from-boxes"], node.props["from-ticks"]) : num(node.props.from, 0);
      const toTotal = (node.props["to-boxes"] !== undefined || node.props["to-ticks"] !== undefined)
        ? boxesTicksToTotal(node.props["to-boxes"], node.props["to-ticks"]) : num(node.props.to, fromTotal);
      return `<div class="ivm-node ivm-progress"><span class="ivm-node-label">${mdInline(name ?? "Track")}</span>${progressBarHtml(fromTotal, toTotal)}</div>`;
    }
    function renderXp(node) {
      const a = resolveArgs(node, ["from", "to"]);
      const from = num(a.from), to = num(a.to), delta = to - from;
      return `<div class="ivm-node ivm-xp"><span class="ivm-node-label">Experience</span>
        <div class="ivm-details">${detail("XP", `${from} &rarr; ${to} (${delta >= 0 ? "+" : ""}${delta})`)}</div></div>`;
    }
    function renderClock(node) {
      const a = resolveArgs(node, ["name", "from", "to", "out-of"]);
      if (node.props.status) {
        return `<div class="ivm-node ivm-clock-status"><span class="ivm-node-label">Clock</span>${detail("Name", mdInline(a.name))}
          <span class="ivm-status-badge ivm-status-badge--${node.props.status}">${escapeHtml(node.props.status)}</span></div>`;
      }
      const outOf = num(a["out-of"], 6), to = num(a.to, 0);
      let segs = "";
      for (let i = 0; i < outOf; i++) segs += `<span class="ivm-clock-seg ${i < to ? "ivm-clock-seg--filled" : ""}"></span>`;
      return `<div class="ivm-node ivm-clock"><span class="ivm-node-label">${escapeHtml(a.name ?? "Clock")}</span>
        <div class="ivm-clock-segs">${segs}</div><span class="ivm-clock-label">${a.from ?? 0} &rarr; ${to} / ${outOf}</span></div>`;
    }
    function renderOracle(node) {
      const a = resolveArgs(node, ["name", "roll", "result"]);
      const childHtml = node.children.length ? `<div class="ivm-oracle-children">${node.children.map((c) => renderNode(c, {})).join("")}</div>` : "";
      return `<div class="ivm-node ivm-oracle"><span class="ivm-oracle-icon">&#9860;</span><div class="ivm-details">
        ${detail("Oracle", mdInline(a.name))}${a.roll !== undefined ? detail("Roll", a.roll) : ""}${detail("Result", mdInline(a.result))}
        </div>${childHtml}</div>`;
    }
    function renderOracleGroup(node) {
      const a = resolveArgs(node, ["name"]);
      const childHtml = node.children.map((c) => renderNode(c, {})).join("");
      return `<div class="ivm-node ivm-oracle-group"><span class="ivm-node-label">${mdInline(a.name)}</span><div class="ivm-oracle-children">${childHtml}</div></div>`;
    }
    function renderAsset(node) {
      const a = resolveArgs(node, ["name", "status", "ability"]);
      return `<div class="ivm-node ivm-asset"><span class="ivm-node-label">Asset</span>${detail("Name", mdInline(a.name))}
        <span class="ivm-status-badge ivm-status-badge--${a.status}">${escapeHtml(a.status)}</span>${a.ability !== undefined ? detail("Ability", a.ability) : ""}</div>`;
    }
    function renderImpact(node) {
      const a = resolveArgs(node, ["name", "marked"]);
      const marked = String(a.marked) === "true";
      return `<div class="ivm-node ivm-impact"><span class="ivm-node-label">Impact</span>${detail("Name", mdInline(a.name))}
        <span class="ivm-status-badge ivm-status-badge--${marked ? "added" : "removed"}">${marked ? "marked" : "cleared"}</span></div>`;
    }
    function renderInitiative(node) {
      const a = resolveArgs(node, ["from", "to"]);
      return `<div class="ivm-node ivm-initiative"><div class="ivm-details">${detail("Position", `${escapeHtml(a.from ?? "")} &rarr; ${escapeHtml(a.to ?? "")}`)}</div></div>`;
    }
    function renderDiceExpr(node) {
      const a = resolveArgs(node, ["expr", "result"]);
      return `<div class="ivm-node ivm-dice-expr"><div class="ivm-details">${detail("Expression", escapeHtml(a.expr))}${detail("Value", a.result)}</div></div>`;
    }
    function renderDash(node) {
      const a = resolveArgs(node, ["text"]);
      return `<div class="ivm-node ivm-note">${mdInline(a.text)}</div>`;
    }
    function renderAdd(node) {
      const a = resolveArgs(node, ["amount", "from"]);
      return `<div class="ivm-node ivm-add"><span class="ivm-node-label">+ Add</span><div class="ivm-details">${detail("Amount", a.amount)}${a.from ? detail("From", mdInline(a.from)) : ""}</div></div>`;
    }
    function renderMove(node) {
      const a = resolveArgs(node, ["name", "id"]);
      const title = a.name ?? (a.id ? String(a.id).split("/").pop().replace(/_/g, " ") : "Move");
      const state = {};
      const childHtml = node.children.map((c) => renderNode(c, state)).join("");
      const headerBadge = state.outcome ? badge(state.outcome, state.match) : "";
      return `<div class="ivm-move"><div class="ivm-move-header"><span class="ivm-move-title">${mdInline(title)}</span>${headerBadge}</div>
        <div class="ivm-move-body">${childHtml}</div></div>`;
    }
    function renderNode(node, state) {
      switch (node.name) {
        case "move": return renderMove(node);
        case "-": return renderDash(node);
        case "add": return renderAdd(node);
        case "roll": return renderRoll(node, state);
        case "progress-roll": return renderProgressRoll(node, state);
        case "reroll": return renderReroll(node, state);
        case "outcome": return renderOutcomeOverride(node, state);
        case "meter": return renderMeter(node);
        case "burn": return renderBurn(node, state);
        case "progress": return renderProgress(node);
        case "track": return renderTrack(node);
        case "xp": return renderXp(node);
        case "clock": return renderClock(node);
        case "oracle": return renderOracle(node);
        case "oracle-group": return renderOracleGroup(node);
        case "asset": return renderAsset(node);
        case "impact": return renderImpact(node);
        case "initiative": case "position": return renderInitiative(node);
        case "dice-expr": return renderDiceExpr(node);
        default: return `<div class="ivm-node ivm-unknown">Unsupported mechanics node: <code>${escapeHtml(node.name)}</code></div>`;
      }
    }

    const html = nodes.map((n) => renderNode(n, {})).join("");
    return `<div class="ivm-block">${html}</div>`;
  }

  function renderStandaloneProgress(fm) {
    const boxes = trackBoxesHtml(fm.progress, fm.progress, 40);
    const metaBits = [fm["track-type"], fm.rank].filter(Boolean).map(escapeHtml).join(" &middot; ");
    return `<div class="ivm-block"><div class="ivm-node ivm-progress">
      ${metaBits ? `<span class="ivm-node-label">${metaBits}</span>` : ""}
      <div class="ivm-progress-bar">${boxes}</div>
    </div></div>`;
  }

  function pipMeterHtml(label, value, max = 5) {
    let pips = "";
    for (let i = 0; i < max; i++) {
      pips += `<span class="char-pip ${i < value ? "char-pip--filled" : ""}"></span>`;
    }
    return `<div class="char-meter">
      <span class="char-meter-label">${escapeHtml(label)}</span>
      <div class="char-pip-row">${pips}</div>
      <span class="char-meter-value">${value}/${max}</span>
    </div>`;
  }

  function assetCardHtml(asset) {
    const idParts = String(asset.id ?? "").replace(/^asset:/, "").split("/");
    const abilityTextKey = idParts.slice(-2).join("/");
    const known = ASSETS_DATA[abilityTextKey];
    const category = known?.category || (idParts.length > 1 ? titleCase(idParts[idParts.length - 2]) : "");
    const name = known?.name || titleCase(idParts[idParts.length - 1] || "Asset");
    const abilityTexts = known?.abilities || [];

    const abilities = Array.isArray(asset.abilities) ? asset.abilities : [];
    const abilityListHtml = abilities.length
      ? `<ul class="char-asset-abilities">${abilities
          .map(
            (on, i) =>
              `<li class="${on ? "char-ability--unlocked" : "char-ability--locked"}"><span class="char-pip ${on ? "char-pip--filled" : ""}"></span><span>${
                abilityTexts[i] ? escapeHtml(abilityTexts[i]) : `<em>Ability ${i + 1}</em>`
              }</span></li>`,
          )
          .join("")}</ul>`
      : "";

    const options = asset.options && typeof asset.options === "object" ? Object.entries(asset.options) : [];
    const optionsHtml = options.length
      ? `<div class="char-asset-options">${options
          .map(([k, v]) => `<span class="ivm-detail"><span class="ivm-detail-label">${escapeHtml(titleCase(k))}</span><span class="ivm-detail-value">${escapeHtml(String(v))}</span></span>`)
          .join("")}</div>`
      : "";

    const controls = asset.controls && typeof asset.controls === "object" ? Object.entries(asset.controls) : [];
    const controlValues = controls.filter(([k, v]) => !k.includes("/") && typeof v !== "boolean");
    const controlFlags = controls.filter(([k, v]) => typeof v === "boolean" && v === true);
    const controlsHtml =
      controlValues.length || controlFlags.length
        ? `<div class="char-asset-options">
            ${controlValues.map(([k, v]) => `<span class="ivm-detail"><span class="ivm-detail-label">${escapeHtml(titleCase(k))}</span><span class="ivm-detail-value">${escapeHtml(String(v))}</span></span>`).join("")}
            ${controlFlags.map(([k]) => `<span class="ivm-status-badge ivm-status-badge--reopened">${escapeHtml(titleCase(k.split("/").pop()))}</span>`).join("")}
          </div>`
        : "";

    return `<div class="char-asset-card">
      <div class="char-asset-header">
        <span class="char-asset-name">${escapeHtml(name)}</span>
        ${category ? `<span class="char-asset-category">${escapeHtml(category)}</span>` : ""}
      </div>
      ${abilityListHtml}
      ${optionsHtml}
      ${controlsHtml}
    </div>`;
  }

  function characterSheetHtml(fm) {
    const stats = ["edge", "heart", "iron", "shadow", "wits"]
      .map((s) => `<div class="char-stat"><span class="char-stat-label">${s}</span><span class="char-stat-value">${fm[s] ?? 0}</span></div>`)
      .join("");

    const meters = [
      pipMeterHtml("Health", num(fm.health, 0), 5),
      pipMeterHtml("Spirit", num(fm.spirit, 0), 5),
      pipMeterHtml("Supply", num(fm.supply, 0), 5),
    ].join("");

    const momentum = num(fm.momentum, 0);
    const momentumHtml = `<div class="ivm-node char-momentum-block">
      <span class="ivm-node-label">Momentum</span>
      ${momentumTrackHtml(momentum)}
    </div>`;

    const specialTracks = ["Bonds", "Discoveries", "Quests"]
      .map((t) => {
        const progress = num(fm[`${t}_Progress`], 0);
        const xp = num(fm[`${t}_XPEarned`], 0);
        return `<div class="ivm-node ivm-progress">
          <span class="ivm-node-label">${t} <span class="char-meter-value">(${xp} XP earned)</span></span>
          <div class="ivm-progress-bar">${trackBoxesHtml(progress, progress, 40)}</div>
        </div>`;
      })
      .join("");

    const xpAdded = num(fm.xp_added, 0);
    const xpSpent = num(fm.xp_spent, 0);
    const xpHtml = `<div class="ivm-node ivm-xp">
      <span class="ivm-node-label">Experience</span>
      <div class="ivm-details">${detail("Available", xpAdded - xpSpent)}${detail("Earned", xpAdded)}${detail("Spent", xpSpent)}</div>
    </div>`;

    const assets = Array.isArray(fm.assets) ? fm.assets.map(assetCardHtml).join("") : "";

    return `<div class="char-sheet">
      <div class="char-section">
        <h3 class="char-section-title">Stats</h3>
        <div class="char-stats-row">${stats}</div>
      </div>
      <div class="char-section">
        <h3 class="char-section-title">Meters</h3>
        <div class="char-meters-layout">
          <div class="char-meters-row">${meters}</div>
          ${momentumHtml}
        </div>
      </div>
      <div class="char-section">
        <h3 class="char-section-title">Experience</h3>
        ${xpHtml}
      </div>
      <div class="char-section">
        <h3 class="char-section-title">Special Tracks</h3>
        <div class="ivm-block">${specialTracks}</div>
      </div>
      ${assets ? `<div class="char-section">
        <h3 class="char-section-title">Assets</h3>
        <div class="char-assets-grid">${assets}</div>
        <p class="char-asset-credit">Asset rules text from <em>Ironsworn: Starforged</em> by Shawn Tomkin, used under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>
      </div>` : ""}
    </div>`;
  }

  return {
    // Called from the markdown-it fence override for "iron-vault-mechanics"/"mechanics" info strings.
    renderMechanicsFence(content, currentSlug) {
      return renderMechanicsBlock(content, currentSlug);
    },
    // Called for pages whose frontmatter has iron-vault-kind: progress.
    renderProgressWidget(fm) {
      return renderStandaloneProgress(fm);
    },
    // Called for pages whose frontmatter has iron-vault-kind: character.
    renderCharacterSheet(fm) {
      return characterSheetHtml(fm);
    },
  };
}

// ---------------- Per-verse build ----------------
// Builds one verse's entire site -- its own nav, pages, homepage feed, and
// CSS/JS -- into docs/<verse.id>/. Parameterized on `V` so each verse gets a
// clean, isolated run (its own pages/, nav tree, slug maps, system renderer,
// etc. -- nothing leaks between verses).
function buildVerse(V) {
  const CONTENT_DIR = V.contentDir;
  const GRAPHICS_DIR = V.graphicsDir;
  const OUTPUT_DIR = path.join(DOCS_DIR, V.id);
  const SITE_TITLE = V.title;
  const SITE_TAGLINE = V.tagline;
  const EXCLUDED_TOP_LEVEL = V.excludedTopLevel;
  const EXCLUDED_FILES = V.excludedFiles ?? new Set();

  // ---------------- Utilities ----------------

  function slugify(segment) {
    return segment
      .toLowerCase()
      .replace(/\.md$/i, "")
      .replace(/[^a-z0-9\/]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function slugPath(relPathNoExt) {
    return relPathNoExt
      .split(path.sep)
      .map(slugify)
      .filter(Boolean)
      .join("/");
  }

  function walk(dir, exts, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, exts, out);
      } else if (exts.some((e) => entry.name.toLowerCase().endsWith(e))) {
        out.push(full);
      }
    }
    return out;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  function relHref(fromSlug, toSlug) {
    const from = fromSlug === "" ? "." : fromSlug;
    const to = toSlug === "" ? "." : toSlug;
    let rel = path.posix.relative(from, to);
    if (rel === "") rel = ".";
    return rel.endsWith("/") ? rel : rel + "/";
  }

  function relAssetHref(fromSlug, assetRelPath) {
    const from = fromSlug === "" ? "." : fromSlug;
    return path.posix.relative(from, assetRelPath);
  }

  // ---------------- Discover content ----------------

  const mdFiles = walk(CONTENT_DIR, [".md"]).filter((file) => {
    const relPath = path.relative(CONTENT_DIR, file);
    const topFolder = relPath.split(path.sep)[0];
    if (EXCLUDED_TOP_LEVEL.has(topFolder)) return false;
    if (EXCLUDED_FILES.has(relPath.split(path.sep).join("/"))) return false;
    return true;
  });
  const graphicsFiles = fs.existsSync(GRAPHICS_DIR)
    ? fs
        .readdirSync(GRAPHICS_DIR)
        .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    : [];

  // slug map: relative-path-without-ext (posix, lowercased) -> page record
  const pages = [];
  const slugByFullPath = new Map(); // "custom-content/names/alien-names" -> page
  const slugByBasename = new Map(); // "alien-names" -> page (first match wins, for "shortest" wikilink resolution)

  for (const file of mdFiles) {
    const relPath = path.relative(CONTENT_DIR, file); // e.g. "Locations/.../Beacon.md"
    const relNoExt = relPath.replace(/\.md$/i, "");
    const slug = slugPath(relNoExt);
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = matter(raw);
    // draft: true in frontmatter keeps a note in the vault but out of the
    // published site entirely -- not built, not in nav, not in the homepage
    // feed, and invisible to wikilink resolution (so any note that links to it
    // just falls back to plain unresolved text instead of a dead link).
    if (parsed.data && parsed.data.draft) continue;
    const basenameKey = slugify(path.basename(relNoExt));
    const page = {
      file,
      relPath,
      slug,
      frontmatter: parsed.data || {},
      body: parsed.content,
      title: path.basename(relNoExt),
      topFolder: relPath.split(path.sep)[0],
    };
    pages.push(page);
    slugByFullPath.set(slug, page);
    if (!slugByBasename.has(basenameKey)) slugByBasename.set(basenameKey, page);
  }

  const assetBySlug = new Map(); // "openingpage.jpg" -> "graphics/Openingpage.jpg"
  for (const f of graphicsFiles) {
    assetBySlug.set(f.toLowerCase(), `graphics/${f}`);
  }

  const unresolvedLinks = new Set();

  function resolveWikiTarget(rawTarget) {
    let target = rawTarget.replace(/\\\//g, "/").trim();
    target = target.replace(/\.md$/i, "");
    const [pathPart] = target.split("#");
    const key = slugify(pathPart);
    if (slugByFullPath.has(key)) return slugByFullPath.get(key).slug;
    const baseKey = slugify(pathPart.split("/").pop());
    if (slugByBasename.has(baseKey)) return slugByBasename.get(baseKey).slug;
    unresolvedLinks.add(rawTarget);
    return null;
  }

  function resolveAssetTarget(rawTarget) {
    const clean = rawTarget.replace(/\\\//g, "/").trim();
    const base = clean.split("/").pop();
    return assetBySlug.get(base.toLowerCase()) || null;
  }

  // ---------------- System renderer for this verse ----------------
  const systemRenderer =
    V.systemRenderer && SYSTEM_RENDERER_FACTORIES[V.systemRenderer]
      ? SYSTEM_RENDERER_FACTORIES[V.systemRenderer]({
          resolveWikiTarget,
          relHref,
          escapeHtml,
          assetsDataPath: V.assetsDataPath,
        })
      : null;

  // Plain fallback for character-kind pages on a verse with no system
  // renderer -- still shows the frontmatter as a readable table rather than
  // rendering nothing.
  function genericFrontmatterDump(fm) {
    const rows = Object.entries(fm)
      .filter(([k]) => k !== "iron-vault-kind")
      .map(
        ([k, v]) =>
          `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}</td></tr>`,
      )
      .join("");
    return rows ? `<table class="char-sheet-fallback"><tbody>${rows}</tbody></table>` : "";
  }

  // ---------------- Wikilink preprocessing (outside fenced code blocks) ----------------

  const WIKILINK_RE = /(!?)\[\[([^\]|#]+)(#[^\]|]+)?(\|([^\]]+))?\]\]/g;

  function convertWikilinks(text, currentSlug) {
    return text.replace(WIKILINK_RE, (whole, bang, rawPath, _anchor, _aliasGroup, alias) => {
      const isEmbed = bang === "!";
      const display = alias || rawPath.split("/").pop().replace(/\\/g, "");
      if (isEmbed) {
        const assetSlug = resolveAssetTarget(rawPath);
        if (assetSlug) {
          return `![${escapeHtml(display)}](${relAssetHref(currentSlug, assetSlug)})`;
        }
        const pageSlug = resolveWikiTarget(rawPath);
        if (pageSlug) {
          return `[${escapeHtml(display)}](${relHref(currentSlug, pageSlug)})`;
        }
        return `*[missing embed: ${escapeHtml(rawPath)}]*`;
      }
      const pageSlug = resolveWikiTarget(rawPath);
      if (pageSlug) {
        return `[${display}](${relHref(currentSlug, pageSlug)})`;
      }
      return display;
    });
  }

  // splits markdown into segments, skipping the contents of fenced code blocks so
  // wikilink conversion never touches code
  function processOutsideFences(text, fn) {
    const fenceRe = /(```[^\n]*\n[\s\S]*?```)/g;
    return text
      .split(fenceRe)
      .map((chunk, i) => (i % 2 === 1 ? chunk : fn(chunk)))
      .join("");
  }

  // ---------------- Markdown rendering ----------------

  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules) ?? function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = (token.info || "").trim();
    if (info === "iron-vault-mechanics" || info === "mechanics") {
      if (systemRenderer?.renderMechanicsFence) {
        return systemRenderer.renderMechanicsFence(token.content, env.currentSlug);
      }
      // No system renderer registered for this verse -- fall back to a plain
      // code block rather than silently dropping the content.
      return `<pre class="ivm-fallback"><code>${escapeHtml(token.content)}</code></pre>`;
    }
    if (
      info === "iron-vault-track" ||
      info === "iron-vault-clock" ||
      info.startsWith("iron-vault-character-")
    ) {
      return ""; // rendered separately from frontmatter, this fence is just an Obsidian placeholder
    }
    if (info === "zoommap") {
      const pathMatch = token.content.match(/^\s*-?\s*path:\s*(.+)$/m);
      if (pathMatch) {
        const assetSlug = resolveAssetTarget(pathMatch[1].trim());
        if (assetSlug) {
          const label = titleCase((env.currentSlug || "").split("/").pop() || "Map");
          const img = `<img class="page-hero-image" src="${relAssetHref(env.currentSlug, assetSlug)}" alt="${escapeHtml(label)}">`;
          const markersMatch = token.content.match(/^\s*markers:\s*(.+)$/m);
          const markersData = markersMatch ? loadMarkersFile(markersMatch[1]) : null;
          const pins = mapPinsHtml(markersData, env.currentSlug);
          const routes = mapRoutesHtml(env.frontmatter?.["site-routes"], markersData);
          return mapFrameHtml(img, label, routes + pins);
        }
      }
      return "";
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  function renderMarkdown(bodyText, currentSlug, frontmatter) {
    const withLinks = processOutsideFences(bodyText, (chunk) => convertWikilinks(chunk, currentSlug));
    return md.render(withLinks, { currentSlug, frontmatter: frontmatter || {} });
  }

  // ---------------- Navigation tree ----------------

  function buildNavTree() {
    const tree = {};
    for (const page of pages) {
      const parts = page.relPath.replace(/\.md$/i, "").split(path.sep);
      let node = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        node.children = node.children || {};
        node.children[seg] = node.children[seg] || { name: seg, children: {}, items: [] };
        node = node.children[seg];
      }
      node.items = node.items || [];
      node.items.push(page);
    }
    return tree.children || {};
  }

  const navTree = buildNavTree();

  function renderNavNode(name, node, currentSlug, depth) {
    const items = (node.items || []).sort((a, b) => a.title.localeCompare(b.title));
    const childFolders = Object.entries(node.children || {}).sort(([a], [b]) => a.localeCompare(b));
    if (items.length === 0 && childFolders.length === 0) return "";
    let html = `<li class="nav-folder"><button class="nav-folder-toggle" type="button">${escapeHtml(name)}</button><ul class="nav-sublist">`;
    for (const [childName, childNode] of childFolders) {
      html += renderNavNode(childName, childNode, currentSlug, depth + 1);
    }
    for (const item of items) {
      const active = item.slug === currentSlug ? " nav-active" : "";
      html += `<li><a class="nav-link${active}" href="${relHref(currentSlug, item.slug)}">${escapeHtml(item.title)}</a></li>`;
    }
    html += `</ul></li>`;
    return html;
  }

  function renderSidebar(currentSlug) {
    const entries = Object.entries(navTree)
      .filter(([name]) => name !== "Journals")
      .sort(([a], [b]) => a.localeCompare(b));
    let html = `<li><a class="nav-link${currentSlug === "" ? " nav-active" : ""}" href="${relHref(currentSlug, "")}">Home / Sessions</a></li>`;
    for (const [name, node] of entries) {
      html += renderNavNode(name, node, currentSlug, 0);
    }
    return html;
  }

  // ---------------- Journals (blog posts) ----------------

  const journalPages = pages.filter((p) => p.topFolder === "Journals");
  function sessionNumber(title) {
    const m = title.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  journalPages.sort((a, b) => sessionNumber(b.title) - sessionNumber(a.title));

  // ---------------- HTML templates ----------------

  // Path from any page in this verse back up to the site-wide hub homepage
  // (docs/index.html). One level up gets out of the verse's own output folder,
  // then however many more levels the current page is nested.
  function hubHref(currentSlug) {
    const depth = (currentSlug === "" ? 0 : currentSlug.split("/").length) + 1;
    return "../".repeat(depth) + "index.html";
  }

  function layout({ title, currentSlug, contentHtml, description }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} · ${escapeHtml(SITE_TITLE)}</title>
<meta name="description" content="${escapeHtml(description || SITE_TAGLINE)}">
<link rel="stylesheet" href="${relAssetHref(currentSlug, "style.css")}">
</head>
<body>
<div class="topbar">
  <div class="topbar-brand">
    <a class="topbar-hub-link" href="${hubHref(currentSlug)}">&larr; ${escapeHtml(HUB_TITLE)}</a>
    <a class="topbar-title" href="${relHref(currentSlug, "")}">${escapeHtml(SITE_TITLE)}</a>
  </div>
  <button class="hamburger" id="navToggle" aria-label="Toggle navigation" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
</div>
<div class="layout">
  <nav class="sidebar" id="sidebar">
    <div class="sidebar-tagline">${escapeHtml(SITE_TAGLINE)}</div>
    <ul class="nav-list">
      ${renderSidebar(currentSlug)}
    </ul>
  </nav>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>
  <main class="content">
    ${contentHtml}
  </main>
</div>
<script src="${relAssetHref(currentSlug, "site.js")}"></script>
</body>
</html>`;
  }

  function pageHeader(title, meta) {
    return `<header class="page-header">
      <h1>${escapeHtml(title)}</h1>
      ${meta ? `<div class="page-meta">${meta}</div>` : ""}
    </header>`;
  }

  // Generic character-page header line (description/callsign/pronouns) --
  // this is display formatting, not game-specific rules, so it applies to
  // any verse regardless of system renderer.
  function characterInfoHtml(fm) {
    const infoBits = [
      fm.callsign ? `Callsign: ${escapeHtml(fm.callsign)}` : "",
      fm.pronouns ? `Pronouns: ${escapeHtml(fm.pronouns)}` : "",
    ]
      .filter(Boolean)
      .join(" &middot; ");

    return `${fm.description ? `<p class="char-description">${escapeHtml(fm.description)}</p>` : ""}
      ${infoBits ? `<p class="page-meta">${infoBits}</p>` : ""}`;
  }

  // ---------------- Map frame (sector maps, etc.) ----------------

  function titleCase(str) {
    return String(str ?? "")
      .replace(/[_/-]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // Scattered straight/corner accent lines along the frame border -- varied
  // lengths, colors and edges, deliberately asymmetric rather than mirrored.
  // pos = which edge; along = % position along that edge; len = px; corner =
  // bend a short stub inward at the end, like a mini version of the main brackets.
  const MAP_FRAME_ACCENTS = [
    { pos: "top", along: 22, inset: 0, len: 20, color: "var(--accent-blue)" },
    { pos: "top", along: 38, inset: 8, len: 8, color: "var(--accent-green)" },
    { pos: "top", along: 68, inset: 0, len: 14, color: "var(--accent-blue)", corner: true },
    { pos: "top", along: 84, inset: 12, len: 10, color: "var(--text-faint)" },
    { pos: "top", along: 10, inset: 13, len: 6, color: "var(--accent-green)" },
    { pos: "bottom", along: 18, inset: 0, len: 10, color: "var(--accent-green)" },
    { pos: "bottom", along: 55, inset: 0, len: 26, color: "var(--accent-blue)" },
    { pos: "bottom", along: 78, inset: 9, len: 12, color: "var(--accent-blue)" },
    { pos: "left", along: 20, inset: 0, len: 12, color: "var(--accent-green)", corner: true },
    { pos: "left", along: 48, inset: 0, len: 22, color: "var(--accent-blue)" },
    { pos: "left", along: 78, inset: 0, len: 8, color: "var(--text-faint)" },
    { pos: "left", along: 35, inset: 10, len: 9, color: "var(--accent-blue)" },
    { pos: "left", along: 90, inset: 6, len: 14, color: "var(--accent-green)" },
    { pos: "right", along: 15, inset: 0, len: 18, color: "var(--accent-blue)" },
    { pos: "right", along: 42, inset: 0, len: 9, color: "var(--accent-green)" },
    { pos: "right", along: 70, inset: 0, len: 15, color: "var(--accent-green)", corner: true },
    { pos: "right", along: 25, inset: 11, len: 7, color: "var(--text-faint)" },
    { pos: "right", along: 88, inset: 7, len: 11, color: "var(--accent-blue)" },
  ];

  // Seeded PRNG (mulberry32) so the extra generated accents are reproducible
  // across builds instead of reshuffling every time -- keeps git diffs clean.
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateMapFrameAccents(count) {
    const rng = mulberry32(20260702);
    const edges = ["top", "bottom", "left", "right"];
    const colors = ["var(--accent-blue)", "var(--accent-green)", "var(--text-faint)"];
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        pos: edges[Math.floor(rng() * edges.length)],
        along: Math.round(rng() * 100),
        inset: Math.round(rng() * 14),
        len: 4 + Math.round(rng() * 22),
        color: colors[Math.floor(rng() * colors.length)],
        corner: rng() < 0.25,
      });
    }
    return out;
  }

  MAP_FRAME_ACCENTS.push(...generateMapFrameAccents(82));

  function mapFrameAccentHtml({ pos, along, inset = 0, len, color, corner }) {
    const horizontal = pos === "top" || pos === "bottom";
    const edgeStyle =
      pos === "top" ? `top:${inset}px;` : pos === "bottom" ? `bottom:${inset}px;` : pos === "left" ? `left:${inset}px;` : `right:${inset}px;`;
    const alongStyle = horizontal ? `left:${along}%;` : `top:${along}%;`;
    const sizeStyle = horizontal ? `width:${len}px;height:2px;` : `width:2px;height:${len}px;`;
    const stub = corner
      ? `<span class="map-frame-accent-stub" style="background:${color};${
          horizontal
            ? `width:2px;height:8px;left:0;${pos === "top" ? "top:0;" : "bottom:0;"}`
            : `width:8px;height:2px;top:0;${pos === "left" ? "left:0;" : "right:0;"}`
        }"></span>`
      : "";
    return `<span class="map-frame-accent" style="background:${color};${edgeStyle}${alongStyle}${sizeStyle}">${stub}</span>`;
  }

  // Site-only HUD frame for map images -- purely CSS/SVG, independent of the
  // viewportFrame image Obsidian's zoommap plugin uses in-app.
  function mapFrameHtml(imgHtml, label, pinsHtml = "") {
    const accents = MAP_FRAME_ACCENTS.map(mapFrameAccentHtml).join("");
    return `<div class="map-frame">
      <span class="map-frame-corner map-frame-corner--tl"></span>
      <span class="map-frame-corner map-frame-corner--tr"></span>
      <span class="map-frame-corner map-frame-corner--bl"></span>
      <span class="map-frame-corner map-frame-corner--br"></span>
      ${accents}
      <div class="map-frame-window">
        ${imgHtml}
        <span class="map-frame-scanlines"></span>
        ${pinsHtml}
      </div>
      <div class="map-frame-caption">${escapeHtml(label)}</div>
    </div>`;
  }

  // Marker files referenced from a zoommap block are either a direct vault-relative
  // path (Graphics/kalidasmaw.markers.json) or a bare name living at the vault
  // root (The Forge -- an extensionless JSON file, same format).
  function loadMarkersFile(raw) {
    const clean = raw.trim().replace(/^["']|["']$/g, "");
    const candidates = clean.includes("/")
      ? [path.join(VAULT_ROOT, clean)]
      : [path.join(VAULT_ROOT, clean), path.join(VAULT_ROOT, clean + ".json")];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, "utf-8"));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // Only pins with an actual link get shown on the site -- the decorative
  // wayfinding icons (paper-plane, android, etc. with no link) are Obsidian-only
  // map furniture, not something readers need.
  // Routes are declared explicitly in the note's own frontmatter (site-routes: a
  // list of [name, name] pairs), deliberately separate from Iron Vault's marker
  // JSON -- proximity between pins isn't reliable enough to infer connections
  // from, and this way editing pins in Obsidian can never silently break a route.
  // Pulls wikilink targets out of a "| Passages | [[A]]; [[B]] |" style table
  // row, which is how Ironsworn's planet-oracle results already get recorded.
  function extractPassagesRow(bodyText) {
    if (!bodyText) return [];
    const rowMatch = bodyText.match(/^\s*\|\s*Passages\s*\|\s*(.+?)\s*\|?\s*$/im);
    if (!rowMatch) return [];
    const cell = rowMatch[1];
    const links = [];
    const linkRe = /\[\[([^\]|#]+)/g;
    let m;
    while ((m = linkRe.exec(cell))) {
      links.push(m[1].trim());
    }
    return links;
  }

  function mapRoutesHtml(explicitRoutes, markersData) {
    if (!markersData || !Array.isArray(markersData.markers)) return "";

    function findPoint(name) {
      const target = String(name).trim().toLowerCase();
      const m = markersData.markers.find(
        (mk) => (mk.link && mk.link.toLowerCase() === target) || (mk.tooltip && mk.tooltip.toLowerCase() === target),
      );
      return m && typeof m.x === "number" && typeof m.y === "number" ? m : null;
    }

    // Two ways to declare a route, both optional and mergeable:
    //  1. site-routes on the sector map note itself: a list of [name, name] pairs.
    //  2. a "Passages" row in an individual pinned page's own stat table -- this
    //     is data you're already recording during play, so it's read directly
    //     rather than asking you to duplicate it as a separate property. Only
    //     draws if the target is also pinned on this same map.
    const pairs = [];
    if (Array.isArray(explicitRoutes)) {
      for (const pair of explicitRoutes) {
        if (Array.isArray(pair) && pair.length === 2) pairs.push([String(pair[0]), String(pair[1])]);
      }
    }
    for (const marker of markersData.markers) {
      if (!marker.link) continue;
      const page = slugByFullPath.get(resolveWikiTarget(marker.link) || "");
      if (!page) continue;
      for (const target of extractPassagesRow(page.body)) {
        pairs.push([marker.link, target]);
      }
    }

    const seen = new Set();
    const lines = pairs
      .map(([nameA, nameB]) => {
        const a = findPoint(nameA);
        const b = findPoint(nameB);
        if (!a || !b) return "";
        const key = [a.id || nameA, b.id || nameB].sort().join("|");
        if (seen.has(key)) return "";
        seen.add(key);
        return `<line x1="${(a.x * 100).toFixed(2)}" y1="${(a.y * 100).toFixed(2)}" x2="${(b.x * 100).toFixed(2)}" y2="${(b.y * 100).toFixed(2)}" />`;
      })
      .join("");
    if (!lines) return "";

    return `<svg class="map-routes" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>`;
  }

  function mapPinsHtml(markersData, currentSlug) {
    if (!markersData || !Array.isArray(markersData.markers) || markersData.markers.length === 0) return "";
    return markersData.markers
      .map((m) => {
        if (typeof m.x !== "number" || typeof m.y !== "number" || !m.link) return "";
        const targetSlug = resolveWikiTarget(m.link);
        if (!targetSlug) return "";
        const xPct = (m.x * 100).toFixed(2);
        const yPct = (m.y * 100).toFixed(2);
        const color = m.iconColor ? escapeHtml(m.iconColor) : "var(--accent-green)";
        const tooltip = m.tooltip || "";
        const style = `left:${xPct}%;top:${yPct}%;`;
        const inner = `<span class="map-pin-dot" style="background:${color};color:${color}"></span>${
          tooltip ? `<span class="map-pin-label">${escapeHtml(tooltip)}</span>` : ""
        }`;
        return `<a class="map-pin" style="${style}" href="${relHref(currentSlug, targetSlug)}">${inner}</a>`;
      })
      .join("");
  }

  // ---------------- Build pages ----------------

  function ensureDirFor(outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
  }

  function writePage(slug, html) {
    const outFile = path.join(OUTPUT_DIR, slug, "index.html");
    ensureDirFor(outFile);
    fs.writeFileSync(outFile, html);
  }

  // clean this verse's own output dir (docs/ itself is wiped once, up front, by
  // the orchestration step at the bottom of this file)
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // copy graphics assets (skip the raw .xcf source file)
  const outGraphicsDir = path.join(OUTPUT_DIR, "graphics");
  fs.mkdirSync(outGraphicsDir, { recursive: true });
  for (const f of graphicsFiles) {
    fs.copyFileSync(path.join(GRAPHICS_DIR, f), path.join(outGraphicsDir, f));
  }

  // build every content page
  for (const page of pages) {
    if (page.topFolder === "Journals") continue; // handled specially below
    const fm = page.frontmatter;
    let pageBody = page.body;
    let headerImg = "";
    const mapPath = fm.path;
    if (mapPath) {
      const assetSlug = resolveAssetTarget(mapPath);
      if (assetSlug) {
        headerImg = `<img class="page-hero-image" src="${relAssetHref(page.slug, assetSlug)}" alt="${escapeHtml(page.title)}">`;
      }
    } else if (fm["iron-vault-kind"] === "character") {
      // Character pages: the first image embed in the body (typically a
      // portrait/headshot) becomes the top hero image, ahead of the stat
      // sheet, instead of rendering inline wherever it falls in the note.
      // Any later image (e.g. a full-body portrait) stays in the body and
      // ends up rendered after the stat sheet, at the bottom of the page.
      // The portrait sits alongside the description/callsign/pronouns on
      // desktop (row layout), stacking below it on narrow/mobile screens
      // (the .char-portrait-row CSS handles the breakpoint).
      const portraitMatch = pageBody.match(/!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp|bmp|svg))(?:[^\]]*)\]\]/i);
      let portraitImg = "";
      if (portraitMatch) {
        const assetSlug = resolveAssetTarget(portraitMatch[1]);
        if (assetSlug) {
          portraitImg = `<img class="char-portrait-image" src="${relAssetHref(page.slug, assetSlug)}" alt="${escapeHtml(page.title)}">`;
          pageBody = pageBody.slice(0, portraitMatch.index) + pageBody.slice(portraitMatch.index + portraitMatch[0].length);
        }
      }
      const infoHtml = characterInfoHtml(fm);
      if (portraitImg || infoHtml.trim()) {
        headerImg = `<div class="char-portrait-row">${portraitImg}<div class="char-portrait-info">${infoHtml}</div></div>`;
      }
    }
    const bodyHtml = renderMarkdown(pageBody, page.slug, fm);
    let trackWidget = "";
    if (fm["iron-vault-kind"] === "progress" && typeof fm.progress === "number") {
      trackWidget = systemRenderer?.renderProgressWidget ? systemRenderer.renderProgressWidget(fm) : "";
    }
    if (fm["iron-vault-kind"] === "character") {
      trackWidget = systemRenderer?.renderCharacterSheet ? systemRenderer.renderCharacterSheet(fm) : genericFrontmatterDump(fm);
    }
    const contentHtml = `${pageHeader(page.title)}${headerImg}${trackWidget}<div class="prose">${bodyHtml}</div>`;
    writePage(page.slug, layout({ title: page.title, currentSlug: page.slug, contentHtml }));
  }

  // build journal/session pages
  for (const page of journalPages) {
    const bodyHtml = renderMarkdown(page.body, page.slug);
    const contentHtml = `${pageHeader(page.title)}<div class="prose">${bodyHtml}</div>`;
    writePage(page.slug, layout({ title: page.title, currentSlug: page.slug, contentHtml }));
  }

  // build homepage: blog feed of journal entries, newest first
  const feedHtml = journalPages
    .map((page) => {
      const bodyHtml = renderMarkdown(page.body, "");
      return `<article class="post">
        <h2 class="post-title"><a href="${relHref("", page.slug)}">${escapeHtml(page.title)}</a></h2>
        <div class="prose">${bodyHtml}</div>
      </article>`;
    })
    .join("\n<hr class='post-divider'>\n");

  const homeContent = `<header class="page-header">
    <h1>${escapeHtml(SITE_TITLE)}</h1>
    <div class="page-meta">${escapeHtml(SITE_TAGLINE)}</div>
  </header>
  <div class="feed">${feedHtml || "<p>No sessions logged yet.</p>"}</div>`;

  writePage("", layout({ title: "Home", currentSlug: "", contentHtml: homeContent }));

  // ---------------- CSS + JS ----------------

  const themeCss = V.theme && THEMES[V.theme] ? THEMES[V.theme]() : "";
  fs.writeFileSync(path.join(OUTPUT_DIR, "style.css"), BASE_CSS + "\n" + themeCss);
  fs.writeFileSync(path.join(OUTPUT_DIR, "site.js"), SITE_JS);

  console.log(`Built ${pages.length} pages (${journalPages.length} journal entries) to ${OUTPUT_DIR}`);
  if (unresolvedLinks.size > 0) {
    console.log(`\n[${V.id}] ${unresolvedLinks.size} unresolved wikilink target(s):`);
    for (const l of unresolvedLinks) console.log(`  - ${l}`);
  }

  return {
    sessionCount: journalPages.length,
    latestSessionTitle: journalPages[0]?.title || null,
  };
}

// ---------------- Hub homepage (verse index) ----------------
// The hub is the site root: a "magazine rack" landing page where every verse
// is a magazine cover leaning in a wire rack, under a hand-made shop sign.
// It's deliberately separate from any verse's own theme -- each verse can
// look however fits its game, but the front door of the site is always this
// rack. Verses are chunked into shelves of MAGS_PER_SHELF so new verses
// added later just grow the rack downward instead of needing template work.

const MAG_COLORS = ["blue", "red", "green", "gold", "purple", "teal", "brown", "navy"];
const MAGS_PER_SHELF = 4;

function escapeHtmlHub(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function magCoverHtml(V, stats, colorClass) {
  const sessionLine =
    stats.sessionCount > 0
      ? `${stats.sessionCount} session${stats.sessionCount === 1 ? "" : "s"} logged`
      : "Just getting started";

  // Verses with their own designed cover image (full bleed, text baked in)
  // skip the CSS-drawn masthead/art/coverline/summary entirely -- the image
  // already is the cover. Dropped the dynamic session-count footer too,
  // since it doesn't know what's in the bottom corner of a custom design;
  // easy to add back as a small overlay badge if wanted.
  if (V.coverImage) {
    return `<a class="mag" href="${encodeURIComponent(V.id)}/" aria-label="${escapeHtmlHub(V.title)}">
  <div class="mag-cover mag-cover--image" style="background-image: url('assets/${encodeURIComponent(V.coverImage)}')"></div>
</a>`;
  }

  return `<a class="mag mag--${colorClass}" href="${encodeURIComponent(V.id)}/">
  <div class="mag-cover">
    <div class="mag-masthead">${escapeHtmlHub(V.title)}</div>
    <div class="mag-art" aria-hidden="true">
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <polygon points="16,3 28,10 28,22 16,29 4,22 4,10" fill="none" stroke="#fff" stroke-width="2"/>
        <line x1="16" y1="3" x2="16" y2="29" stroke="#fff" stroke-width="1.2"/>
        <line x1="4" y1="10" x2="28" y2="22" stroke="#fff" stroke-width="1.2"/>
        <line x1="28" y1="10" x2="4" y2="22" stroke="#fff" stroke-width="1.2"/>
      </svg>
    </div>
    <div class="mag-coverline">${escapeHtmlHub(V.genre)} &middot; ${escapeHtmlHub(V.status)}</div>
    <p class="mag-summary">${escapeHtmlHub(V.summary)}</p>
    <div class="mag-footer">
      <span class="mag-barcode" aria-hidden="true"></span>
      <span class="mag-price">${escapeHtmlHub(sessionLine)}</span>
    </div>
  </div>
</a>`;
}

function ghostMagHtml() {
  return `<div class="mag mag--ghost" aria-hidden="true">
  <div class="mag-cover">
    <div class="mag-masthead">&hellip;</div>
    <p class="mag-summary">More verses get racked up here as new games start.</p>
  </div>
</div>`;
}

function buildHub(verseResults) {
  const items = verseResults.map(({ verse, stats }, i) => magCoverHtml(verse, stats, MAG_COLORS[i % MAG_COLORS.length]));
  items.push(ghostMagHtml());
  const shelves = [];
  for (let i = 0; i < items.length; i += MAGS_PER_SHELF) {
    const rowHtml = items.slice(i, i + MAGS_PER_SHELF).join("\n");
    shelves.push(`<div class="shelf">
      <div class="shelf-mags">${rowHtml}</div>
      <div class="shelf-wire" aria-hidden="true">
        <div class="shelf-tines"></div>
        <div class="shelf-bar"></div>
      </div>
    </div>`);
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlHub(HUB_TITLE)}</title>
<meta name="description" content="${escapeHtmlHub(HUB_TAGLINE)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Permanent+Marker&display=swap" rel="stylesheet">
<link rel="stylesheet" href="hub.css">
<link rel="stylesheet" href="https://zinecityring.neocities.org/zinering.css">
</head>
<body>
<div class="scene">
  <div class="sign-wrap">
    <div class="tape tape-left"></div>
    <div class="tape tape-right"></div>
    <div class="sign">Woden's Adventure Zines</div>
  </div>
  <div class="rack">
    ${shelves.join("\n")}
  </div>
</div>
<div id="zine-city">
  <script src="https://zinecityring.neocities.org/zinecity-variables.js"></script>
  <script src="https://zinecityring.neocities.org/widgets/zinecityanimated.js"></script>
</div>
</body>
</html>`;
  fs.writeFileSync(path.join(DOCS_DIR, "index.html"), html);
  fs.writeFileSync(path.join(DOCS_DIR, "hub.css"), fs.readFileSync(path.join(__dirname, "themes", "magazine-rack.css"), "utf-8"));
}

// ---------------- Base stylesheet (universal site chrome) ----------------
// Covers the topbar, sidebar/nav, page layout, prose typography, and the
// mechanics-widget/character-sheet *structure* (badges, tally boxes, meters,
// pip rows, momentum ruler) -- all of it reusable by any verse regardless of
// system or theme. A verse with no theme just gets this default palette.

const BASE_CSS = `
:root {
  --bg: #16181d;
  --bg-elevated: #1c1f26;
  --bg-card: #21252d;
  --border: #2d323c;
  --text: #dcdfe4;
  --text-dim: #96a0ab;
  --text-faint: #656d78;
  --accent-blue: #6fa8dc;
  --accent-green: #6fcf97;
  --accent-green-dim: rgba(111, 207, 151, 0.15);
  --accent-blue-dim: rgba(111, 168, 220, 0.15);
  --danger: #e0788a;
  --warn: #e0b256;
  --font-body: "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-head: "Consolas", "SFMono-Regular", ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  line-height: 1.65;
}
a { color: var(--accent-blue); text-decoration: none; }
a:hover { color: var(--accent-green); text-decoration: underline; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1.1rem;
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg));
  border-bottom: 1px solid var(--border);
}
.topbar-title {
  font-family: var(--font-head);
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--accent-green);
  letter-spacing: 0.02em;
  text-shadow: 0 0 12px var(--accent-green-dim);
}
.topbar-title:hover { color: var(--accent-green); text-decoration: none; }
.topbar-brand { display: flex; flex-direction: column; gap: 0.1rem; }
.topbar-hub-link {
  font-family: var(--font-head);
  font-size: 0.68rem;
  color: var(--text-faint);
  letter-spacing: 0.03em;
}
.topbar-hub-link:hover { color: var(--accent-blue); text-decoration: none; }

.hamburger {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 34px;
  height: 34px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
}
.hamburger span { display: block; height: 2px; margin: 0 7px; background: var(--accent-blue); border-radius: 2px; }

.layout { display: flex; min-height: calc(100vh - 58px); }

.sidebar {
  width: 280px;
  flex-shrink: 0;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  padding: 1rem 0.75rem 2rem;
  overflow-y: auto;
}
.sidebar-tagline {
  font-size: 0.8rem;
  color: var(--text-faint);
  padding: 0 0.5rem 0.9rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.6rem;
  font-style: italic;
}
.nav-list, .nav-sublist { list-style: none; margin: 0; padding: 0; }
.nav-sublist { padding-left: 0.9rem; }
.nav-folder { margin: 0.1rem 0; }
.nav-folder-toggle {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  border-radius: 4px;
}
.nav-folder-toggle:hover { color: var(--accent-blue); background: var(--bg-card); }
.nav-folder.nav-collapsed > .nav-sublist { display: none; }
.nav-folder.nav-open > .nav-sublist { display: block; }
.nav-link {
  display: block;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  color: var(--text-dim);
  font-size: 0.88rem;
}
.nav-link:hover { background: var(--bg-card); color: var(--accent-blue); text-decoration: none; }
.nav-link.nav-active { color: var(--accent-green); background: var(--accent-green-dim); font-weight: 600; }

.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 15;
}

.content {
  flex: 1;
  min-width: 0;
  padding: 2rem 2.2rem 4rem;
  max-width: 860px;
}

.page-header { margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
.page-header h1 {
  font-family: var(--font-head);
  color: var(--text);
  margin: 0 0 0.3rem;
  font-size: 1.8rem;
  border-left: 3px solid var(--accent-green);
  padding-left: 0.6rem;
}
.page-meta { color: var(--text-faint); font-size: 0.9rem; padding-left: 0.7rem; }

.page-hero-image { width: 100%; max-width: 100%; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 1.5rem; }

/* Character portrait headshot + description/callsign/pronouns side by side;
   stacks (image on top) once the viewport gets too narrow for a row. */
.char-portrait-row { display: flex; align-items: center; gap: 1.2rem; margin-bottom: 1.5rem; }
.char-portrait-image { width: 25%; max-width: 220px; flex-shrink: 0; display: block; margin: 0; border-radius: 8px; border: 1px solid var(--border); }
.char-portrait-info { flex: 1; min-width: 0; }
.char-portrait-info .char-description { margin: 0 0 0.4rem; }
.char-portrait-info .page-meta { margin: 0; padding-left: 0; }
@media (max-width: 640px) {
  .char-portrait-row { flex-direction: column; align-items: flex-start; }
  .char-portrait-image { width: 40%; max-width: 160px; }
}

.prose h2 { color: var(--accent-blue); font-family: var(--font-head); margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
.prose h3 { color: var(--accent-green); font-family: var(--font-head); margin-top: 1.5rem; }
.prose p { color: var(--text); }
.prose img { max-width: 100%; border-radius: 6px; border: 1px solid var(--border); }
.prose code { background: var(--bg-card); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; color: var(--accent-green); }
.prose pre { background: var(--bg-card); padding: 0.8rem; border-radius: 6px; overflow-x: auto; border: 1px solid var(--border); }
.prose blockquote { border-left: 3px solid var(--accent-blue); margin: 1rem 0; padding: 0.3rem 0 0.3rem 1rem; color: var(--text-dim); background: var(--bg-card); border-radius: 0 6px 6px 0; }
.prose ul, .prose ol { padding-left: 1.4rem; }
.prose table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
.prose th, .prose td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; }
.prose th { background: var(--bg-card); color: var(--accent-blue); }

.feed .post { margin-bottom: 2.5rem; }
.post-title { font-family: var(--font-head); font-size: 1.4rem; }
.post-title a { color: var(--accent-green); }
.post-divider { border: none; border-top: 1px dashed var(--border); margin: 2rem 0; }

/* Mechanics-widget structure (badges, tally boxes, meters, pips) -- reusable
   by any verse/system that chooses to emit this HTML shape, not exclusive to
   Iron Vault/Ironsworn. */
.ivm-block { display: flex; flex-direction: column; gap: 0.75rem; margin: 1rem 0; }
.ivm-move { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-card); }
.ivm-move-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.55rem 0.9rem; background: var(--bg-elevated); font-family: var(--font-head); }
.ivm-move-title { font-weight: 700; color: var(--text); }
.ivm-move-body { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.7rem 0.9rem; }
.ivm-node { display: flex; flex-direction: column; gap: 0.35rem; }
.ivm-node-label { font-weight: 600; color: var(--accent-blue); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.03em; }
.ivm-details { display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; font-size: 0.9em; }
.ivm-detail { display: flex; gap: 0.3rem; align-items: baseline; }
.ivm-detail-label { color: var(--text-faint); font-size: 0.85em; }
.ivm-detail-value { color: var(--text); font-weight: 600; }
.ivm-badge { display: inline-block; padding: 0.15rem 0.65rem; border-radius: 999px; font-size: 0.78em; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; width: fit-content; }
.ivm-badge--strong-hit { background: rgba(111, 207, 151, 0.18); color: var(--accent-green); }
.ivm-badge--weak-hit { background: rgba(224, 178, 86, 0.2); color: var(--warn); }
.ivm-badge--miss { background: rgba(224, 120, 138, 0.18); color: var(--danger); }
.ivm-match { display: inline-block; margin-left: 0.4rem; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.68em; font-weight: 700; background: var(--accent-blue); color: var(--bg); }
.ivm-status-badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 4px; font-size: 0.76em; font-weight: 600; width: fit-content; }
.ivm-status-badge--added { background: rgba(111, 207, 151, 0.18); color: var(--accent-green); }
.ivm-status-badge--completed, .ivm-status-badge--upgraded { background: rgba(111, 168, 220, 0.18); color: var(--accent-blue); }
.ivm-status-badge--removed { background: rgba(224, 120, 138, 0.18); color: var(--danger); }
.ivm-status-badge--reopened { background: rgba(224, 178, 86, 0.2); color: var(--warn); }
.ivm-progress-bar, .ivm-meter { display: flex; flex-direction: column; gap: 0.35rem; }
.ivm-meter-track { position: relative; height: 8px; border-radius: 4px; background: var(--bg-elevated); overflow: hidden; }
.ivm-meter-fill { position: absolute; top: 0; left: 0; height: 100%; border-radius: 4px; background: var(--accent-green); }
.ivm-progress-bar-label, .ivm-meter-label { font-size: 0.85em; color: var(--text-dim); }
.ivm-track-boxes { display: flex; flex-wrap: wrap; gap: 3px; }
.ivm-tally-box { flex-shrink: 0; }
.ivm-tally-box rect { transition: fill 0.2s ease; }
.ivm-meter-up { color: var(--accent-green); }
.ivm-meter-down { color: var(--danger); }
.ivm-clock-segs { display: flex; gap: 3px; }
.ivm-clock-seg { width: 12px; height: 12px; border-radius: 2px; background: var(--bg-elevated); display: inline-block; border: 1px solid var(--border); }
.ivm-clock-seg--filled { background: var(--accent-blue); }
.ivm-clock-label { font-size: 0.85em; color: var(--text-faint); }
.ivm-oracle { border-left: 3px solid var(--accent-blue); padding-left: 0.6rem; }
.ivm-oracle-icon { font-size: 0.8em; color: var(--accent-blue); }
.ivm-oracle-children { margin-top: 0.35rem; padding-left: 0.85rem; display: flex; flex-direction: column; gap: 0.35rem; }
.ivm-note { font-style: italic; color: var(--text-dim); padding-left: 0.4rem; border-left: 2px solid var(--border); }
.ivm-unknown { font-size: 0.85em; color: var(--text-faint); }
.ivm-parse-error { background: var(--bg-card); padding: 0.5rem; border-radius: 4px; font-size: 0.85em; }
.ivm-fallback { background: var(--bg-card); padding: 0.8rem; border-radius: 6px; overflow-x: auto; border: 1px solid var(--border); color: var(--text-dim); font-size: 0.85em; }

/* Character sheet structure -- reusable widget shell; the actual stat
   labels/ranges are chosen by whichever system renderer fills it in. */
.char-sheet { display: flex; flex-direction: column; gap: 1.4rem; margin-bottom: 2rem; }
.char-sheet-fallback { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; }
.char-sheet-fallback td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; font-size: 0.88rem; vertical-align: top; }
.char-sheet-fallback td:first-child { color: var(--text-faint); width: 30%; }
.char-description { color: var(--text-dim); font-style: italic; }
.char-section { border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.1rem; background: var(--bg-card); }
.char-section-title { margin: 0 0 0.8rem; font-family: var(--font-head); color: var(--accent-blue); font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
.char-stats-row { display: flex; flex-wrap: wrap; gap: 0.7rem; }
.char-stat { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem; width: 74px; height: 74px; padding: 0 0.3rem; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-elevated); }
.char-stat-label { font-size: 0.68rem; text-transform: uppercase; color: var(--text-faint); letter-spacing: 0.02em; text-align: center; line-height: 1.1; }
.char-stat-value { font-family: var(--font-head); font-size: 1.5rem; color: var(--accent-green); font-weight: 700; }
.char-meters-row { display: flex; flex-wrap: wrap; gap: 1.5rem; margin-bottom: 0.8rem; }
.char-meter { display: flex; flex-direction: column; gap: 0.3rem; }
.char-meter-label { font-weight: 600; color: var(--accent-blue); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.03em; }
.char-meter-value { font-size: 0.8rem; color: var(--text-faint); }
.char-pip-row { display: flex; gap: 4px; }
.char-pip { width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--border); background: var(--bg-elevated); display: inline-block; }
.char-pip--filled { background: var(--accent-green); border-color: var(--accent-green); }
.char-assets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.8rem; }
.char-asset-card { border: 1px solid var(--border); border-radius: 6px; padding: 0.7rem 0.85rem; background: var(--bg-elevated); display: flex; flex-direction: column; gap: 0.5rem; }
.char-asset-header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.char-asset-name { font-weight: 700; color: var(--text); }
.char-asset-category { font-size: 0.72rem; color: var(--text-faint); text-transform: uppercase; }
.char-asset-options { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.char-asset-abilities { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.char-asset-abilities li { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.85rem; line-height: 1.45; }
.char-asset-abilities .char-pip { margin-top: 0.25rem; flex-shrink: 0; }
.char-ability--unlocked { color: var(--text); }
.char-ability--locked { color: var(--text-faint); }
.char-ability--locked .char-pip { opacity: 0.5; }
.char-asset-credit { font-size: 0.72rem; color: var(--text-faint); margin-top: 0.6rem; }

/* Momentum-style ruler (connected chevron boxes, point stabs into the next box) */
.momentum-track { padding: 0.6rem 0; overflow-x: auto; }
.momentum-boxes { display: flex; width: max-content; padding: 6px 4px; }
.momentum-box {
  position: relative;
  flex-shrink: 0;
  width: 38px;
  height: 32px;
  margin-left: -9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px 0 15px;
  font-family: var(--font-head);
  font-size: 0.66rem;
  font-weight: 700;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-dim);
  clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%);
}
.momentum-box:first-child { margin-left: 0; padding-left: 6px; }
.momentum-box--last { clip-path: none; padding-right: 6px; }
.momentum-box--neg { color: var(--danger); }
.momentum-box--pos { color: var(--accent-green); }
.momentum-box--zero { color: var(--accent-blue); }
.momentum-box--current {
  background: var(--accent-green) !important;
  color: var(--bg) !important;
  border-color: var(--accent-green);
  transform: scale(1.05);
  transform-origin: left center;
  z-index: 30 !important;
  box-shadow: 0 0 6px rgba(111, 207, 151, 0.5);
  /* both edges point rightward: a notch cut into the left mirrors the point on the right */
  clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%);
}

/* Mobile-first: sidebar hidden by default, slides in from the right */
@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    transform: translateX(100%);
    transition: transform 0.25s ease;
    z-index: 20;
    box-shadow: -8px 0 24px rgba(0,0,0,0.4);
  }
  .sidebar.sidebar-open { transform: translateX(0); }
  .sidebar-overlay.overlay-visible { display: block; }
  .content { padding: 1.4rem 1.1rem 3rem; }
  .page-header h1 { font-size: 1.4rem; }

  /* Meters: stack Health/Spirit/Supply in a column on the left, Momentum
     becomes a vertical chevron chain on the right instead of side-scrolling. */
  .char-meters-layout { display: flex; flex-direction: row; align-items: flex-start; gap: 1.25rem; }
  .char-meters-row { flex-direction: column; gap: 0.7rem; order: 2; }
  .char-momentum-block { flex-shrink: 0; order: 1; }
  .char-momentum-block .momentum-track { overflow: visible; padding: 0; }
  /* column-reverse: DOM order is still -6..+10, this just flips the stack so
     +10 ends up on top and -6 on bottom without touching the desktop order. */
  .char-momentum-block .momentum-boxes { flex-direction: column-reverse; width: auto; padding: 4px 6px; }
  .char-momentum-block .momentum-box {
    width: 32px;
    height: 38px;
    margin-left: 0;
    margin-top: -9px;
    padding: 6px 0 13px;
    /* point at the top now (stabs upward into the next-higher box), flat bottom */
    clip-path: polygon(100% 9px, 50% 0, 0 9px, 0 100%, 100% 100%);
  }
  .char-momentum-block .momentum-box:first-child { margin-top: 0; padding-bottom: 6px; }
  .char-momentum-block .momentum-box--last { clip-path: none; padding-top: 6px; }
  .char-momentum-block .momentum-box--current {
    clip-path: polygon(100% 100%, 100% 9px, 50% 0, 0 9px, 0 100%, 50% calc(100% - 9px));
    transform-origin: center bottom;
  }
}
@media (min-width: 901px) {
  .hamburger { display: none; }
  .sidebar-overlay { display: none !important; }
}
`;

// ---------------- Theme: Starforged sci-fi HUD ----------------
// Just a palette override plus the decorative map-frame chrome -- everything
// structural lives in BASE_CSS above so a themeless verse still looks whole.

const STARFORGED_HUD_CSS = `
:root {
  --bg: #0a1420;
  --bg-elevated: #101f30;
  --bg-card: #132436;
  --border: #1f3a52;
  --text: #d7e6ef;
  --text-dim: #8fa8b8;
  --text-faint: #5f7688;
  --accent-blue: #4fb3d9;
  --accent-green: #3ddc97;
  --accent-green-dim: rgba(61, 220, 151, 0.15);
  --accent-blue-dim: rgba(79, 179, 217, 0.15);
  --danger: #e6667a;
  --warn: #e0b256;
}

/* Site-only HUD frame for map images -- thick plated border, image sits inset in a "window" */
.map-frame {
  position: relative;
  margin: 0 0 1.5rem;
  padding: 18px 18px 10px;
  background: linear-gradient(160deg, var(--bg-elevated), var(--bg-card) 65%);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(79, 179, 217, 0.08);
}
.map-frame-window { position: relative; border-radius: 4px; overflow: hidden; border: 1px solid var(--border); background: var(--bg); }
.map-frame-window::after {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(79, 179, 217, 0.35);
  border-radius: 2px;
  pointer-events: none;
}
.map-frame-window .page-hero-image { margin: 0; border: none; border-radius: 0; display: block; }
.map-frame-corner { position: absolute; width: 22px; height: 22px; pointer-events: none; }
.map-frame-corner--tl { top: 5px; left: 5px; border-top: 2px solid var(--accent-green); border-left: 2px solid var(--accent-green); border-radius: 3px 0 0 0; }
.map-frame-corner--tr { top: 5px; right: 5px; border-top: 2px solid var(--accent-green); border-right: 2px solid var(--accent-green); border-radius: 0 3px 0 0; }
.map-frame-corner--bl { bottom: 5px; left: 5px; border-bottom: 2px solid var(--accent-green); border-left: 2px solid var(--accent-green); border-radius: 0 0 0 3px; }
.map-frame-corner--br { bottom: 5px; right: 5px; border-bottom: 2px solid var(--accent-green); border-right: 2px solid var(--accent-green); border-radius: 0 0 3px 0; }
.map-frame-accent { position: absolute; pointer-events: none; opacity: 0.85; }
.map-frame-accent-stub { position: absolute; pointer-events: none; }
.map-frame-caption {
  margin-top: 10px;
  font-family: var(--font-head);
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-green);
  text-align: center;
}
.map-frame-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(79, 179, 217, 0.05) 0px,
    rgba(79, 179, 217, 0.05) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: overlay;
}
.map-routes {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 3;
}
.map-routes line {
  stroke: var(--accent-green);
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-dasharray: 3 2;
  opacity: 0.95;
  filter: drop-shadow(0 0 3px rgba(61, 220, 151, 0.8));
}
.map-pin {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  text-decoration: none;
}
.map-pin-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid var(--bg);
  box-shadow: 0 0 0 2px currentColor, 0 0 10px 2px rgba(0, 0, 0, 0.7);
  transition: transform 0.15s ease;
}
.map-pin:hover .map-pin-dot { transform: scale(1.25); }
.map-pin-label {
  position: absolute;
  top: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--font-head);
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  color: var(--text);
  background: rgba(10, 20, 32, 0.85);
  border: 1px solid var(--border);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  pointer-events: none;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.map-pin:hover .map-pin-label { color: var(--accent-green); border-color: var(--accent-green); }
`;

const SITE_JS = `
document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.getElementById("navToggle");
  var sidebar = document.getElementById("sidebar");
  var overlay = document.getElementById("sidebarOverlay");
  function closeSidebar() {
    sidebar.classList.remove("sidebar-open");
    overlay.classList.remove("overlay-visible");
    toggle.setAttribute("aria-expanded", "false");
  }
  function openSidebar() {
    sidebar.classList.add("sidebar-open");
    overlay.classList.add("overlay-visible");
    toggle.setAttribute("aria-expanded", "true");
  }
  toggle.addEventListener("click", function () {
    if (sidebar.classList.contains("sidebar-open")) closeSidebar();
    else openSidebar();
  });
  overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll(".nav-folder-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.parentElement.classList.toggle("nav-open");
      btn.parentElement.classList.toggle("nav-collapsed");
    });
  });
});
`;

// ---------------- Orchestration ----------------
fs.rmSync(DOCS_DIR, { recursive: true, force: true });
fs.mkdirSync(DOCS_DIR, { recursive: true });
fs.writeFileSync(path.join(DOCS_DIR, ".nojekyll"), "");
if (SITE_DOMAIN) {
  fs.writeFileSync(path.join(DOCS_DIR, "CNAME"), SITE_DOMAIN + "\n");
}

const verseResults = VERSES.map((verse) => ({ verse, stats: buildVerse(verse) }));
buildHub(verseResults);

// Copy the hub's own asset folder (custom zine cover art etc.) into docs/
// so it's part of the published site, not just the source repo.
const HUB_ASSETS_SRC = path.join(__dirname, "assets");
if (fs.existsSync(HUB_ASSETS_SRC)) {
  fs.cpSync(HUB_ASSETS_SRC, path.join(DOCS_DIR, "assets"), { recursive: true });
}

console.log(`Built hub + ${VERSES.length} verse(s) to ${DOCS_DIR}`);
