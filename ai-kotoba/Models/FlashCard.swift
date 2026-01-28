import Foundation
import SwiftData

@Model
final class FlashCard {
    @Attribute(.unique) var id: UUID
    var front: String
    var back: String

    // SRS fields (SM-2 algorithm)
    var easeFactor: Double
    var interval: Int
    var repetitions: Int
    var nextReviewDate: Date
    var lastReviewedAt: Date?

    init(id: UUID = UUID(),
         front: String,
         back: String,
         easeFactor: Double = 2.5,
         interval: Int = 0,
         repetitions: Int = 0,
         nextReviewDate: Date = Date(),
         lastReviewedAt: Date? = nil) {
        self.id = id
        self.front = front
        self.back = back
        self.easeFactor = easeFactor
        self.interval = interval
        self.repetitions = repetitions
        self.nextReviewDate = nextReviewDate
        self.lastReviewedAt = lastReviewedAt
    }
}
