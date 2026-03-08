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
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath   = req.url.split('?')[0];          /* strip query string */
  const filePath  = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  const ext       = path.extname(filePath).toLowerCase();
  const mimeType  = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`[saunagotto] serving on port ${PORT}`);
});
