#!/usr/bin/env python3
"""
Local static file server for development — identical to `python3 -m http.server`
except it sends Cache-Control: no-store on every response, so browsers always
fetch the latest file instead of serving a stale cached copy of an HTML/CSS/JS
file that was just edited. Plain http.server has no cache-control headers,
which lets browsers apply heuristic caching to <script>/<link> loads and serve
stale content across navigations within the same session — this avoids that.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
    HTTPServer(("", port), NoCacheHandler).serve_forever()
