import SwiftUI
import SwiftData

struct ScenarioView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: ScenarioViewModel?
    @State private var selectedScenario: Scenario?

    var body: some View {
        VStack {
            if let viewModel {
                if let scenario = selectedScenario {
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
        VStack(spacing: 20) {
            Text("创建新场景")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("描述您想练习的场景，AI 将生成一段日语对话")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            TextField("例如：在餐厅点餐", text: Binding(
                get: { viewModel.scenarioTitle },
                set: { viewModel.scenarioTitle = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 400)

            Button(action: {
                Task {
                    await viewModel.generateScenario()
                    if let generated = viewModel.generatedScenario {
                        selectedScenario = generated
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
            .disabled(viewModel.scenarioTitle.isEmpty || viewModel.isGenerating)
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
