import Foundation
import Speech
import AVFoundation

@Observable
class SpeechRecognitionService {
    static let shared = SpeechRecognitionService()

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer: SFSpeechRecognizer?

    var isRecording = false
    var authorizationStatus: SFSpeechRecognizerAuthorizationStatus = .notDetermined

    private init() {
        // Use Japanese locale for recognition
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
        authorizationStatus = SFSpeechRecognizer.authorizationStatus()
    }

    // MARK: - Authorization
    func requestAuthorization() async -> Bool {
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    self.authorizationStatus = status
                    continuation.resume(returning: status == .authorized)
                }
            }
        }
    }

    // MARK: - Recording
    func startRecording(onResult: @escaping (String) -> Void, onError: @escaping (Error) -> Void) throws {
        // 1. Cancel existing tasks
        stopRecording()

        // 2. Safety Checks
        guard authorizationStatus == .authorized else { throw SpeechRecognitionError.notAuthorized }
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            throw SpeechRecognitionError.recognizerUnavailable
        }

        // 3. Platform-Specific Audio Setup
        #if os(iOS)
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        #endif

        // 4. Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else {
            throw SpeechRecognitionError.unableToCreateRequest
        }
        recognitionRequest.shouldReportPartialResults = true

        // On macOS, set task hint to dictation for better recognition
        #if os(macOS)
        recognitionRequest.taskHint = .dictation
        #endif

        // 5. Configure Audio Engine
        let newEngine = AVAudioEngine()
        audioEngine = newEngine

        let inputNode = newEngine.inputNode

        // On macOS, we need to use the output format from the input node
        // and ensure it's compatible with speech recognition
        #if os(macOS)
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        #else
        let recordingFormat = inputNode.inputFormat(forBus: 0)
        #endif

        // Verify we have a valid format
        guard recordingFormat.sampleRate > 0 && recordingFormat.channelCount > 0 else {
            throw SpeechRecognitionError.audioEngineUnavailable
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            self.recognitionRequest?.append(buffer)
        }

        newEngine.prepare()
        try newEngine.start()

        isRecording = true

        // 6. Start recognition task
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { result, error in
            if let result = result {
                let transcription = result.bestTranscription.formattedString
                DispatchQueue.main.async {
                    onResult(transcription)
                }
            }

            if let error = error {
                DispatchQueue.main.async { onError(error) }
                self.stopRecording()
            }

            if result?.isFinal == true {
                self.stopRecording()
            }
        }
    }

    func stopRecording() {
        // Stop the engine and remove the tap first
        if let engine = audioEngine {
            if engine.isRunning {
                engine.stop()
            }
            engine.inputNode.removeTap(onBus: 0)
        }

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        recognitionTask?.cancel()
        recognitionTask = nil

        audioEngine = nil
        isRecording = false

        #if os(iOS)
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Error deactivating audio session: \(error)")
        }
        #endif
    }
}

// MARK: - Errors
enum SpeechRecognitionError: LocalizedError {
    case notAuthorized, recognizerUnavailable, unableToCreateRequest, audioEngineUnavailable

    var errorDescription: String? {
        switch self {
        case .notAuthorized: return "语音识别未授权。请在系统设置中授权。"
        case .recognizerUnavailable: return "语音识别服务不可用。"
        case .unableToCreateRequest: return "无法创建语音识别请求。"
        case .audioEngineUnavailable: return "音频引擎不可用。"
        }
    }
}