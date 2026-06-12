/**
 * Static Site Generator for YouTube Takeout Analyzer.
 * Fully self-contained — run from the project root where Takeout/ folder lives.
 *
 * Usage:
 *   node generate-static-site.js
 *   # outputs index.html in current directory
 */
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const moment = require("moment");

// ── Config ─────────────────────────────────────────────────────────
const WATCH_HISTORY_INPUT = "Takeout/YouTube and YouTube Music/history/watch-history.html";
const TOP_K = 10;
const TOP_VIDEOS_LIMIT = 50;

// ── Data classes ───────────────────────────────────────────────────
class HashMap {
  _map = new Map();
  computeIfAbsent(key, fn) {
    if (!this._map.has(key)) this._map.set(key, fn());
    return this._map.get(key);
  }
  values() { return [...this._map.values()]; }
  get size() { return this._map.size; }
}

class Counter {
  _map = new Map();
  increment(key, amount = 1) {
    this._map.set(key, (this._map.get(key) || 0) + amount);
  }
  entries() { return [...this._map.entries()]; }
}

class Channel {
  constructor(url, name) { this.url = url; this.name = name; this.views = 0; }
  addView() { this.views++; }
}

class Video {
  constructor(url, name, channel) { this.url = url; this.name = name; this.channel = channel; this.viewDates = []; }
  addView(date) { this.viewDates.push(date); }
  get views() { return this.viewDates.length; }
}

class View {
  wasRemoved; isYouTubeMusicVisit; isStoryView; becamePrivate;
  videoUrl; videoName; channelUrl; channelName; date;
}

// ── Parser ─────────────────────────────────────────────────────────
function parseWatchHistory(filePath) {
  const views = [];
  const html = fs.readFileSync(filePath, "utf-8");
  const $ = cheerio.load(html);
  const cells = $("body .mdl-grid .mdl-cell .mdl-grid");

  cells.each((i, elem) => {
    const view = new View();
    views.push(view);
    const content = $(".content-cell", elem).first();
    const anchors = $("a", content);
    const text = content.text();

    if (text.startsWith("Watched a video that has been removed")) {
      view.wasRemoved = true;
      return;
    } else if (text.startsWith("Visited YouTube Music")) {
      view.isYouTubeMusicVisit = true;
      return;
    } else if (text.startsWith("Watched story")) {
      view.isStoryView = true;
      return;
    }

    const videoAnchor = $(anchors.get(0));
    const videoName = videoAnchor.text();
    const videoUrl = videoAnchor.attr("href");
    if (!videoUrl) return;

    view.videoName = videoName;
    view.videoUrl = videoUrl;

    const channelAnchor = $(anchors.get(1));
    const channelUrl = channelAnchor.attr("href");
    if (!channelUrl) {
      view.becamePrivate = true;
      return;
    }

    view.channelName = channelAnchor.text();
    view.channelUrl = channelUrl;

    const htmlContent = content.html();
    const lines = htmlContent.split("<br>").map(l => l.trim()).filter(l => l);
    if (lines.length >= 3) {
      const dateStr = lines[lines.length - 1];
      const date = moment(dateStr, "D MMM YYYY, HH:mm:ss", false);
      view.date = date.isValid() ? date.toISOString() : null;
    }
  });

  return views;
}

function processViews(views) {
  const digest = {
    totalViewsCount: views.length,
    removedVideoCount: 0,
    youtubeMusicVisits: 0,
    storyViews: 0,
    videosWithoutChannel: 0,
    channelByUrl: new HashMap(),
    videoByUrl: new HashMap(),
    countByMonthYear: new Counter(),
    views,
  };

  for (const view of views) {
    if (view.wasRemoved) {
      digest.removedVideoCount++;
      continue;
    } else if (view.isYouTubeMusicVisit) {
      digest.youtubeMusicVisits++;
      continue;
    } else if (view.isStoryView) {
      digest.storyViews++;
      continue;
    } else if (!view.channelUrl) {
      digest.videosWithoutChannel++;
      continue;
    }

    const date = moment(view.date);
    const channel = digest.channelByUrl.computeIfAbsent(view.channelUrl,
      () => new Channel(view.channelUrl, view.channelName));
    const video = digest.videoByUrl.computeIfAbsent(view.videoUrl,
      () => new Video(view.videoUrl, view.videoName, channel));
    video.addView(date);
    channel.addView();
    digest.countByMonthYear.increment(date.format("YYYY-MM"));
  }

  return digest;
}

