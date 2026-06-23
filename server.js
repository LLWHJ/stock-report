import express from 'express';
import https from 'node:https';
import iconv from 'iconv-lite';

const app = express();
const PORT = process.env.PORT || 3131;
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));

/* === HTTP fetch (returns Buffer) === */
function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': '*/*', ...extraHeaders },
    };
    const req = https.get(url, opts, res => {
      const c = []; res.on('data', b => c.push(b)); res.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/* === Ticker resolution === */
function resolveTicker(t) {
  const u = t.toUpperCase();
  if (u.endsWith('.SS')) return { market: 'sh', code: u.replace('.SS', ''), type: 'cn' };
  if (u.endsWith('.SZ')) return { market: 'sz', code: u.replace('.SZ', ''), type: 'cn' };
  if (u.endsWith('.HK')) return { market: 'hk', code: u.replace('.HK', ''), type: 'hk' };
  return { market: 'us', code: u, type: 'us' };
}

/* === Tencent QQ (A-shares / HK) === */
async function tencentQuote(market, code) {
  const key = market + code;
  const buf = await httpGet('https://qt.gtimg.cn/q=' + key, { 'Referer': 'https://gu.qq.com/' });
  const text = iconv.decode(buf, 'gbk');
  const m = text.match(/"([^"]+)"/);
  if (!m) throw new Error('Empty Tencent response');
  const p = m[1].split('~');
  const cur = +p[3], prev = +p[4], opn = +p[5], vol = +p[6] * 100;
  return { name: p[1], current: cur, prevClose: prev, open: opn, volume: vol, change: cur - prev, changePercent: prev ? (cur - prev) / prev * 100 : 0, high: Math.max(cur, opn, prev), low: Math.min(cur, opn, prev) };
}

async function tencentKline(market, code) {
  const key = market + code;
  const buf = await httpGet('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + key + ',day,,,60,qfq', { 'Referer': 'https://gu.qq.com/' });
  const text = iconv.decode(buf, 'gbk');
  const d = JSON.parse(text);
  const klines = d?.data?.[key]?.day || d?.data?.[key]?.qfqday || [];
  return klines.map(k => ({ date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +k[5] * 100 }));
}

/* === Sina (US stocks) === */
async function sinaQuote(code) {
  const buf = await httpGet('https://hq.sinajs.cn/list=gb_' + code.toLowerCase(), { 'Referer': 'https://finance.sina.com.cn' });
  const text = iconv.decode(buf, 'gbk');
  const m = text.match(/"([^"]+)"/);
  if (!m) throw new Error('Empty Sina response');
  const p = m[1].split(',');
  const cur = +p[1], chgAmt = +p[4], opn = +p[5], high = +p[6], low = +p[7], vol = +p[10];
  return { name: p[0], current: cur, prevClose: cur - chgAmt, open: opn, volume: vol, change: chgAmt, changePercent: +p[2], high, low };
}

/* === Technical indicators === */
function calcMA(d, n) { const r = []; for (let i = 0; i < d.length; i++) { if (i < n - 1) { r.push(null); continue; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += d[j]; r.push(s / n); } return r; }
function calcRSI(d, n) { const ch = []; for (let i = 1; i < d.length; i++) ch.push(d[i] - d[i - 1]); const r = []; let ag = 0, al = 0; for (let i = 0; i < ch.length; i++) { const g = ch[i] > 0 ? ch[i] : 0, l = ch[i] < 0 ? -ch[i] : 0; if (i < n) { ag += g; al += l; if (i === n - 1) { ag /= n; al /= n; r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al)); } else r.push(null); } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al)); } } return [null, ...r]; }
function calcChg(d, n) { return d.length < n + 1 ? null : ((d[d.length - 1] - d[d.length - 1 - n]) / d[d.length - 1 - n]) * 100; }

