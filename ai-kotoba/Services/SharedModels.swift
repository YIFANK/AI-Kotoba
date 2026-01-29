import Foundation

// MARK: - Japanese-Only Response Models (First Turn)

struct ScenarioResponseJapanese: Codable {
    let conversation: [ConversationItemJapanese]
    let vocabulary: [VocabularyDataJapanese]

    struct ConversationItemJapanese: Codable {
        let speaker: String
        let japanese: String
    }

    struct VocabularyDataJapanese: Codable {
        let word: String
        let reading: String
        let example: String
    }
}

// MARK: - Full Response Models (After Translation Merge)

struct ScenarioResponse: Codable {
    let conversation: [ConversationItem]
    let vocabulary: [VocabularyData]

    struct ConversationItem: Codable {
        let speaker: String
        let japanese: String
        let chinese: String
    }

    struct VocabularyData: Codable {
        let word: String
        let reading: String
        let meaning: String
        let example: String
    }
}

struct ScenarioResult {
    let conversationLines: [ConversationLine]
    let vocabularySuggestions: [VocabularySuggestion]
}

struct VocabularySuggestion: Identifiable {
    let id = UUID()
    let word: String
    let reading: String
    let meaning: String
    let example: String
}

// MARK: - Feedback Response Models

struct FeedbackResponse: Codable {
    let score: Int
    let explanation: String
}

struct FeedbackResult {
    let score: Int
    let explanation: String
}

// MARK: - JSON Parsing Utility

/// Shared utility for parsing JSON responses from AI services
enum JSONParsingUtility {
    /// Extracts JSON from text that may be wrapped in markdown code blocks or have surrounding text
    static func extractJSON(from text: String) -> String {
        // Try to extract from markdown code blocks first
        if let jsonBlockStart = text.range(of: "```json"),
           let jsonBlockEnd = text.range(of: "```", range: jsonBlockStart.upperBound..<text.endIndex) {
            let jsonContent = text[jsonBlockStart.upperBound..<jsonBlockEnd.lowerBound]
            return jsonContent.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        // Try generic code block
        if let codeBlockStart = text.range(of: "```"),
           let codeBlockEnd = text.range(of: "```", range: codeBlockStart.upperBound..<text.endIndex) {
            let jsonContent = text[codeBlockStart.upperBound..<codeBlockEnd.lowerBound]
            return jsonContent.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        // Find JSON object by matching braces
        guard let firstBrace = text.firstIndex(of: "{") else {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        var braceCount = 0
        var lastBrace: String.Index?

        for (index, char) in text[firstBrace...].enumerated() {
            let currentIndex = text.index(firstBrace, offsetBy: index)
            if char == "{" {
                braceCount += 1
            } else if char == "}" {
                braceCount -= 1
                if braceCount == 0 {
                    lastBrace = currentIndex
                    break
                }
            }
        }

        if let lastBrace = lastBrace {
            return String(text[firstBrace...lastBrace])
        }

        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Parses scenario JSON response into ScenarioResult
    static func parseScenarioJSON(_ text: String) throws -> ScenarioResult {
        print("=== PARSING JSON ===")

        // Extract JSON from text (handles markdown and plain text)
        let jsonText = extractJSON(from: text)

        print("JSON text to parse:")
        print(jsonText)

        guard let jsonData = jsonText.data(using: .utf8) else {
            print("ERROR: Could not convert text to data")
            throw ParsingError.invalidData
        }

        let decoder = JSONDecoder()
        let scenarioResponse = try decoder.decode(ScenarioResponse.self, from: jsonData)

        let conversationLines = scenarioResponse.conversation.enumerated().map { index, item in
            ConversationLine(
                japaneseText: item.japanese,
                chineseTranslation: item.chinese,
                speaker: item.speaker,
                orderIndex: index
            )
        }

        let vocabularySuggestions = scenarioResponse.vocabulary.map { item in
            VocabularySuggestion(
                word: item.word,
                reading: item.reading,
                meaning: item.meaning,
                example: item.example
            )
        }

        return ScenarioResult(
            conversationLines: conversationLines,
            vocabularySuggestions: vocabularySuggestions
        )
    }

    /// Parses feedback JSON response into FeedbackResult
    static func parseFeedbackJSON(_ text: String) throws -> FeedbackResult {
        // Extract JSON from text
        let jsonText = extractJSON(from: text)

        guard let jsonData = jsonText.data(using: .utf8) else {
            throw ParsingError.invalidData
        }

        let decoder = JSONDecoder()
        let feedbackResponse = try decoder.decode(FeedbackResponse.self, from: jsonData)

        return FeedbackResult(
            score: feedbackResponse.score,
            explanation: feedbackResponse.explanation
        )
    }

    enum ParsingError: LocalizedError {
        case invalidData

        var errorDescription: String? {
            switch self {
            case .invalidData: return "无法解析响应数据"
            }
        }
    }
}
