import Foundation
import SwiftData

@Model
final class ConversationLine {
    @Attribute(.unique) var id: UUID
    var japaneseText: String
    var chineseTranslation: String
    var speaker: String
    var orderIndex: Int

    init(id: UUID = UUID(),
         japaneseText: String,
         chineseTranslation: String,
         speaker: String,
         orderIndex: Int) {
        self.id = id
        self.japaneseText = japaneseText
        self.chineseTranslation = chineseTranslation
        self.speaker = speaker
        self.orderIndex = orderIndex
    }
}
