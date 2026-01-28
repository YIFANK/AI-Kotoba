import Foundation
import SwiftData

@Observable
class ScenarioViewModel {
    var scenarioTitle = ""
    var isGenerating = false
    var errorMessage: String?
    var generatedScenario: Scenario?
    var vocabularySuggestions: [VocabularySuggestion] = []

    private let claudeService = ClaudeService()
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    @MainActor
    func generateScenario() async {
        guard !scenarioTitle.isEmpty else {
            errorMessage = "请输入场景描述"
            return
        }

        isGenerating = true
        errorMessage = nil

        do {
            let result = try await claudeService.generateScenario(scenario: scenarioTitle)

            let scenario = Scenario(
                title: scenarioTitle,
                conversationLines: result.conversationLines,
                createdAt: Date(),
                isFavorite: false
            )

            modelContext.insert(scenario)

            // Enforce 100 scenario limit
            try await enforceHistoryLimit()

            try modelContext.save()

            generatedScenario = scenario
            vocabularySuggestions = result.vocabularySuggestions
            scenarioTitle = ""

        } catch {
            errorMessage = "生成场景失败: \(error.localizedDescription)"
        }

        isGenerating = false
    }

    @MainActor
    private func enforceHistoryLimit() async throws {
        let descriptor = FetchDescriptor<Scenario>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )

        let allScenarios = try modelContext.fetch(descriptor)

        // Keep only the 100 most recent, but don't delete favorites
        let nonFavorites = allScenarios.filter { !$0.isFavorite }

        if nonFavorites.count > Constants.maxHistoryCount {
            let toDelete = nonFavorites.dropFirst(Constants.maxHistoryCount)
            for scenario in toDelete {
                modelContext.delete(scenario)
            }
        }
    }

    @MainActor
    func saveVocabularySuggestion(_ suggestion: VocabularySuggestion) {
        let vocabItem = VocabularyItem(
            word: suggestion.word,
            reading: suggestion.reading,
            meaning: suggestion.meaning,
            exampleSentence: suggestion.example
        )

        modelContext.insert(vocabItem)

        do {
            try modelContext.save()
        } catch {
            errorMessage = "保存词汇失败: \(error.localizedDescription)"
        }
    }
}
