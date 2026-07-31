#!/usr/bin/env python3
"""
故障诊断 Agent Demo — 静态文件服务器
启动后访问 http://localhost:8080
"""

import http.server
import socketserver
import os
import sys

PORT = 8080
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def main():
    if not os.path.exists(DIRECTORY):
        print(f"错误: dist/ 目录不存在。请先运行 npm run build")
        sys.exit(1)

    files = os.listdir(DIRECTORY)
    if not any(f.endswith('.html') for f in files):
        print(f"错误: dist/ 中没有 HTML 文件。请先运行 npm run build")
        sys.exit(1)

    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"故障诊断 Agent Demo 服务已启动")
        print(f"访问: http://localhost:{PORT}")
        print(f"目录: {DIRECTORY}")
        print(f"按 Ctrl+C 停止")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已停止")

if __name__ == '__main__':
    main()
