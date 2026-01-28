# AI-Kotoba (AI言葉)

一个专为中国日语学习者设计的 macOS 原生应用，使用 AI 技术帮助你通过场景对话学习日语。

## 功能特点

### 1. 场景对话练习
- 输入任意场景（如"在餐厅点餐"），AI 自动生成自然的日语对话
- 每句对话都配有中文翻译
- 点击任意对话行，即可听到标准日语发音

### 2. 历史记录
- 自动保存最近 100 个场景
- 支持搜索和筛选
- 自动清理：超过 100 个时删除最旧的非收藏场景

### 3. 收藏功能
- 将喜欢的场景添加到收藏夹
- 收藏的场景不会被自动删除
- 随时回顾重要对话

### 4. 词汇表管理
- 手动添加日语词汇（单词、读音、中文释义、例句）
- 编辑和删除词汇
- 搜索功能快速查找
- 一键创建复习卡片

### 5. 智能复习系统
- 采用 SM-2 间隔重复算法（与 Anki 相同）
- 根据记忆难度调整复习时间
- 专注于困难内容，减少简单内容的重复

## 技术栈

- **界面框架**: SwiftUI (macOS 14+)
- **数据持久化**: SwiftData
- **AI 服务**: Anthropic Claude API
- **语音合成**: AVSpeechSynthesizer (系统内置日语语音)
- **编程语言**: Swift 5.9+

## 项目结构

```
AI-Kotoba/
├── Models/                    # 数据模型
│   ├── Scenario.swift         # 场景对话
│   ├── ConversationLine.swift # 对话行
│   ├── VocabularyItem.swift   # 词汇项
│   └── FlashCard.swift        # 复习卡片
├── ViewModels/                # 视图模型
│   ├── ScenarioViewModel.swift
│   ├── HistoryViewModel.swift
│   ├── VocabularyViewModel.swift
│   └── FlashCardViewModel.swift
├── Views/                     # 界面视图
│   ├── ContentView.swift      # 主导航
│   ├── ScenarioView.swift     # 场景生成
│   ├── ConversationView.swift # 对话显示
│   ├── HistoryView.swift      # 历史记录
│   ├── FavoritesView.swift    # 收藏夹
│   ├── VocabularyView.swift   # 词汇表
│   ├── FlashCardView.swift    # 复习卡片
│   └── SettingsView.swift     # 设置
├── Services/                  # 服务层
│   ├── ClaudeService.swift    # Claude API 集成
│   ├── TTSService.swift       # 语音合成
│   └── SRSAlgorithm.swift     # 间隔重复算法
└── Utilities/                 # 工具类
    ├── APIKeyManager.swift    # API 密钥管理
    └── Constants.swift        # 常量定义
```

## 快速开始

### 前置要求

