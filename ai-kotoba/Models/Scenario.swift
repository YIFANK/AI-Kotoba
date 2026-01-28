import Foundation
import SwiftData

@Model
final class Scenario {
    @Attribute(.unique) var id: UUID
    var title: String
    var conversationLines: [ConversationLine]
    var createdAt: Date
    var isFavorite: Bool

    init(id: UUID = UUID(),
         title: String,
         conversationLines: [ConversationLine] = [],
         createdAt: Date = Date(),
         isFavorite: Bool = false) {
        self.id = id
        self.title = title
        self.conversationLines = conversationLines
        self.createdAt = createdAt
        self.isFavorite = isFavorite
    }
}
