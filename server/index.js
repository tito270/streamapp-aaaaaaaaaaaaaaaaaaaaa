// Temporarily suppress console output while dotenv prints its startup tip
const _consoleLog = console.log;
const _consoleError = console.error;
console.log = () => {};
console.error = () => {};
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
// restore console functions for normal server logging
console.log = _consoleLog;
console.error = _consoleError;

// server/index.js
const express = require('express');
const cors = require('cors');
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');

console.log = () => {};
console.error = () => {};

const app = express();
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ---------- Logging Utilities ----------
const logsDir = path.join(__dirname, '..', 'server', 'logs');
// Ensure logs directory exists at startup
try {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {
  console.error('Failed to create logs directory:', e);
}
const streamNameMap = new Map(); // streamId -> streamName
const userStreamOwnership = new Map(); // username -> Set<streamId>

function cleanupUserStreams(username) {
  if (!username) return;
  const streamIds = userStreamOwnership.get(username);
  if (streamIds && streamIds.size > 0) {
    console.log(`Cleaning up streams for user: ${username}`);
    for (const streamId of streamIds) {
      cleanupStream(streamId);
    }
    userStreamOwnership.delete(username);
  }
}
app.locals.cleanupUserStreams = cleanupUserStreams;

const streamIssueState = new Map(); // streamId -> { startTime: number }
const procCleanupMap = new Map(); // streamId -> cleanup function for ffmpeg process listeners

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_');
}

// Format server-local time with timezone offset: YYYY-MM-DD HH:MM:SS ±HH:MM
function formatServerTime(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  const offsetMin = -d.getTimezoneOffset(); // minutes ahead of UTC
  const sign = offsetMin >= 0 ? '+' : '-';
  const offHours = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offMins = pad(Math.abs(offsetMin) % 60);
  return `${year}-${month}-${day} ${hours}:${mins}:${secs} ${sign}${offHours}:${offMins}`;
}

// Format duration ms -> H:MM:SS (or MM:SS if <1h)
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

// ---------- Bitrate reader ----------
function logBitrate(ffmpegProcess, streamId) {
  let lastSize = 0;
  let lastTime = 0;

  const onStdout = (data) => {
    // ignore if this stream was marked deleted
    if (deletedStreams.has(streamId)) return;
    const info = activeStreams.get(streamId);
    if (!info || !info.proc || info.proc.pid !== ffmpegProcess.pid) return;

    const lines = data.toString().trim().split('\n');
    let totalSize, outTime;
    for (const line of lines) {
      if (line.startsWith('total_size=')) totalSize = parseInt(line.split('=')[1], 10);
      if (line.startsWith('out_time_ms=')) outTime = parseInt(line.split('=')[1], 10);
    }

    if (totalSize && outTime) {
      if (lastSize > 0 && lastTime > 0) {
        const bytesDiff = totalSize - lastSize;
        const timeDiff = (outTime - lastTime) / 1e6;
        if (timeDiff > 0) {
          const bitrateBps = (bytesDiff / timeDiff) * 8;
          const bitrateMbps = parseFloat((bitrateBps / 1e6).toFixed(2));

          try {
            bitrateMap.set(streamId, bitrateMbps);
            const hist = bitrateHistoryMap.get(streamId) || [];
            hist.push({ time: Date.now(), bitrate: bitrateMbps, estimated: false });
            if (hist.length > 3600) hist.shift();
            bitrateHistoryMap.set(streamId, hist);
            lastUpdateMap.set(streamId, Date.now());

            const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
            console.log(`Stream ${streamId} 📊 Bitrate: ${bitrateMbps} Mbps`);
            // persist bitrate and possible issue resolution to logs
            try { writeBitrateLog(streamId, `${formatServerTime()} Bitrate: ${bitrateMbps} Mbps`); } catch (e) {}
            try {
              if (streamIssueState.has(streamId)) {
                const endTime = Date.now();
                try {
                  const { startTime } = streamIssueState.get(streamId) || { startTime: endTime };
                  const dur = endTime - startTime;
                  writeIssueLog(streamId, `Signal Loss End: ${formatServerTime(endTime)} (Duration: ${formatDuration(dur)})`);
                } catch (_) {
                  writeIssueLog(streamId, `Signal Loss End: ${formatServerTime(endTime)}`);
                }
                streamIssueState.delete(streamId);
              }
            } catch (e) {}
            broadcastEvent({ type: 'bitrate', streamId, sourceUrl: streamUrlMap.get(streamId) || null, streamUrl: streamUrlMap.get(streamId) || null, hlsUrl: hlsPath, hlsAbsUrl, bitrate: bitrateMbps, estimated: false });
          } catch (e) {
            // ignore errors during logging/broadcast
          }
        }
      }
      lastSize = totalSize;
      lastTime = outTime;
    }
  };

  const onStderr = (chunk) => {
    if (deletedStreams.has(streamId)) return;
    const text = String(chunk.toString()).trim();
    if (!text) return;
    broadcastEvent({ type: 'ffmpeg-log', streamId, log: text });
  };

  ffmpegProcess.stdout.on('data', onStdout);
  try { ffmpegProcess.stderr.on('data', onStderr); } catch (e) { /* ignore */ }

  const cleanupListeners = () => {
    try { ffmpegProcess.stdout.removeListener('data', onStdout); } catch (_) {}
    try { ffmpegProcess.stderr.removeListener('data', onStderr); } catch (_) {}
  };

  // Store cleanup so callers can remove listeners immediately
  procCleanupMap.set(streamId, cleanupListeners);

  ffmpegProcess.on('close', () => {
    try { cleanupListeners(); } catch (_) {}
    procCleanupMap.delete(streamId);
  });
  ffmpegProcess.on('error', () => {
    try { cleanupListeners(); } catch (_) {}
    procCleanupMap.delete(streamId);
  });
}

