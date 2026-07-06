"""Tiny static server for the family tree (no Node required).
Run from a normal terminal:  python3 ".claude/serve.py"
Then open http://127.0.0.1:4599 in your browser.
(You can also just double-click index.html — a server is only needed if
 your browser blocks local images over file://.)"""
import functools, http.server, os, socketserver

DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 4599

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)

class TCP(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

with TCP(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Serving {DIRECTORY}\n  →  http://127.0.0.1:{PORT}\nPress Ctrl+C to stop.")
    httpd.serve_forever()
