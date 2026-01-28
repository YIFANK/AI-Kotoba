import Foundation
import SwiftData

@Model
final class VocabularyItem {
    @Attribute(.unique) var id: UUID
    var word: String
    var reading: String
    var meaning: String
    var exampleSentence: String?
    var addedAt: Date

    // SRS fields
    var easeFactor: Double
    var interval: Int
    var repetitions: Int
    var nextReviewDate: Date
    var lastReviewedAt: Date?

    init(id: UUID = UUID(),
         word: String,
         reading: String,
         meaning: String,
         exampleSentence: String? = nil,
         addedAt: Date = Date(),
         easeFactor: Double = 2.5,
         interval: Int = 0,
         repetitions: Int = 0,
         nextReviewDate: Date = Date(),
         lastReviewedAt: Date? = nil) {
        self.id = id
        self.word = word
        self.reading = reading
        self.meaning = meaning
        self.exampleSentence = exampleSentence
        self.addedAt = addedAt
        self.easeFactor = easeFactor
        self.interval = interval
        self.repetitions = repetitions
        self.nextReviewDate = nextReviewDate
        self.lastReviewedAt = lastReviewedAt
    }
}