// ── Data extraction ────────────────────────────────────────────────
function getTopChannels(digest, limit = 10) {
  const channels = [...digest.channelByUrl.values()];
  channels.sort((a, b) => b.views - a.views);
  return channels.slice(0, limit).map(c => ({ name: c.name, url: c.url, views: c.views }));
}

function getTopVideos(digest, limit = 50) {
  const videos = [...digest.videoByUrl.values()];
  videos.sort((a, b) => b.views - a.views);
  return videos.slice(0, limit).map(v => ({
    name: v.name, url: v.url, channel: v.channel?.name || "Unknown", views: v.views,
  }));
}

function getViewsByMonth(digest) {
  const entries = [...digest.countByMonthYear.entries()];
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([month, count]) => ({ month, count }));
}

function getChannelProgression(digest, topK = 10) {
  const channels = getTopChannels(digest, topK).map(c => c.name);
  const channelSet = new Set(channels);
  const monthMap = {};
  for (const view of digest.views) {
    if (!view.channelName || !view.date || !channelSet.has(view.channelName)) continue;
    const month = view.date.substring(0, 7);
    if (!monthMap[month]) monthMap[month] = {};
    monthMap[month][view.channelName] = (monthMap[month][view.channelName] || 0) + 1;
  }
  const months = Object.keys(monthMap).sort();
  return {
    channels,
    rows: months.map(m => ({ month: m, ...monthMap[m] })),
  };
}

