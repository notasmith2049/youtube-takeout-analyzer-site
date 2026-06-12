const fs = require("fs");
const cheerio = require("cheerio");
const moment = require("moment");

const $ = cheerio.load(fs.readFileSync("Takeout/YouTube and YouTube Music/history/watch-history.html", "utf-8"));
const dates = [];
$("body .mdl-grid .mdl-cell .mdl-grid").each((i, elem) => {
  const content = $(".content-cell", elem).first();
  const text = content.text();
  if (text.startsWith("Watched a video that has been removed") || text.startsWith("Visited YouTube Music") || text.startsWith("Watched story")) return;
  const anchors = $("a", content);
  const videoAnchor = $(anchors.get(0));
  const videoUrl = videoAnchor.attr("href");
  if (!videoUrl) return;
  const channelAnchor = $(anchors.get(1));
  const channelUrl = channelAnchor.attr("href");
  if (!channelUrl) return;
  const htmlContent = content.html();
  const lines = htmlContent.split("<br>").map(l => l.trim()).filter(l => l);
  if (lines.length >= 3) {
    const dateStr = lines[lines.length - 1];
    const date = moment(dateStr, "D MMM YYYY, HH:mm:ss", false);
    if (date.isValid()) dates.push(date);
  }
});

const min = moment.min(dates);
const max = moment.max(dates);
console.log("Min:", min.format("MMM YYYY"));
console.log("Max:", max.format("MMM YYYY"));
console.log("Range:", min.format("MMM YYYY") + " — " + max.format("MMM YYYY"));
