#!/usr/bin/env python3
"""AI-Kotoba Web 本地服务器
静态文件 + 本地 AI 桥接：POST /api/ai 调用本机已登录的 claude / codex CLI，
让网页无需 API Key 即可生成会话。

用法：python3 server.py [端口，默认 8734]
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
TIMEOUT = 300  # CLI 单次调用超时（秒）
REALTIME_MODEL = "gpt-realtime-2.1"
AUDIO_MODEL = "gpt-audio-1.5"
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


def run_claude(prompt, model=None):
    cli = find_cli("claude")
    if not cli:
        raise FileNotFoundError("未找到 claude 命令，请先安装并登录 Claude Code")
    cmd = [cli, "-p", prompt, "--output-format", "text"]
    if model:
        cmd.extend(["--model", model])
    # 在临时目录运行，避免加载项目上下文（CLAUDE.md 等），更快更干净
    r = subprocess.run(
        cmd,
        capture_output=True, text=True, timeout=TIMEOUT, cwd=tempfile.gettempdir(),
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:500] or f"claude 退出码 {r.returncode}")
    return r.stdout.strip()


def run_codex(prompt, model=None):
    cli = find_cli("codex")
    if not cli:
        raise FileNotFoundError("未找到 codex 命令，请先安装并登录 Codex CLI")
    with tempfile.NamedTemporaryFile(mode="r", suffix=".txt", delete=False) as f:
        outfile = f.name
    try:
        cmd = [cli, "exec", "--skip-git-repo-check", "--output-last-message", outfile]
        if model:
            cmd.extend(["--model", model])
        cmd.append(prompt)
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=tempfile.gettempdir(),
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
                "openai_realtime": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
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
        if self.path == "/api/pronunciation/analyze":
            self.analyze_pronunciation()
            return
        if self.path == "/api/realtime/session":
            self.create_realtime_session()
            return
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
            model = (body.get("model") or "").strip()
            text = run_codex(prompt, model) if engine == "codex" else run_claude(prompt, model)
            if not text:
                raise RuntimeError("本地模型返回内容为空")
            self.send_json({"text": text})
        except subprocess.TimeoutExpired:
            self.send_json({"error": "本地模型响应超时"}, 500)
        except (FileNotFoundError, RuntimeError) as e:
            self.send_json({"error": str(e)}, 500)
        except Exception as e:
            self.send_json({"error": f"服务器错误：{e}"}, 500)

    def analyze_pronunciation(self):
        """Analyze a bounded WAV recording with an audio-capable model."""
        try:
            length = int(self.headers.get("content-length", 0))
            if length <= 0 or length > 9 * 1024 * 1024:
                self.send_json({"error": "录音请求为空或过大，请控制在 20 秒以内"}, 413)
                return
            body = json.loads(self.rfile.read(length))
            target = str(body.get("target") or "").strip()[:240]
            level = str(body.get("level") or "N4")
            native_language = str(body.get("nativeLanguage") or "Chinese").strip()[:80]
            explanation_language = str(body.get("explanationLanguage") or "Simplified Chinese").strip()[:80]
            audio = str(body.get("audio") or "")
            if not target:
                self.send_json({"error": "请先填写目标日语句子"}, 400)
                return
            if level not in {"N5", "N4", "N3", "N2", "N1"}:
                level = "N4"
            try:
                wav_header = base64.b64decode(audio[:80], validate=True)
            except (ValueError, TypeError):
                wav_header = b""
            if not (wav_header.startswith(b"RIFF") and wav_header[8:12] == b"WAVE"):
                self.send_json({"error": "录音格式无效，请重新录制"}, 400)
                return

            api_key = os.environ.get("OPENAI_API_KEY", "").strip() or str(body.get("apiKey") or "").strip()
            if not api_key:
                self.send_json({"error": "请在设置中填写 OpenAI API Key，或为 server.py 配置 OPENAI_API_KEY"}, 401)
                return

            request_body = {
                "model": AUDIO_MODEL,
                "store": False,
                "messages": [
                    {
                        "role": "developer",
                        "content": (
                            "You are a careful Japanese pronunciation coach. Assess only what is audible. "
                            "Do not claim laboratory-grade pitch or phoneme measurements. Return valid JSON only."
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": self._pronunciation_prompt(
                                target, level, native_language, explanation_language
                            )},
                            {"type": "input_audio", "input_audio": {"data": audio, "format": "wav"}},
                        ],
                    },
                ],
            }
            safety_id = hashlib.sha256(f"ai-kotoba:{self.client_address[0]}".encode()).hexdigest()
            request = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
                method="POST",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "OpenAI-Safety-Identifier": safety_id,
                },
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read())
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            analysis = self._extract_json_object(content)
            self.send_json({"analysis": analysis, "model": result.get("model", AUDIO_MODEL)})
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw).get("error", {}).get("message", raw)
            except json.JSONDecodeError:
                detail = raw
            self.send_json({"error": f"OpenAI 音频分析：{str(detail)[:500]}"}, error.code)
        except (json.JSONDecodeError, ValueError, KeyError, IndexError) as error:
            self.send_json({"error": f"音频模型返回的诊断格式无效：{error}"}, 502)
        except Exception as error:
            self.send_json({"error": f"发音诊断失败：{error}"}, 500)

    @staticmethod
    def _pronunciation_prompt(target, level, native_language, explanation_language):
        return f'''Analyze a {native_language}-speaking JLPT {level} learner reading this Japanese sentence:

Target: {target}

Focus on audible intelligibility, long vowels, geminate consonants, moraic nasal, voicing, mora timing, pauses, and fluency. Pitch-accent comments must be cautious listening impressions, never laboratory measurements. Write all feedback in {explanation_language}; keep Japanese transcripts and drills in Japanese. Return only:
{{
  "transcript": "Japanese you actually heard",
  "overallScore": 0到100的整数,
  "dimensions": {{
    "intelligibility": {{"score": 0到100, "feedback": "short feedback in {explanation_language}"}},
    "sounds": {{"score": 0到100, "feedback": "short feedback in {explanation_language}"}},
    "rhythm": {{"score": 0到100, "feedback": "short feedback in {explanation_language}"}},
    "fluency": {{"score": 0到100, "feedback": "short feedback in {explanation_language}"}},
    "prosody": {{"score": 0到100, "feedback": "cautious feedback in {explanation_language}"}}
  }},
  "strengths": ["up to 3 specific strengths in {explanation_language}"],
  "issues": [{{"segment": "specific Japanese segment", "type": "issue type in {explanation_language}", "heard": "what it sounded like", "advice": "advice in {explanation_language}", "drill": "minimal Japanese drill"}}],
  "summary": "2-sentence summary in {explanation_language}",
  "practicePlan": ["up to 3 next exercises in {explanation_language}"]
}}'''

    @staticmethod
    def _extract_json_object(text):
        source = str(text)
        fence_start = source.find("```")
        if fence_start >= 0:
            first_line = source.find("\n", fence_start)
            fence_end = source.find("```", first_line + 1)
            if first_line >= 0 and fence_end > first_line:
                source = source[first_line + 1:fence_end]
        start = source.find("{")
        if start < 0:
            raise ValueError("未找到 JSON")
        value, _ = json.JSONDecoder().raw_decode(source[start:])
        if not isinstance(value, dict):
            raise ValueError("诊断结果不是对象")
        return value

    def create_realtime_session(self):
        """Use OpenAI's unified WebRTC interface so the standard key stays server-side."""
        try:
            length = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(length))
            sdp = str(body.get("sdp") or "")
            if not sdp.startswith("v=0"):
                self.send_json({"error": "无效的 WebRTC SDP"}, 400)
                return

            api_key = os.environ.get("OPENAI_API_KEY", "").strip() or str(body.get("apiKey") or "").strip()
            if not api_key:
                self.send_json({"error": "请在设置中填写 OpenAI API Key，或为 server.py 配置 OPENAI_API_KEY"}, 401)
                return

            voice = str(body.get("voice") or "marin")
            if voice not in {"marin", "cedar"}:
                voice = "marin"
            instructions = str(body.get("instructions") or "")[:12000]
            session = {
                "type": "realtime",
                "model": REALTIME_MODEL,
                "output_modalities": ["audio"],
                "instructions": instructions,
                "audio": {
                    "input": {
                        "transcription": {"model": "gpt-realtime-whisper", "language": "ja", "delay": "low"},
                        "turn_detection": {"type": "semantic_vad"},
                    },
                    "output": {"voice": voice},
                },
            }

            boundary = f"----AIKotoba{uuid.uuid4().hex}"
            multipart = self._multipart_body(boundary, sdp, json.dumps(session, ensure_ascii=False))
            safety_id = hashlib.sha256(f"ai-kotoba:{self.client_address[0]}".encode()).hexdigest()
            request = urllib.request.Request(
                "https://api.openai.com/v1/realtime/calls",
                data=multipart,
                method="POST",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "OpenAI-Safety-Identifier": safety_id,
                },
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                answer = response.read()
                self.send_response(response.status)
                self.send_header("content-type", "application/sdp")
                self.send_header("content-length", str(len(answer)))
                self.end_headers()
                self.wfile.write(answer)
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw).get("error", {}).get("message", raw)
            except json.JSONDecodeError:
                detail = raw
            self.send_json({"error": f"OpenAI Realtime API：{str(detail)[:500]}"}, error.code)
        except Exception as error:
            self.send_json({"error": f"Realtime 会话创建失败：{error}"}, 500)

    @staticmethod
    def _multipart_body(boundary, sdp, session_json):
        chunks = []
        for name, value, content_type in (
            ("sdp", sdp, "application/sdp"),
            ("session", session_json, "application/json"),
        ):
            chunks.append(f"--{boundary}\r\n".encode())
            chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n'.encode())
            chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode())
            chunks.append(value.encode("utf-8"))
            chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode())
        return b"".join(chunks)


if __name__ == "__main__":
    print(f"AI-Kotoba Web 已启动：http://localhost:{PORT}")
    print(f"本地 CLI 检测：claude={'✓' if find_cli('claude') else '✗'}  codex={'✓' if find_cli('codex') else '✗'}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
