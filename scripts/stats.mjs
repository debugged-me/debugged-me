// Draws the "Activity" card for the profile README from live GitHub data.
// Runs in GitHub Actions: GITHUB_TOKEN=... node scripts/stats.mjs dist/stats.svg
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const LOGIN = process.env.PROFILE_USER || "debugged-me";

const INK = "#37352F";
const GREY = "#787774";
const FAINT = "#9B9A97";
const LINE = "#E9E9E7";
const SANS = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

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
  const W = 1000, H = 350;
  const allTime = Object.values(data.years).reduce((sum, y) => sum + y.total, 0);
  const { current, longest } = streaks(data.years, now.toISOString().slice(0, 10));
  const days = (n) => (n === 1 ? " day" : " days");

  const metrics = [
    [fmt(data.pastYear.total), "", "Contributions, past year"],
    [fmt(allTime), "", "Contributions, all time"],
    [fmt(current), days(current), "Current streak"],
    [fmt(longest.length), days(longest.length), longest.length ? `Longest streak · ${shortDate(longest.start)} – ${shortDate(longest.end)}` : "Longest streak"],
  ];
  const col = 230;
  const metricSvg = metrics.map(([num, unit, label], i) => `
    <g class="fade" style="animation-delay:${0.1 + i * 0.08}s">
      ${i ? `<line x1="${40 + i * col - 20}" y1="92" x2="${40 + i * col - 20}" y2="152" stroke="${LINE}"/>` : ""}
      <text x="${40 + i * col}" y="${i ? 106 : 106}" font-size="13" fill="${GREY}">${label}</text>
      <text x="${40 + i * col}" y="144" font-size="32" font-weight="700" letter-spacing="-.5" fill="${INK}">${num}<tspan font-size="16" font-weight="500" letter-spacing="0" fill="${GREY}">${unit}</tspan></text>
    </g>`).join("");

  // Weekly totals for the last 52 weeks.
  const weeks = data.pastYear.weeks.slice(-52).map((w) => ({ start: w[0].date, total: w.reduce((s, d) => s + d.count, 0) }));
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const peak = weeks.reduce((best, w, i) => (w.total > weeks[best].total ? i : best), 0);
  const left = 40, right = 960, base = 312, tall = 92;
  const slot = (right - left) / weeks.length, bw = Math.min(11, slot * 0.6);
  let lastMonth = null;
  const bars = [], labels = [];
  weeks.forEach((w, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const h = w.total ? Math.max(4, (w.total / max) * tall) : 2;
    const fill = !w.total ? "#F1F1EF" : i === peak ? INK : "#D3D1CB";
    bars.push(`<rect class="grow" style="animation-delay:${(0.3 + i * 0.018).toFixed(3)}s" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"/>`);
    const month = w.start.slice(5, 7);
    if (month !== lastMonth && i > 0 && i < weeks.length - 2) labels.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${base + 20}" font-size="11.5" fill="${FAINT}" text-anchor="middle">${MONTHS[+month - 1]}</text>`);
    lastMonth = month;
  });
  const px = left + peak * slot + slot / 2, ph = Math.max(4, (weeks[peak].total / max) * tall);
  const anchor = px > 900 ? "end" : px < 100 ? "start" : "middle";
  const peakSvg = weeks[peak].total
    ? `<g class="fade" style="animation-delay:1.4s"><text x="${px.toFixed(1)}" y="${(base - ph - 9).toFixed(1)}" font-size="12" font-weight="600" fill="${INK}" text-anchor="${anchor}">${fmt(weeks[peak].total)}</text></g>`
    : "";

  const updated = `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}`;
  const summary = `GitHub activity: ${fmt(data.pastYear.total)} contributions in the past year, ${fmt(allTime)} all time, current streak ${current} days, longest streak ${longest.length} days.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${summary}">
  <title>${summary}</title>
  <style>
text { font-family: ${SANS}; }
.fade { animation: fade .8s ease-out both; }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.grow { transform-box: fill-box; transform-origin: bottom; animation: grow .9s cubic-bezier(.2,.8,.2,1) both; }
@keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.live { transform-box: fill-box; transform-origin: center; animation: live 2.4s ease-out infinite; }
@keyframes live { 0% { opacity: .6; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(2.6); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="11.5" fill="#FFFFFF" stroke="${LINE}"/>
  <g fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M41 34 v14 h16 M45 44 l4 -4 3 3 5 -6"/></g>
  <text x="66" y="47" font-size="16" font-weight="600" fill="${INK}">Activity</text>
  <circle class="live" cx="${960 - 5}" cy="42.5" r="3.4" fill="#6C9B7D"/>
  <circle cx="${960 - 5}" cy="42.5" r="3.4" fill="#6C9B7D"/>
  <text x="${960 - 16}" y="47" font-size="12.5" fill="${FAINT}" text-anchor="end">Updated ${updated}</text>
  <line x1="40" y1="68" x2="960" y2="68" stroke="${LINE}"/>
  ${metricSvg}
  <text x="40" y="200" font-size="13" fill="${GREY}">Contributions per week</text>
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