// ── HTML template ──────────────────────────────────────────────────
function generateHtml(data) {
  const DATA_JSON = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YouTube Takeout Analyzer</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;800&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0f;--bg2:#111118;--card:#151520;--card-h:#1a1a28;--border:#2a2a3a;--border-g:#00e5ff33;--txt:#e0e0f0;--txt2:#8888aa;--txt3:#555570;--accent:#00e5ff;--red:#ff3355;--font-d:'Orbitron',monospace;--font-b:'Inter',system-ui,sans-serif}
html{font-size:16px;scroll-behavior:smooth}
body{font-family:var(--font-b);background:var(--bg);color:var(--txt);min-height:100vh;line-height:1.6;overflow-x:hidden}
.scanline{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,229,255,.015) 2px,rgba(0,229,255,.015) 4px);z-index:9999}
.container{max-width:1400px;margin:0 auto;padding:0 24px}
.header{padding:32px 0 24px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,var(--bg2),var(--bg));position:relative}
.header::after{content:'';position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:60%;height:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent)}
.hc{display:flex;flex-direction:column;gap:4px}
.title{font-family:var(--font-d);font-size:1.75rem;font-weight:800;letter-spacing:.15em;text-transform:uppercase;background:linear-gradient(135deg,var(--accent),var(--txt));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.sub{font-family:var(--font-d);font-size:.75rem;color:var(--txt3);letter-spacing:.2em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:32px 0}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px 20px;text-align:center;transition:all .3s ease;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--accent),transparent);opacity:0;transition:opacity .3s}
.card:hover{background:var(--card-h);border-color:var(--border-g);transform:translateY(-2px)}
.card:hover::before{opacity:1}
.ci{font-size:1.5rem;margin-bottom:8px;opacity:.8}
.cv{font-family:var(--font-d);font-size:2rem;font-weight:800;color:var(--accent);line-height:1.2}
.cl{font-size:.75rem;color:var(--txt2);text-transform:uppercase;letter-spacing:.1em;margin-top:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
.sec{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px;transition:border-color .3s}
.sec:hover{border-color:var(--border-g)}
.sec.wide{grid-column:1/-1}
.st{font-family:var(--font-d);font-size:.85rem;font-weight:600;color:var(--accent);letter-spacing:.15em;margin-bottom:20px;text-transform:uppercase}
.cc{position:relative;width:100%;min-height:300px}
.cc canvas{width:100%!important;height:auto!important;max-height:400px}
.tc{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{font-family:var(--font-d);font-size:.7rem;letter-spacing:.15em;color:var(--txt3);text-align:left;padding:12px 16px;border-bottom:1px solid var(--border);text-transform:uppercase}
td{padding:10px 16px;border-bottom:1px solid rgba(42,42,58,.5);color:var(--txt2);transition:color .2s}
tr:hover td{color:var(--txt);background:rgba(0,229,255,.02)}
tr td:first-child{color:var(--txt3);font-family:var(--font-d);font-size:.75rem;width:40px}
tr td:nth-child(2){color:var(--txt);font-weight:500}
a{color:inherit;text-decoration:none;transition:color .2s}
a:hover{color:var(--accent)}
.ft{margin-top:60px;padding:24px 0;border-top:1px solid var(--border);text-align:center}
.ft p{color:var(--txt3);font-size:.75rem;letter-spacing:.05em}
@media(max-width:900px){.grid{grid-template-columns:1fr}.cards{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.title{font-size:1.3rem}}
@media(max-width:480px){.cards{grid-template-columns:repeat(2,1fr)}.cv{font-size:1.5rem}}
</style>
</head>
<body>
<div class="scanline"></div>
<header class="header"><div class="container"><div class="hc"><h1 class="title">YOUTUBE TAKEOUT ANALYZER</h1><p class="sub">// STATIC DASHBOARD</p></div></div></header>
<main class="container">
<section class="cards" id="cards"></section>
<div class="grid">
<section class="sec wide"><h2 class="st">// TOP CHANNELS</h2><div class="cc"><canvas id="ch"></canvas></div></section>
<section class="sec"><h2 class="st">// VIEWS BY MONTH</h2><div class="cc"><canvas id="bm"></canvas></div></section>
<section class="sec"><h2 class="st">// CHANNEL PROGRESSION</h2><div class="cc"><canvas id="pr"></canvas></div></section>
</div>
<section class="sec"><h2 class="st">// TOP VIDEOS</h2><div class="tc"><table id="tv"><thead><tr><th>#</th><th>Video</th><th>Channel</th><th>Views</th></tr></thead><tbody></tbody></table></div></section>
</main>
<footer class="ft"><div class="container"><p>YouTube Takeout Analyzer • Static Dashboard</p></div></footer>
<script>
const DATA = ${DATA_JSON};
Chart.defaults.color='#8888aa';Chart.defaults.borderColor='#2a2a3a';Chart.defaults.font.family="'Inter', system-ui, sans-serif";
const C=['#00e5ff','#ff6b35','#00ff88','#ffd700','#ff3355','#7c4dff','#ff9100','#00e676','#ea80fc','#40c4ff','#ff6f00','#69f0ae','#b388ff','#4dd0e1','#ffab40'];
const gi=i=>C[i%C.length];let ci={};
function cards(s){const m=[['totalViews','👁','Total Views'],['uniqueVideos','🎬','Unique Videos'],['uniqueChannels','📺','Channels'],['removedVideos','💀','Removed'],['videosWithoutChannel','🔒','Private']];document.getElementById('cards').innerHTML=m.map(([k,ic,lb])=>'<div class="card"><div class="ci">'+ic+'</div><div class="cv">'+((s[k]||0).toLocaleString())+'</div><div class="cl">'+lb+'</div></div>').join('')}
function tc(d){const ctx=document.getElementById('ch').getContext('2d');if(ci.ch)ci.ch.destroy();ci.ch=new Chart(ctx,{type:'bar',data:{labels:d.map(c=>c.name),datasets:[{label:'Views',data:d.map(c=>c.views),backgroundColor:d.map((_,i)=>gi(i)+'66'),borderColor:d.map((_,i)=>gi(i)),borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0},grid:{color:'#2a2a3a44'}},x:{grid:{display:false},ticks:{maxRotation:45,font:{size:10}}}}}})}
function bm(d){const ctx=document.getElementById('bm').getContext('2d');if(ci.bm)ci.bm.destroy();ci.bm=new Chart(ctx,{type:'line',data:{labels:d.map(x=>x.month),datasets:[{label:'Views',data:d.map(x=>x.count),borderColor:'#00e5ff',backgroundColor:'#00e5ff22',fill:true,tension:.3,pointRadius:3,pointBackgroundColor:'#00e5ff',pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0},grid:{color:'#2a2a3a44'}},x:{grid:{display:false},ticks:{maxTicksLimit:15,font:{size:9}}}},interaction:{intersect:false,mode:'index'}}})}
function pr(d){const ctx=document.getElementById('pr').getContext('2d');if(ci.pr)ci.pr.destroy();ci.pr=new Chart(ctx,{type:'line',data:{labels:d.rows.map(r=>r.month),datasets:d.channels.map((ch,i)=>({label:ch,data:d.rows.map(r=>r[ch]||0),borderColor:gi(i),backgroundColor:gi(i)+'22',fill:false,tension:.3,pointRadius:2,pointHoverRadius:5}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12,padding:12,font:{size:10},color:'#8888aa'}}},scales:{y:{beginAtZero:true,ticks:{precision:0},grid:{color:'#2a2a3a44'}},x:{grid:{display:false},ticks:{maxTicksLimit:12,font:{size:9}}}},interaction:{intersect:false,mode:'index'}}})}
function tv(d){document.querySelector('#tv tbody').innerHTML=d.map((v,i)=>'<tr><td>'+(i+1)+'</td><td><a href="'+(v.url||'#')+'" target="_blank">'+e(v.name)+'</a></td><td>'+e(v.channel)+'</td><td>'+v.views+'</td></tr>').join('')}
function e(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
cards(DATA.summary);tc(DATA.topChannels);bm(DATA.byMonth);pr(DATA.channelProgression);tv(DATA.topVideos);
</script>
</body>
</html>`;
}

// ── Main ───────────────────────────────────────────────────────────
(function() {
  const inputPath = path.resolve(WATCH_HISTORY_INPUT);
  if (!fs.existsSync(inputPath)) {
    console.error("❌ Takeout data not found at:", inputPath);
    console.error("   Place your YouTube Takeout watch-history.html in:");
    console.error("   " + path.dirname(inputPath));
    process.exit(1);
  }

  console.log("📂 Reading:", inputPath);
  const views = parseWatchHistory(inputPath);
  console.log(`📊 Parsed ${views.length} entries`);

  const digest = processViews(views);
  console.log(`   • ${digest.totalViewsCount} total views`);
  console.log(`   • ${digest.videoByUrl.size} unique videos`);
  console.log(`   • ${digest.channelByUrl.size} channels`);
  console.log(`   • ${digest.removedVideoCount} removed, ${digest.videosWithoutChannel} private`);

  const data = {
    summary: {
      totalViews: digest.totalViewsCount,
      uniqueVideos: digest.videoByUrl.size,
      uniqueChannels: digest.channelByUrl.size,
      removedVideos: digest.removedVideoCount,
      videosWithoutChannel: digest.videosWithoutChannel,
    },
    topChannels: getTopChannels(digest, TOP_K),
    topVideos: getTopVideos(digest, TOP_VIDEOS_LIMIT),
    byMonth: getViewsByMonth(digest),
    channelProgression: getChannelProgression(digest, TOP_K),
  };

  const html = generateHtml(data);
  const outPath = path.resolve("index.html");
  fs.writeFileSync(outPath, html);
  console.log(`\n✅ Dashboard generated: ${outPath}`);
  console.log(`   Size: ${(html.length / 1024).toFixed(1)} KB`);
  console.log("   Open in browser or deploy to GitHub Pages!");
})();
