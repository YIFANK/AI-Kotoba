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

    func saveAPIKey(_ apiKey: String) throws {
        let data = apiKey.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.service,
            kSecAttrAccount as String: Constants.Keychain.apiKeyAccount,
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

    func loadAPIKey() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.service,
            kSecAttrAccount as String: Constants.Keychain.apiKeyAccount,
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

        return apiKey
    }

    func deleteAPIKey() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Constants.Keychain.service,
            kSecAttrAccount as String: Constants.Keychain.apiKeyAccount
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw APIKeyError.deleteFailed
        }
    }

    func hasAPIKey() -> Bool {
        do {
            _ = try loadAPIKey()
            return true
        } catch {
            return false
        }
    }
}
