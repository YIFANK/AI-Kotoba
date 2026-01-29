import SwiftUI
import SwiftData

@main
struct AI_KotobaApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Scenario.self,
            ConversationLine.self,
            VocabularyItem.self,
            FlashCard.self
        ])

        // Enable automatic lightweight migration for schema changes
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            allowsSave: true
        )

        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            // If migration fails during development, print detailed error
            print("Failed to create ModelContainer: \(error)")
            print("This usually means a schema change requires migration.")
            print("For development, delete the app and reinstall to clear the database.")
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
    }
}
