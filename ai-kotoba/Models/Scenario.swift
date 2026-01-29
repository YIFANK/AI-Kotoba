import Foundation
import SwiftData

@Model
final class Scenario {
    @Attribute(.unique) var id: UUID
    var title: String
    var conversationLines: [ConversationLine]
    var vocabularyItems: [VocabularyItemData]?  // Made optional for better migration
    var createdAt: Date
    var isFavorite: Bool

    init(id: UUID = UUID(),
         title: String,
         conversationLines: [ConversationLine] = [],
         vocabularyItems: [VocabularyItemData]? = nil,
         createdAt: Date = Date(),
         isFavorite: Bool = false) {
        self.id = id
        self.title = title
        self.conversationLines = conversationLines
        self.vocabularyItems = vocabularyItems
        self.createdAt = createdAt
        self.isFavorite = isFavorite
    }
}

// Codable struct for storing vocabulary data in scenarios
struct VocabularyItemData: Codable {
    let word: String
    let reading: String
    let meaning: String
    let example: String
}
