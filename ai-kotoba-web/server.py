#!/usr/bin/env python3
"""AI-Kotoba Web 本地服务器
静态文件 + AI 桥接：POST /api/ai 调用本机已登录的 claude / codex CLI，
或安全使用服务端 OPENAI_API_KEY，让网页无需接触标准 API Key。

用法：python3 server.py [端口，默认 8734]
"""
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_ROOT = os.path.dirname(ROOT)
DEFAULT_UI = "/AI_kotoba_newUI/AI-Kotoba.dc.html"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
TIMEOUT = 300  # CLI 单次调用超时（秒）
REALTIME_MODEL = "gpt-realtime-2.1"
AUDIO_MODEL = "gpt-audio-1.5"
DATA_FILE = os.path.join(ROOT, "data.json")  # 学习数据持久化（跨浏览器共享）
SUDACHI_LOCK = threading.Lock()
SUDACHI_TOKENIZER = None
SUDACHI_ERROR = None
ELEVENLABS_VOICE_LOCK = threading.Lock()
ELEVENLABS_JAPANESE_VOICES = None
ELEVENLABS_TTS_CACHE_LOCK = threading.Lock()
ELEVENLABS_TTS_CACHE_DIR = os.path.join(ROOT, ".tts-cache")
DEFAULT_ELEVENLABS_VOICES = {
    "a": "Xb7hH8MSUJpSbSDYk0k2",  # Alice: clear educator, verified ja-JP
    "b": "JBFqnCBsd6RMkjVDRZzb",  # George: warm storyteller, verified ja-JP
}


def load_dotenv(path):
    """Load simple KEY=VALUE pairs without overriding variables from the launching shell."""
    try:
        with open(path, encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].lstrip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if not key or not (key[0].isalpha() or key[0] == "_") or not all(
                    char.isalnum() or char == "_" for char in key
                ):
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except FileNotFoundError:
        pass


for env_path in (os.path.join(STATIC_ROOT, ".env"), os.path.join(ROOT, ".env")):
    load_dotenv(env_path)


def get_sudachi_tokenizer():
    """Load Sudachi lazily so the rest of the app still runs without the optional dictionary."""
    global SUDACHI_TOKENIZER, SUDACHI_ERROR
    if SUDACHI_TOKENIZER is not None:
        return SUDACHI_TOKENIZER
    if SUDACHI_ERROR is not None:
        return None
    try:
        from sudachipy import dictionary
        SUDACHI_TOKENIZER = dictionary.Dictionary(dict="core").create()
    except Exception as error:
        SUDACHI_ERROR = str(error)
    return SUDACHI_TOKENIZER