1. **macOS 14 (Sonoma) 或更高版本**
2. **Xcode 15 或更高版本**
3. **Claude API 密钥** - 从 [Anthropic Console](https://console.anthropic.com/settings/keys) 获取

### 安装步骤

#### 方法 1: 使用 Xcode (推荐)

1. **克隆或下载项目**
   ```bash
   git clone https://github.com/yourusername/AI-Kotoba.git
   cd AI-Kotoba
   ```

2. **创建 Xcode 项目**

   打开 Xcode，选择 "Create a new Xcode project":
   - Platform: macOS
   - Template: App
   - Product Name: AI-Kotoba
   - Organization Identifier: com.yourname
   - Interface: SwiftUI
   - Language: Swift
   - Storage: SwiftData
   - 保存位置: 选择本项目的根目录

3. **添加源文件**

   在 Xcode 中:
   - 删除 Xcode 自动创建的默认文件
   - 将 `AI-Kotoba` 文件夹拖入项目导航器
   - 确保选择 "Create groups"（不要选 "Create folder references"）
   - 确保 "Add to targets" 中勾选了 "AI-Kotoba"

4. **构建并运行**

   按 `Cmd + R` 或点击运行按钮

#### 方法 2: 使用设置脚本

```bash
./setup.sh
```

然后按照脚本中的说明操作。

### 首次运行

1. 启动应用后，会提示输入 Claude API 密钥
2. 输入你的 API 密钥（从 [Anthropic Console](https://console.anthropic.com/settings/keys) 获取）
3. API 密钥将安全地存储在 macOS 钥匙串中
4. 开始创建你的第一个学习场景！

## 使用指南

### 1. 创建场景对话

1. 点击侧边栏的 "练习" 标签
2. 在输入框中描述场景，例如：
   - "在便利店买东西"
   - "问路"
   - "预约餐厅"
   - "办理酒店入住"
3. 点击 "生成对话"
4. 等待 AI 生成对话（通常需要几秒钟）

### 2. 学习对话

- 点击任意对话行，听日语发音
- 对比日语原文和中文翻译
- 点击星标将场景添加到收藏

### 3. 管理词汇

1. 点击 "词汇" 标签
2. 点击 "添加词汇" 按钮
3. 填写：
   - 单词（日语汉字）
   - 读音（平假名/片假名）
   - 意思（中文）
   - 例句（可选）
4. 点击词汇旁的卡片图标创建复习卡片

### 4. 复习卡片

1. 点击 "复习卡片" 标签
2. 看到日语（正面），尝试回忆中文意思
3. 点击卡片翻转查看答案
4. 根据记忆难度选择：
   - **再来** (0) - 完全不记得
   - **困难** (3) - 想起来但很费力
   - **良好** (4) - 想起来有点犹豫
   - **简单** (5) - 轻松想起来

### 5. 查看历史

- "历史" 标签显示最近 100 个场景
- 使用搜索框快速查找
- 滑动删除不需要的场景

## 间隔重复算法 (SM-2)

本应用使用经典的 SuperMemo SM-2 算法：

- **质量评分**: 0-5 分
- **间隔计算**:
  - 第一次: 1 天
  - 第二次: 6 天
  - 之后: 上次间隔 × 难度因子
- **难度因子**: 根据你的回答动态调整
- **遗忘处理**: 评分 < 3 时重置学习进度

## 数据隐私

- **本地存储**: 所有数据（场景、词汇、复习记录）都存储在本地
- **API 密钥安全**: Claude API 密钥存储在 macOS 钥匙串中
- **离线可用**: 除了生成新场景，其他功能都可离线使用
- **无数据收集**: 应用不收集或上传任何用户数据

## 常见问题

### Q: API 密钥存储在哪里？
A: API 密钥安全地存储在 macOS 钥匙串中，只有本应用可以访问。

### Q: 生成对话需要多长时间？
A: 通常 3-10 秒，取决于网络速度和 Claude API 响应时间。

### Q: 可以导出我的数据吗？
A: 当前版本暂不支持导出，数据存储在 SwiftData 容器中。未来版本将添加导出功能。

### Q: 为什么历史只保存 100 个？
A: 这是为了保持应用性能和数据库大小合理。重要的场景可以添加到收藏，收藏数量无限制。

### Q: 日语发音听起来不自然？
A: 应用使用 macOS 系统内置的日语语音。虽然不如真人，但对学习发音已经足够。你可以在系统设置中选择不同的日语语音。

### Q: 支持其他语言学习吗？
A: 当前版本专为日语学习设计。如需其他语言，可以修改提示词和语音设置。

## 开发和贡献

### 开发环境设置

1. 克隆仓库
2. 打开 Xcode 项目
3. 选择 "My Mac" 作为运行目标
4. 构建并运行

### 代码结构

- **MVVM 架构**: 清晰分离视图、视图模型和模型
- **SwiftData**: 简单高效的数据持久化
- **Observable**: 使用 Swift 5.9 的 `@Observable` 宏
- **Async/Await**: 所有异步操作使用现代并发

### 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 致谢

- **Anthropic Claude**: 提供强大的 AI 对话生成能力
- **SuperMemo**: SM-2 间隔重复算法
- **Apple**: SwiftUI 和 SwiftData 框架

## 联系方式

如有问题或建议，请提交 Issue: https://github.com/yourusername/AI-Kotoba/issues

---

**AI-Kotoba** - 用 AI 的力量，让日语学习更高效！🇯🇵✨
