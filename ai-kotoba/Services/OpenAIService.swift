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
        do {
            return try JSONParsingUtility.parseScenarioJSON(translatedText)
        } catch {
            throw OpenAIError.parsingError
        }
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

        do {
            return try JSONParsingUtility.parseFeedbackJSON(text)
        } catch {
            throw OpenAIError.parsingError
        }
    }
}
