import SwiftUI
import SwiftData

struct FavoritesView: View {
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
                    favoritesListView(viewModel: viewModel)
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
    private func favoritesListView(viewModel: HistoryViewModel) -> some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("收藏夹")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Spacer()

                Text("共 \(favoriteScenarios.count) 个场景")
                    .foregroundColor(.secondary)
            }
            .padding()

            Divider()

            // List
            if favoriteScenarios.isEmpty {
                ContentUnavailableView(
                    "没有收藏的场景",
                    systemImage: "star",
                    description: Text("在历史记录中点击星标来收藏场景")
                )
            } else {
                List {
                    ForEach(favoriteScenarios, id: \.id) { scenario in
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

    private var favoriteScenarios: [Scenario] {
        viewModel?.scenarios.filter { $0.isFavorite } ?? []
    }
}
