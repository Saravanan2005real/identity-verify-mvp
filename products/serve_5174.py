import os
import sys
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PRODUCTS_DIR = os.path.dirname(os.path.abspath(__file__))
OCR_BACKEND = "http://127.0.0.1:5001"

class ProductsGatewayHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PRODUCTS_DIR, **kwargs)

    def do_GET(self):
        # Proxy OCR API or uploads to Flask backend if requested on 5174
        if self.path.startswith("/api/v1/") or self.path.startswith("/ocr_uploads/"):
            self._proxy("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/v1/"):
            self._proxy("POST")
        else:
            self.send_error(405, "Method Not Allowed")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def _proxy(self, method):
        target_url = f"{OCR_BACKEND}{self.path}"
        try:
            headers = {k: v for k, v in self.headers.items() if k.lower() != 'host'}
            data = None
            if method == "POST":
                content_len = int(self.headers.get('Content-Length', 0))
                if content_len > 0:
                    data = self.rfile.read(content_len)

            req = urllib.request.Request(target_url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=30) as resp:
                self.send_response(resp.status)
                for header, val in resp.getheaders():
                    if header.lower() not in ('transfer-encoding', 'content-length'):
                        self.send_header(header, val)
                content = resp.read()
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for header, val in e.headers.items():
                if header.lower() not in ('transfer-encoding', 'content-length'):
                    self.send_header(header, val)
            body = e.read()
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as err:
            self.send_error(502, f"Bad Gateway: {err}")

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

if __name__ == "__main__":
    port = 5174
    server = ThreadingHTTPServer(("0.0.0.0", port), ProductsGatewayHandler)
    print(f"Products Gateway running on http://localhost:{port} (serving {PRODUCTS_DIR})")
    server.serve_forever()
