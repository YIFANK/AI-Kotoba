import SwiftUI
import SwiftData

enum NavigationItem: String, CaseIterable {
    case practice = "练习"
    case history = "历史"
    case favorites = "收藏"
    case vocabulary = "词汇"
    case flashcards = "复习卡片"
    case settings = "设置"

    var icon: String {
        switch self {
        case .practice: return "text.bubble"
        case .history: return "clock"
        case .favorites: return "star.fill"
        case .vocabulary: return "book"
        case .flashcards: return "rectangle.stack"
        case .settings: return "gear"
        }
    }
}

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var selectedItem: NavigationItem = .practice
    @State private var showingAPIKeySetup = false

    var body: some View {
        NavigationSplitView {
            List(NavigationItem.allCases, id: \.self, selection: $selectedItem) { item in
                Label(item.rawValue, systemImage: item.icon)
            }
            .navigationTitle("AI-Kotoba")
        } detail: {
            Group {
                switch selectedItem {
                case .practice:
                    ScenarioView()
                case .history:
                    HistoryView()
                case .favorites:
                    FavoritesView()
                case .vocabulary:
                    VocabularyView()
                case .flashcards:
                    FlashCardView()
                case .settings:
                    SettingsView()
                }
            }
            .frame(minWidth: 600, minHeight: 400)
        }
        .onAppear {
            checkAPIKey()
        }
        .sheet(isPresented: $showingAPIKeySetup) {
            APIKeySetupView(isPresented: $showingAPIKeySetup)
        }
    }

    private func checkAPIKey() {
        if !APIKeyManager.shared.hasAPIKey() {
            showingAPIKeySetup = true
        }
    }
}

struct APIKeySetupView: View {
    @Binding var isPresented: Bool
    @State private var apiKey = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            Text("欢迎使用 AI-Kotoba")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("请输入您的 Claude API 密钥以开始使用")
                .foregroundColor(.secondary)

            SecureField("API 密钥", text: $apiKey)
                .textFieldStyle(.roundedBorder)
                .frame(width: 400)

            if let errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.caption)
            }

            HStack {
                Button("取消") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("保存") {
                    saveAPIKey()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(apiKey.isEmpty)
            }

            Text("您可以在设置中随时更改 API 密钥")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(40)
        .frame(width: 500, height: 300)
    }

    private func saveAPIKey() {
        do {
            try APIKeyManager.shared.saveAPIKey(apiKey)
            isPresented = false
        } catch {
            errorMessage = "保存 API 密钥失败: \(error.localizedDescription)"
        }
    }
}
