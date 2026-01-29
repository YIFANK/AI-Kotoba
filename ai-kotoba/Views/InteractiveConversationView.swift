import SwiftUI
import Speech

struct InteractiveConversationView: View {
    @State var sessionState: InteractiveSessionState
    let vocabularySuggestions: [VocabularySuggestion]
    let onBack: () -> Void
    let onRequestFeedback: (String, String, String) async throws -> FeedbackResult
    let onSaveVocabulary: (VocabularySuggestion) -> Void

    @State private var userInput = ""
    @State private var isRequestingFeedback = false
    @State private var feedbackError: String?
    @State private var savedVocabIds = Set<UUID>()
    @State private var isRecording = false
    @State private var speechError: String?
    @StateObject private var ttsService = TTSService.shared
    @State private var speechService = SpeechRecognitionService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            headerView

            Divider()

            if sessionState.isComplete {
                completionView
            } else {
                // Main content
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // Progress indicator
                        progressView

                        Divider()

                        // Display previous lines
                        previousLinesView

                        // Current line interaction
                        if let currentLine = sessionState.currentLine {
                            currentLineView(currentLine: currentLine)
                        }
                    }
                    .padding()
                }
            }
        }
        .onDisappear {
            // Stop recording when view disappears
            if isRecording {
                stopRecording()
            }
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            Button(action: onBack) {
                Label("返回", systemImage: "chevron.left")
            }

            Spacer()

            Text(sessionState.scenario.title)
                .font(.headline)

            Spacer()

            Label("互动模式", systemImage: "person.fill.checkmark")
                .font(.caption)
                .foregroundColor(.blue)
        }
        .padding()
        .background(Color.gray.opacity(0.1))
    }

    // MARK: - Progress

    private var progressView: some View {
        HStack {
            Text("进度")
                .font(.headline)

            Spacer()

            Text("\(sessionState.currentLineIndex + 1) / \(sessionState.scenario.conversationLines.count)")
                .font(.title3)
                .fontWeight(.semibold)
        }
    }

    // MARK: - Previous Lines

    private var previousLinesView: some View {
        VStack(alignment: .leading, spacing: 16) {
            if sessionState.currentLineIndex > 0 {
                Text("已完成的对话")
                    .font(.headline)
                    .foregroundColor(.secondary)

                let sortedLines = sessionState.scenario.conversationLines.sorted(by: { $0.orderIndex < $1.orderIndex })
                ForEach(0..<sessionState.currentLineIndex, id: \.self) { index in
                    let line = sortedLines[index]
                    CompletedLineView(
                        line: line,
                        response: sessionState.lineResponses.first(where: { $0.lineId == line.id }),
                        isUserTurn: isUserTurnForLine(line)
                    )
                }
            }
        }
    }

    // MARK: - Current Line

    private func currentLineView(currentLine: ConversationLine) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("当前对话")
                .font(.headline)

            if sessionState.isUserTurn() {
                // User's turn to respond
                userTurnView(currentLine: currentLine)
            } else {
                // AI's turn (not user's character)
                aiTurnView(currentLine: currentLine)
            }
        }
    }

    private func userTurnView(currentLine: ConversationLine) -> some View {
        let currentResponse = sessionState.getCurrentResponse()

        return VStack(alignment: .leading, spacing: 12) {
            // Show Chinese prompt
            HStack {
                Text(currentLine.speaker)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(4)

                Spacer()
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("请翻译以下内容：")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(currentLine.chineseTranslation)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.yellow.opacity(0.1))
                    .cornerRadius(8)
            }

            // User input
            if currentResponse?.isRevealed == false {
                VStack(alignment: .leading, spacing: 8) {
                    Text("您的日语回答：")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack(spacing: 8) {
                        TextField("输入日语翻译...", text: $userInput)
                            .textFieldStyle(.roundedBorder)
                            .font(.body)
                            .disabled(isRecording)

                        Button(action: {
                            toggleRecording()
                        }) {
                            Image(systemName: isRecording ? "mic.fill" : "mic")
                                .foregroundColor(isRecording ? .red : .accentColor)
                                .imageScale(.large)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.bordered)
                        .disabled(speechService.authorizationStatus == SFSpeechRecognizerAuthorizationStatus.denied || speechService.authorizationStatus == SFSpeechRecognizerAuthorizationStatus.restricted)
                    }

                    if let error = speechError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    if isRecording {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text("正在识别...")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    Button(action: {
                        sessionState.updateUserResponse(userInput)
                        sessionState.revealAnswer()
                    }) {
                        Text("显示答案")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(userInput.isEmpty)
                }
            }

            // Answer revealed
            if currentResponse?.isRevealed == true {
                answerRevealedView(currentLine: currentLine, currentResponse: currentResponse!)
            }
        }
        .padding()
        .background(Color.blue.opacity(0.05))
        .cornerRadius(12)
    }

    private func answerRevealedView(currentLine: ConversationLine, currentResponse: LineResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // User's answer
            if let userResponse = currentResponse.userResponse, !userResponse.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("您的回答：")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(userResponse)
                        .font(.body)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(8)
                }
            }

            // Correct answer
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("标准答案：")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    Button(action: {
                        ttsService.speak(text: currentLine.japaneseText)
                    }) {
                        Image(systemName: "speaker.wave.2.fill")
                            .foregroundColor(.accentColor)
                    }
                    .buttonStyle(.plain)
                }

                Text(currentLine.japaneseText)
                    .font(.body)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(8)
            }

            // Feedback section
            feedbackSection(currentLine: currentLine, currentResponse: currentResponse)

            // Next button
            Button(action: {
                sessionState.nextLine()
                userInput = ""
            }) {
                Text("下一句")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func feedbackSection(currentLine: ConversationLine, currentResponse: LineResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let feedback = currentResponse.feedback {
                // Display feedback
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("AI 评价")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Spacer()

                        Text("得分: \(feedback.score)/10")
                            .font(.headline)
                            .foregroundColor(feedbackColor(score: feedback.score))
                    }

                    Text(feedback.explanation)
                        .font(.body)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.purple.opacity(0.05))
                        .cornerRadius(8)
                }
            } else if let userResponse = currentResponse.userResponse, !userResponse.isEmpty {
                // Request feedback button
                Button(action: {
                    Task {
                        await requestFeedback(
                            userResponse: userResponse,
                            correctResponse: currentLine.japaneseText,
                            chinesePrompt: currentLine.chineseTranslation
                        )
                    }
                }) {
                    if isRequestingFeedback {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .scaleEffect(0.8)
                    } else {
                        Label("请 AI 评价", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isRequestingFeedback)

                if let error = feedbackError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
        }
    }

    private func aiTurnView(currentLine: ConversationLine) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(currentLine.speaker)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.gray.opacity(0.2))
                    .cornerRadius(4)

                Spacer()

                Button(action: {
                    ttsService.speak(text: currentLine.japaneseText)
                }) {
                    Image(systemName: "speaker.wave.2.fill")
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
            }

            Text(currentLine.japaneseText)
                .font(.title3)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.gray.opacity(0.05))
                .cornerRadius(8)

            Text(currentLine.chineseTranslation)
                .font(.body)
                .foregroundColor(.secondary)

            Button(action: {
                sessionState.nextLine()
            }) {
                Text("下一句")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(12)
    }

    // MARK: - Completion

    private var completionView: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.green)

                Text("练习完成！")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("您已完成所有对话")
                    .foregroundColor(.secondary)

                // Summary
                summaryView

                // Vocabulary section
                if !vocabularySuggestions.isEmpty {
                    Divider()
                        .padding(.vertical, 8)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("场景词汇")
                            .font(.headline)
                            .padding(.bottom, 4)

                        ForEach(vocabularySuggestions) { suggestion in
                            VocabularySuggestionView(
                                suggestion: suggestion,
                                isSaved: savedVocabIds.contains(suggestion.id),
                                onSave: {
                                    onSaveVocabulary(suggestion)
                                    savedVocabIds.insert(suggestion.id)
                                }
                            )
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button("返回") {
                    onBack()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }

    private var summaryView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("练习总结")
                .font(.headline)

            let userResponses = sessionState.lineResponses.filter { $0.userResponse != nil && !$0.userResponse!.isEmpty }
            let feedbackCount = sessionState.lineResponses.filter { $0.feedback != nil }.count
            let avgScore = calculateAverageScore()

            VStack(spacing: 4) {
                HStack {
                    Text("回答数量:")
                    Spacer()
                    Text("\(userResponses.count)")
                        .fontWeight(.semibold)
                }

                HStack {
                    Text("请求评价:")
                    Spacer()
                    Text("\(feedbackCount)")
                        .fontWeight(.semibold)
                }

                if let avgScore = avgScore {
                    HStack {
                        Text("平均得分:")
                        Spacer()
                        Text(String(format: "%.1f/10", avgScore))
                            .fontWeight(.semibold)
                            .foregroundColor(feedbackColor(score: Int(avgScore)))
                    }
                }
            }
            .font(.body)
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    // MARK: - Helper Methods

    private func isUserTurnForLine(_ line: ConversationLine) -> Bool {
        switch sessionState.playingCharacter {
        case .both:
            return true
        case .personA:
            return line.speaker == sessionState.speakers.first
        case .personB:
            return sessionState.speakers.count > 1 ? line.speaker == sessionState.speakers[1] : false
        }
    }

    private func requestFeedback(userResponse: String, correctResponse: String, chinesePrompt: String) async {
        isRequestingFeedback = true
        feedbackError = nil

        do {
            let result = try await onRequestFeedback(userResponse, correctResponse, chinesePrompt)
            sessionState.updateFeedback(score: result.score, explanation: result.explanation)
        } catch {
            feedbackError = "获取反馈失败: \(error.localizedDescription)"
        }

        isRequestingFeedback = false
    }

    private func feedbackColor(score: Int) -> Color {
        switch score {
        case 9...10: return .green
        case 7...8: return .blue
        case 4...6: return .orange
        default: return .red
        }
    }

    private func calculateAverageScore() -> Double? {
        let scores = sessionState.lineResponses.compactMap { $0.feedback?.score }
        guard !scores.isEmpty else { return nil }
        return Double(scores.reduce(0, +)) / Double(scores.count)
    }

    // MARK: - Speech Recognition

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        speechError = nil

        // Request authorization if needed
        if speechService.authorizationStatus == SFSpeechRecognizerAuthorizationStatus.notDetermined {
            Task {
                let authorized = await speechService.requestAuthorization()
                if authorized {
                    performStartRecording()
                } else {
                    speechError = "语音识别需要授权"
                }
            }
        } else if speechService.authorizationStatus == SFSpeechRecognizerAuthorizationStatus.authorized {
            performStartRecording()
        } else {
            speechError = "语音识别未授权。请在系统设置中授权。"
        }
    }

    private func performStartRecording() {
        do {
            try speechService.startRecording(
                onResult: { [self] transcription in
                    userInput = transcription
                },
                onError: { [self] (error: Error) in
                    speechError = error.localizedDescription
                    isRecording = false
                }
            )
            isRecording = true
        } catch {
            speechError = error.localizedDescription
            isRecording = false
        }
    }

    private func stopRecording() {
        speechService.stopRecording()
        isRecording = false
    }
}


// MARK: - Completed Line View

struct CompletedLineView: View {
    let line: ConversationLine
    let response: LineResponse?
    let isUserTurn: Bool

    @StateObject private var ttsService = TTSService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(line.speaker)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(isUserTurn ? Color.blue.opacity(0.1) : Color.gray.opacity(0.2))
                    .cornerRadius(4)

                Spacer()

                Button(action: {
                    ttsService.speak(text: line.japaneseText)
                }) {
                    Image(systemName: "speaker.wave.2.fill")
                        .foregroundColor(.accentColor)
                        .imageScale(.small)
                }
                .buttonStyle(.plain)
            }

            // Show user response if exists
            if isUserTurn, let userResponse = response?.userResponse, !userResponse.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("您的回答：")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    Text(userResponse)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // Show correct answer
            Text(line.japaneseText)
                .font(.body)

            Text(line.chineseTranslation)
                .font(.caption)
                .foregroundColor(.secondary)

            // Show feedback if exists
            if let feedback = response?.feedback {
                HStack {
                    Text("得分: \(feedback.score)/10")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    Spacer()

                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundColor(.purple)
                }
            }
        }
        .padding()
        .background(Color.gray.opacity(0.02))
        .cornerRadius(8)
    }
}
