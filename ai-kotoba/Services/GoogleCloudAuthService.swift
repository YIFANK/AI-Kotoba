import Foundation
import Security

enum GoogleAuthError: Error, LocalizedError {
    case invalidCredentials(String)
    case invalidPrivateKey
    case signingFailed
    case tokenRequestFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredentials(let msg): return "Invalid service account JSON: \(msg)"
        case .invalidPrivateKey: return "Could not load private key from service account"
        case .signingFailed: return "JWT signing failed"
        case .tokenRequestFailed(let msg): return "OAuth2 token request failed: \(msg)"
        }
    }
}

/// Handles Google Cloud service account authentication (JWT → Bearer token).
/// Caches the token until ~1 minute before expiry.
class GoogleCloudAuthService {
    static let shared = GoogleCloudAuthService()

    private var cachedToken: String?
    private var tokenExpiry: Date?

    private init() {}

    // MARK: - Public API

    func getAccessToken() async throws -> String {
        if let token = cachedToken, let expiry = tokenExpiry, expiry.timeIntervalSinceNow > 60 {
            return token
        }

        let credentials = try loadCredentials()
        let jwt = try makeJWT(credentials: credentials)
        let token = try await exchangeJWT(jwt: jwt, tokenURI: credentials.tokenURI)

        cachedToken = token
        tokenExpiry = Date().addingTimeInterval(3500) // ~58 min, slightly under 1 hour

        print("[GoogleAuth] Obtained new access token (expires ~58 min from now)")
        return token
    }

    /// Validates and persists service account JSON to the keychain.
    func saveCredentials(jsonString: String) throws {
        guard let data = jsonString.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = dict["type"] as? String, type == "service_account",
              dict["client_email"] is String,
              dict["private_key"] is String,
              dict["token_uri"] is String else {
            throw GoogleAuthError.invalidCredentials("Not a valid service_account JSON")
        }
        try APIKeyManager.shared.saveGoogleCloudServiceAccount(jsonString)
        cachedToken = nil
        tokenExpiry = nil
        print("[GoogleAuth] Service account credentials saved")
    }

    func deleteCredentials() throws {
        try APIKeyManager.shared.deleteGoogleCloudServiceAccount()
        cachedToken = nil
        tokenExpiry = nil
    }

    func hasCredentials() -> Bool {
        APIKeyManager.shared.hasGoogleCloudServiceAccount()
    }

    // MARK: - Private Types

    private struct ServiceAccountCredentials {
        let clientEmail: String
        let privateKey: String
        let tokenURI: String
    }

    // MARK: - Credentials Loading

    private func loadCredentials() throws -> ServiceAccountCredentials {
        let json = try APIKeyManager.shared.loadGoogleCloudServiceAccount()
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let clientEmail = dict["client_email"] as? String,
              let privateKey = dict["private_key"] as? String,
              let tokenURI = dict["token_uri"] as? String else {
            throw GoogleAuthError.invalidCredentials("Missing required fields")
        }
        return ServiceAccountCredentials(clientEmail: clientEmail,
                                         privateKey: privateKey,
                                         tokenURI: tokenURI)
    }

    // MARK: - JWT Creation

    private func makeJWT(credentials: ServiceAccountCredentials) throws -> String {
        let headerJSON = #"{"alg":"RS256","typ":"JWT"}"#
        let headerB64 = base64url(Data(headerJSON.utf8))

        let now = Int(Date().timeIntervalSince1970)
        let payloadJSON = "{\"iss\":\"\(credentials.clientEmail)\",\"sub\":\"\(credentials.clientEmail)\",\"aud\":\"https://oauth2.googleapis.com/token\",\"iat\":\(now),\"exp\":\(now + 3600),\"scope\":\"https://www.googleapis.com/auth/cloud-platform\"}"
        let payloadB64 = base64url(Data(payloadJSON.utf8))

        let signingInput = "\(headerB64).\(payloadB64)"
        guard let signingData = signingInput.data(using: .utf8) else {
            throw GoogleAuthError.signingFailed
        }

        let privateKey = try secKey(fromPEM: credentials.privateKey)

        var cfError: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .rsaSignatureMessagePKCS1v15SHA256,
            signingData as CFData,
            &cfError
        ) as Data? else {
            let err = cfError?.takeRetainedValue()
            print("[GoogleAuth] Signing error: \(err?.localizedDescription ?? "unknown")")
            throw (err as Error?) ?? GoogleAuthError.signingFailed
        }

        return "\(signingInput).\(base64url(signature))"
    }

    private func secKey(fromPEM pem: String) throws -> SecKey {
        guard let pemData = pem.data(using: .utf8) else {
            throw GoogleAuthError.invalidPrivateKey
        }

        var format = SecExternalFormat.formatUnknown
        var itemType = SecExternalItemType.itemTypePrivateKey
        var importedItems: CFArray?

        let status = SecItemImport(
            pemData as CFData,
            nil,
            &format,
            &itemType,
            [],
            nil,
            nil,
            &importedItems
        )

        guard status == errSecSuccess,
              let items = importedItems as? [AnyObject],
              let first = items.first else {
            print("[GoogleAuth] SecItemImport failed with status \(status)")
            throw GoogleAuthError.invalidPrivateKey
        }

        // swiftlint:disable:next force_cast
        return first as! SecKey
    }

    // MARK: - Token Exchange

    private func exchangeJWT(jwt: String, tokenURI: String) async throws -> String {
        guard let url = URL(string: tokenURI) else {
            throw GoogleAuthError.tokenRequestFailed("Invalid token URI: \(tokenURI)")
        }

        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "grant_type", value: "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            URLQueryItem(name: "assertion", value: jwt)
        ]
        guard let body = components.percentEncodedQuery?.data(using: .utf8) else {
            throw GoogleAuthError.tokenRequestFailed("Failed to encode request body")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw GoogleAuthError.tokenRequestFailed("Invalid response type")
        }

        guard http.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? "(empty)"
            print("[GoogleAuth] Token exchange failed \(http.statusCode): \(body)")
            throw GoogleAuthError.tokenRequestFailed("HTTP \(http.statusCode): \(body)")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String else {
            throw GoogleAuthError.tokenRequestFailed("Could not parse access_token")
        }

        return accessToken
    }

    // MARK: - Helpers

    private func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
