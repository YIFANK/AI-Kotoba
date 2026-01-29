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
