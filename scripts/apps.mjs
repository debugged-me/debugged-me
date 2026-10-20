// Builds a tile for each public repo and rewrites the README's public-apps section.
// Runs in GitHub Actions: GITHUB_TOKEN=... node scripts/apps.mjs dist README.md
//
// Every public repo shows up, newest first, except: this profile repo, forks, archived
// repos, Homebrew taps (homebrew-*), and repos tagged with the topic "hide-from-profile".
// The tile text comes from the repo's name, primary language, and About description.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOGIN = process.env.PROFILE_USER || "debugged-me";
const HIDE_TOPIC = "hide-from-profile";
const RAW = `https://raw.githubusercontent.com/${LOGIN}/${LOGIN}/output`;
const START = "<!-- public-apps:start -->";
const END = "<!-- public-apps:end -->";

const INK = "#0A0A0A";
const BODY = "#262626";
const FAINT = "#8A8A8A";
const BORDER = "#D4D4D4";
const FAMILY = "'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Sora advance widths at 100px for weights 300 and 800, measured from scripts/sora.woff2.
const SORA = {
  chars: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~—–·…’‘“”éñ×→",
  300: [23.3,28.3,41.2,68.1,65.5,83.6,67.5,26.1,36.9,36.9,56.6,58.8,25.8,50.1,25.8,32.3,73.5,41.6,61.4,60.9,63.1,61.7,65.4,56.5,62.9,65.4,25.8,25.8,58.7,58.8,58.7,54.8,112,74.9,67.3,79.4,79.5,60.3,56,83.1,80.6,30.8,63.8,65.8,53.9,90.5,84,86.7,63,86.7,68.7,69.7,58.8,79.5,69.9,103.2,68.5,64.9,65.7,36.9,32.3,36.9,56.3,57,30,56.9,68.4,60.4,68.4,60.9,37.5,67.1,63.5,29.9,30.7,54.9,27.4,96.2,63.5,66.9,68.4,68.4,40.3,52.9,42.1,62,54.7,82.7,54.7,53.4,48.5,36.9,37.3,36.9,47.7,89.4,50.6,25.8,78.8,23.8,23.8,42.2,42.2,60.9,63.5,58.8,100],
  800: [20.4,32.4,51.6,73.2,65,90.4,74.5,27,39.8,39.8,57.1,59.8,27.6,51,27.6,42.8,76.9,43,63.6,63.8,68.2,65.1,69.6,61.8,67.7,69.6,27.6,27.6,59.8,59,59.8,56.6,112.9,79,69.6,80.2,77.8,59.2,56,83.3,79.8,33.8,64.4,77.7,56.2,98.8,88.5,86.4,67.6,86.4,74,65.9,62.6,77.1,75,108,73,65.8,64.5,39.8,42.8,39.8,63.2,59.4,30,60,70.8,61.3,70.8,62.8,38.3,69,65.6,34.2,34.6,66.1,32.4,98.8,65.6,68.2,70.8,70.8,42.4,56.2,43.6,65,60.9,94.6,61.4,57.7,50.6,39.8,37.6,39.8,55.9,91.8,53,27.6,87.2,27.8,27.8,52.6,52.6,62.8,65.6,59.8,100],
};

const width = (text, size, weight) =>
  [...text].reduce((sum, c) => {
    const i = SORA.chars.indexOf(c);
    return sum + (i < 0 ? 62 : SORA[weight][i]);
  }, 0) * size / 100;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function repos(login, token) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "profile-app-tiles" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/users/${login}/repos?per_page=100&type=owner&sort=created&direction=desc`, { headers });
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${await res.text()}`);
  return (await res.json()).filter((r) =>
    !r.private && !r.fork && !r.archived &&
    r.name.toLowerCase() !== login.toLowerCase() &&
    !r.name.toLowerCase().startsWith("homebrew-") &&
    !(r.topics || []).includes(HIDE_TOPIC));
}

export function describe(repo) {
  const name = repo.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "PaperTrail: Because your shoebox…" -> "Because your shoebox…"
  const text = (repo.description || "").trim().replace(new RegExp(`^${name}\\s*[:\\-–—]\\s*`, "i"), "");
  return text || (repo.language ? `${repo.language} project` : "Public repository");
}

