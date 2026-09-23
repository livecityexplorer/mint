#!/usr/bin/env python3
"""
Mint IPTV Player Embedded Desktop Server
Runs on Linux Mint using standard library Python 3 (zero external dependencies).
Serves React frontend + proxies IPTV m3u8 streams and Xtream Codes API.
"""

import sys
import os
import argparse
import urllib.request
import urllib.parse
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 43210
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Check possible dist locations
DIST_DIR = os.path.join(BASE_DIR, 'dist') if os.path.exists(os.path.join(BASE_DIR, 'dist')) else BASE_DIR
if not os.path.exists(os.path.join(DIST_DIR, 'index.html')) and os.path.exists(os.path.join(BASE_DIR, '..', 'dist', 'index.html')):
    DIST_DIR = os.path.join(BASE_DIR, '..', 'dist')

class MintIPTVHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == '/api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"status":"ok","engine":"python3-embedded"}\n')
            return

        if parsed.path == '/api/server-info':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            payload = json.dumps({'port': PORT, 'engine': 'python3', 'status': 'running'})
            self.wfile.write(payload.encode('utf-8'))
            return

        if parsed.path == '/api/proxy':
            qs = urllib.parse.parse_qs(parsed.query)
            target_url = qs.get('url', [None])[0]
            if not target_url:
                self.send_response(400)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(b'Missing "url" parameter')
                return
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
                req = urllib.request.Request(target_url, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self.send_response(resp.status)
                    self.send_cors_headers()
                    ct = resp.headers.get('Content-Type', 'application/octet-stream')
                    self.send_header('Content-Type', ct)
                    self.end_headers()
                    self.wfile.write(resp.read())
            except Exception as e:
                self.send_response(502)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return

        if parsed.path == '/api/xc/action':
            qs = urllib.parse.parse_qs(parsed.query)
            server_url = qs.get('serverUrl', [''])[0].rstrip('/')
            username = qs.get('username', [''])[0]
            password = qs.get('password', [''])[0]
            action = qs.get('action', ['get_live_streams'])[0]

            if not server_url or not username or not password:
                self.send_response(400)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(b'{"error":"Missing credentials"}')
                return

            endpoint = f"{server_url}/player_api.php?username={urllib.parse.quote(username)}&password={urllib.parse.quote(password)}&action={urllib.parse.quote(action)}"
            try:
                req = urllib.request.Request(endpoint, headers={'User-Agent': 'IPTV-Player-Mint/1.0'})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = resp.read()
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors_headers()
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            return

        # Static files & SPA fallback
        clean_path = parsed.path.lstrip('/')
        target_file = os.path.join(DIST_DIR, clean_path)

        if not os.path.exists(target_file) and not parsed.path.startswith('/api'):
            self.path = '/index.html'

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/xc/login':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                server_url = data.get('serverUrl', '').rstrip('/')
                username = data.get('username', '')
                password = data.get('password', '')

                endpoint = f"{server_url}/player_api.php?username={urllib.parse.quote(username)}&password={urllib.parse.quote(password)}"
                req = urllib.request.Request(endpoint, headers={'User-Agent': 'IPTV-Player-Mint/1.0'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': True, 'data': resp_data}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
            return

        self.send_response(404)
        self.send_cors_headers()
        self.end_headers()

def run():
    global PORT
    parser = argparse.ArgumentParser(description='Mint IPTV Player Desktop Server')
    parser.add_argument('--port', '-p', type=int, default=43210, help='Port to bind (default: 43210)')
    args, _ = parser.parse_known_args()
    PORT = args.port

    server_address = ('127.0.0.1', PORT)
    try:
        httpd = HTTPServer(server_address, MintIPTVHandler)
        print(f"Mint IPTV Player server running on http://127.0.0.1:{PORT}")
        sys.stdout.flush()
        httpd.serve_forever()
    except Exception as e:
        print(f"Failed to start server on port {PORT}: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    run()