def katakana_to_hiragana(text):
    return "".join(chr(ord(char) - 0x60) if "ァ" <= char <= "ヶ" else char for char in text)

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
        super().__init__(*args, directory=STATIC_ROOT, **kwargs)

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
        if self.path in {"/", "/index.html"}:
            self.send_response(302)
            self.send_header("Location", DEFAULT_UI)
            self.end_headers()
        elif self.path == "/api/status":
            has_openai_key = bool(os.environ.get("OPENAI_API_KEY", "").strip())
            has_elevenlabs_key = bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())
            self.send_json({
                "claude": bool(find_cli("claude")),
                "codex": bool(find_cli("codex")),
                "openai_text": has_openai_key,
                "openai_realtime": has_openai_key,
                "openai_fast_model": os.environ.get("OPENAI_FAST_MODEL", "gpt-5.6-luna").strip() or "gpt-5.6-luna",
                "elevenlabs_tts": has_elevenlabs_key,
                "elevenlabs_model": os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_v3").strip() or "eleven_v3",
                "elevenlabs_japanese_voices_configured": bool(
                    os.environ.get("ELEVENLABS_JA_VOICE_A", "").strip()
                    or os.environ.get("ELEVENLABS_JA_VOICE_B", "").strip()
                ),
                "sudachipy": get_sudachi_tokenizer() is not None,
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
        if self.path == "/api/tts/elevenlabs":
            self.create_elevenlabs_speech()
            return
        if self.path == "/api/tokenize":
            self.tokenize_japanese()
            return
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
            schema = (body.get("schema") or "").strip()
            if engine == "openai":
                text = self.call_openai_text(prompt, model, json_mode=bool(schema))
            else:
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

    def create_elevenlabs_speech(self):
        """Generate Japanese audio without exposing the ElevenLabs key to the browser."""
        try:
            length = int(self.headers.get("content-length", 0))
            if length <= 0 or length > 64 * 1024:
                self.send_json({"error": "朗读文本为空或过长"}, 413)
                return
            body = json.loads(self.rfile.read(length))
            text = re.sub(r"\[[^\]\n]+\]", "", str(body.get("text") or "")).strip()
            if not text:
                self.send_json({"error": "没有可朗读的日语文本"}, 400)
                return
            if len(text) > 5000:
                self.send_json({"error": "单次朗读最多 5000 个字符，请按句播放"}, 413)
                return

            api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
            if not api_key:
                self.send_json({"error": "服务端未配置 ELEVENLABS_API_KEY"}, 401)
                return

            role = "b" if str(body.get("role") or "a").lower() == "b" else "a"
            model = os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_v3").strip() or "eleven_v3"
            voice_id = self._elevenlabs_voice_id(api_key, role)
            cache_key = hashlib.sha256(json.dumps({
                "version": 1,
                "model": model,
                "voice": voice_id,
                "text": text,
            }, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
            cache_path = os.path.join(ELEVENLABS_TTS_CACHE_DIR, f"{cache_key}.mp3")
            with ELEVENLABS_TTS_CACHE_LOCK:
                try:
                    with open(cache_path, "rb") as cache_file:
                        cached_audio = cache_file.read()
                except FileNotFoundError:
                    cached_audio = b""
            if cached_audio:
                self._send_elevenlabs_audio(cached_audio, model, "hit")
                return
            request_body = {
                "text": text,
                "model_id": model,
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "style": 0.15,
                    "use_speaker_boost": True,
                },
            }
            # multilingual_v2 detects language automatically and rejects language_code.
            if model != "eleven_multilingual_v2":
                request_body["language_code"] = "ja"
            request = urllib.request.Request(
                "https://api.elevenlabs.io/v1/text-to-speech/"
                f"{urllib.parse.quote(voice_id, safe='')}?output_format=mp3_44100_128",
                data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
                method="POST",
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    audio = response.read()
            except urllib.error.HTTPError as error:
                raw = error.read().decode("utf-8", errors="replace")
                free_library_block = (
                    error.code == 402
                    and "free users cannot use library voices" in raw.lower()
                    and voice_id != DEFAULT_ELEVENLABS_VOICES[role]
                )
                if not free_library_block:
                    self.send_json({"error": f"ElevenLabs TTS：{self._elevenlabs_error_detail(raw)}"}, error.code)
                    return

                # Free accounts can list library voices but cannot synthesize them via API.
                # Retry once with an official multilingual default and remember that choice.
                global ELEVENLABS_JAPANESE_VOICES
                with ELEVENLABS_VOICE_LOCK:
                    ELEVENLABS_JAPANESE_VOICES = []
                fallback_id = DEFAULT_ELEVENLABS_VOICES[role]
                fallback_request = urllib.request.Request(
                    "https://api.elevenlabs.io/v1/text-to-speech/"
                    f"{urllib.parse.quote(fallback_id, safe='')}?output_format=mp3_44100_128",
                    data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
                    method="POST",
                    headers={
                        "xi-api-key": api_key,
                        "Content-Type": "application/json",
                        "Accept": "audio/mpeg",
                    },
                )
                with urllib.request.urlopen(fallback_request, timeout=90) as response:
                    audio = response.read()
            if not audio:
                raise RuntimeError("ElevenLabs 返回了空音频")
            os.makedirs(ELEVENLABS_TTS_CACHE_DIR, exist_ok=True)
            temp_path = f"{cache_path}.{uuid.uuid4().hex}.tmp"
            try:
                with open(temp_path, "wb") as cache_file:
                    cache_file.write(audio)
                with ELEVENLABS_TTS_CACHE_LOCK:
                    os.replace(temp_path, cache_path)
            finally:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass
            self._send_elevenlabs_audio(audio, model, "miss")
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            self.send_json({"error": f"ElevenLabs TTS：{self._elevenlabs_error_detail(raw)}"}, error.code)
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            self.send_json({"error": f"朗读请求无效：{error}"}, 400)
        except Exception as error:
            self.send_json({"error": f"ElevenLabs TTS 失败：{error}"}, 500)

    @staticmethod
    def _elevenlabs_voice_id(api_key, role):
        """Pick an explicit voice, otherwise the best available verified Japanese voice."""
        explicit = os.environ.get(f"ELEVENLABS_JA_VOICE_{role.upper()}", "").strip()
        if explicit:
            return explicit

        global ELEVENLABS_JAPANESE_VOICES
        with ELEVENLABS_VOICE_LOCK:
            if ELEVENLABS_JAPANESE_VOICES is None:
                request = urllib.request.Request(
                    "https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false",
                    headers={"xi-api-key": api_key, "Accept": "application/json"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        voices = json.loads(response.read()).get("voices", [])
                except Exception:
                    voices = []

                def score(voice):
                    verified = voice.get("verified_languages") or []
                    labels = voice.get("labels") or {}
                    language_text = " ".join(str(value).lower() for value in labels.values())
                    japanese_verified = any(
                        str(item.get("language") or "").lower() in {"ja", "jpn", "japanese"}
                        or str(item.get("locale") or "").lower().startswith("ja")
                        for item in verified
                    )
                    points = 100 if japanese_verified else 0
                    if "japanese" in language_text or "日本語" in language_text:
                        points += 50
                    points += {"studio": 20, "good": 12, "ok": 4}.get(voice.get("recording_quality"), 0)
                    points += {"professional": 14, "generated": 8, "cloned": 6, "premade": 4}.get(voice.get("category"), 0)
                    if not voice.get("is_legacy"):
                        points += 3
                    return points

                ranked = sorted(voices, key=score, reverse=True)
                japanese = [voice for voice in ranked if score(voice) >= 50 and voice.get("voice_id")]
                ELEVENLABS_JAPANESE_VOICES = [voice["voice_id"] for voice in japanese[:2]]

            available = ELEVENLABS_JAPANESE_VOICES
            if available:
                return available[1] if role == "b" and len(available) > 1 else available[0]
        return DEFAULT_ELEVENLABS_VOICES[role]

    @staticmethod
    def _elevenlabs_error_detail(raw):
        try:
            detail = json.loads(raw).get("detail", raw)
            if isinstance(detail, dict):
                detail = detail.get("message", detail)
        except (json.JSONDecodeError, AttributeError):
            detail = raw
        return str(detail)[:500]

    def _send_elevenlabs_audio(self, audio, model, cache_status):
        self.send_response(200)
        self.send_header("content-type", "audio/mpeg")
        self.send_header("content-length", str(len(audio)))
        self.send_header("x-ai-kotoba-tts-model", model)
        self.send_header("x-ai-kotoba-tts-cache", cache_status)
        self.end_headers()
        self.wfile.write(audio)

    def call_openai_text(self, prompt, model=None, json_mode=False):
        """Run short, high-volume text tasks without exposing the server API key."""
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("服务端未配置 OPENAI_API_KEY")
        selected_model = model or os.environ.get("OPENAI_FAST_MODEL", "gpt-5.6-luna").strip() or "gpt-5.6-luna"
        request_body = {
            "model": selected_model,
            "store": False,
            "messages": [{"role": "user", "content": prompt}],
        }
        if json_mode:
            request_body["response_format"] = {"type": "json_object"}
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
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw).get("error", {}).get("message", raw)
            except json.JSONDecodeError:
                detail = raw
            raise RuntimeError(f"OpenAI 轻量模型：{str(detail)[:500]}") from error
        return result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

    def tokenize_japanese(self):
        """Return learner-friendly Japanese morphology with offsets, lemma, reading, and POS."""
        try:
            length = int(self.headers.get("content-length", 0))
            if length <= 0 or length > 128 * 1024:
                self.send_json({"error": "分词文本为空或过长"}, 413)
                return
            body = json.loads(self.rfile.read(length))
            text = str(body.get("text") or "")[:20000]
            mode_name = str(body.get("mode") or "B").upper()
            if mode_name not in {"A", "B", "C"}:
                mode_name = "B"
            if not text:
                self.send_json({"tokens": [], "mode": mode_name, "engine": "sudachipy"})
                return

            tokenizer = get_sudachi_tokenizer()
            if tokenizer is None:
                self.send_json({
                    "error": "SudachiPy 尚未安装",
                    "install": "python3 -m pip install -r ai-kotoba-web/requirements.txt",
                    "detail": SUDACHI_ERROR,
                }, 503)
                return

            from sudachipy import tokenizer as sudachi_tokenizer
            split_mode = getattr(sudachi_tokenizer.Tokenizer.SplitMode, mode_name)
            with SUDACHI_LOCK:
                morphemes = list(tokenizer.tokenize(text, split_mode))

            tokens = []
            cursor = 0
            for morpheme in morphemes:
                surface = morpheme.surface()
                start = text.find(surface, cursor)
                if start < 0:
                    start = cursor
                end = start + len(surface)
                cursor = end
                pos = list(morpheme.part_of_speech())
                reading = morpheme.reading_form()
                tokens.append({
                    "surface": surface,
                    "start": start,
                    "end": end,
                    "dictionaryForm": morpheme.dictionary_form(),
                    "normalizedForm": morpheme.normalized_form(),
                    "reading": reading,
                    "readingHiragana": katakana_to_hiragana(reading),
                    "partOfSpeech": pos,
                    "pos": pos[0] if pos else "",
                    "wordLike": bool(surface.strip()) and (not pos or pos[0] not in {"空白", "補助記号"}),
                    "isOov": morpheme.dictionary_id() < 0,
                })
            self.send_json({"tokens": tokens, "mode": mode_name, "engine": "sudachipy"})
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            self.send_json({"error": f"分词请求无效：{error}"}, 400)
        except Exception as error:
            self.send_json({"error": f"日语分词失败：{error}"}, 500)

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
            input_language = str(body.get("inputLanguage") or "ja").strip().lower()
            transcription = {"model": "gpt-realtime-whisper", "delay": "low"}
            if input_language and input_language != "auto":
                transcription["language"] = input_language
            session = {
                "type": "realtime",
                "model": REALTIME_MODEL,
                "output_modalities": ["audio"],
                "instructions": instructions,
                "audio": {
                    "input": {
                        "transcription": transcription,
                        "turn_detection": None,
                    },
                    "output": {"voice": voice},
                },
                "truncation": {
                    "type": "retention_ratio",
                    "retention_ratio": 0.8,
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