function clip(text, size, weight, maxW) {
  if (width(text, size, weight) <= maxW) return text;
  let s = text;
  while (s && width(s + "…", size, weight) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}

function wrap(text, size, weight, maxW, maxLines) {
  const lines = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && width(next, size, weight) > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.map((l) => clip(l, size, weight, maxW));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(lines.slice(maxLines - 1).join(" "), size, weight, maxW);
  return kept;
}

export function tile(repo, fontB64) {
  const W = 320, H = 148;
  const label = repo.language ? `PUBLIC APP · ${repo.language.toUpperCase()}` : "PUBLIC APP";
  const nameSize = Math.max(15, Math.min(25, 25 * 236 / width(repo.name, 25, 800)));
  const name = clip(repo.name, nameSize, 800, 236);
  const desc = wrap(describe(repo), 13, 300, 264, 2);
  const crop = [[14, 14, 1, 1], [W - 14, 14, -1, 1], [14, H - 14, 1, -1], [W - 14, H - 14, -1, -1]]
    .map(([x, y, sx, sy]) => `<path d="M${x} ${y + sy * 12} V${y} H${x + sx * 12}"/>`).join("");
  const summary = `${repo.name} — ${describe(repo)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(summary)}">
  <title>${esc(summary)}</title>
  <style>
@font-face { font-family: 'Sora'; src: url(data:font/woff2;base64,${fontB64}) format('woff2'); font-weight: 100 800; }
text { font-family: ${FAMILY}; }
.in { animation: in .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <defs>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="6"/></clipPath>
    <pattern id="minor" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#F0F0F0"/></pattern>
    <pattern id="major" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="url(#minor)"/><path d="M120 0H0V120" fill="none" stroke="#E5E5E5"/></pattern>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="#FFFFFF"/>
    <rect width="${W}" height="${H}" fill="url(#major)" opacity=".7"/>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="5.5" fill="none" stroke="${BORDER}"/>
  <g fill="none" stroke="${INK}" stroke-width="1.6">${crop}</g>
  <g class="in">
    <text x="28" y="40" font-size="10" font-weight="700" letter-spacing="1.8" fill="${FAINT}">${esc(label)}</text>
    <text x="28" y="74" font-size="${nameSize.toFixed(1)}" font-weight="800" letter-spacing="-.5" fill="${INK}">${esc(name)}</text>
    ${desc.map((line, i) => `<text x="28" y="${98 + i * 17}" font-size="13" font-weight="300" fill="${BODY}">${esc(line)}</text>`).join("\n    ")}
  </g>
  <g class="in" style="animation-delay:.2s" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="square">
    <path d="M276 34 H290 V48 M290 34 L272 52"/>
  </g>
</svg>
`;
}

// Phone version: on a phone a tile is a third of the screen (~115px), so the canvas is
// 120 wide and the text renders near its real size.
export function tileMobile(repo, fontB64) {
  const W = 120, H = 150, inner = 96;
  const label = (repo.language || "App").toUpperCase();
  const nameSize = Math.max(11, Math.min(17, 17 * inner / width(repo.name, 17, 800)));
  const name = clip(repo.name, nameSize, 800, inner);
  const desc = wrap(describe(repo), 11, 300, inner, 4);
  const crop = [[7, 7, 1, 1], [W - 7, 7, -1, 1], [7, H - 7, 1, -1], [W - 7, H - 7, -1, -1]]
    .map(([x, y, sx, sy]) => `<path d="M${x} ${y + sy * 8} V${y} H${x + sx * 8}"/>`).join("");
  const summary = `${repo.name} — ${describe(repo)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(summary)}">
  <title>${esc(summary)}</title>
  <style>
@font-face { font-family: 'Sora'; src: url(data:font/woff2;base64,${fontB64}) format('woff2'); font-weight: 100 800; }
text { font-family: ${FAMILY}; }
.in { animation: in .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="5.5" fill="#FFFFFF" stroke="${BORDER}"/>
  <g fill="none" stroke="${INK}" stroke-width="1.4">${crop}</g>
  <g class="in">
    <text x="12" y="28" font-size="8" font-weight="700" letter-spacing="1.2" fill="${FAINT}">${esc(label)}</text>
    <text x="12" y="58" font-size="${nameSize.toFixed(1)}" font-weight="800" letter-spacing="-.3" fill="${INK}">${esc(name)}</text>
    ${desc.map((line, i) => `<text x="12" y="${80 + i * 14}" font-size="11" font-weight="300" fill="${BODY}">${esc(line)}</text>`).join("\n    ")}
  </g>
  <g class="in" style="animation-delay:.2s" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="square">
    <path d="M${W - 30} 19 H${W - 18} V31 M${W - 18} 19 L${W - 32} 33"/>
  </g>
</svg>
`;
}

export function readmeBlock(list) {
  if (!list.length) return "";
  // On screens under 600px wide the phone tile is used instead.
  const links = list.map((r) => {
    const s = slug(r.name);
    return `  <a href="${r.html_url}"><picture><source media="(max-width: 600px)" srcset="${RAW}/app-${s}-m.svg"><img src="${RAW}/app-${s}.svg" width="32%" alt="${esc(`${r.name} — ${describe(r)}`)}"></picture></a>`;
  });
  return `<p align="center">\n${links.join("\n")}\n</p>`;
}

async function main() {
  const [outDir = "dist", readmePath = "README.md"] = process.argv.slice(2);
  const font = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sora.woff2")).toString("base64");
  const list = await repos(LOGIN, process.env.GITHUB_TOKEN);
  mkdirSync(outDir, { recursive: true });
  for (const r of list) {
    writeFileSync(join(outDir, `app-${slug(r.name)}.svg`), tile(r, font));
    writeFileSync(join(outDir, `app-${slug(r.name)}-m.svg`), tileMobile(r, font));
  }

  const md = readFileSync(readmePath, "utf8");
  const a = md.indexOf(START), b = md.indexOf(END);
  if (a < 0 || b < a) {
    console.warn(`README has no ${START} … ${END} markers; leaving it unchanged`);
  } else {
    const block = readmeBlock(list);
    const next = `${md.slice(0, a + START.length)}\n${block}${block ? "\n" : ""}${md.slice(b)}`;
    if (next !== md) writeFileSync(readmePath, next);
  }
  console.log(`${list.length} app tiles: ${list.map((r) => r.name).join(", ") || "none"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
