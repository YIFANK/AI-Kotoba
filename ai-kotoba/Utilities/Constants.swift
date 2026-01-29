import Foundation

enum AIProvider: String, Codable {
    case claude = "claude"
    case openai = "openai"
}

enum Constants {
    static let maxHistoryCount = 100
    static let claudeAPIEndpoint = "https://api.anthropic.com/v1/messages"
    static let claudeAPIVersion = "2023-06-01"
    static let defaultModel = "claude-haiku-4-5-20251001"

    enum OpenAI {
        static let endpoint = "https://api.openai.com/v1/chat/completions"
        static let defaultModel = "gpt-5-mini"
    }

    enum Keychain {
        static let service = "com.aikotoba.api"
        static let apiKeyAccount = "claude-api-key"
        static let openAIKeyAccount = "openai-api-key"
    }

    enum Prompts {
        // First turn: Generate Japanese content only
        static func scenarioPromptJapanese(scenario: String) -> String {
            """
            あなたは日本語教育のエキスパートです。学習者が「実際に日本で耳にする生きた表現」を学べるよう、指定されたシーンに最適な会話文を作成してください。

            ### シーン
            \(scenario)

            ### 指導・作成ガイドライン
            1. **自然なやり取り**: 教科書的な硬すぎる日本語ではなく、対象シーンにおいて日本人が日常的に使う自然な相槌、省略、語彙（〜ですね、〜ちゃう、など）を適切に含めてください。
            2. **適切な敬語レベル**: 登場人物の関係性（初対面、友人、上司と部下など）を考慮し、最も自然な敬語やタメ口を選択してください。
            3. **会話の構成**: 2名の人物による6〜10往復程度の、文脈のある会話にしてください。
            4. **語彙の選定**: 会話の中から、学習者が覚えるべき重要かつ実用的な表現を5〜10個抽出してください。

            ### 出力形式 (JSON)
            以下の構造で出力してください：
            {
              "conversation": [
                {
                  "speaker": "話者A",
                  "japanese": "日本語のセリフ"
                }
              ],
              "vocabulary": [
                {
                  "word": "単語（漢字表記）",
                  "reading": "読み方（ひらがな）",
                  "example": "その単語を使った別の短い例文"
                }
              ]
            }
            """
        }

        // Second turn: Translate to Chinese
        static func scenarioPromptTranslation(japaneseJSON: String) -> String {
            """
            你是一个专业的日中翻译。请将以下JSON中的日语内容翻译成中文，并以相同的JSON格式返回翻译结果。

            要求：
            1. 对于conversation数组中的每一项，添加"chinese"字段，包含"japanese"字段的中文翻译
            2. 对于vocabulary数组中的每一项，添加"meaning"字段，包含单词的中文意思

            原始JSON：
            \(japaneseJSON)

            请返回完整的JSON，包含所有原有字段以及新增的中文翻译字段。
            """
        }

        // Legacy single-turn prompt (kept for reference, not used)
        static func scenarioPromptLegacy(scenario: String) -> String {
            """
            你是一个帮助中国人学习日语的助手。请为以下场景生成一段自然、真实的日语对话：\(scenario)

            要求：
            1. 创建一段包含6-10轮对话的对话，涉及2个人
            2. 使用适合该场景的礼貌程度
            3. 包含常用短语和自然表达
            4. 提取对话中的重要词汇（5-10个）

            请以JSON格式返回，格式如下：
            {
              "conversation": [
                {
                  "speaker": "说话者名称",
                  "japanese": "日语文本",
                  "chinese": "中文翻译"
                }
              ],
              "vocabulary": [
                {
                  "word": "日语单词（汉字）",
                  "reading": "假名读音",
                  "meaning": "中文意思",
                  "example": "例句"
                }
              ]
            }

            场景：\(scenario)
            """
        }

        static func feedbackPrompt(chinesePrompt: String, userResponse: String, correctResponse: String) -> String {
            """
            你是一个日语学习助手。学生需要将以下中文翻译成日语：

            中文：\(chinesePrompt)

            学生的回答：\(userResponse)
            标准答案：\(correctResponse)

            请评价学生的回答，给出1-10分的评分，并用中文解释为什么一方的回答更好或者两者相当。

            请以JSON格式返回：
            {
              "score": 分数（1-10），
              "explanation": "中文解释"
            }

            评分标准：
            - 10分：完美，与标准答案意思完全一致且表达自然
            - 7-9分：很好，意思正确但表达略有不同或有小瑕疵
            - 4-6分：基本正确，但有明显错误或不自然
            - 1-3分：错误较多或意思不对
            """
        }
    }
}