/* === Sentiment & Recommendation === */
const POS_W = ['surge','soar','gain','up','rise','growth','profit','positive','bullish','upgrade','beat','outperform','strong','record','dividend','buy','optimistic','突破','上涨','增长','利好','盈利','买入','看涨'];
const NEG_W = ['drop','fall','decline','down','loss','negative','bearish','downgrade','miss','underperform','weak','cut','sell','crash','plunge','下滑','下跌','亏损','利空','卖出','看跌','风险','减持'];
function simpleSent(t) { const s = t.toLowerCase(); let sc = 0; POS_W.forEach(w => { if (s.includes(w)) sc++; }); NEG_W.forEach(w => { if (s.includes(w)) sc--; }); return sc > 0 ? 'positive' : sc < 0 ? 'negative' : 'neutral'; }
function genRec({ closes, ma5, ma10, ma20, rsi, changes, news }) {
  const lr = rsi?.[rsi.length - 1], lc = closes?.[closes.length - 1], m5 = ma5?.[ma5.length - 1], m10 = ma10?.[ma10.length - 1], m20 = ma20?.[ma20.length - 1];
  let b = 0, s = 0; const rs = [];
  if (lr != null && !isNaN(lr)) { if (lr < 30) { b++; rs.push('RSI超卖(<30)'); } if (lr > 70) { s++; rs.push('RSI超买(>70)'); } }
  if (m5 != null && m10 != null) { if (m5 > m10) { b++; rs.push('MA5>MA10(短多)'); } else { s++; rs.push('MA5<MA10(短空)'); } }
  if (m10 != null && m20 != null) { if (m10 > m20) { b++; rs.push('MA10>MA20(中多)'); } else { s++; rs.push('MA10<MA20(中空)'); } }
  if (lc != null && m20 != null) { if (lc > m20) { b++; rs.push('价格>MA20'); } else { s++; rs.push('价格<MA20'); } }
  if (changes?.d5 != null) { if (changes.d5 > 8) { s++; rs.push('5日涨>8%'); } if (changes.d5 < -8) { b++; rs.push('5日跌>8%'); } }
  if (news && news.length) { const pn = news.filter(n => n.sentiment === 'positive').length, nn = news.filter(n => n.sentiment === 'negative').length; if (pn > nn + 1) { b++; rs.push('利好新闻多'); } if (nn > pn + 1) { s++; rs.push('利空新闻多'); } }
  let action, conf;
  if (b > s + 1) { action = 'buy'; conf = Math.min(+(b / (b + s)).toFixed(2), 0.85) * 100; rs.unshift('📈 买入信号占优'); }
  else if (s > b + 1) { action = 'sell'; conf = Math.min(+(s / (b + s)).toFixed(2), 0.85) * 100; rs.unshift('📉 卖出信号占优'); }
  else { action = 'hold'; conf = 50; rs.unshift('⚖️ 多空均衡'); }
  return { action, confidence: Math.round(conf), signals: { buy: b, sell: s }, reasons: rs };
}

/* === News === */
async function fetchNews(code) {
  try {
  const buf = await httpGet('https://news.google.com/rss/search?q=' + encodeURIComponent(code + ' stock') + '&hl=en-US&gl=US&ceid=US:en');
  const text = iconv.decode(buf, 'utf-8');
    const items = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
    while ((m = re.exec(text)) !== null && items.length < 5) {
      const t = m[1]; const title = t.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] || ''; const link = t.match(/<link[^>]*>([^<]*)<\/link>/)?.[1] || ''; const pub = t.match(/<pubDate[^>]*>([^<]*)<\/pubDate>/)?.[1] || '';
      if (title && !title.startsWith('<!')) items.push({ title, link, published: pub, sentiment: simpleSent(title) });
    }
    return items;
  } catch { return []; }
}

/* === API endpoint === */
app.get('/api/report', async (req, res) => {
  const raw = req.query.ticker;
  if (!raw) return res.status(400).json({ error: '请提供股票代码' });
  try {
    const rt = resolveTicker(raw.trim());
    let price, history = [];

    if (rt.type === 'cn' || rt.type === 'hk') {
      price = await tencentQuote(rt.market, rt.code);
      try { const kl = await tencentKline(rt.market, rt.code); if (kl.length >= 5) { history = kl; const last = kl[kl.length - 1]; price.high = last.high; price.low = last.low; price.open = last.open; } } catch {}
    } else {
      price = await sinaQuote(rt.code);
    }

    const closes = history.map(d => d.close).filter(c => c != null);
    let ma5 = [], ma10 = [], ma20 = [], rsi = [], changes = {};
    if (closes.length >= 5) {
      ma5 = calcMA(closes, 5); ma10 = calcMA(closes, 10); ma20 = calcMA(closes, 20); rsi = calcRSI(closes, 14);
      changes = { d1: calcChg(closes, 1), d5: calcChg(closes, 5), m1: calcChg(closes, 22), m3: calcChg(closes, Math.min(66, closes.length - 1)) };
    }

    // Fire & forget news
    let news = []; fetchNews(rt.code).then(n => { news = n; }).catch(() => {});

    const rec = genRec({ closes, ma5, ma10, ma20, rsi, changes, news });

    res.json({
      price: { current: price.current, change: price.change, changePercent: price.changePercent, high: price.high, low: price.low, open: price.open, prevClose: price.prevClose, volume: price.volume, name: price.name, currency: rt.type === 'us' ? 'USD' : 'CNY' },
      history: history.length ? history : [],
      indicators: closes.length >= 5 ? { ma5: ma5[ma5.length - 1], ma10: ma10[ma10.length - 1], ma20: ma20[ma20.length - 1], rsi: rsi[rsi.length - 1] } : {},
      changes, news, recommendation: rec,
    });
  } catch (err) {
    res.status(500).json({ error: '获取数据失败: ' + err.message });
  }
});

app.listen(PORT, () => console.log('📈 Stock Report → http://localhost:' + PORT));
