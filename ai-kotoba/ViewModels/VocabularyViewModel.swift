import Foundation
import SwiftData

@Observable
class VocabularyViewModel {
    var vocabularyItems: [VocabularyItem] = []
    var searchText = ""

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadVocabulary()
    }

    func loadVocabulary() {
        let descriptor = FetchDescriptor<VocabularyItem>(
            sortBy: [SortDescriptor(\.addedAt, order: .reverse)]
        )

        do {
            vocabularyItems = try modelContext.fetch(descriptor)
        } catch {
            print("Failed to load vocabulary: \(error)")
        }
    }

    var filteredVocabulary: [VocabularyItem] {
        if searchText.isEmpty {
            return vocabularyItems
        }
        return vocabularyItems.filter {
            $0.word.localizedCaseInsensitiveContains(searchText) ||
            $0.reading.localizedCaseInsensitiveContains(searchText) ||
            $0.meaning.localizedCaseInsensitiveContains(searchText)
        }
    }

    func addVocabulary(word: String, reading: String, meaning: String, exampleSentence: String? = nil) {
        let item = VocabularyItem(
            word: word,
            reading: reading,
            meaning: meaning,
            exampleSentence: exampleSentence,
            addedAt: Date(),
            nextReviewDate: Date()
        )

        modelContext.insert(item)

        do {
            try modelContext.save()
            loadVocabulary()
        } catch {
            print("Failed to add vocabulary: \(error)")
        }
    }

    func updateVocabulary(_ item: VocabularyItem, word: String, reading: String, meaning: String, exampleSentence: String?) {
        item.word = word
        item.reading = reading
        item.meaning = meaning
        item.exampleSentence = exampleSentence

        do {
            try modelContext.save()
            loadVocabulary()
        } catch {
            print("Failed to update vocabulary: \(error)")
        }
    }

    func deleteVocabulary(_ item: VocabularyItem) {
        modelContext.delete(item)

        do {
            try modelContext.save()
            loadVocabulary()
        } catch {
            print("Failed to delete vocabulary: \(error)")
        }
    }

    func createFlashCard(from item: VocabularyItem) {
        let flashCard = FlashCard(
            front: "\(item.word) (\(item.reading))",
            back: item.meaning,
            nextReviewDate: Date()
        )

        modelContext.insert(flashCard)

        do {
            try modelContext.save()
        } catch {
            print("Failed to create flashcard: \(error)")
        }
    }
}
