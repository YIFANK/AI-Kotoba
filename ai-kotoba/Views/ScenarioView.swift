import SwiftUI
import SwiftData

struct ScenarioView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: ScenarioViewModel?
    @State private var selectedScenario: Scenario?
    @State private var selectedMode: ConversationMode = .regular
    @State private var showCharacterSelection = false
    @State private var interactiveSession: InteractiveSessionState?

    var body: some View {
        VStack {
            if let viewModel {
                if let session = interactiveSession {
                    // Interactive mode conversation
                    InteractiveConversationView(
                        sessionState: session,
                        vocabularySuggestions: viewModel.vocabularySuggestions,
                        onBack: {
                            interactiveSession = nil
                            selectedScenario = nil
                        },
                        onRequestFeedback: { userResponse, correctResponse, chinesePrompt in
                            try await viewModel.requestFeedback(
                                userResponse: userResponse,
                                correctResponse: correctResponse,
                                chinesePrompt: chinesePrompt
                            )
                        },
                        onSaveVocabulary: { suggestion in
                            viewModel.saveVocabularySuggestion(suggestion)
                        }
                    )
                } else if showCharacterSelection, let scenario = selectedScenario {
                    // Character selection for interactive mode
                    CharacterSelectionView(
                        scenario: scenario,
                        onSelect: { character in
                            interactiveSession = InteractiveSessionState(
                                scenario: scenario,
                                playingCharacter: character
                            )
                            showCharacterSelection = false
                        },
                        onBack: {
                            showCharacterSelection = false
                            selectedScenario = nil
                        }
                    )
                } else if let scenario = selectedScenario {
                    // Regular mode conversation
                    ConversationView(
                        scenario: scenario,
                        vocabularySuggestions: viewModel.vocabularySuggestions,
                        onBack: {
                            selectedScenario = nil
                        },
                        onSaveVocabulary: { suggestion in
                            viewModel.saveVocabularySuggestion(suggestion)
                        }
                    )
                } else {
                    // Input view
                    scenarioInputView(viewModel: viewModel)
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = ScenarioViewModel(modelContext: modelContext)
            }
        }
    }

    @ViewBuilder
    private func scenarioInputView(viewModel: ScenarioViewModel) -> some View {
        VStack(spacing: 24) {
            Text("创建新场景")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("描述您想练习的场景，AI 将生成一段日语对话")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            // Scenario input
            TextField("例如：在餐厅点餐", text: Binding(
                get: { viewModel.scenarioTitle },
                set: { viewModel.scenarioTitle = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 400)

            VStack(spacing: 16) {
                // Mode selection
                VStack(alignment: .leading, spacing: 8) {
                    Text("模式")
                        .font(.headline)

                    Picker("模式", selection: $selectedMode) {
                        Label("常规模式", systemImage: "book.fill")
                            .tag(ConversationMode.regular)
                        Label("互动模式", systemImage: "person.fill.checkmark")
                            .tag(ConversationMode.interactive)
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 400)

                    Text(selectedMode == .regular ?
                         "查看完整对话，学习词汇" :
                         "逐句翻译练习，获得 AI 反馈")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // API provider selection
                VStack(alignment: .leading, spacing: 8) {
                    Text("AI 服务")
                        .font(.headline)

                    Picker("AI 服务", selection: Binding(
                        get: { viewModel.apiProvider },
                        set: { viewModel.apiProvider = $0 }
                    )) {
                        Text("Claude").tag(AIProvider.claude)
                        Text("OpenAI").tag(AIProvider.openai)
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 400)

                    if !viewModel.hasAPIKey() {
                        Text("⚠️ 请在设置中配置 API 密钥")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }
            .frame(maxWidth: 400)

            Button(action: {
                Task {
                    await viewModel.generateScenario()
                    if let generated = viewModel.generatedScenario {
                        selectedScenario = generated
                        if selectedMode == .interactive {
                            showCharacterSelection = true
                        }
                    }
                }
            }) {
                if viewModel.isGenerating {
                    ProgressView()
                        .scaleEffect(0.8)
                        .frame(width: 150)
                } else {
                    Text("生成对话")
                        .frame(width: 150)
                }
            }
            .disabled(viewModel.scenarioTitle.isEmpty || viewModel.isGenerating || !viewModel.hasAPIKey())
            .buttonStyle(.borderedProminent)

            if let error = viewModel.errorMessage {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