function getStreamLogDir(streamId) {
  const streamName = streamNameMap.get(streamId) || streamId;
  const sanitizedStreamName = sanitizeFilename(streamName);
  const streamLogDir = path.join(logsDir, sanitizedStreamName);
  if (!fs.existsSync(streamLogDir)) {
    fs.mkdirSync(streamLogDir, { recursive: true });
  }
  return streamLogDir;
}

function dateSuffix() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function logFilenameFor(streamId, type) {
  // type: 'bitrate' or 'issues' -> TitleCase prefix
  const prefix = type === 'bitrate' ? 'Bitrate' : (type === 'issues' ? 'Issue' : type);
  const streamName = streamNameMap.get(streamId) || streamId;
  const sanitizedStreamName = sanitizeFilename(streamName);
  return `${prefix}-${sanitizedStreamName}-${dateSuffix()}.log`;
}

function writeBitrateLog(streamId, message) {
  try {
  const logPath = path.join(getStreamLogDir(streamId), logFilenameFor(streamId, 'bitrate'));
    fs.appendFileSync(logPath, message + '\n', 'utf8');
  } catch (error) {
    console.error('Failed to write to bitrate log file:', error);
  }
}

function writeIssueLog(streamId, message) {
  try {
  const logPath = path.join(getStreamLogDir(streamId), logFilenameFor(streamId, 'issues'));
    fs.appendFileSync(logPath, message + '\n', 'utf8');
  } catch (error) {
    console.error('Failed to write to issue log file:', error);
  }
}



// ---------- Detect machine IP (override with HOST_IP) ----------
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i && i.family === 'IPv4' && !i.internal && !String(i.address).startsWith('169.254.')) {
        return i.address;
      }
    }
  }
  return '127.0.0.1';
}
const HOST_IP = process.env.HOST_IP || getLocalIp();

// ---------- SSE ----------
// Map of response -> sessionId (optional)
const sseClients = new Map();
function broadcastEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients.keys()) {
    try { res.write(data); } catch (_) {}
  }
}

// Session / ownership tracking removed — single global ownership model
// Previous per-tab session ownership is no longer used. Keep placeholder functions
// for compatibility but make them no-ops.
const streamOwners = new Map();
function addOwnerForStream(streamId, sessionId) { /* no-op */ }
function removeOwnerForStream(streamId, sessionId) { /* no-op */ }
function removeSessionOwners(sessionId, stopStreams = false) { /* no-op */ }

// ---------- State ----------
const activeStreams = new Map();      // streamId -> { proc, url, attempts, backoffTimer }
const viewerCounts = new Map();       // streamId -> viewer count
const deletedStreams = new Set();     // recently deleted (block restarts)
const CLEANUP_BLOCK_MS = 5 * 60 * 1000;

const bitrateMap = new Map();         // streamId -> number|null
const bitrateHistoryMap = new Map();  // streamId -> [{ time, bitrate, estimated? }]
const streamUrlMap = new Map();       // streamId -> original input URL
const lastUpdateMap = new Map();      // streamId -> last bitrate update (ms)

const FINAL_STALE_THRESHOLD_MS = 60_000;

// Idle timeout for streams with no viewers (default 2 minutes)
const API_IDLE_TIMEOUT_MS = Number(process.env.API_IDLE_TIMEOUT_MS || 2 * 60 * 1000);

const HISTORY_FILE = path.join(__dirname, 'bitrate_history.json');

// ---------- History Persistence ----------
function saveHistory() {
  try {
    const data = {};
    for (const [key, value] of bitrateHistoryMap.entries()) {
      data[key] = value;
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data));
    console.log('Bitrate history saved.');
  } catch (error) {
    console.error('Failed to save bitrate history:', error);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      for (const key in data) {
        const history = data[key].filter(p => p.time >= oneDayAgo);
        bitrateHistoryMap.set(key, history);
      }
      console.log('Bitrate history loaded and pruned.');
    }
  } catch (error) {
    console.error('Failed to load bitrate history:', error);
  }
}

