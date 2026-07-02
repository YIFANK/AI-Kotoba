#!/usr/bin/env python3
"""AI-Kotoba Web 本地服务器
静态文件 + 本地 AI 桥接：POST /api/ai 调用本机已登录的 claude / codex CLI，
让网页无需 API Key 即可生成会话。

用法：python3 server.py [端口，默认 8734]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
TIMEOUT = 300  # CLI 单次调用超时（秒）
DATA_FILE = os.path.join(ROOT, "data.json")  # 学习数据持久化（跨浏览器共享）

# GUI 启动时 PATH 可能不含 CLI 安装目录，补上常见位置
EXTRA_PATHS = [
    os.path.expanduser("~/.local/bin"),
    os.path.expanduser("~/.claude/local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
]
os.environ["PATH"] = os.pathsep.join([os.environ.get("PATH", ""), *EXTRA_PATHS])


def find_cli(name):
    return shutil.which(name)


def run_claude(prompt):
    cli = find_cli("claude")
    if not cli:
        raise FileNotFoundError("未找到 claude 命令，请先安装并登录 Claude Code")
    # 在临时目录运行，避免加载项目上下文（CLAUDE.md 等），更快更干净
    r = subprocess.run(
        [cli, "-p", prompt, "--output-format", "text"],
        capture_output=True, text=True, timeout=TIMEOUT, cwd=tempfile.gettempdir(),
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:500] or f"claude 退出码 {r.returncode}")
    return r.stdout.strip()


def run_codex(prompt):
    cli = find_cli("codex")
    if not cli:
        raise FileNotFoundError("未找到 codex 命令，请先安装并登录 Codex CLI")
    with tempfile.NamedTemporaryFile(mode="r", suffix=".txt", delete=False) as f:
        outfile = f.name
    try:
        r = subprocess.run(
            [cli, "exec", "--skip-git-repo-check", "--output-last-message", outfile, prompt],
            capture_output=True, text=True, timeout=TIMEOUT, cwd=tempfile.gettempdir(),
        )
        with open(outfile) as f:
            last = f.read().strip()
        if last:
            return last
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout).strip()[:500] or f"codex 退出码 {r.returncode}")
        return r.stdout.strip()
    finally:
        os.unlink(outfile)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        # 静态资源禁用缓存，避免代码更新后浏览器仍执行旧版 JS
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/status":
            self.send_json({
                "claude": bool(find_cli("claude")),
                "codex": bool(find_cli("codex")),
            })
        elif self.path == "/api/data":
            try:
                with open(DATA_FILE, encoding="utf-8") as f:
                    self.send_json(json.load(f))
            except (FileNotFoundError, json.JSONDecodeError):
                self.send_json({})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/data":
            try:
                length = int(self.headers.get("content-length", 0))
                data = json.loads(self.rfile.read(length))
                tmp = DATA_FILE + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                os.replace(tmp, DATA_FILE)
                self.send_json({"ok": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return
        if self.path != "/api/ai":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length))
            prompt = body["prompt"]
            engine = body.get("engine", "claude")
            text = run_codex(prompt) if engine == "codex" else run_claude(prompt)
            if not text:
                raise RuntimeError("本地模型返回内容为空")
            self.send_json({"text": text})
        except subprocess.TimeoutExpired:
            self.send_json({"error": "本地模型响应超时"}, 500)
        except (FileNotFoundError, RuntimeError) as e:
            self.send_json({"error": str(e)}, 500)
        except Exception as e:
            self.send_json({"error": f"服务器错误：{e}"}, 500)


if __name__ == "__main__":
    print(f"AI-Kotoba Web 已启动：http://localhost:{PORT}")
    print(f"本地 CLI 检测：claude={'✓' if find_cli('claude') else '✗'}  codex={'✓' if find_cli('codex') else '✗'}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
