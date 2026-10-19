// Draws the "Activity" card for the profile README from live GitHub data.
// Runs in GitHub Actions: GITHUB_TOKEN=... node scripts/stats.mjs dist/stats.svg
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOGIN = process.env.PROFILE_USER || "debugged-me";

const INK = "#0A0A0A";
const TEXT2 = "#525252";
const FAINT = "#8A8A8A";
const BORDER = "#D4D4D4";
const BLUE = "#0A0A0A";
const GREEN = "#0A0A0A";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const CALENDAR = "contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }";

async function gql(token, query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-activity-card" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

// -> { pastYear: { total, weeks: [[{date, count}]] }, years: { 2024: { total, days } } }
export async function load(login, token) {
  const { user } = await gql(token, "query($login: String!) { user(login: $login) { contributionsCollection { contributionYears } } }", { login });
  const now = new Date().toISOString();
  const aliases = user.contributionsCollection.contributionYears.map((y) => {
    const to = String(y) === now.slice(0, 4) ? now : `${y}-12-31T23:59:59Z`;
    return `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") { ${CALENDAR} }`;
  });
  const data = await gql(token, `query($login: String!) { user(login: $login) { last: contributionsCollection { ${CALENDAR} } ${aliases.join(" ")} } }`, { login });

  const days = (cal) => cal.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })));
  const years = {};
  for (const [key, value] of Object.entries(data.user)) {
    if (key.startsWith("y")) years[key.slice(1)] = { total: value.contributionCalendar.totalContributions, days: days(value.contributionCalendar) };
  }
  const last = data.user.last.contributionCalendar;
  return {
    pastYear: { total: last.totalContributions, weeks: last.weeks.map((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))) },
    years,
  };
}

export function streaks(years, today = new Date().toISOString().slice(0, 10)) {
  const byDate = new Map();
  for (const y of Object.values(years)) for (const d of y.days) if (d.date <= today) byDate.set(d.date, d.count);
  const days = [...byDate].sort(([a], [b]) => (a < b ? -1 : 1));

  let longest = { length: 0 }, run = null;
  for (const [date, count] of days) {
    if (count > 0) {
      run = run ? { ...run, end: date, length: run.length + 1 } : { start: date, end: date, length: 1 };
      if (run.length > longest.length) longest = run;
    } else run = null;
  }

  // Today without contributions yet doesn't break the streak.
  let i = days.length - 1, current = 0;
  if (i >= 0 && days[i][1] === 0) i--;
  while (i >= 0 && days[i][1] > 0) { current++; i--; }
  return { current, longest };
}

const fmt = (n) => n.toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