// Save history periodically and on exit
setInterval(saveHistory, 5 * 60 * 1000); // every 5 minutes
process.on('exit', saveHistory);
process.on('SIGINT', () => {
  saveHistory();
  process.exit();
});


// Prefer bundled ffmpeg.exe but fall back to system ffmpeg if not present
const bundledFfmpeg = path.join(__dirname, 'ffmpeg.exe');
const ffmpegPath = fs.existsSync(bundledFfmpeg) ? bundledFfmpeg : 'ffmpeg';

const config = {
  rtmp: { port: 1935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  http: { port: 8000, mediaroot: './media', allow_origin: '*' },
  trans: {
    ffmpeg: ffmpegPath,
    tasks: [
      { app: 'live', hls: true, hlsFlags: "[hls_time=6:hls_list_size=12:hls_flags=delete_segments+append_list+independent_segments]", hlsKeep: false }
    ]
  },
  logType: 0
};
const HLS_BASE = `http://${HOST_IP}:${config.http.port}`;

const nms = new NodeMediaServer(config);
nms.run();

function makeHlsUrls(streamId) {
  const hlsPath = `/live/${streamId}/index.m3u8`;
  return { hlsPath, hlsAbsUrl: `${HLS_BASE}${hlsPath}` };
}

// ---------- SSE /events (includes absolute HLS URL) ----------
app.get('/events', (req, res) => {
  // SSE: clients connect; per-session filtering removed — broadcast to all clients
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('\n');
  sseClients.set(res, null);

  for (const [streamId, bitrate] of bitrateMap.entries()) {
    const sourceUrl = streamUrlMap.get(streamId) || null;
    const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
    res.write(`data: ${JSON.stringify({ type: 'bitrate', streamId, sourceUrl, streamUrl: sourceUrl, hlsUrl: hlsPath, hlsAbsUrl, bitrate })}\n\n`);
    const history = bitrateHistoryMap.get(streamId) || [];
    if (history.length > 0) {
      const slice = history.slice(-300);
      res.write(`data: ${JSON.stringify({ type: 'bitrate-history', streamId, sourceUrl, streamUrl: sourceUrl, hlsUrl: hlsPath, hlsAbsUrl, history: slice })}\n\n`);
    }
  }

  req.on('close', () => {
    try {
      sseClients.delete(res);
    } catch (_) {
      try { sseClients.delete(res); } catch (_) {}
    }
  });
});

// Endpoint to explicitly end a session (useful when frontend logs out)
// /end-session retained for compatibility but is a no-op now
app.post('/end-session', (req, res) => {
  try {
    return res.json({ ok: true });
  } catch (e) {
    console.error('end-session error', e);
    return res.status(500).json({ error: String(e) });
  }
});

// ---------- Viewer tracking ----------
nms.on('prePlay', (id, StreamPath) => {
  try {
    const parts = StreamPath.split('/');
    const streamId = parts[parts.length - 1];
    const count = (viewerCounts.get(streamId) || 0) + 1;
    viewerCounts.set(streamId, count);
    broadcastEvent({ type: 'viewers', streamId, viewers: count });
  } catch (_) {}
});
nms.on('donePlay', (id, StreamPath) => {
  try {
    const parts = StreamPath.split('/');
    const streamId = parts[parts.length - 1];
    const count = Math.max(0, (viewerCounts.get(streamId) || 1) - 1);
    viewerCounts.set(streamId, count);
    broadcastEvent({ type: 'viewers', streamId, viewers: count });
    maybeCleanupIfIdle(streamId);
  } catch (_) {}
});

// ---------- Cleanup ----------
function cleanupStream(streamId) {
  const info = activeStreams.get(streamId);
  const sourceUrl = streamUrlMap.get(streamId);
  if (info) {
    try {
      if (info.backoffTimer) { clearTimeout(info.backoffTimer); info.backoffTimer = null; }
      if (info.proc && !info.proc.killed) {
        // Remove stdout/stderr listeners immediately if present
        try {
          const cleanup = procCleanupMap.get(streamId);
          if (cleanup) {
            try { cleanup(); } catch (_) {}
            procCleanupMap.delete(streamId);
          }
        } catch (_) {}

        try { info.proc.kill('SIGKILL'); } catch (_) {
          try { if (process.platform === 'win32' && info.proc.pid) spawn('taskkill', ['/PID', String(info.proc.pid), '/T', '/F']); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // remove HLS folder
  try {
    const liveFolder = path.join(__dirname, '..', 'media', 'live', streamId);
    if (fs.existsSync(liveFolder)) {
      fs.rmSync(liveFolder, { recursive: true, force: true });
      console.log(`Removed media folder for ${streamId}`);
    }
  } catch (e) { console.error('Failed to remove media folder', e); }

  activeStreams.delete(streamId);
  bitrateMap.delete(streamId);
  bitrateHistoryMap.delete(streamId);
  streamUrlMap.delete(streamId);
  lastUpdateMap.delete(streamId);
  viewerCounts.delete(streamId);

  // remove any ownership tracking for this stream
  try { streamOwners.delete(streamId); } catch (_) {}

  try {
    deletedStreams.add(streamId);
    setTimeout(() => deletedStreams.delete(streamId), CLEANUP_BLOCK_MS);
  } catch (_) {}

  const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
  console.log(`Transcoding stopped for stream ${streamId}`);
  broadcastEvent({ type: 'cleaned', streamId, sourceUrl: sourceUrl || null, streamUrl: sourceUrl || null, hlsUrl: hlsPath, hlsAbsUrl });
}

function maybeCleanupIfIdle(streamId) {
  try {
    const viewers = viewerCounts.get(streamId) || 0;
    const now = Date.now();
    // If there are active viewers, do nothing
    if (viewers > 0) return;

    const info = activeStreams.get(streamId);
    if (!info) return;

    // Prefer last bitrate update time as indicator of liveliness, otherwise fall back to process start time
    const last = lastUpdateMap.get(streamId) || 0;
    const startedAt = info.startedAt || 0;
    const reference = Math.max(last || 0, startedAt || 0);

    // If we've never had an update but started recently, wait until timeout
    if (!reference) return;

    if (now - reference > API_IDLE_TIMEOUT_MS) {
      console.log(`Idle timeout reached for ${streamId} (no viewers). Cleaning up.`);
      try { cleanupStream(streamId); } catch (e) { console.error('Idle cleanup failed', e); }
    }
  } catch (e) {
    console.error('maybeCleanupIfIdle error', e);
  }
}

// Periodic sweep for idle streams (in case donePlay events are missed)
setInterval(() => {
  try {
    for (const streamId of Array.from(activeStreams.keys())) {
      maybeCleanupIfIdle(streamId);
    }
  } catch (e) { console.error('Idle sweeper error', e); }
}, 30_000);

// ---------- Restart/backoff ----------
function scheduleRestart(streamId, streamUrl) {
  // Automatic restart logic has been disabled. Restarts must be initiated manually
  // by calling the /restart-stream endpoint.
  console.log(`scheduleRestart called for ${streamId} but automatic restart is disabled.`);
  return;
}

function startFfmpeg(streamUrl, streamId, resolution= '480p', force = false) {
  const rtmpUrl = `rtmp://127.0.0.1/live/${streamId}`; // local publish
  if (deletedStreams.has(streamId)) {
    // stream was recently cleaned up; silently refuse to start ffmpeg
    return null;
  }
  const existing = activeStreams.get(streamId);
  if (existing && existing.proc && !existing.proc.killed) {
    if (force) {
      try { if (!existing.proc.killed) existing.proc.kill('SIGKILL'); } catch (_) {
        try { if (process.platform === 'win32' && existing.proc.pid) spawn('taskkill', ['/PID', String(existing.proc.pid), '/T', '/F']); } catch (_) {}
      }
      existing.proc = null;
    } else {
      return existing.proc;
    }
  }

  console.log(`Starting ffmpeg for ${streamId} -> ${streamUrl} at ${resolution}`);
  broadcastEvent({ type: 'starting', streamId, sourceUrl: streamUrl });

  // Build ffmpeg args with per-protocol reliability options.
  const ffmpegArgs = [];

  // Input options (protocol-specific)
  if (streamUrl.startsWith('rtsp://')) {
     ffmpegArgs.push('-rtsp_transport', 'tcp');
  }
  
  if (streamUrl.startsWith('udp://')) {
    // For UDP, we need to be more robust against packet loss and timing issues.
    ffmpegArgs.push(
      '-probesize', '5M',           // Increase probe size to 5MB
      '-analyzeduration', '5000000', // Analyze for 5 seconds
      '-fflags', '+genpts+igndts+discardcorrupt' // Handle various stream issues
    );
  }

  // General input options
  ffmpegArgs.push('-re');

  // Input URL
  ffmpegArgs.push('-i', streamUrl);
  
  // Transcoding and output options based on resolution
  const resolutionSettings = {
     '720p': {
      scale: 'scale=-2:720',
      bitrate: '2500k',
      maxrate: '3000k',
      bufsize: '6000k',
      audio_bitrate: '128k',
    },
    '480p': {
      scale: 'scale=-2:480',
      bitrate: '1200k',
      maxrate: '1500k',
      bufsize: '2000k',
      audio_bitrate: '96k',
    }
  };

  const settings = resolutionSettings[resolution] || resolutionSettings['480p'];

  ffmpegArgs.push(
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-vf', settings.scale,
    '-b:v', settings.bitrate,
    '-maxrate', settings.maxrate,
    '-bufsize', settings.bufsize,
    '-g', '60',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', settings.audio_bitrate,
    '-ar', '44100',
    '-f', 'flv',
    '-progress', 'pipe:1',
    '-nostats',
    rtmpUrl
  );

  const ffmpeg = spawn(config.trans.ffmpeg, ffmpegArgs);

  // If force=true this is an explicit manual restart: reset attempts so backoff scheduling
  // from previous failures won't interfere. Keep attempts from existing otherwise.
  activeStreams.set(streamId, { proc: ffmpeg, url: streamUrl, attempts: force ? 0 : ((existing && existing.attempts) || 0), backoffTimer: null, startedAt: Date.now() });
  // owner tracking removed
  logBitrate(ffmpeg, streamId);

  ffmpeg.stderr.on('data', () => { /* noisy */ });

  ffmpeg.on('close', (code, signal) => {
    console.log(`ffmpeg for ${streamId} closed (code=${code} signal=${signal})`);
    const info = activeStreams.get(streamId);
    if (info) info.proc = null;
  broadcastEvent({ type: 'stopped', streamId, sourceUrl: streamUrl, streamUrl });
  // Automatic restart disabled: restart must be requested manually via /restart-stream
  });

  ffmpeg.on('error', (err) => {
    console.error(`ffmpeg error for ${streamId}:`, err);
  broadcastEvent({ type: 'error', streamId, sourceUrl: streamUrl, streamUrl, error: String(err) });
  // Automatic restart disabled: restart must be requested manually via /restart-stream
  });

  streamUrlMap.set(streamId, streamUrl);
  bitrateMap.set(streamId, null);
  lastUpdateMap.set(streamId, 0);

  const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
  broadcastEvent({ type: 'started', streamId, sourceUrl: streamUrl, streamUrl, hlsUrl: hlsPath, hlsAbsUrl });
  return ffmpeg;
}

// ---------- API ----------
app.post('/start-stream', async (req, res) => {
  const { streamUrl, streamName, resolution } = req.body || {};
  // sessionId ignored on start-stream
  const username = req.body?.username || null; // optional: persist for this user
  if (!streamUrl) return res.status(400).send('streamUrl is required');
  const streamId = crypto.createHash('md5').update(streamUrl).digest('hex');

  if (username) {
    if (!userStreamOwnership.has(username)) {
      userStreamOwnership.set(username, new Set());
    }
    userStreamOwnership.get(username).add(streamId);
  }

  if (streamName) {
    streamNameMap.set(streamId, streamName);
  }
  const existing = activeStreams.get(streamId);
  const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);

  if (existing && existing.proc && !existing.proc.killed) {
    return res.json({ hlsUrl: hlsPath, hlsAbsUrl });
  }

  try {
    let actualStreamUrl = streamUrl;
    if (streamUrl.startsWith('http')) {
      // youtube-dl-exec may return a string with newline; normalize/trim it.
      const resolved = await youtubedl(streamUrl, { 'get-url': true, format: 'best' }).catch(() => streamUrl);
      actualStreamUrl = String(resolved || streamUrl).trim();
      streamUrlMap.set(streamId, actualStreamUrl);
    }
  startFfmpeg(actualStreamUrl, streamId, resolution, false);

    // Persist to user's saved streams if a username was provided.
    // This ensures the frontend can reload saved streams after a refresh.
    try {
      if (username) {
        const userDataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
        const userFile = path.join(userDataDir, `${sanitizeFilename(username)}.json`);
        let userStreams = [];
        try {
          if (fs.existsSync(userFile)) {
            userStreams = JSON.parse(fs.readFileSync(userFile, 'utf8')) || [];
          }
        } catch (_) { userStreams = []; }
        // Avoid duplicates by streamUrl
        const exists = userStreams.find(s => s.streamUrl === streamUrl || s.streamId === streamId);
        if (!exists) {
          userStreams.push({ streamId, streamUrl: streamUrl, streamName: streamName || null, resolution: resolution || null, addedAt: Date.now() });
          fs.writeFileSync(userFile, JSON.stringify(userStreams, null, 2), 'utf8');
        }
      }
    } catch (e) {
      console.error('Failed to persist user stream:', e);
    }

    res.json({ hlsUrl: hlsPath, hlsAbsUrl });
  } catch (error) {
    console.error('Failed to start stream', error);
    res.status(500).send('Failed to start stream');
  }
});

const STALE_THRESHOLD_MS = 15_000;
setInterval(() => {
  const now = Date.now();
  for (const [streamId, url] of streamUrlMap.entries()) {
    const last = lastUpdateMap.get(streamId) || 0;
    const current = bitrateMap.get(streamId);
    if ((last === 0 || now - last > STALE_THRESHOLD_MS) && current !== 0) {
      // Mark as 0 (stream down) but keep the process entry so we can restart it.
      bitrateMap.set(streamId, 0);

      // Log issue start
      if (!streamIssueState.has(streamId)) {
  const startTime = Date.now();
  streamIssueState.set(streamId, { startTime });
  writeIssueLog(streamId, `Signal Loss Start: ${formatServerTime(startTime)}`);
      }

      const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
      broadcastEvent({ type: 'bitrate', streamId, sourceUrl: url || null, hlsUrl: hlsPath, hlsAbsUrl, bitrate: 0 });
      const info = activeStreams.get(streamId);
      if (info && info.proc && !info.proc.killed) {
        console.log(`Bitrate stale for ${streamId}; manual restart required (no automatic restart).`);
        // Do not schedule automatic restart; operator should call /restart-stream if needed.
      }
      // do not call maybeCleanupIfIdle here; keeping process alive helps immediate restarts
    }
  }
}, 5000);

app.post('/stop-stream', (req, res) => {
  const { streamId, streamUrl } = req.body || {};
  // sessionId ignored on stop-stream/restart-stream
  if (!streamId && !streamUrl) return res.status(400).json({ error: 'streamId or streamUrl required' });
  const id = streamId || crypto.createHash('md5').update(streamUrl).digest('hex');
  if (!activeStreams.has(id) && !streamUrlMap.has(id)) return res.status(404).json({ error: 'stream not found' });
  // remove ownership for this session if provided
  // sessionId parameter ignored (ownership removed)
  cleanupStream(id);
  return res.json({ ok: true, message: `Transcoding stopped for stream ${id}` });
});

// Restart stream: kill existing ffmpeg process for the given streamId (or streamUrl -> id) and start a new one reusing the same id
app.post('/restart-stream', async (req, res) => {
  const { streamId, streamUrl, streamName, resolution } = req.body || {};
  if (!streamId && !streamUrl) return res.status(400).json({ error: 'streamId or streamUrl required' });
  const id = streamId || crypto.createHash('md5').update(streamUrl).digest('hex');
  if (streamName) {
    streamNameMap.set(id, streamName);
  }
  const actualUrl = streamUrl || streamUrlMap.get(id);
  if (!actualUrl) return res.status(404).json({ error: 'streamUrl not found for provided id' });

  try {
    // If there's an active ffmpeg process, kill it and wait for it to exit before starting a new one.
    const info = activeStreams.get(id);
    if (info && info.proc) {
      try {
        await killProcessAndWait(id, 4000);
      } catch (e) {
        console.error(`Error while killing process for ${id}:`, e);
      }
      // clear reference after kill
      if (info) {
        info.proc = null;
        if (info.backoffTimer) { clearTimeout(info.backoffTimer); info.backoffTimer = null; }
      }
    }

    // mark bitrate as 0 (stream down) and clear last update
    bitrateMap.set(id, 0);
    lastUpdateMap.set(id, 0);

    // Allow restart even if this stream was recently marked deleted
    try { deletedStreams.delete(id); } catch (_) {}

    // clear attempts/backoff so manual restart isn't followed by a scheduled retry
    try {
      const inf = activeStreams.get(id);
      if (inf) {
        inf.attempts = 0;
        if (inf.backoffTimer) { clearTimeout(inf.backoffTimer); inf.backoffTimer = null; }
      }
    } catch (_) {}

    // start ffmpeg again with the same id, forcing a fresh process
  startFfmpeg(actualUrl, id, resolution, true);
    const { hlsPath, hlsAbsUrl } = makeHlsUrls(id);
    return res.json({ ok: true, streamId: id, hlsUrl: hlsPath, hlsAbsUrl });
  } catch (err) {
    console.error('Failed to restart stream', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/calculate-bitrate', (req, res) => {
  const { streamUrl, streamId } = req.body || {};
  if (!streamId && !streamUrl) return res.status(400).json({ error: 'streamId or streamUrl required' });
  const id = streamId || crypto.createHash('md5').update(streamUrl).digest('hex');
  const bitrate = bitrateMap.get(id) ?? null;
  const history = bitrateHistoryMap.get(id) ?? [];
  const { hlsAbsUrl } = makeHlsUrls(id);
  return res.json({ bitrate, history, hlsAbsUrl });
});

// Diagnostic probe: run ffprobe on a source URL and return parsed JSON (fast, short timeout)
app.post('/probe', (req, res) => {
  const { streamUrl } = req.body || {};
  if (!streamUrl) return res.status(400).json({ error: 'streamUrl required' });
  try {
    const { spawn } = require('child_process');
    const args = ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', streamUrl];
    const p = spawn(path.join(__dirname, 'ffprobe.exe'), args, { timeout: 9000 });
    let out = '';
    let err = '';
    p.stdout.on('data', d => out += String(d));
    p.stderr.on('data', d => err += String(d));
    p.on('close', (code) => {
      if (out) {
        try { return res.json({ ok: true, data: JSON.parse(out) }); } catch (e) { return res.json({ ok: false, error: 'ffprobe returned non-json', raw: out, stderr: err }); }
      }
      return res.status(500).json({ ok: false, code, stderr: err });
    });
    p.on('error', (e) => res.status(500).json({ ok: false, error: String(e) }));
  } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/bitrate-history', (req, res) => {
  const { streamUrl, streamId, maxSamples = 300 } = req.body || {};
  if (!streamId && !streamUrl) return res.status(400).json({ error: 'streamId or streamUrl required' });
  const id = streamId || crypto.createHash('md5').update(streamUrl).digest('hex');
  const history = bitrateHistoryMap.get(id) || [];
  if (history.length > 0) {
    return res.json({ history: history.slice(-maxSamples) });
  }

  try {
    const liveFolder = path.join(__dirname, '..', 'media', 'live', id);
    if (fs.existsSync(liveFolder)) {
      const files = fs.readdirSync(liveFolder).filter(f => f.endsWith('.ts'));
      if (files.length >= 2) {
        const sorted = files.map(f => ({ f, m: fs.statSync(path.join(liveFolder, f)).mtimeMs })).sort((a, b) => a.m - b.m);
        const last = sorted.slice(-2);
        const sizes = last.map(x => fs.statSync(path.join(liveFolder, x.f)).size);
        const avgBytesPerSec = sizes.reduce((a, b) => a + b, 0) / (last.length * 2); // hls_time=2
        const mbps = Math.round((avgBytesPerSec * 8 / 1e6) * 100) / 100;
        return res.json({ history: [{ time: Date.now(), bitrate: mbps, estimated: true }] });
      }
    }
  } catch (_) {}

  return res.json({ history: [] });
});

app.get('/logs/streams', (req, res) => {
  try {
    if (!fs.existsSync(logsDir)) {
      return res.json([]);
    }
    const streams = fs.readdirSync(logsDir).filter(name => {
      const dirPath = path.join(logsDir, name);
      return fs.statSync(dirPath).isDirectory();
    });
    res.json(streams);
  } catch (error) {
    console.error('Failed to list streams:', error);
    res.status(500).send('Failed to list streams');
  }
});

// Return files in a stream's logs folder. :id may be a folder name or a streamId.
app.get('/logs/streams/:id/files', (req, res) => {
  try {
    const raw = req.params.id || '';
    const id = String(raw);
    // If the id matches an actual folder, use that. Otherwise, if it's a streamId
    // and we have a mapped stream name, use the sanitized stream name.
    let folderName = null;
    const directPath = path.join(logsDir, id);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
      folderName = id;
    } else if (streamNameMap.has(id)) {
      folderName = sanitizeFilename(streamNameMap.get(id));
    }

    if (!folderName) return res.status(404).json([]);
    const folderPath = path.join(logsDir, folderName);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return res.status(404).json([]);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.log'));
    return res.json(files);
  } catch (e) {
    console.error('Failed to list files for stream logs', e);
    return res.status(500).json([]);
  }
});

app.get('/download-log/:streamId/:filename', (req, res) => {
  const { streamId, filename } = req.params;
  
  const streamName = streamNameMap.get(streamId) || streamId;
  const sanitizedStreamName = sanitizeFilename(streamName);
  const streamDir = path.join(logsDir, sanitizedStreamName);

  if (!fs.existsSync(streamDir) || !fs.statSync(streamDir).isDirectory()) {
    // Fallback for when streamId is actually the folder name
    const fallbackDir = path.join(logsDir, streamId);
    if (!fs.existsSync(fallbackDir) || !fs.statSync(fallbackDir).isDirectory()) {
      return res.status(404).send('Log folder not found for the specified stream.');
    }
    // If fallback is valid, use it
    streamDir = fallbackDir;
  }

  try {
    const logFilePath = path.join(streamDir, filename);
    if (fs.existsSync(logFilePath)) {
      return res.download(logFilePath, filename, (err) => {
        if (err) {
          console.error(`Failed to download log file: ${logFilePath}`, err);
          res.status(500).send('Could not download the file.');
        }
      });
    }
    return res.status(404).send('No log files found for the specified stream.');
  } catch (e) {
    console.error('Error finding log files for download', e);
    return res.status(500).send('Failed to find log files');
  }
});

app.get('/api/logs/all-files', (req, res) => {
  const allLogs = [];
  try {
    if (!fs.existsSync(logsDir)) {
      return res.json([]);
    }

    const streamDirs = fs.readdirSync(logsDir).filter(name => {
      const dirPath = path.join(logsDir, name);
      try {
        return fs.statSync(dirPath).isDirectory();
      } catch (e) { return false; }
    });

    for (const streamDir of streamDirs) {
      const streamPath = path.join(logsDir, streamDir);
      try {
        const files = fs.readdirSync(streamPath)
          .filter(f => f.endsWith('.log'))
          .map(file => ({ stream: streamDir, file, path: path.join(streamDir, file) }));
        allLogs.push(...files);
      } catch (e) {
        console.error(`Could not read logs from ${streamPath}:`, e);
      }
    }
    res.json(allLogs);
  } catch (error) {
    console.error('Failed to list all log files:', error);
    res.status(500).send('Failed to list all log files');
  }
});

const PORT = Number(process.env.API_PORT || 3001);
const FRONTEND_PORT = 5173; // <-- new

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on http://${HOST_IP}:${PORT}`);
  console.log(`HLS served from ${HLS_BASE}`);
  console.log(`Frontend (Vite) expected on http://${HOST_IP}:${FRONTEND_PORT}`);
});

// keepalive
setInterval(() => {}, 1 << 30);

// ---------- Authentication Routes ----------
const authRoutes = require('./auth').router;
const authenticateToken = require('./auth').authenticateToken;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/auth', authRoutes);

const dataFolderPath = path.join(__dirname, 'data');
if (!fs.existsSync(dataFolderPath)) {
  fs.mkdirSync(dataFolderPath);
}

// New endpoint: Get a user's saved stream list
app.get('/api/streams', authenticateToken, (req, res) => {
  const username = req.user.username;
  if (!username) {
    return res.status(400).json({ error: 'Username not found in token' });
  }
  try {
    const userFile = path.join(dataFolderPath, `${sanitizeFilename(username)}.json`);
    if (fs.existsSync(userFile)) {
      const streams = JSON.parse(fs.readFileSync(userFile, 'utf8'));
      res.json(streams);
    } else {
      res.json([]); // No saved streams for this user
    }
  } catch (e) {
    console.error(`Failed to read streams for user ${username}`, e);
    res.status(500).json({ error: 'Failed to read user streams' });
  }
});

// New endpoint: Save/overwrite a user's entire stream list
app.post('/api/streams', authenticateToken, (req, res) => {
  const username = req.user.username;
  if (!username) {
    return res.status(400).json({ error: 'Username not found in token' });
  }
  const streams = req.body;
  if (!Array.isArray(streams)) {
    return res.status(400).json({ error: 'Request body must be an array of streams' });
  }
  try {
    const userFile = path.join(dataFolderPath, `${sanitizeFilename(username)}.json`);
    fs.writeFileSync(userFile, JSON.stringify(streams, null, 2), 'utf8');
    res.json({ ok: true, message: `Saved ${streams.length} streams for user ${username}` });
  } catch (e) {
    console.error(`Failed to save streams for user ${username}`, e);
    res.status(500).json({ error: 'Failed to save user streams' });
  }
});

// New endpoint: return active streams (backend truth) so frontend can repopulate UI on load
app.get('/api/active-streams', (req, res) => {
  try {
    const out = [];
    for (const [streamId, info] of activeStreams.entries()) {
      const sourceUrl = streamUrlMap.get(streamId) || (info && info.url) || null;
      const name = streamNameMap.get(streamId) || null;
      const bitrate = bitrateMap.get(streamId) ?? null;
      const viewers = viewerCounts.get(streamId) || 0;
      const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
      out.push({ streamId, sourceUrl, streamName: name, hlsUrl: hlsPath, hlsAbsUrl, bitrate, viewers });
    }
    // also include any tracked streams in streamUrlMap that don't have an activeStreams entry
    for (const [streamId, url] of streamUrlMap.entries()) {
      if (!activeStreams.has(streamId)) {
        const name = streamNameMap.get(streamId) || null;
        const bitrate = bitrateMap.get(streamId) ?? null;
        const viewers = viewerCounts.get(streamId) || 0;
        const { hlsPath, hlsAbsUrl } = makeHlsUrls(streamId);
        out.push({ streamId, sourceUrl: url, streamName: name, hlsUrl: hlsPath, hlsAbsUrl, bitrate, viewers });
      }
    }
    res.json(out);
  } catch (e) {
    console.error('Failed to list active streams', e);
    res.status(500).json({ error: String(e) });
  }
});

// ---------- Kill Process Utility ----------
function killProcessAndWait(streamId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const info = activeStreams.get(streamId);
    if (!info || !info.proc || info.proc.killed) {
      return resolve();
    }

    const proc = info.proc;
    const pid = proc.pid;

    const timeout = setTimeout(() => {
      console.error(`Timeout waiting for process ${pid} (stream ${streamId}) to exit. Forcing kill.`);
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
        } else {
          proc.kill('SIGKILL');
        }
      } catch (e) {
        // ignore, may already be gone
      }
      reject(new Error(`Timeout waiting for process ${pid} to exit.`));
    }, timeoutMs);

    proc.once('exit', () => {
      clearTimeout(timeout);
      console.log(`Process ${pid} (stream ${streamId}) exited.`);
      resolve();
    });

     try {
      // Remove listeners to avoid side-effects during shutdown
      const cleanup = procCleanupMap.get(streamId);
      if (cleanup) {
        cleanup();
        procCleanupMap.delete(streamId);
      }
    } catch (e) {
      console.error('Error during pre-kill listener cleanup:', e);
    }

    console.log(`Attempting to gracefully kill process ${pid} (stream ${streamId}).`);
    proc.kill('SIGTERM'); // Graceful shutdown
  });
}

