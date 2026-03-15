const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.mp3':  'audio/mpeg',
  '.mp4':  'video/mp4',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath  = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  const ext      = path.extname(filePath).toLowerCase();
  const mimeType = MIME[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      /* Safari (and all browsers) send Range requests for video.
         Must respond 206 Partial Content or Safari refuses to play. */
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end   = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunk = end - start + 1;

      res.writeHead(206, {
        'Content-Type':   mimeType,
        'Content-Range':  `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunk,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type':   mimeType,
        'Accept-Ranges':  'bytes',
        'Content-Length': total,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}).listen(PORT, () => {
  console.log(`[saunagotto] serving on port ${PORT}`);
});
