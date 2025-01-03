const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const static = require('node-static');
const httpProxy = require('http-proxy');

process.argv.reduce((param, current) => {
    if (param.length) {
        process.argv[param] = current;
        current = '';
    } else if (current[0] == '-') {
        current = current.replace(/^-+/, '');
        process.argv[current] = true;
    }
    return current;
}, '');

if (process.argv.help) {
    console.log(`Penggunaan:
    ${process.argv.self || 'qcdesa'} [--listen 80] [--passcode ADMIN_PASSWORD]

--listen    Port untuk diakses client via browser, default 80
--passcode  Password admin, default admin

Contoh:
    ${process.argv.self || 'qcdesa'} --listen 80 --passcode rahasia

`)
    process.exit();
}

const listen = process.argv.listen || 443;
if (path.basename(__dirname) === 'js') {
    process.chdir(path.resolve(__dirname, '..'));
} else {
    process.chdir(__dirname);
}

let SERVER_DIR, CLIENT_DIR;

if (fs.existsSync('server')) {
    SERVER_DIR = path.join(__dirname, '../server');
    CLIENT_DIR = path.join(__dirname, '../client');
} else {
    SERVER_DIR = path.resolve(__dirname, '../../dist/server');
    CLIENT_DIR = path.resolve(__dirname, '../../dist/client');
}
const SERVER_JS = `${SERVER_DIR}/index.js`;

if (!fs.existsSync(SERVER_DIR) || !fs.existsSync(CLIENT_DIR)) {
    console.error('Tidak dapat menemukan direktori aplikasi JS qcdesa');
    process.exit(1);
}

console.log('Menjalankan Server..');
const caller = require('vm').runInThisContext(require('module').wrap(fs.readFileSync(SERVER_JS)));
try {
    caller(exports, require, module, SERVER_JS, SERVER_DIR);
    console.log('Server OK');
} catch (error) {
    console.error('Server ERROR: ', error);
}

console.log('Menjalankan Client..');
const clientRoot = new static.Server(CLIENT_DIR);
const apiRoot = new static.Server(path.join(process.cwd(), 'data/public'));
console.log("Public path", path.join(process.cwd(), 'data/public'));

const apiProxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:8888', ws: true });

/** @type {http.RequestListener} */
const requestHandler = (request, response) => {
    const urls = request.url.split('/').slice(1);
    console.log(urls);
    if (urls[0] == 'public') {
        request.url = request.url.replace(/^\/public/, '');
        apiRoot.serve(request, response);
    } else if (urls[0] == 'api') {
        if (urls[1] == 'public') {
            request.url = request.url.replace(/^\/api\/public/, '');
            apiRoot.serve(request, response);
        } else {
            apiProxy.web(request, response);
        }
    } else {
        request.addListener('end', function () {
            clientRoot.serve(request, response, (e, res) => {
                if (e && (e.status === 404)) {
                    clientRoot.serveFile('/index.html', 200, {}, request, response);
                }
            });
        }).resume();
    }
};

// HTTPS Server
const options = {
    key: fs.readFileSync('/path/to/privkey.pem'),
    cert: fs.readFileSync('/path/to/fullchain.pem'),
};

const httpsServer = https.createServer(options, requestHandler);
httpsServer.listen(443, '0.0.0.0', () => {
    console.log('Server HTTPS berjalan di https://0.0.0.0/');
});

// WebSocket Support
httpsServer.on('upgrade', (req, socket, head) => {
    apiProxy.ws(req, socket, head);
    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received WebSocket data:', data);
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    });
});

// HTTP Server untuk redirect ke HTTPS
const httpServer = http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
});
httpServer.listen(80, '0.0.0.0', () => {
    console.log('Server HTTP berjalan di http://0.0.0.0/ (redirect ke HTTPS)');
});
