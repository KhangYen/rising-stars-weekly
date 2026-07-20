// Rising Stars Weekly — digest generator.
// Runs weekly in GitHub Actions (free cron); no dependencies, Node 20+.
//
// Consumes RepoRadar's published snapshot data (same author, ToS-clean:
// our own star-history measurements, not scraped trending pages):
//   https://khangyen.github.io/repo-radar/history.json  {repo: [{d,s},...]}
//   https://khangyen.github.io/repo-radar/data.json     {generated, repos}
// and writes digests/YYYY-MM-DD.md plus a README.md refresh.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIGESTS = path.join(ROOT, "digests");
const SOURCES = [
  "https://khangyen.github.io/repo-radar",
  "https://raw.githubusercontent.com/KhangYen/repo-radar/main/docs",
];
const WINDOW_DAYS = 7;
const TOP_N = 25;

async function fetchJson(file) {
  let lastErr;
  for (const base of SOURCES) {
    try {
      const res = await fetch(`${base}/${file}`, {
        headers: { "User-Agent": "RisingStarsWeekly (github.com/KhangYen/rising-stars-weekly)" },
      });
      if (!res.ok) throw new Error(`${res.status} ${base}/${file}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

async function main() {
  const [history, data] = await Promise.all([
    fetchJson("history.json"),
    fetchJson("data.json"),
  ]);
  const meta = new Map((data.repos || []).map(r => [r.full_name, r]));

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);

  const movers = [];
  for (const [name, snaps] of Object.entries(history)) {
    // earliest snapshot inside the window vs the latest one
    const inWindow = snaps.filter(x => x.d >= cutoff);
    if (inWindow.length < 2) continue;
    const first = inWindow[0], last = inWindow[inWindow.length - 1];
    const gained = last.s - first.s;
    if (gained <= 0) continue;
    const spanDays = Math.max(1, Math.round((Date.parse(last.d) - Date.parse(first.d)) / 864e5));
    movers.push({ name, gained, stars: last.s, spanDays, meta: meta.get(name) });
  }

  if (!movers.length) {
    console.log("No repos with >=2 in-window snapshots yet — nothing to publish.");
    return;
  }

  movers.sort((a, b) => b.gained - a.gained);
  const top = movers.slice(0, TOP_N);
  const maxSpan = Math.max(...top.map(x => x.spanDays));

  const lines = [];
  lines.push(`# Rising stars — ${today}`);
  lines.push("");
  lines.push(
    `Top ${top.length} GitHub repos by stars gained over the last ` +
    `${maxSpan} day${maxSpan === 1 ? "" : "s"}, measured from ` +
    `[RepoRadar](https://khangyen.github.io/repo-radar/)'s own daily snapshots.`
  );
  lines.push("");
  top.forEach((x, i) => {
    const m = x.meta || {};
    const desc = m.description ? ` — ${m.description}` : "";
    const lang = m.language ? ` \`${m.language}\`` : "";
    lines.push(
      `${i + 1}. **[${x.name}](https://github.com/${x.name})** ` +
      `+${fmt(x.gained)} ★ (${fmt(x.stars)} total)${lang}${desc}`
    );
    if (m.hn) {
      lines.push(`   - HN: [${m.hn.title}](${m.hn.url}) (${m.hn.points} points)`);
    }
  });
  lines.push("");
  lines.push(
    "*Generated automatically from repos that stayed on RepoRadar's radar " +
    "all week; brand-new entries appear once they have a week of history.*"
  );
  lines.push("");

  fs.mkdirSync(DIGESTS, { recursive: true });
  fs.writeFileSync(path.join(DIGESTS, `${today}.md`), lines.join("\n"));

  // README = latest digest + archive index
  const archive = fs.readdirSync(DIGESTS)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse();
  const readme = [];
  readme.push("# ⭐ Rising Stars Weekly");
  readme.push("");
  readme.push(
    "A weekly digest of the GitHub repos gaining stars fastest, computed " +
    "from [RepoRadar](https://khangyen.github.io/repo-radar/)'s daily " +
    "star-history snapshots (not scraped trending pages). Updates every " +
    "Sunday via GitHub Actions. **Watch this repo** to get it in your feed."
  );
  readme.push("");
  readme.push("---");
  readme.push("");
  readme.push(lines.join("\n"));
  readme.push("## Past weeks");
  readme.push("");
  for (const f of archive) {
    readme.push(`- [${f.replace(".md", "")}](digests/${f})`);
  }
  readme.push("");
  fs.writeFileSync(path.join(ROOT, "README.md"), readme.join("\n"));

  console.log(
    `Wrote digest ${today}: ${top.length} repos, top mover ${top[0].name} ` +
    `(+${top[0].gained}), window ${maxSpan}d, archive ${archive.length}.`
  );
}

main().catch(e => { console.error(e); process.exitCode = 1; });
