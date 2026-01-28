import SwiftUI

struct ConversationView: View {
    let scenario: Scenario
    let vocabularySuggestions: [VocabularySuggestion]
    let onBack: () -> Void
    let onSaveVocabulary: (VocabularySuggestion) -> Void

    @StateObject private var ttsService = TTSService.shared
    @State private var savedVocabIds = Set<UUID>()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Button(action: onBack) {
                    Label("返回", systemImage: "chevron.left")
                }
                .buttonStyle(.plain)

                Spacer()

                Text(scenario.title)
                    .font(.headline)

                Spacer()

                Text(scenario.createdAt, style: .date)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color.gray.opacity(0.1))

            Divider()

            // Conversation
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Conversation lines
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(scenario.conversationLines.sorted(by: { $0.orderIndex < $1.orderIndex }), id: \.id) { line in
                            ConversationLineView(line: line)
                        }
                    }

                    // Vocabulary suggestions
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
                    }
                }
                .padding()
            }
        }
    }
}

struct ConversationLineView: View {
    let line: ConversationLine
    @StateObject private var ttsService = TTSService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(line.speaker)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)

                Spacer()
            }

            Button(action: {
                ttsService.speak(text: line.japaneseText)
            }) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(line.japaneseText)
                            .font(.title3)
                            .foregroundColor(.primary)
                            .multilineTextAlignment(.leading)

                        Text(line.chineseTranslation)
                            .font(.body)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.leading)
                    }

                    Spacer()

                    Image(systemName: "speaker.wave.2.fill")
                        .foregroundColor(.accentColor)
                        .imageScale(.large)
                }
                .padding()
                .background(Color.gray.opacity(0.05))
                .cornerRadius(8)
            }
            .buttonStyle(.plain)
        }
    }
}

struct VocabularySuggestionView: View {
    let suggestion: VocabularySuggestion
    let isSaved: Bool
    let onSave: () -> Void

    @StateObject private var ttsService = TTSService.shared

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // TTS button
            Button(action: {
                ttsService.speak(text: suggestion.word)
            }) {
                Image(systemName: "speaker.wave.2.fill")
                    .foregroundColor(.accentColor)
                    .imageScale(.medium)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)

            // Vocabulary info
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(suggestion.word)
                        .font(.title3)
                        .fontWeight(.semibold)

                    Text(suggestion.reading)
                        .font(.body)
                        .foregroundColor(.secondary)
                }

                Text(suggestion.meaning)
                    .font(.body)
                    .foregroundColor(.secondary)

                if !suggestion.example.isEmpty {
                    Text(suggestion.example)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .italic()
                        .padding(.top, 2)
                }
            }

            Spacer()

            // Save button
            Button(action: onSave) {
                Image(systemName: isSaved ? "checkmark.circle.fill" : "plus.circle")
                    .foregroundColor(isSaved ? .green : .accentColor)
                    .imageScale(.large)
            }
            .buttonStyle(.plain)
            .disabled(isSaved)
        }
        .padding()
        .background(Color.blue.opacity(0.05))
        .cornerRadius(8)
    }
}
