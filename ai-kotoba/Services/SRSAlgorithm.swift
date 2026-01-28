import Foundation

struct SRSAlgorithm {
    // SM-2 Algorithm implementation
    // Quality scale: 0-5
    // 0: Complete blackout
    // 1: Incorrect response, but correct one seemed easy to recall
    // 2: Incorrect response, correct one seemed hard to recall
    // 3: Correct response, but required significant effort
    // 4: Correct response, with some hesitation
    // 5: Perfect response

    struct ReviewResult {
        let easeFactor: Double
        let interval: Int
        let repetitions: Int
        let nextReviewDate: Date
    }

    static func calculateNextReview(
        quality: Int,
        currentEaseFactor: Double,
        currentInterval: Int,
        currentRepetitions: Int
    ) -> ReviewResult {
        var easeFactor = currentEaseFactor
        var interval = currentInterval
        var repetitions = currentRepetitions

        // Update ease factor
        easeFactor = max(1.3, easeFactor + (0.1 - Double(5 - quality) * (0.08 + Double(5 - quality) * 0.02)))

        if quality < 3 {
            // Incorrect response - reset repetitions
            repetitions = 0
            interval = 1
        } else {
            // Correct response
            repetitions += 1

            switch repetitions {
            case 1:
                interval = 1
            case 2:
                interval = 6
            default:
                interval = Int(Double(interval) * easeFactor)
            }
        }

        let nextReviewDate = Calendar.current.date(byAdding: .day, value: interval, to: Date()) ?? Date()

        return ReviewResult(
            easeFactor: easeFactor,
            interval: interval,
            repetitions: repetitions,
            nextReviewDate: nextReviewDate
        )
    }
}
