import Foundation
import SwiftData

// Track user's response and feedback for each line
struct LineResponse: Codable, Identifiable {
    let id = UUID()
    let lineId: UUID
    var userResponse: String?
    var isRevealed: Bool
    var feedback: FeedbackData?

    struct FeedbackData: Codable {
        let score: Int
        let explanation: String
    }
}

// Interactive session state (not persisted to SwiftData, just in-memory)
@Observable
class InteractiveSessionState {
    var scenario: Scenario
    var mode: ConversationMode
    var playingCharacter: PlayingCharacter
    var currentLineIndex: Int
    var lineResponses: [LineResponse]
    var speakers: [String] // List of unique speakers in order of appearance

    init(scenario: Scenario, playingCharacter: PlayingCharacter) {
        self.scenario = scenario
        self.mode = .interactive
        self.playingCharacter = playingCharacter
        self.currentLineIndex = 0

        // Extract unique speakers in order
        var seenSpeakers = Set<String>()
        var speakersInOrder: [String] = []
        for line in scenario.conversationLines.sorted(by: { $0.orderIndex < $1.orderIndex }) {
            if !seenSpeakers.contains(line.speaker) {
                seenSpeakers.insert(line.speaker)
                speakersInOrder.append(line.speaker)
            }
        }
        self.speakers = speakersInOrder

        // Initialize line responses
        self.lineResponses = scenario.conversationLines.map { line in
            LineResponse(lineId: line.id, userResponse: nil, isRevealed: false, feedback: nil)
        }
    }

    var currentLine: ConversationLine? {
        let sortedLines = scenario.conversationLines.sorted(by: { $0.orderIndex < $1.orderIndex })
        guard currentLineIndex < sortedLines.count else { return nil }
        return sortedLines[currentLineIndex]
    }

    var isComplete: Bool {
        currentLineIndex >= scenario.conversationLines.count
    }

    func isUserTurn() -> Bool {
        guard let currentLine = currentLine else { return false }

        switch playingCharacter {
        case .both:
            return true
        case .personA:
            // Person A speaks on even-indexed lines (0, 2, 4, ...)
            return currentLine.orderIndex % 2 == 0
        case .personB:
            // Person B speaks on odd-indexed lines (1, 3, 5, ...)
            return currentLine.orderIndex % 2 == 1
        }
    }

    func nextLine() {
        currentLineIndex += 1
    }

    func updateUserResponse(_ response: String) {
        guard let currentLine = currentLine else { return }

        if let index = lineResponses.firstIndex(where: { $0.lineId == currentLine.id }) {
            lineResponses[index].userResponse = response
        }
    }

    func revealAnswer() {
        guard let currentLine = currentLine else { return }

        if let index = lineResponses.firstIndex(where: { $0.lineId == currentLine.id }) {
            lineResponses[index].isRevealed = true
        }
    }

    func updateFeedback(score: Int, explanation: String) {
        guard let currentLine = currentLine else { return }

        if let index = lineResponses.firstIndex(where: { $0.lineId == currentLine.id }) {
            lineResponses[index].feedback = LineResponse.FeedbackData(
                score: score,
                explanation: explanation
            )
        }
    }

    func getCurrentResponse() -> LineResponse? {
        guard let currentLine = currentLine else { return nil }
        return lineResponses.first(where: { $0.lineId == currentLine.id })
    }
}
