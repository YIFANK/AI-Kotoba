import Foundation
import SwiftData

@Observable
class FlashCardViewModel {
    var allCards: [FlashCard] = []
    var dueCards: [FlashCard] = []
    var currentCardIndex = 0
    var showingAnswer = false
    var studySessionCompleted = false

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadCards()
    }

    func loadCards() {
        let descriptor = FetchDescriptor<FlashCard>(
            sortBy: [SortDescriptor(\.nextReviewDate)]
        )

        do {
            allCards = try modelContext.fetch(descriptor)
            dueCards = allCards.filter { $0.nextReviewDate <= Date() }
            currentCardIndex = 0
            showingAnswer = false
            studySessionCompleted = dueCards.isEmpty
        } catch {
            print("Failed to load flashcards: \(error)")
        }
    }

    var currentCard: FlashCard? {
        guard currentCardIndex < dueCards.count else { return nil }
        return dueCards[currentCardIndex]
    }

    var progress: String {
        guard !dueCards.isEmpty else { return "0/0" }
        return "\(currentCardIndex + 1)/\(dueCards.count)"
    }

    func flipCard() {
        showingAnswer.toggle()
    }

    func rateCard(quality: Int) {
        guard let card = currentCard else { return }

        let result = SRSAlgorithm.calculateNextReview(
            quality: quality,
            currentEaseFactor: card.easeFactor,
            currentInterval: card.interval,
            currentRepetitions: card.repetitions
        )

        card.easeFactor = result.easeFactor
        card.interval = result.interval
        card.repetitions = result.repetitions
        card.nextReviewDate = result.nextReviewDate
        card.lastReviewedAt = Date()

        do {
            try modelContext.save()
        } catch {
            print("Failed to save card review: \(error)")
        }

        // Move to next card
        currentCardIndex += 1
        showingAnswer = false

        if currentCardIndex >= dueCards.count {
            studySessionCompleted = true
        }
    }

    func addFlashCard(front: String, back: String) {
        let card = FlashCard(
            front: front,
            back: back,
            nextReviewDate: Date()
        )

        modelContext.insert(card)

        do {
            try modelContext.save()
            loadCards()
        } catch {
            print("Failed to add flashcard: \(error)")
        }
    }

    func resetSession() {
        loadCards()
    }
}
