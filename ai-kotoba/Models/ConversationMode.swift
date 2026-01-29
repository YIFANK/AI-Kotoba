import Foundation

enum ConversationMode: String, Codable {
    case regular = "regular"
    case interactive = "interactive"
}

enum PlayingCharacter: String, Codable {
    case personA = "person_a"
    case personB = "person_b"
    case both = "both"

    func shouldPlay(speaker: String) -> Bool {
        switch self {
        case .personA:
            // Assumes first unique speaker is Person A
            return true // Will be checked against actual speaker name
        case .personB:
            return true // Will be checked against actual speaker name
        case .both:
            return true
        }
    }
}
