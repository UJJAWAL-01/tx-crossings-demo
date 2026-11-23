"""Serve this demo folder at http://127.0.0.1:8777/ and open it in the browser.

The page uses JavaScript modules, which browsers load only from a server with the right content
types (on this Windows machine Python's default table says text/plain for .js), so this sets them.
    py -3 serve.py            (or double-click serve.bat)
    py -3 serve.py 8800 --no-browser
"""
import functools
import http.server
import os
import sys
import webbrowser

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8777)
HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
         ".css": "text/css", ".png": "image/png", ".html": "text/html; charset=utf-8",
         ".svg": "image/svg+xml", ".csv": "text/csv"}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=HERE)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/"
        print(f"Demo running at {url}  (close this window or press Ctrl+C to stop)", flush=True)
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        httpd.serve_forever()
