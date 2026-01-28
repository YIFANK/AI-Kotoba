import SwiftUI
import SwiftData

struct HistoryView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: HistoryViewModel?
    @State private var selectedScenario: Scenario?

    var body: some View {
        VStack {
            if let viewModel {
                if let scenario = selectedScenario {
                    ConversationView(
                        scenario: scenario,
                        vocabularySuggestions: [],
                        onBack: {
                            selectedScenario = nil
                            viewModel.loadScenarios()
                        },
                        onSaveVocabulary: { _ in }
                    )
                } else {
                    historyListView(viewModel: viewModel)
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = HistoryViewModel(modelContext: modelContext)
            } else {
                viewModel?.loadScenarios()
            }
        }
    }

    @ViewBuilder
    private func historyListView(viewModel: HistoryViewModel) -> some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("历史记录")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Spacer()

                Text("共 \(viewModel.scenarios.count) 个场景")
                    .foregroundColor(.secondary)
            }
            .padding()

            // Search
            TextField("搜索场景...", text: Binding(
                get: { viewModel.searchText },
                set: { viewModel.searchText = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .padding(.horizontal)

            Divider()
                .padding(.top)

            // List
            if viewModel.filteredScenarios.isEmpty {
                ContentUnavailableView(
                    "没有找到场景",
                    systemImage: "clock",
                    description: Text("创建新场景开始学习")
                )
            } else {
                List {
                    ForEach(viewModel.filteredScenarios, id: \.id) { scenario in
                        ScenarioRowView(
                            scenario: scenario,
                            onTap: { selectedScenario = scenario },
                            onToggleFavorite: { viewModel.toggleFavorite(scenario) },
                            onDelete: { viewModel.deleteScenario(scenario) }
                        )
                    }
                }
                .listStyle(.plain)
            }
        }
    }
}

struct ScenarioRowView: View {
    let scenario: Scenario
    let onTap: () -> Void
    let onToggleFavorite: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(scenario.title)
                    .font(.headline)

                HStack {
                    Text(scenario.createdAt, style: .date)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("•")
                        .foregroundColor(.secondary)

                    Text("\(scenario.conversationLines.count) 行对话")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            Button(action: onToggleFavorite) {
                Image(systemName: scenario.isFavorite ? "star.fill" : "star")
                    .foregroundColor(scenario.isFavorite ? .yellow : .gray)
            }
            .buttonStyle(.plain)

            Button(action: onDelete) {
                Image(systemName: "trash")
                    .foregroundColor(.red)
            }
            .buttonStyle(.plain)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .padding(.vertical, 4)
    }
}
