# AI-Kotoba Web

macOS 版 AI-Kotoba 的网页版：面向任意母语学习者的 AI 日语情景会话学习工具。无需构建；可以纯静态运行，也可以使用自带的轻量 Python 服务获得跨浏览器数据同步、本地 CLI 与更安全的 Realtime 语音接入。

## 运行

推荐用自带的桥接服务器（支持「本地 CLI」免 Key 生成）：

```bash
cd ai-kotoba-web
python3 -m pip install -r requirements.txt  # 首次安装日语形态分析器
python3 server.py          # 打开 http://localhost:8734（默认进入新 UI）
```

GPT 语音 Tutor 推荐把标准 OpenAI API Key 只放在服务端：

```bash
cd ai-kotoba-web
OPENAI_API_KEY=sk-... python3 server.py
```

同一 Key 也用于文章逐词释义与缺失生词翻译；这些轻量任务默认走 `gpt-5.6-luna`，可用 `OPENAI_FAST_MODEL` 覆盖。完整课文释义会批量生成并缓存，不会在每次点击生词时重复调用。

文章与会话朗读可选 ElevenLabs。把 `ELEVENLABS_API_KEY` 放在仓库根目录 `.env` 后，服务端默认使用高音质 `eleven_v3`，并从账号已有声音中优先选择经过日语验证、录音质量较高的 voice。也可以用 `ELEVENLABS_JA_VOICE_A` / `ELEVENLABS_JA_VOICE_B` 固定两个 Voice ID；网页不会接触 API Key，生成的音频会持久缓存到被 Git 忽略的 `.tts-cache`，服务不可用时自动回退系统日语语音。

个人本地开发也可以在「设置」里填写 OpenAI Key；网页会把它发送给同机的 `server.py` 建立 Realtime 会话。纯静态托管保留浏览器直连作为兼容路径，但不适合公开部署。

也可以用任意静态服务器(如 `python3 -m http.server`),但此时「本地 CLI」不可用,只能走 API Key。

> 语音识别(麦克风)要求安全上下文,`localhost` 或 HTTPS 均可;推荐 Chrome / Edge / Safari。

## 功能(与 macOS 版对齐)

- **任意学习者语言**:在设置中自由填写母语和解释语言；场景、阅读、Tutor、课后复盘、互动反馈与发音诊断都会使用该档案。界面首版支持简体中文 / English 切换
- **两轮 AI 生成**:第一轮纯日语生成会话,第二轮按学习者的解释语言翻译,避免目标语言与翻译混写导致的不自然表达(`js/services.js`)
- **三种 AI 来源**:本地 CLI(`server.py` 桥接本机已登录的 Claude Code / Codex,免 API Key)、Claude API、OpenAI API
- **普通会话模式**:点击句子即可 TTS 朗读(ja-JP),生词建议一键加入生词本
- **双 TTS 引擎 + A/B 双音色**:配置后优先由服务端调用 ElevenLabs `eleven_v3`，自动选择账号内高质量日语 voice；角色 A / B 按台词奇偶分别使用两个音色，也可通过环境变量固定 Voice ID。会话支持 0.6× / 0.75× / 0.9× / 1.0× 语速并保持音高，调速直接复用服务端缓存，不会重复计费；失败自动回退系统语音
- **汉字注音(振り仮名)**:生成时 AI 输出「漢字[かんじ]」标记,前端渲染为 `<ruby>` 注音,一键开关
- **阅读文章**:输入任意请求,两轮生成日语短文,支持注音、逐段翻译对照、逐段朗读、生词一键收藏
- **三行对译与精细选词**:文章按「带 furigana 的原文 / 逐词语境释义 / 自然对译」显示；SudachiPy B 模式提供词边界、词典形、标准读音、词性和活用形式，点击活用词时会按词典形收入生词本。若依赖不可用，自动降级到浏览器日语分词
- **每日签到**:任何学习行为(生成、复习、跟读)自动打卡,练习页显示连续天数与最近 7 天记录
- **AI 语音 Tutor**:使用 GPT-Realtime-2.1 + WebRTC 进行原生语音到语音的日语口语课，支持自然会话 / 即时纠错 / 口试训练、Marin / Cedar 声音、打断、日语实时转写与所选语言的课后复盘。Tutor 会保存近期错误作为长期学习重点，在后续课程里自然复现；学习者也可以直接用语音要求 Tutor 把表达加入生词复习或记住某个错误。`server.py` 会优先通过统一 Realtime 接口建连；纯静态托管保留浏览器 BYOK 兼容路径
- **Tutor 学习闭环**:课后复盘自动沉淀个人弱点与课程记录，推荐表达支持一键全部加入 SM-2 间隔复习；学习档案显示累计课程、长期重点与待复习数量
- **发音诊断**:浏览器录制单声道 WAV，使用 `gpt-audio-1.5` 直接听取目标句与学习者录音，提供可理解度、长音/促音/拨音/清浊音、拍节奏、流畅度与谨慎的语调听感反馈。结果会保存用于趋势分析，原始录音不会写入学习数据
- **数据持久化**:所有学习数据经 server.py 存入 data.json,同一台电脑上任意浏览器共享,清缓存不丢失
- **互动模式**:选择扮演角色 A / B / 双方,按 `orderIndex % 2` 奇偶判定轮次;支持日语语音输入(Web Speech API)或文字输入,AI 使用所选解释语言反馈
- **生词本**:搜索、朗读、删除,显示下次复习时间
- **闪卡复习**:SM-2 间隔重复算法,quality < 3 重置进度、>= 3 拉长间隔(`js/srs.js`)
- **历史 / 收藏**:非收藏会话最多保留 100 条,收藏豁免自动清理
- **设置**:支持 Claude 与 OpenAI,密钥保存时自动 trim;数据可导出 / 导入 / 清空
- **演示模式**:未配置 API Key 时,「练习」会加载内置演示会话,其余功能均可体验

## 文件结构

```
../AI_kotoba_newUI/AI-Kotoba.dc.html  新版页面与三行对译阅读
../AI_kotoba_newUI/integration.js     新 UI 与数据、生成、Realtime 的连接层
index.html        旧版页面入口（仍可通过 /ai-kotoba-web/index.html 打开）
server.py         静态服务、数据同步、本地 CLI 与 Realtime 建连桥接
requirements.txt  SudachiPy 与核心日语词典
css/style.css     浅色简约主题
js/app.js         所有视图与交互逻辑
js/services.js    Claude/OpenAI 调用、两轮提示词、JSON 提取(括号配对)
js/storage.js     localStorage 持久化、100 条历史上限
js/srs.js         SM-2 算法
js/speech.js      日语 TTS 与语音识别
js/realtime.js    GPT Realtime WebRTC 语音 Tutor
js/pronunciation.js  WAV 录音与 GPT Audio 发音诊断
js/i18n.js        中英文界面词典与切换
```