// fontB64: scripts/sora.woff2 as base64, embedded so GitHub shows Sora.
export function render(data, now = new Date(), fontB64 = null) {
  const W = 1000, H = 360;
  const allTime = Object.values(data.years).reduce((sum, y) => sum + y.total, 0);
  const { current, longest } = streaks(data.years, now.toISOString().slice(0, 10));
  const days = (n) => (n === 1 ? " DAY" : " DAYS");

  const metrics = [
    [fmt(data.pastYear.total), "", "PAST YEAR"],
    [fmt(allTime), "", "ALL TIME"],
    [fmt(current), days(current), "CURRENT STREAK"],
    [fmt(longest.length), days(longest.length), longest.length ? `LONGEST · ${shortDate(longest.start).toUpperCase()} – ${shortDate(longest.end).toUpperCase()}` : "LONGEST STREAK"],
  ];
  const col = 230;
  const metricSvg = metrics.map(([num, unit, label], i) => `
    <g class="in" style="animation-delay:${0.1 + i * 0.08}s">
      ${i ? `<line x1="${40 + i * col - 20}" y1="88" x2="${40 + i * col - 20}" y2="152" stroke="${BORDER}"/>` : ""}
      <text x="${40 + i * col}" y="104" font-size="11" font-weight="700" letter-spacing="1.6" fill="${FAINT}">${label}</text>
      <text x="${40 + i * col}" y="146" font-size="38" font-weight="800" letter-spacing="-1" fill="${INK}">${num}<tspan font-size="13" font-weight="700" letter-spacing="1" fill="${BLUE}">${unit}</tspan></text>
    </g>`).join("");

  // Weekly totals for the last 52 weeks.
  const weeks = data.pastYear.weeks.slice(-52).map((w) => ({ start: w[0].date, total: w.reduce((s, d) => s + d.count, 0) }));
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const peak = weeks.reduce((best, w, i) => (w.total > weeks[best].total ? i : best), 0);
  const left = 40, right = 960, base = 318, tall = 92;
  const slot = (right - left) / weeks.length, bw = Math.min(12, slot * 0.66);
  let lastMonth = null;
  const bars = [], labels = [];
  weeks.forEach((w, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const h = w.total ? Math.max(4, (w.total / max) * tall) : 2;
    const fill = !w.total ? "#EBEBEB" : i === peak ? INK : BLUE;
    bars.push(`<rect class="grow" style="animation-delay:${(0.3 + i * 0.018).toFixed(3)}s" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`);
    const month = w.start.slice(5, 7);
    if (month !== lastMonth && i > 0 && i < weeks.length - 2) labels.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${base + 20}" font-size="10.5" font-weight="600" letter-spacing="1" fill="${FAINT}" text-anchor="middle">${MONTHS[+month - 1].toUpperCase()}</text>`);
    lastMonth = month;
  });
  const grid = [0.5, 1].map((f) => `<line x1="${left}" y1="${(base - tall * f).toFixed(1)}" x2="${right}" y2="${(base - tall * f).toFixed(1)}" stroke="#EBEBEB" stroke-dasharray="3 4"/>`).join("");
  const px = left + peak * slot + slot / 2, ph = Math.max(4, (weeks[peak].total / max) * tall);
  const anchor = px > 900 ? "end" : px < 100 ? "start" : "middle";
  const peakSvg = weeks[peak].total
    ? `<g class="in" style="animation-delay:1.4s"><text x="${px.toFixed(1)}" y="${(base - ph - 9).toFixed(1)}" font-size="12" font-weight="700" fill="${INK}" text-anchor="${anchor}">${fmt(weeks[peak].total)}</text></g>`
    : "";

  const updated = now.toISOString().slice(0, 10);
  const summary = `GitHub activity: ${fmt(data.pastYear.total)} contributions in the past year, ${fmt(allTime)} all time, current streak ${current} days, longest streak ${longest.length} days.`;
  const crop = [[14, 14, 1, 1], [W - 14, 14, -1, 1], [14, H - 14, 1, -1], [W - 14, H - 14, -1, -1]].map(([x, y, sx, sy]) => `<path d="M${x} ${y + sy * 12} V${y} H${x + sx * 12}"/>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${summary}">
  <title>${summary}</title>
  <style>
${fontB64 ? `@font-face { font-family: 'Sora'; src: url(data:font/woff2;base64,${fontB64}) format('woff2'); font-weight: 100 800; }` : ""}
text { font-family: 'Sora', ${SANS}; }
.in { animation: in .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.grow { transform-box: fill-box; transform-origin: bottom; animation: grow .9s cubic-bezier(.2,.8,.2,1) both; }
@keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.live { transform-box: fill-box; transform-origin: center; animation: live 2s ease-out infinite; }
@keyframes live { 0% { opacity: .6; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(2.8); } }
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
  <rect x="40" y="35" width="10" height="10" fill="${BLUE}"/>
  <text x="60" y="45" font-size="13" font-weight="800" letter-spacing="2.4" fill="${INK}">ACTIVITY</text>
  <circle class="live" cx="${960 - 5}" cy="40.5" r="3.5" fill="${GREEN}"/>
  <circle cx="${960 - 5}" cy="40.5" r="3.5" fill="${GREEN}"/>
  <text x="${960 - 16}" y="45" font-size="11" font-weight="600" letter-spacing="1.2" fill="${FAINT}" text-anchor="end">UPDATED ${updated}</text>
  <line x1="40" y1="64" x2="960" y2="64" stroke="${BORDER}"/>
  ${metricSvg}
  <text x="40" y="200" font-size="11" font-weight="700" letter-spacing="1.6" fill="${FAINT}">CONTRIBUTIONS / WEEK</text>
  ${grid}
  ${bars.join("\n  ")}
  <line x1="${left}" y1="${base}" x2="${right}" y2="${base}" stroke="${BORDER}"/>
  ${labels.join("\n  ")}
  ${peakSvg}
</svg>
`;
}

async function main() {
  const out = process.argv[2] || "dist/stats.svg";
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const font = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sora.woff2")).toString("base64");
  const svg = render(await load(LOGIN, token), new Date(), font);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
