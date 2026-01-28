import Foundation

enum Constants {
    static let maxHistoryCount = 100
    static let claudeAPIEndpoint = "https://api.anthropic.com/v1/messages"
    static let claudeAPIVersion = "2023-06-01"
    static let defaultModel = "claude-haiku-4-5-20251001"

    enum Keychain {
        static let service = "com.aikotoba.api"
        static let apiKeyAccount = "claude-api-key"
    }

    enum Prompts {
        static func scenarioPrompt(scenario: String) -> String {
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
    }
}
