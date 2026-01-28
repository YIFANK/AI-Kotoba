import Foundation

enum ClaudeError: Error {
    case invalidAPIKey
    case invalidResponse
    case networkError(Error)
    case parsingError
}

struct ClaudeMessage: Codable {
    let role: String
    let content: String
}

struct ClaudeRequest: Codable {
    let model: String
    let max_tokens: Int
    let messages: [ClaudeMessage]
}

struct ClaudeResponse: Codable {
    let id: String
    let type: String
    let role: String
    let content: [ContentBlock]
    let model: String
    let stop_reason: String?

    struct ContentBlock: Codable {
        let type: String
        let text: String
    }
}

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

@Observable
class ClaudeService {
    var isLoading = false
    var lastError: ClaudeError?

    func generateScenario(scenario: String) async throws -> ScenarioResult {
        guard let apiKey = try? APIKeyManager.shared.loadAPIKey() else {
            throw ClaudeError.invalidAPIKey
        }

        isLoading = true
        defer { isLoading = false }

        let prompt = Constants.Prompts.scenarioPrompt(scenario: scenario)

        let request = ClaudeRequest(
            model: Constants.defaultModel,
            max_tokens: 2048,
            messages: [
                ClaudeMessage(role: "user", content: prompt)
            ]
        )

        guard let url = URL(string: Constants.claudeAPIEndpoint) else {
            throw ClaudeError.invalidResponse
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        urlRequest.setValue(Constants.claudeAPIVersion, forHTTPHeaderField: "anthropic-version")
        urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")

        let encoder = JSONEncoder()
        urlRequest.httpBody = try encoder.encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        // DEBUG: Print raw response
        if let rawString = String(data: data, encoding: .utf8) {
            print("=== RAW CLAUDE RESPONSE ===")
            print(rawString)
            print("=== END RAW RESPONSE ===")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            print("ERROR: Invalid HTTP response")
            throw ClaudeError.invalidResponse
        }

        print("HTTP Status Code: \(httpResponse.statusCode)")

        guard (200...299).contains(httpResponse.statusCode) else {
            print("ERROR: HTTP status code \(httpResponse.statusCode)")
            throw ClaudeError.invalidResponse
        }

        let decoder = JSONDecoder()
        let claudeResponse = try decoder.decode(ClaudeResponse.self, from: data)

        print("=== DECODED RESPONSE ===")
        print("ID: \(claudeResponse.id)")
        print("Model: \(claudeResponse.model)")
        print("Content blocks: \(claudeResponse.content.count)")

        guard let text = claudeResponse.content.first?.text else {
            print("ERROR: No text content in response")
            throw ClaudeError.parsingError
        }

        print("=== TEXT CONTENT ===")
        print(text)
        print("=== END TEXT CONTENT ===")

        return try parseScenarioJSON(text)
    }

    private func parseScenarioJSON(_ text: String) throws -> ScenarioResult {
        print("=== PARSING JSON ===")

        // Try to extract JSON from text (in case Claude wraps it in markdown)
        var jsonText = text
        if let jsonStart = text.range(of: "{"),
           let jsonEnd = text.range(of: "}", options: .backwards) {
            jsonText = String(text[jsonStart.lowerBound...jsonEnd.upperBound])
        }

        print("JSON text to parse:")
        print(jsonText)

        guard let jsonData = jsonText.data(using: .utf8) else {
            print("ERROR: Could not convert text to data")
            throw ClaudeError.parsingError
        }

        let decoder = JSONDecoder()
        let scenarioResponse = try decoder.decode(ScenarioResponse.self, from: jsonData)

        print("✓ Successfully decoded JSON")
        print("Conversation items: \(scenarioResponse.conversation.count)")
        print("Vocabulary items: \(scenarioResponse.vocabulary.count)")

        // Convert to ConversationLine objects
        let conversationLines = scenarioResponse.conversation.enumerated().map { index, item in
            ConversationLine(
                japaneseText: item.japanese,
                chineseTranslation: item.chinese,
                speaker: item.speaker,
                orderIndex: index
            )
        }

        // Convert to VocabularySuggestion objects
        let vocabularySuggestions = scenarioResponse.vocabulary.map { item in
            VocabularySuggestion(
                word: item.word,
                reading: item.reading,
                meaning: item.meaning,
                example: item.example
            )
        }

        print("=== PARSING COMPLETE ===")
        print("Total conversation lines: \(conversationLines.count)")
        print("Total vocabulary suggestions: \(vocabularySuggestions.count)")

        return ScenarioResult(
            conversationLines: conversationLines,
            vocabularySuggestions: vocabularySuggestions
        )
    }
}
