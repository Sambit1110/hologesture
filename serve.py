#!/usr/bin/env python3
"""Serve HoloGesture on http://localhost:8000.

Like `python3 -m http.server`, but with a bigger connection queue (the browser
loads many modules at once, and the default queue of 5 can drop some) and with
caching turned off, so you always get the latest code after an update.
"""
import functools
import http.server
import json
import os
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the terminal quiet

    def do_POST(self):
        # The app's Calibrate button sends its recording here; it is saved in
        # the calibration/ folder next to this file.
        if self.path != "/calibration":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 10_000_000:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except ValueError:
            self.send_error(400)
            return
        folder = os.path.join(ROOT, "calibration")
        os.makedirs(folder, exist_ok=True)
        name = time.strftime("calibration-%Y%m%d-%H%M%S.json")
        with open(os.path.join(folder, name), "wb") as f:
            f.write(body)
        reply = json.dumps({"file": f"calibration/{name}"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)
        print(f"Saved calibration/{name}")


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    try:
        httpd = Server(("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT))
    except OSError as err:
        if err.errno in (48, 98):  # address already in use (macOS, Linux)
            sys.exit(
                f"Port {PORT} is already in use. HoloGesture (or another server) may already be "
                f"running: try http://localhost:{PORT}, or start on another port: python3 serve.py {PORT + 1}"
            )
        raise
    with httpd:
        print(f"HoloGesture running at http://localhost:{PORT}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
