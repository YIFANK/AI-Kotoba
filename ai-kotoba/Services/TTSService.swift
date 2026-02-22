import AVFoundation
import CryptoKit

class TTSService: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    static let shared = TTSService()

    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVAudioPlayer?

    @Published var isSpeaking = false

    // Disk cache: Library/Caches/TTSCache/{sha256(provider:voice:text)}.mp3
    private let cacheDirectory: URL = {
        let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = cachesDir.appendingPathComponent("TTSCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    var provider: TTSProvider {
        get {
            let raw = UserDefaults.standard.string(forKey: "tts_provider") ?? TTSProvider.apple.rawValue
            return TTSProvider(rawValue: raw) ?? .apple
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: "tts_provider")
        }
    }

    override private init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(text: String, language: String = "ja-JP") {
        stop()

        switch provider {
        case .apple:
            speakWithApple(text: text, language: language)
        case .elevenlabs:
            Task { await speakWithElevenLabs(text: text) }
        case .googlecloud:
            Task { await speakWithGoogleCloud(text: text) }
        }
    }

    func stop() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        audioPlayer?.stop()
        audioPlayer = nil
        isSpeaking = false
    }

    // MARK: - Apple TTS

    private func speakWithApple(text: String, language: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language)
        utterance.rate = 0.5
        synthesizer.speak(utterance)
    }

    // MARK: - Google Cloud TTS

    private func speakWithGoogleCloud(text: String) async {
        guard GoogleCloudAuthService.shared.hasCredentials() else {
            print("[TTSService] Google Cloud service account not configured — falling back to Apple TTS")
            await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
            return
        }

        let accessToken: String
        do {
            accessToken = try await GoogleCloudAuthService.shared.getAccessToken()
        } catch {
            print("[TTSService] Google Cloud auth failed: \(error) — falling back to Apple TTS")
            await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
            return
        }

        let voiceName = UserDefaults.standard.string(forKey: Constants.GoogleCloud.voiceKey)
                        ?? Constants.GoogleCloud.defaultVoice
        let cacheURL = cachedAudioURL(provider: "google", voice: voiceName, text: text)

        if FileManager.default.fileExists(atPath: cacheURL.path) {
            print("[TTSService] Cache hit (Google): \(text.prefix(40))")
            await MainActor.run { playAudioFile(at: cacheURL, fallbackText: text) }
            return
        }

        print("[TTSService] Fetching from Google Cloud: \(text.prefix(40))")

        guard let url = URL(string: Constants.GoogleCloud.endpoint) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "input": ["text": text],
            "voice": ["languageCode": "ja-JP", "name": voiceName],
            "audioConfig": ["audioEncoding": "MP3"]
        ])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                print("[TTSService] Google Cloud: invalid response type")
                await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
                return
            }

            guard httpResponse.statusCode == 200 else {
                let body = String(data: data, encoding: .utf8) ?? "(no body)"
                print("[TTSService] Google Cloud error \(httpResponse.statusCode): \(body)")
                await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
                return
            }

            // Response is JSON with base64-encoded audioContent
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let audioContent = json["audioContent"] as? String,
                  let audioData = Data(base64Encoded: audioContent) else {
                print("[TTSService] Google Cloud: failed to decode audioContent")
                await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
                return
            }

            try audioData.write(to: cacheURL)
            print("[TTSService] Cached \(audioData.count) bytes → \(cacheURL.lastPathComponent)")
            await MainActor.run { playAudioFile(at: cacheURL, fallbackText: text) }

        } catch {
            print("[TTSService] Google Cloud network error: \(error)")
            await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
        }
    }

    // MARK: - ElevenLabs TTS

    private func speakWithElevenLabs(text: String) async {
        guard let apiKey = try? APIKeyManager.shared.loadElevenLabsKey(), !apiKey.isEmpty else {
            print("[TTSService] ElevenLabs key not found — falling back to Apple TTS")
            await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
            return
        }

        let voiceID = UserDefaults.standard.string(forKey: Constants.ElevenLabs.voiceIDKey)
                      ?? Constants.ElevenLabs.defaultVoiceID
        let cacheURL = cachedAudioURL(provider: "elevenlabs", voice: voiceID, text: text)

        if FileManager.default.fileExists(atPath: cacheURL.path) {
            print("[TTSService] Cache hit (ElevenLabs): \(text.prefix(40))")
            await MainActor.run { playAudioFile(at: cacheURL, fallbackText: text) }
            return
        }

        print("[TTSService] Fetching from ElevenLabs: \(text.prefix(40))")
        let url = URL(string: "\(Constants.ElevenLabs.endpoint)/\(voiceID)")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "xi-api-key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("audio/mpeg", forHTTPHeaderField: "Accept")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "text": text,
            "model_id": Constants.ElevenLabs.defaultModel,
            "voice_settings": ["stability": 0.5, "similarity_boost": 0.75]
        ])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                print("[TTSService] ElevenLabs: invalid response type")
                await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
                return
            }

            guard httpResponse.statusCode == 200 else {
                let body = String(data: data, encoding: .utf8) ?? "(no body)"
                print("[TTSService] ElevenLabs error \(httpResponse.statusCode): \(body)")
                await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
                return
            }

            try data.write(to: cacheURL)
            print("[TTSService] Cached \(data.count) bytes → \(cacheURL.lastPathComponent)")
            await MainActor.run { playAudioFile(at: cacheURL, fallbackText: text) }

        } catch {
            print("[TTSService] ElevenLabs network error: \(error)")
            await MainActor.run { speakWithApple(text: text, language: "ja-JP") }
        }
    }

    // MARK: - Audio Playback

    private func playAudioFile(at url: URL, fallbackText: String) {
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.delegate = self
            audioPlayer?.play()
            isSpeaking = true
        } catch {
            print("[TTSService] AVAudioPlayer failed: \(error) — falling back to Apple TTS")
            speakWithApple(text: fallbackText, language: "ja-JP")
        }
    }

    // MARK: - Cache Helpers

    private func cachedAudioURL(provider: String, voice: String, text: String) -> URL {
        let key = sha256("\(provider):\(voice):\(text)")
        return cacheDirectory.appendingPathComponent("\(key).mp3")
    }

    private func sha256(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - AVSpeechSynthesizerDelegate

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        isSpeaking = true
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        isSpeaking = false
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        isSpeaking = false
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { self.isSpeaking = false }
    }
}
