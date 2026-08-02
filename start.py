#!/usr/bin/env python3
"""
故障诊断 Agent Demo — 离线静态文件服务器。

启动后访问 http://127.0.0.1:8080

工程基线（docs/13 §17/§19）：
- 默认仅监听 127.0.0.1，不暴露局域网；
- 不开放宽泛 CORS（默认同源）；
- 启动前校验 dist 交付物与 Case Catalog 完整性；
- 支持 --host / --port / --validate-only / --no-browser。

用法：
    python3 start.py                      # 默认 127.0.0.1:8080，自动开浏览器
    python3 start.py --validate-only      # 仅校验交付物
    python3 start.py --port 8000          # 指定端口
"""

import argparse
import http.server
import json
import os
import socketserver
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HOST = '127.0.0.1'
DEFAULT_PORT = 8080


def validate(dist_dir):
    """启动前校验：dist 交付物 + Case Catalog 完整性。返回 (ok, messages)。"""
    msgs = []

    if not os.path.isdir(dist_dir):
        msgs.append(f'缺失 dist/ 目录：{dist_dir}（请先执行 npm run build）')
        return False, msgs
    if not os.path.exists(os.path.join(dist_dir, 'index.html')):
        msgs.append(f'dist/ 缺少 index.html（请先执行 npm run build）')
        return False, msgs

    index_path = os.path.join(ROOT, 'cases', 'index.json')
    if not os.path.exists(index_path):
        msgs.append('缺失 cases/index.json（Case Catalog 权威入口）')
        return False, msgs
    try:
        with open(index_path, encoding='utf-8') as fh:
            index = json.load(fh)
        cases = index.get('cases', [])
        if len(cases) < 3:
            msgs.append(f'cases/index.json 预期至少 3 个基线 Case，实际 {len(cases)}')
        for entry in cases:
            cid = entry.get('case_id') or entry.get('path')
            cdir = os.path.join(ROOT, 'cases', entry.get('path', cid))
            if not cid or not os.path.isdir(cdir):
                msgs.append(f'Case 目录缺失：{cid}')
            elif not os.path.exists(os.path.join(cdir, 'manifest.json')):
                msgs.append(f'Case 缺少 manifest.json：{cid}')
    except Exception as exc:  # noqa: BLE001 — 启动校验需捕获所有解析异常
        msgs.append(f'cases/index.json 解析失败：{exc}')

    return len(msgs) == 0, msgs


class Handler(http.server.SimpleHTTPRequestHandler):
    """同源静态文件服务：默认不附加宽泛 CORS 头（docs/13 §17.3）。"""

    def __init__(self, *args, directory, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, fmt, *args):  # 静默默认访问日志，保留错误输出
        pass


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(description='故障诊断 Agent Demo 离线服务器')
    parser.add_argument('--host', default=DEFAULT_HOST, help=f'绑定地址（默认 {DEFAULT_HOST}）')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help=f'端口（默认 {DEFAULT_PORT}）')
    parser.add_argument('--validate-only', action='store_true', help='仅校验交付物后退出')
    parser.add_argument('--no-browser', action='store_true', help='不自动打开浏览器')
    args = parser.parse_args()

    dist_dir = os.path.join(ROOT, 'dist')
    ok, msgs = validate(dist_dir)
    print('启动校验：')
    for m in msgs:
        print(f'  ✗ {m}')
    if ok:
        print('  ✓ dist 交付物与 Case Catalog 完整')

    if args.validate_only or not ok:
        return 0 if ok else 1

    # 非 loopback 绑定时给出安全提示（不阻止，但明确风险）。
    if args.host not in ('127.0.0.1', 'localhost', '::1'):
        print(f'  ⚠ 绑定 {args.host}：服务将暴露到网络，请确认访问控制')

    handler = lambda *a, **kw: Handler(*a, directory=dist_dir, **kw)
    with ReusableTCPServer((args.host, args.port), handler) as httpd:
        url = f'http://{args.host}:{args.port}'
        print(f'\n故障诊断 Agent Demo 服务已启动')
        print(f'访问: {url}')
        print(f'目录: {dist_dir}')
        print('按 Ctrl+C 停止')
        if not args.no_browser:
            try:
                webbrowser.open(url)
            except Exception:  # noqa: BLE001 — 无头环境开浏览器失败不应阻断服务
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n服务已停止')
    return 0


if __name__ == '__main__':
    sys.exit(main())
