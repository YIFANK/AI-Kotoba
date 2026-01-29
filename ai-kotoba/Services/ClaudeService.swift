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

        // TURN 1: Generate Japanese content
        print("=== TURN 1: Generating Japanese content ===")
        let japanesePrompt = Constants.Prompts.scenarioPromptJapanese(scenario: scenario)
        let japaneseText = try await callClaudeAPI(apiKey: apiKey, prompt: japanesePrompt, maxTokens: 2048)

        print("=== JAPANESE RESPONSE ===")
        print(japaneseText)
        print("=== END JAPANESE RESPONSE ===")

        // TURN 2: Translate to Chinese
        print("=== TURN 2: Translating to Chinese ===")
        let translationPrompt = Constants.Prompts.scenarioPromptTranslation(japaneseJSON: japaneseText)
        let translatedText = try await callClaudeAPI(apiKey: apiKey, prompt: translationPrompt, maxTokens: 2048)

        print("=== TRANSLATED RESPONSE ===")
        print(translatedText)
        print("=== END TRANSLATED RESPONSE ===")

        // Parse and return the final result
        do {
            return try JSONParsingUtility.parseScenarioJSON(translatedText)
        } catch {
            throw ClaudeError.parsingError
        }
    }

    // Helper method to make Claude API calls
    private func callClaudeAPI(apiKey: String, prompt: String, maxTokens: Int) async throws -> String {
        let request = ClaudeRequest(
            model: Constants.defaultModel,
            max_tokens: maxTokens,
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

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClaudeError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("API Error: \(errorString)")
            }
            throw ClaudeError.invalidResponse
        }

        let decoder = JSONDecoder()
        let claudeResponse = try decoder.decode(ClaudeResponse.self, from: data)

        guard let text = claudeResponse.content.first?.text else {
            throw ClaudeError.parsingError
        }

        return text
    }

    func compareFeedback(userResponse: String, correctResponse: String, chinesePrompt: String) async throws -> FeedbackResult {
        guard let apiKey = try? APIKeyManager.shared.loadAPIKey() else {
            throw ClaudeError.invalidAPIKey
        }

        isLoading = true
        defer { isLoading = false }

        let prompt = Constants.Prompts.feedbackPrompt(
            chinesePrompt: chinesePrompt,
            userResponse: userResponse,
            correctResponse: correctResponse
        )

        let request = ClaudeRequest(
            model: Constants.defaultModel,
            max_tokens: 512,
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

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw ClaudeError.invalidResponse
        }

        let decoder = JSONDecoder()
        let claudeResponse = try decoder.decode(ClaudeResponse.self, from: data)

        guard let text = claudeResponse.content.first?.text else {
            throw ClaudeError.parsingError
        }

        do {
            return try JSONParsingUtility.parseFeedbackJSON(text)
        } catch {
            throw ClaudeError.parsingError
        }
    }
}
