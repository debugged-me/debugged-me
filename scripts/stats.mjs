// Draws the "Activity" card for the profile README from live GitHub data.
// Runs in GitHub Actions: GITHUB_TOKEN=... node scripts/stats.mjs dist/stats.svg
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const LOGIN = process.env.PROFILE_USER || "debugged-me";

const INK = "#1F2433";
const SUBTLE = "#9AA1B2";
const LINE = "#E9EBF2";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif";

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

export function render(data, now = new Date()) {
  const W = 1000, H = 346;
  const allTime = Object.values(data.years).reduce((sum, y) => sum + y.total, 0);
  const { current, longest } = streaks(data.years, now.toISOString().slice(0, 10));

  const metrics = [
    [fmt(data.pastYear.total), "", "Past year"],
    [fmt(allTime), "", "All time"],
    [fmt(current), current === 1 ? " day" : " days", "Current streak"],
    [fmt(longest.length), longest.length === 1 ? " day" : " days", longest.length ? `Longest · ${shortDate(longest.start)} – ${shortDate(longest.end)}` : "Longest streak"],
  ];
  const metricSvg = metrics.map(([num, unit, label], i) => `
    <g class="rise" style="animation-delay:${0.1 + i * 0.1}s">
      <text x="${40 + i * 232}" y="124" font-size="38" font-weight="800" letter-spacing="-1" fill="${INK}">${num}<tspan font-size="17" font-weight="600" letter-spacing="0" fill="${SUBTLE}">${unit}</tspan></text>
      <text x="${40 + i * 232}" y="150" font-size="11.5" font-weight="600" letter-spacing="1.2" fill="${SUBTLE}">${label.toUpperCase()}</text>
    </g>`).join("");

  // Weekly totals for the last 52 weeks.
  const weeks = data.pastYear.weeks.slice(-52).map((w) => ({ start: w[0].date, total: w.reduce((s, d) => s + d.count, 0) }));
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const peak = weeks.reduce((best, w, i) => (w.total > weeks[best].total ? i : best), 0);
  const left = 40, right = 960, base = 310, tall = 84;
  const slot = (right - left) / weeks.length, bw = Math.min(12, slot * 0.64);
  let lastMonth = null;
  const bars = [], labels = [];
  weeks.forEach((w, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const h = w.total ? Math.max(5, (w.total / max) * tall) : 3;
    const fill = w.total ? (i === peak ? "url(#peak)" : "url(#bar)") : "#EEF0F6";
    bars.push(`<rect class="grow" style="animation-delay:${(0.3 + i * 0.018).toFixed(3)}s" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}" fill="${fill}"/>`);
    const month = w.start.slice(5, 7);
    if (month !== lastMonth && i > 0 && i < weeks.length - 2) labels.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${base + 20}" font-size="11" fill="${SUBTLE}" text-anchor="middle">${MONTHS[+month - 1]}</text>`);
    lastMonth = month;
  });
  const px = left + peak * slot + slot / 2, ph = Math.max(5, (weeks[peak].total / max) * tall);
  const peakSvg = weeks[peak].total
    ? `<g class="rise" style="animation-delay:1.4s"><text x="${px.toFixed(1)}" y="${(base - ph - 10).toFixed(1)}" font-size="11.5" font-weight="700" fill="#DB2777" text-anchor="${px > 900 ? "end" : px < 100 ? "start" : "middle"}">${fmt(weeks[peak].total)}</text></g>`
    : "";

  const updated = `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}`;
  const summary = `GitHub activity: ${fmt(data.pastYear.total)} contributions in the past year, ${fmt(allTime)} all time, current streak ${current} days, longest streak ${longest.length} days.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${summary}">
  <title>${summary}</title>
  <style>
text { font-family: ${SANS}; }
.rise { animation: rise .8s cubic-bezier(.2,.8,.2,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.grow { transform-box: fill-box; transform-origin: bottom; animation: grow .9s cubic-bezier(.2,.8,.2,1) both; }
@keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.glow { transform-box: fill-box; transform-origin: center; animation: drift 16s ease-in-out infinite alternate; }
@keyframes drift { from { transform: translate(0,0); } to { transform: translate(-120px,30px); } }
.live { transform-box: fill-box; transform-origin: center; animation: live 2.4s ease-out infinite; }
@keyframes live { 0% { opacity: .55; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(3); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <defs>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="24"/></clipPath>
    <radialGradient id="g"><stop offset="0" stop-color="#E0E7FF" stop-opacity=".9"/><stop offset="1" stop-color="#E0E7FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="h"><stop offset="0" stop-color="#FCE7F3" stop-opacity=".9"/><stop offset="1" stop-color="#FCE7F3" stop-opacity="0"/></radialGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#C4B5FD"/></linearGradient>
    <linearGradient id="peak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DB2777"/><stop offset="1" stop-color="#F9A8D4"/></linearGradient>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="#FFFFFF"/>
    <circle class="glow" cx="930" cy="10" r="230" fill="url(#g)"/>
    <circle class="glow" cx="80" cy="${H}" r="200" fill="url(#h)" style="animation-direction:alternate-reverse"/>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" stroke="${LINE}"/>
  <text x="40" y="48" font-size="17" font-weight="700" fill="${INK}">Activity</text>
  <circle class="live" cx="${960 - 6}" cy="43" r="3.5" fill="#22C55E"/>
  <circle cx="${960 - 6}" cy="43" r="3.5" fill="#22C55E"/>
  <text x="${960 - 18}" y="48" font-size="12" fill="${SUBTLE}" text-anchor="end">Updated ${updated}</text>
  ${metricSvg}
  <line x1="40" y1="176" x2="960" y2="176" stroke="${LINE}"/>
  <text x="40" y="200" font-size="11.5" font-weight="600" letter-spacing="1.2" fill="${SUBTLE}">CONTRIBUTIONS PER WEEK</text>
  ${bars.join("\n  ")}
  ${labels.join("\n  ")}
  ${peakSvg}
</svg>
`;
}

async function main() {
  const out = process.argv[2] || "dist/stats.svg";
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const svg = render(await load(LOGIN, token));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
