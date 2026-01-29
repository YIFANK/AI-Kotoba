import Foundation

enum OpenAIError: Error {
    case invalidAPIKey
    case invalidResponse
    case networkError(Error)
    case parsingError
}

struct OpenAIMessage: Codable {
    let role: String
    let content: String
}

struct OpenAIRequest: Codable {
    let model: String
    let messages: [OpenAIMessage]

    enum CodingKeys: String, CodingKey {
        case model
        case messages
    }
}

struct OpenAIResponse: Codable {
    let id: String
    let object: String
    let created: Int
    let model: String
    let choices: [Choice]

    struct Choice: Codable {
        let index: Int
        let message: OpenAIMessage
        let finish_reason: String?
    }
}

@Observable
class OpenAIService {
    var isLoading = false
    var lastError: OpenAIError?

    func generateScenario(scenario: String) async throws -> ScenarioResult {
        guard let apiKey = try? APIKeyManager.shared.loadOpenAIKey() else {
            throw OpenAIError.invalidAPIKey
        }

        isLoading = true
        defer { isLoading = false }

        // TURN 1: Generate Japanese content
        print("=== TURN 1: Generating Japanese content ===")
        let japanesePrompt = Constants.Prompts.scenarioPromptJapanese(scenario: scenario)
        let japaneseText = try await callOpenAIAPI(apiKey: apiKey, prompt: japanesePrompt, maxTokens: 2048)

        print("=== JAPANESE RESPONSE ===")
        print(japaneseText)
        print("=== END JAPANESE RESPONSE ===")

        // TURN 2: Translate to Chinese
        print("=== TURN 2: Translating to Chinese ===")
        let translationPrompt = Constants.Prompts.scenarioPromptTranslation(japaneseJSON: japaneseText)
        let translatedText = try await callOpenAIAPI(apiKey: apiKey, prompt: translationPrompt, maxTokens: 2048)

        print("=== TRANSLATED RESPONSE ===")
        print(translatedText)
        print("=== END TRANSLATED RESPONSE ===")

        // Parse and return the final result
        return try parseScenarioJSON(translatedText)
    }

    // Helper method to make OpenAI API calls
    private func callOpenAIAPI(apiKey: String, prompt: String, maxTokens: Int) async throws -> String {
        let request = OpenAIRequest(
            model: Constants.OpenAI.defaultModel,
            messages: [
                OpenAIMessage(role: "user", content: prompt)
            ],
        )

        guard let url = URL(string: Constants.OpenAI.endpoint) else {
            throw OpenAIError.invalidResponse
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        urlRequest.httpBody = try encoder.encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw OpenAIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("API Error: \(errorString)")
            }
            throw OpenAIError.invalidResponse
        }

        let decoder = JSONDecoder()
        let openAIResponse = try decoder.decode(OpenAIResponse.self, from: data)

        guard let text = openAIResponse.choices.first?.message.content else {
            throw OpenAIError.parsingError
        }

        return text
    }

    func compareFeedback(userResponse: String, correctResponse: String, chinesePrompt: String) async throws -> FeedbackResult {
        guard let apiKey = try? APIKeyManager.shared.loadOpenAIKey() else {
            throw OpenAIError.invalidAPIKey
        }

        isLoading = true
        defer { isLoading = false }

        let prompt = Constants.Prompts.feedbackPrompt(
            chinesePrompt: chinesePrompt,
            userResponse: userResponse,
            correctResponse: correctResponse
        )

        let request = OpenAIRequest(
            model: Constants.OpenAI.defaultModel,
            messages: [
                OpenAIMessage(role: "user", content: prompt)
            ],
        )

        guard let url = URL(string: Constants.OpenAI.endpoint) else {
            throw OpenAIError.invalidResponse
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        urlRequest.httpBody = try encoder.encode(request)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw OpenAIError.invalidResponse
        }

        let decoder = JSONDecoder()
        let openAIResponse = try decoder.decode(OpenAIResponse.self, from: data)

        guard let text = openAIResponse.choices.first?.message.content else {
            throw OpenAIError.parsingError
        }

        return try parseFeedbackJSON(text)
    }

    // Helper to extract JSON from text (handles markdown and plain responses)
    private func extractJSON(from text: String) -> String {
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

    private func parseScenarioJSON(_ text: String) throws -> ScenarioResult {
        print("=== PARSING JSON ===")

        // Extract JSON from text (handles markdown and plain text)
        let jsonText = extractJSON(from: text)

        print("JSON text to parse:")
        print(jsonText)

        guard let jsonData = jsonText.data(using: .utf8) else {
            print("ERROR: Could not convert text to data")
            throw OpenAIError.parsingError
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

    private func parseFeedbackJSON(_ text: String) throws -> FeedbackResult {
        // Extract JSON from text
        let jsonText = extractJSON(from: text)

        guard let jsonData = jsonText.data(using: .utf8) else {
            throw OpenAIError.parsingError
        }

        let decoder = JSONDecoder()
        let feedbackResponse = try decoder.decode(FeedbackResponse.self, from: jsonData)

        return FeedbackResult(
            score: feedbackResponse.score,
            explanation: feedbackResponse.explanation
        )
    }
}
