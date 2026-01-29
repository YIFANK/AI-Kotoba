import Foundation
import Security

enum APIKeyError: Error {
    case saveFailed
    case loadFailed
    case deleteFailed
    case notFound
}

class APIKeyManager {
    static let shared = APIKeyManager()

    private init() {}

    // MARK: - Claude API Key

    func saveAPIKey(_ apiKey: String) throws {
        try saveKey(apiKey, account: Constants.Keychain.apiKeyAccount)
    }

    func loadAPIKey() throws -> String {
        try loadKey(account: Constants.Keychain.apiKeyAccount)
    }

    func deleteAPIKey() throws {
        try deleteKey(account: Constants.Keychain.apiKeyAccount)
    }

    func hasAPIKey() -> Bool {
        hasKey(account: Constants.Keychain.apiKeyAccount)
    }

    // MARK: - OpenAI API Key

    func saveOpenAIKey(_ apiKey: String) throws {
        try saveKey(apiKey, account: Constants.Keychain.openAIKeyAccount)
    }

    func loadOpenAIKey() throws -> String {
        try loadKey(account: Constants.Keychain.openAIKeyAccount)
    }

    func deleteOpenAIKey() throws {
        try deleteKey(account: Constants.Keychain.openAIKeyAccount)
    }

    func hasOpenAIKey() -> Bool {
        hasKey(account: Constants.Keychain.openAIKeyAccount)
    }

    // MARK: - Private Helpers

    private func saveKey(_ apiKey: String, account: String) throws {
        // Trim whitespace and newlines from API key
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let data = trimmedKey.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]

        // Delete any existing key first
        SecItemDelete(query as CFDictionary)

        // Add new key
        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            throw APIKeyError.saveFailed
        }
    }

    private func loadKey(account: String) throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            throw status == errSecItemNotFound ? APIKeyError.notFound : APIKeyError.loadFailed
        }

        guard let data = result as? Data,
              let apiKey = String(data: data, encoding: .utf8) else {
            throw APIKeyError.loadFailed
        }

        // Trim whitespace and newlines when loading
        return apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func deleteKey(account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.service,
            kSecAttrAccount as String: account
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw APIKeyError.deleteFailed
        }
    }

    private func hasKey(account: String) -> Bool {
        do {
            _ = try loadKey(account: account)
            return true
        } catch {
            return false
        }
    }
}
