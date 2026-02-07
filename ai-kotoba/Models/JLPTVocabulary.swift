import Foundation

/// Represents a vocabulary entry from the JLPT library (separate from user's personal VocabularyItem)
struct JLPTVocabulary: Identifiable, Hashable {
    let id: UUID
    let word: String
    let reading: String
    let meaning: String
    let level: JLPTLevel
    let category: String

    init(word: String, reading: String, meaning: String, level: JLPTLevel, category: String) {
        self.id = UUID()
        self.word = word
        self.reading = reading
        self.meaning = meaning
        self.level = level
        self.category = category
    }
}

enum JLPTLevel: String, CaseIterable, Identifiable {
    case n5 = "N5"
    case n4 = "N4"
    case n3 = "N3"
    case n2 = "N2"
    case n1 = "N1"

    var id: String { rawValue }

    var displayName: String {
        rawValue
    }

    var fileName: String {
        "\(rawValue)_vocabulary"
    }
}
