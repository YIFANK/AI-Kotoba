import SwiftUI

struct SettingsView: View {
    @State private var apiKey = ""
    @State private var showingAPIKey = false
    @State private var saveMessage: String?
    @State private var saveMessageIsError = false

    var body: some View {
        Form {
            Section("API 配置") {
                HStack {
                    if showingAPIKey {
                        TextField("Claude API 密钥", text: $apiKey)
                    } else {
                        SecureField("Claude API 密钥", text: $apiKey)
                    }

                    Button(action: { showingAPIKey.toggle() }) {
                        Image(systemName: showingAPIKey ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.plain)
                }

                HStack {
                    Button("保存") {
                        saveAPIKey()
                    }
                    .disabled(apiKey.isEmpty)

                    Button("删除") {
                        deleteAPIKey()
                    }
                    .foregroundColor(.red)
                }

                if let message = saveMessage {
                    Text(message)
                        .foregroundColor(saveMessageIsError ? .red : .green)
                        .font(.caption)
                }
            }

            Section("关于") {
                LabeledContent("应用名称", value: "AI-Kotoba")
                LabeledContent("版本", value: "1.0.0")
                LabeledContent("描述", value: "日语学习助手")
            }

            Section("使用说明") {
                Text("""
                1. 在「练习」页面输入场景，AI 会生成日语对话
                2. 点击对话行可以听到日语发音
                3. 在「历史」中查看所有生成的场景
                4. 点击星标将场景添加到收藏夹
                5. 在「词汇」中添加和管理词汇
                6. 使用「复习卡片」进行间隔重复学习
                """)
                .font(.caption)
                .foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
        .onAppear {
            loadAPIKey()
        }
    }

    private func loadAPIKey() {
        if let key = try? APIKeyManager.shared.loadAPIKey() {
            apiKey = key
        }
    }

    private func saveAPIKey() {
        do {
            try APIKeyManager.shared.saveAPIKey(apiKey)
            saveMessage = "API 密钥保存成功"
            saveMessageIsError = false
        } catch {
            saveMessage = "保存失败: \(error.localizedDescription)"
            saveMessageIsError = true
        }
    }

    private func deleteAPIKey() {
        do {
            try APIKeyManager.shared.deleteAPIKey()
            apiKey = ""
            saveMessage = "API 密钥已删除"
            saveMessageIsError = false
        } catch {
            saveMessage = "删除失败: \(error.localizedDescription)"
            saveMessageIsError = true
        }
    }
}
