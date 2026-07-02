# AI-Kotoba Web

macOS 版 AI-Kotoba 的网页版:面向中文母语者的 AI 日语情景会话学习工具。纯静态站点,无需构建、无后端,数据全部保存在浏览器 localStorage,API 请求直接从浏览器发出。

## 运行

推荐用自带的桥接服务器(支持「本地 CLI」免 Key 生成):

```bash
cd ai-kotoba-web
python3 server.py          # 打开 http://localhost:8734
```

也可以用任意静态服务器(如 `python3 -m http.server`),但此时「本地 CLI」不可用,只能走 API Key。

> 语音识别(麦克风)要求安全上下文,`localhost` 或 HTTPS 均可;推荐 Chrome / Edge / Safari。

## 功能(与 macOS 版对齐)

- **两轮 AI 生成**:第一轮纯日语生成会话,第二轮补充中文翻译,避免中日夹杂导致的不自然表达(`js/services.js`)
- **三种 AI 来源**:本地 CLI(`server.py` 桥接本机已登录的 Claude Code / Codex,免 API Key)、Claude API、OpenAI API
- **普通会话模式**:点击句子即可 TTS 朗读(ja-JP),生词建议一键加入生词本
- **双 TTS 引擎 + A/B 双音色**:默认浏览器系统语音;可切换 ElevenLabs,角色 A / B 按台词奇偶分别使用两个音色(默认 Sarah 女声 / George 男声,可换任意 Voice ID),同句音频本页缓存避免重复计费,失败自动回退系统语音
- **汉字注音(振り仮名)**:生成时 AI 输出「漢字[かんじ]」标记,前端渲染为 `<ruby>` 注音,一键开关
- **阅读文章**:输入任意请求(如「N4 水平,介绍我最喜欢的漫画家」),两轮生成日语短文,支持注音、逐段中文对照、逐段朗读、生词一键收藏
- **每日签到**:任何学习行为(生成、复习、跟读)自动打卡,练习页显示连续天数与最近 7 天记录
- **互动模式**:选择扮演角色 A / B / 双方,按 `orderIndex % 2` 奇偶判定轮次;支持日语语音输入(Web Speech API)或文字输入,AI 给出中文反馈
- **生词本**:搜索、朗读、删除,显示下次复习时间
- **闪卡复习**:SM-2 间隔重复算法,quality < 3 重置进度、>= 3 拉长间隔(`js/srs.js`)
- **历史 / 收藏**:非收藏会话最多保留 100 条,收藏豁免自动清理
- **设置**:支持 Claude 与 OpenAI,密钥保存时自动 trim;数据可导出 / 导入 / 清空
- **演示模式**:未配置 API Key 时,「练习」会加载内置演示会话,其余功能均可体验

## 文件结构

```
index.html        页面骨架(侧边栏 + 主视图)
css/style.css     浅色简约主题
js/app.js         所有视图与交互逻辑
js/services.js    Claude/OpenAI 调用、两轮提示词、JSON 提取(括号配对)
js/storage.js     localStorage 持久化、100 条历史上限
js/srs.js         SM-2 算法
js/speech.js      日语 TTS 与语音识别
```
