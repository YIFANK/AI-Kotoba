import Foundation
import SwiftData

@Observable
class HistoryViewModel {
    var scenarios: [Scenario] = []
    var searchText = ""
    var selectedScenario: Scenario?

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadScenarios()
    }

    func loadScenarios() {
        let descriptor = FetchDescriptor<Scenario>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )

        do {
            scenarios = try modelContext.fetch(descriptor)
        } catch {
            print("Failed to load scenarios: \(error)")
        }
    }

    var filteredScenarios: [Scenario] {
        if searchText.isEmpty {
            return scenarios
        }
        return scenarios.filter { $0.title.localizedCaseInsensitiveContains(searchText) }
    }

    func toggleFavorite(_ scenario: Scenario) {
        scenario.isFavorite.toggle()
        do {
            try modelContext.save()
            loadScenarios()
        } catch {
            print("Failed to toggle favorite: \(error)")
        }
    }

    func deleteScenario(_ scenario: Scenario) {
        modelContext.delete(scenario)
        do {
            try modelContext.save()
            loadScenarios()
        } catch {
            print("Failed to delete scenario: \(error)")
        }
    }
}
