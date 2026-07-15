# AI-Kotoba 公网版

这个目录把现有的 `AI_kotoba_newUI` HTML 界面封装成可部署的全栈网站。

- 页面公开访问，游客可浏览内置课文和对话。
- AI 生成、Realtime Tutor、发音诊断和云同步需要 Sign in with ChatGPT。
- D1 按登录邮箱隔离学习记录。
- OpenAI / ElevenLabs key 只存在服务端环境变量中。
- ElevenLabs 音频缓存在 R2，避免同一句话反复计费。
- 公测期每位用户有每日 AI 用量上限。

## 本地验证

需要 Node.js `>=22.13.0`：

```bash
npm install
npm run build
npm run dev
```

本地预览没有 Sites 注入的 ChatGPT 身份头，因此会显示游客演示模式。完整登录与多用户云同步要在 Sites 部署后验证。

## 服务端环境变量

必需：

- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`

可选：

- `OPENAI_FAST_MODEL`
- `OPENAI_AUDIO_MODEL`
- `OPENAI_REALTIME_MODEL`
- `ELEVENLABS_TTS_MODEL`
- `ELEVENLABS_JA_VOICE_A`
- `ELEVENLABS_JA_VOICE_B`
